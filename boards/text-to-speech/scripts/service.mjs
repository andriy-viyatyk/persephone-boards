import { isReady, install, remove, supported } from "./downloads.mjs";
import { loadEngine, unloadEngine } from "./engine.mjs";
import { splitSentences } from "./text.mjs";

const languages = "ar bg cs da de el en es et fi fr hi hr hu id it ja ko lt lv nl pl pt ro ru sk sl sv tr uk vi".split(" ");
const voices = Array.from({ length: 10 }, (_, index) => ({ index, name: `Voice ${index}` }));
// Unload the model after ten minutes without queued or running work.
const IDLE_UNLOAD_MS = 10 * 60 * 1000;
let voice = 0, policy = "accept-granted", timer, pumping = false, stopping = false;
let maintenance = false, installController = null, installTask = null, readyCache = null, readyTask = null;
let activeChannel = null;
let state = { phase: "checking", loaded: 0, total: 0, error: "" };
const management = new Set(), idleWaiters = [];
const queue = [];
function setting(id, value) {
  if (id === "default-voice") voice = Number.isInteger(value) && value >= 0 && value <= 9 ? value : 0;
  if (id === "caller-approval-policy") policy = value === "same-board-only" ? value : "accept-granted";
}
persephone.settings.onChange(({ id, value }) => setting(id, value));
const settingsReady = Promise.all(["default-voice", "caller-approval-policy"].map(async id => setting(id, await persephone.settings.get(id)))).catch(() => {});
async function send(channel, message) {
  if (channel.closed) return false;
  try { if (!channel.writable) await channel.whenWritable(); if (channel.closed) return false; channel.send(message); return true; } catch { return false; }
}
function close(channel, reason) { if (!channel.closed) channel.close(reason); }
async function fail(channel, code, message) { await send(channel, { type: "error", code, message }); close(channel); }
async function ready() {
  if (readyCache !== null) return readyCache;
  readyTask ??= isReady();
  try { return readyCache = await readyTask; } finally { readyTask = null; }
}
async function publish() {
  const installed = await ready();
  const snapshot = { type: "snapshot", ...state, ready: installed, supported: supported() };
  await Promise.all([...management].map(channel => send(channel, snapshot)));
}
async function waitForWork() { if (pumping || queue.length) await new Promise(resolve => idleWaiters.push(resolve)); }
async function changeAssets(action) {
  if (maintenance) return;
  maintenance = true;
  clearTimeout(timer);
  state = { phase: "waiting", loaded: 0, total: 0, error: "" }; void publish();
  const controller = new AbortController(); installController = controller;
  try {
    await waitForWork();
    if (controller.signal.aborted || stopping) throw new Error("Cancelled.");
    unloadEngine();
    if (action === "install") {
      let last = 0;
      await install({ signal: controller.signal, onProgress: progress => {
        state = { ...progress, error: "" };
        if (Date.now() - last >= 200) { last = Date.now(); void publish(); }
      } });
    } else await remove();
    readyCache = null; state = { phase: action === "install" ? "ready" : "missing", loaded: 0, total: 0, error: "" };
  } catch (error) {
    readyCache = null;
    state = { phase: controller.signal.aborted ? "cancelled" : "failed", loaded: 0, total: 0, error: controller.signal.aborted ? "" : error?.message || "Operation failed." };
  } finally { installController = null; maintenance = false; await publish(); }
}
function managementCommand(message) {
  if (message?.type === "cancel") { installController?.abort(new Error("Cancelled.")); return; }
  if (message?.type === "install" || message?.type === "delete") {
    if (!maintenance) installTask = changeAssets(message.type).finally(() => { installTask = null; });
  }
}
function idle() { clearTimeout(timer); if (!pumping && !queue.length) { timer = setTimeout(unloadEngine, IDLE_UNLOAD_MS); timer.unref?.(); } }
async function pump() {
  if (pumping) return;
  pumping = true; clearTimeout(timer);
  try {
    while (queue.length && !stopping) {
      const job = queue.shift();
      if (job.channel.closed) continue;
      activeChannel = job.channel;
      try {
        if (!await ready()) { await fail(job.channel, "not-ready", "Install the runtime and model from the board page."); continue; }
        const { sherpa, tts } = await loadEngine();
        for (let i = 0; i < job.sentences.length && !job.channel.closed; i++) {
          const text = job.sentences[i];
          const audio = await tts.generateAsync({ text, enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig({ sid: job.voice, speed: job.speed, extra: { lang: job.lang } }) });
          if (job.channel.closed) break;
          for (let start = 0; start < audio.samples.length && !job.channel.closed; start += 65536) {
            const samples = audio.samples.subarray(start, start + 65536);
            const data = new ArrayBuffer(samples.length * 4), view = new DataView(data);
            for (let n = 0; n < samples.length; n++) view.setFloat32(n * 4, samples[n], true);
            if (!await send(job.channel, { type: "audio", data, sampleRate: audio.sampleRate, encoding: "pcm-f32le", sentence: i, text })) break;
          }
        }
        if (!job.channel.closed) { await send(job.channel, { type: "done" }); close(job.channel); }
      } catch (error) { if (!job.channel.closed) await fail(job.channel, "engine-failed", error?.message || "Synthesis failed."); }
      finally { activeChannel = null; }
    }
  } finally { pumping = false; for (const resolve of idleWaiters.splice(0)) resolve(); if (!maintenance) idle(); if (stopping) unloadEngine(); }
}
persephone.service.onChannel(async (channel, open, info) => {
  const early = [];
  const stopEarly = channel.onMessage(message => early.push(message));
  channel.onClose(() => { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].channel === channel) queue.splice(i, 1); });
  await settingsReady;
  if (channel.closed) return;
  const cross = Boolean(info?.interface);
  if (cross && (policy !== "accept-granted" || info.interface.id !== "speech.synthesize" || info.interface.version !== 1)) return close(channel, { code: "connection-refused", message: "Caller refused." });
  if (!cross && open?.type === "downloads") {
    stopEarly();
    management.add(channel);
    channel.onClose(() => management.delete(channel));
    channel.onMessage(managementCommand);
    for (const message of early) managementCommand(message);
    if (state.phase === "checking") { const installed = await ready(); if (state.phase === "checking") state.phase = installed ? "ready" : "missing"; }
    await publish();
    return;
  }
  if (open?.type === "describe") { await send(channel, { type: "description", local: true, languages, voices, defaultVoice: voice, sampleRate: 44100, encoding: "pcm-f32le" }); return close(channel); }
  if (open?.type !== "speak" || typeof open.text !== "string" || !open.text.trim() || typeof open.lang !== "string" || (open.speed !== undefined && (typeof open.speed !== "number" || !Number.isFinite(open.speed) || open.speed < 0.5 || open.speed > 2))) return fail(channel, "invalid-argument", "Invalid speech request.");
  if (maintenance || stopping) return fail(channel, "not-ready", "The runtime or model is being changed.");
  if (!languages.includes(open.lang)) return fail(channel, "unsupported-language", "Unsupported language.");
  const selected = open.voice === undefined ? voice : open.voice;
  if (!Number.isInteger(selected) || selected < 0 || selected > 9) return fail(channel, "unsupported-voice", "Unsupported voice.");
  const sentences = splitSentences(open.text);
  if (!sentences.length) return fail(channel, "invalid-argument", "Text contains no speakable content.");
  queue.push({ channel, sentences, voice: selected, speed: open.speed ?? 1, lang: open.lang });
  void pump();
});
persephone.service.onShutdown(async () => {
  stopping = true; clearTimeout(timer); installController?.abort(new Error("Service shutting down."));
  if (activeChannel) close(activeChannel);
  for (const job of queue.splice(0)) close(job.channel);
  if (!pumping) { for (const resolve of idleWaiters.splice(0)) resolve(); unloadEngine(); }
  await installTask?.catch(() => {});
});
