import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { add, list, remove, scoreAgainstEarlier, templates } from "./enrollments.mjs";
import { StreamingFrontend, embed, encodeTemplate, matchWindow, pcmToFloat, sampleDistance, similarity, subsequenceDistance } from "./engine.mjs";

const MODEL = fileURLToPath(new URL("../model/speech-embedding.onnx", import.meta.url));
const MAX_ENROLL_BYTES = 16000 * 2 * 3;
const DEFAULT_THRESHOLD = 0.85;
const diagnosticChannels = new Set();
const formatOK = (value) => value?.encoding === "pcm-s16le" && value.sampleRate === 16000 && value.channels === 1;
const validText = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 128;
const send = async (channel, message) => {
  if (channel.closed) return false;
  try { if (!channel.writable) await channel.whenWritable(); if (channel.closed) return false; channel.send(message); return true; } catch { return false; }
};
const close = (channel, reason) => { if (!channel.closed) channel.close(reason); };
function fail(channel, code, message) { void send(channel, { type: "error", code, message }).finally(() => close(channel)); }
function checkedRuntime() {
  return existsSync(MODEL) && existsSync(path.resolve(path.dirname(MODEL), "../vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"));
}
function isOwnPage(info) { return !info?.interface; }
async function allowed(info) {
  const setting = await persephone.settings.get("caller-approval-policy").catch(() => "accept-granted");
  // A channel without interface metadata comes from this board's own page: other boards and the app
  // always reach a provider through an interface. (`info.page.boardId` is the page instance id, not
  // the board folder name.)
  if (isOwnPage(info)) return true;
  return setting === "accept-granted" && info?.interface?.id === "speech.wake" && info.interface.version === 1;
}
function quality(samples) {
  const rms = (start, end) => { let sum = 0; for (let i = start; i < end; i++) sum += samples[i] * samples[i]; return Math.sqrt(sum / Math.max(1, end - start)); };
  const window = 1600, levels = [];
  for (let start = 0; start + window <= samples.length; start += window) levels.push({ start, end: start + window, rms: rms(start, start + window) });
  const noise = levels.length ? [...levels].map((x) => x.rms).sort((a, b) => a - b)[Math.floor((levels.length - 1) * 0.2)] : 0;
  const active = levels.filter((x) => x.rms > Math.max(0.006, noise * 2.4));
  if (!active.length || active.reduce((n, x) => n + x.rms, 0) / active.length < 0.009) return { accepted: false, reason: "silence" };
  const speechStart = active[0].start, speechEnd = active.at(-1).end;
  if ((speechEnd - speechStart) / 16 < 200) return { accepted: false, reason: "short" };
  let peak = 0; for (let i = speechStart; i < speechEnd; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.995 || peak < 0.02) return { accepted: false, reason: "noise" };
  return { accepted: true, speechStart, speechEnd };
}

async function handle(channel, open, info, inbox, stopInbox) {
  if (!await allowed(info)) { close(channel, { code: "connection-refused", message: "This provider does not accept this caller." }); return; }
  if (!open || typeof open !== "object" || typeof open.type !== "string") throw Object.assign(new Error("Invalid opening request."), { code: "invalid-argument" });
  if (open.type === "diagnostics") {
    if (!isOwnPage(info)) { close(channel, { code: "connection-refused", message: "Diagnostics are private to this board." }); return; }
    diagnosticChannels.add(channel); channel.onClose(() => diagnosticChannels.delete(channel));
    await send(channel, { type: "diagnostics-ready" }); return;
  }
  if (open.type === "describe") {
    await send(channel, { type: "description", local: true, features: [], defaultThreshold: DEFAULT_THRESHOLD, maxEnrollMs: 3000 });
    close(channel); return;
  }
  if (open.type === "list") {
    await send(channel, { type: "enrollments", phrases: await list() }); close(channel); return;
  }
  if (open.type === "delete") {
    const t = open.target;
    const valid = t && typeof t === "object" && ((validText(t.phrase) && ["wake", "stop"].includes(t.kind) && Object.keys(t).every((k) => ["phrase", "kind"].includes(k))) || (validText(t.person) && Object.keys(t).every((k) => k === "person")) || (validText(t.sampleId) && Object.keys(t).every((k) => k === "sampleId")));
    if (!valid) throw Object.assign(new Error("Delete target is invalid."), { code: "invalid-argument" });
    await send(channel, { type: "deleted", count: await remove(t) }); close(channel); return;
  }
  if (open.type === "enroll") {
    if (!validText(open.phrase) || !validText(open.person) || !["wake", "stop"].includes(open.kind) || !formatOK(open.format)) throw Object.assign(new Error("Enrollment arguments or audio format are invalid."), { code: formatOK(open.format) ? "invalid-argument" : "unsupported-format" });
  } else if (open.type === "listen") {
    if (!formatOK(open.format)) throw Object.assign(new Error("Only mono 16 kHz PCM s16le is supported."), { code: "unsupported-format" });
    if (open.threshold !== undefined && (!Number.isFinite(open.threshold) || open.threshold < 0 || open.threshold > 1)) throw Object.assign(new Error("Threshold must be finite and in [0, 1]."), { code: "invalid-argument" });
    if (!(await templates()).length) throw Object.assign(new Error("Enroll at least one wake or stop phrase first."), { code: "no-enrollments" });
  } else throw Object.assign(new Error("Unknown operation."), { code: "invalid-argument" });
  if (!checkedRuntime()) throw Object.assign(new Error("The bundled model or runtime is missing."), { code: "not-ready" });

  const audio = []; let bytes = 0, ended = false, sampleCount = 0;
  const pushAudio = (message) => {
    if (ended) throw Object.assign(new Error("Audio arrived after end."), { code: "invalid-argument" });
    if (!message || typeof message !== "object") throw Object.assign(new Error("Expected an audio or end message."), { code: "invalid-argument" });
    if (message.type === "end") { ended = true; return; }
    if (message.type !== "audio" || !(message.data instanceof ArrayBuffer) || message.data.byteLength % 2 || message.data.byteLength > 32000) throw Object.assign(new Error("Audio chunks must be even-byte PCM ArrayBuffers no larger than one second."), { code: "invalid-argument" });
    bytes += message.data.byteLength;
    if (open.type === "enroll" && bytes > MAX_ENROLL_BYTES) throw Object.assign(new Error("Enrollment exceeds 3000 ms."), { code: "too-long" });
    if (bytes > 16000 * 2 * 60 * 60) throw Object.assign(new Error("Audio queue limit exceeded."), { code: "engine-failed" });
    audio.push(message.data.slice(0));
  };
  if (open.type === "enroll") while (inbox.length) pushAudio(inbox.shift());
  stopInbox();
  const unregister = channel.onMessage((message) => {
    if (open.type === "listen") {
      if (inbox.length >= 256) { fail(channel, "engine-failed", "The incoming audio queue is full."); return; }
      inbox.push(message); return;
    }
    try { pushAudio(message); } catch (e) { fail(channel, e.code || "invalid-argument", e.message); }
  });
  channel.onClose(() => { unregister?.(); audio.length = 0; });
  try {
    if (open.type === "enroll") {
      while (!ended && !channel.closed) { if (!inbox.length) await new Promise((resolve) => setTimeout(resolve, 10)); while (inbox.length) pushAudio(inbox.shift()); }
      if (channel.closed) return;
      const joined = new Uint8Array(bytes); let offset = 0; for (const part of audio) { joined.set(new Uint8Array(part), offset); offset += part.byteLength; }
      const clip = pcmToFloat(joined.buffer), assessed = quality(clip);
      if (!assessed.accepted) { await send(channel, { type: "enrolled", sampleId: "", quality: { accepted: false, reason: assessed.reason }, match: null }); close(channel); return; }
      const embeddings = await encodeTemplate(clip, assessed.speechStart, assessed.speechEnd);
      if (!embeddings.length) { await send(channel, { type: "enrolled", sampleId: "", quality: { accepted: false, reason: "short" }, match: null }); close(channel); return; }
      const match = await scoreAgainstEarlier(embeddings, open.phrase, open.kind, open.person, (a, b) => similarity(sampleDistance(a, b)));
      const saved = await add({ phrase: open.phrase, kind: open.kind, person: open.person, embeddings });
      await send(channel, { type: "enrolled", sampleId: saved.sampleId, quality: { accepted: true }, match }); close(channel); return;
    }

    const threshold = open.threshold ?? DEFAULT_THRESHOLD, frontend = new StreamingFrontend(), history = [], refractory = new Map();
    let activeUntil = 0, gated = false, lastDiagnostic = 0;
    const samples = await templates();
    while (!ended && !channel.closed) {
      if (!inbox.length) { await new Promise((resolve) => setTimeout(resolve, 10)); continue; }
      const message = inbox.shift();
      if (message.type === "end") { ended = true; break; }
      if (message.type !== "audio" || !(message.data instanceof ArrayBuffer) || message.data.byteLength % 2) throw Object.assign(new Error("Invalid audio chunk."), { code: "invalid-argument" });
      const pcm = pcmToFloat(message.data); sampleCount += pcm.length;
      let energy = 0; for (const sample of pcm) energy += sample * sample;
      const loud = Math.sqrt(energy / Math.max(1, pcm.length)) > 0.006;
      if (loud) { gated = true; activeUntil = sampleCount + 6400; }
      else if (sampleCount > activeUntil) gated = false;
      frontend.push(pcm);
      const windows = frontend.takeReady();
      if (!gated) { if (history.length) history.length = 0; continue; }
      for (const window of windows) {
        const vector = await embed(window.features); history.push(Array.from(vector));
        if (history.length > 100) history.shift();
        let best = null;
        for (const sample of samples) {
          if (history.length < sample.embeddings.length) continue;
          const distance = subsequenceDistance(sample.embeddings, matchWindow(sample.embeddings, history));
          if (!best || distance < best.distance) best = { sample, distance };
        }
        const score = best ? similarity(best.distance) : 0;
        if (best && score >= threshold) {
          const key = `${best.sample.phrase}\0${best.sample.person}\0${best.sample.kind}`, now = window.sampleEnd / 16;
          if (now - (refractory.get(key) ?? -Infinity) >= 1500) {
            refractory.set(key, now);
            await send(channel, { type: best.sample.kind, phrase: best.sample.phrase, person: best.sample.person, score, time: now });
          }
        }
        const now = Date.now();
        if (now - lastDiagnostic >= 250) {
          lastDiagnostic = now;
          await Promise.all([...diagnosticChannels].map((diagnostic) => send(diagnostic, { type: "diagnostic", score, threshold, time: window.sampleEnd / 16 })));
        }
      }
    }
    if (!channel.closed) await send(channel, { type: "done" });
  } finally { unregister?.(); audio.length = 0; close(channel); }
}

persephone.service.onChannel((channel, open, info) => {
  const inbox = []; let early = true, bufferedBytes = 0;
  let off;
  const stopInbox = () => { early = false; off?.(); };
  channel.onClose(() => { early = false; inbox.length = 0; });
  off = channel.onMessage((message) => {
    if (!early) return;
    if (inbox.length >= 256) { fail(channel, "engine-failed", "The incoming channel queue is full."); return; }
    const chunkBytes = message?.type === "audio" && message.data instanceof ArrayBuffer ? message.data.byteLength : 0;
    bufferedBytes += chunkBytes;
    if (open?.type === "enroll" && bufferedBytes > MAX_ENROLL_BYTES) { fail(channel, "too-long", "Enrollment exceeds 3000 ms."); return; }
    if (bufferedBytes > 1024 * 1024) { fail(channel, "engine-failed", "The early audio buffer limit was exceeded."); return; }
    inbox.push(message);
  });
  void (async () => {
    try { await handle(channel, open, info, inbox, stopInbox); }
    catch (error) { fail(channel, error.code || "engine-failed", error.message || "The wake engine failed."); }
  })();
});
