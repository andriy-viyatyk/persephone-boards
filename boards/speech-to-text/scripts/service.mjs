"use strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { assetSnapshot, dataRoot, downloadVerified, installRuntime, MODELS, RUNTIME, sha256File, stopProcessTree, verifyRuntime } from "./downloads.mjs";
import { languageCodeForName, languageNameForCode } from "./whisper-languages.mjs";
import { LiveStream, LIVE_TUNING } from "./live.mjs";

// Queue pressure is shared by all live channels using the single whisper-server.
const MAX_AUDIO_MS = 300000;
const LIVE_QUEUE_TUNING = {
  draftPartialSkipMs: 60000, // Skip draft and partial inference when queued commits reach one minute.
  queuedCommitHardCapMs: 300000, // Stop live intake and drain accepted commits at five minutes queued.
};
const MAX_RETRY_LANGUAGES = 3;
const SETTING_IDS = ["language-hints", "vocabulary-prompt", "use-gpu", "idle-unload-minutes", "caller-approval-policy"];
const ACTIVE_MODEL_KEY = "speech-to-text.active-model";
const DEFAULT_MODEL = MODELS[0].file;
const root = dataRoot();
const modelByName = new Map(MODELS.map((model) => [model.file, model]));
const requests = new Set(), liveRequests = new Set(), queue = [], management = new Set(), downloads = new Map();
const verifiedModels = new Map();
let engine = null, engineGeneration = 0, activeRequest = null, engineTask = null;
let idleTimer = null, stopping = false, queuePump = null, lastUseAt = 0;
let settings = { gpu: true, idleMinutes: 10, approval: "accept-granted", vocabulary: "", languages: ["app", "en"] };

const send = async (channel, message) => {
  if (channel.closed) return false;
  try {
    if (!channel.writable) await channel.whenWritable();
    if (channel.closed) return false;
    channel.send(message);
    return true;
  } catch { return false; }
};
const close = (channel, reason) => { if (!channel.closed) channel.close(reason); };
const removeJobs = (request) => { let removed = 0; for (let i = queue.length - 1; i >= 0; i--) if (queue[i].request === request) { queue.splice(i, 1); removed++; } request.pending = Math.max(0, request.pending - removed); };
const queuedCommitSamples = () => queue.reduce((samples, job) => samples + (job.kind === "commit" ? job.range.end - job.range.start : 0), activeRequest?.kind === "commit" ? activeRequest.range.end - activeRequest.range.start : 0);
const queuedCommitMs = () => queuedCommitSamples() / 16;
const liveQueueHardCapped = () => queuedCommitMs() >= LIVE_QUEUE_TUNING.queuedCommitHardCapMs;
function discardQueuedLowPriority() {
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i];
    if (job.kind !== "draft" && job.kind !== "partial") continue;
    queue.splice(i, 1);
    job.request.pending = Math.max(0, job.request.pending - 1);
    if (job.kind === "partial") {
      job.request.partialPending = false;
      job.request.stream?.segmenter.partialComplete(job.request.stream.samples, job.range.utterance);
    }
    liveDone(job.request);
  }
}
const liveDone = (request) => { if (!request.pending) for (const resolve of request.waiters.splice(0)) resolve(); };
const terminal = async (request, message) => {
  if (request.terminal) return;
  request.terminal = true;
  request.chunks.length = 0;
  requests.delete(request);
  liveRequests.delete(request);
  removeJobs(request);
  request.controller?.abort(new Error("Request ended."));
  if (request.stream) { await request.stream.stop(); request.stream.clear(); }
  await send(request.channel, message);
  close(request.channel);
  liveDone(request);
  if (engine && !activeRequest && queue.length === 0) scheduleIdleStop();
};
const publishManagement = async (extra = {}) => {
  const installed = await assetSnapshot(root).catch(() => ({ runtime: false, models: {}, licenses: [] }));
  const activeModel = await getActiveModel();
  const snapshot = { type: "snapshot", assets: installed, activeModel, runtimeVersion: RUNTIME.displayVersion, engine: engine ? "running" : "stopped", progress: [...downloads.values()].map(({ asset, phase, loaded, total, error }) => ({ asset, phase, loaded, total, ...(error ? { error } : {}) })), ...extra };
  await Promise.all([...management].map((channel) => send(channel, snapshot)));
};
async function getActiveModel() {
  const value = await persephone.storage.get(ACTIVE_MODEL_KEY).catch(() => undefined);
  if (modelByName.has(value)) return value;
  await persephone.storage.set(ACTIVE_MODEL_KEY, DEFAULT_MODEL).catch(() => {});
  return DEFAULT_MODEL;
}
const installedModel = async (name) => {
  const model = modelByName.get(name);
  if (!model) return false;
  const file = path.join(root, "models", model.file);
  if (!verifiedModels.has(name)) verifiedModels.set(name, (async () => {
    const info = await stat(file).catch(() => null);
    return Boolean(info?.isFile() && info.size === model.bytes && await sha256File(file).then((hash) => hash === model.sha256).catch(() => false));
  })());
  return verifiedModels.get(name);
};
// Hashing the runtime costs a pass over ~20 MB, so verify once and redo it only after install or remove.
let runtimeVerified = null;
const installedRuntime = () => runtimeVerified ??= verifyRuntime(root).catch(() => false);
function checkCaller(info) {
  if (!info?.interface) return true;
  return settings.approval === "accept-granted" && info.interface.id === "speech.transcribe" && info.interface.version === 1;
}
const refuse = (channel) => close(channel, { code: "connection-refused", message: "This provider does not accept this caller." });
const failOpen = (channel, code, message) => { void send(channel, { type: "error", code, message }); close(channel); };
function validFormat(format) {
  return format?.encoding === "pcm-s16le" && format.sampleRate === 16000 && format.channels === 1;
}

async function pickPort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function stopEngine() {
  clearTimeout(idleTimer); idleTimer = null;
  if (!engine) return;
  const old = engine;
  engine = null;
  engineGeneration++;
  old.controller?.abort(new Error("Engine configuration changed."));
  await stopProcessTree(old.child, 1400);
}
async function startEngine(modelName) {
  const model = modelByName.get(modelName);
  if (!model) throw new Error("The active model is unsupported.");
  const executable = path.join(root, "runtime", RUNTIME.id, "whisper-server.exe");
  const modelPath = path.join(root, "models", model.file);
  const fingerprint = `${model.file}:${settings.gpu}`;
  if (engine?.fingerprint === fingerprint && engine.child.exitCode === null && engine.ready) return engine;
  if (engine) await stopEngine();
  const port = await pickPort();
  const args = ["--host", "127.0.0.1", "--port", String(port), "--model", modelPath];
  if (!settings.gpu) args.push("--no-gpu");
  const child = spawn(executable, args, { windowsHide: true, cwd: path.dirname(executable), stdio: "ignore" });
  const record = { child, port, fingerprint, generation: ++engineGeneration, ready: false, controller: null, error: null };
  engine = record;
  child.once("error", (error) => { record.error = error; if (engine === record) engine = null; });
  child.once("exit", () => { if (engine === record) { engine = null; void publishManagement(); } });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (record.error) throw record.error;
    if (child.exitCode !== null) throw new Error("whisper-server exited during startup.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.text()).includes("ok")) { record.ready = true; return record; }
    } catch { /* Wait for the local server to bind and load its model. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopEngine();
  throw new Error("whisper-server did not become ready in time.");
}
async function ensureEngine(modelName) {
  if (engineTask) await engineTask.catch(() => {});
  if (engine?.fingerprint === `${modelName}:${settings.gpu}` && engine.ready && engine.child.exitCode === null) return engine;
  const task = startEngine(modelName);
  engineTask = task;
  try { return await task; }
  finally { if (engineTask === task) engineTask = null; }
}
function scheduleIdleStop() {
  clearTimeout(idleTimer);
  if (liveRequests.size) { idleTimer = null; return; }
  const minutes = Math.max(1, Math.min(120, Number(settings.idleMinutes) || 10));
  const idleMs = minutes * 60000;
  const remaining = lastUseAt ? Math.max(0, idleMs - (Date.now() - lastUseAt)) : idleMs;
  idleTimer = setTimeout(() => {
    if (!activeRequest && queue.length === 0 && liveRequests.size === 0) void stopEngine().then(() => publishManagement());
  }, remaining);
  idleTimer.unref?.();
}
function makeWav(chunks, totalBytes) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + totalBytes, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(totalBytes, 40);
  return new Blob([header, ...chunks]);
}
function parseLanguages(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.filter((item) => typeof item === "string").map((item) => item.trim().toLowerCase()).filter((code) => languageNameForCode(code)))];
}
function parseLanguageHints(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.filter((item) => typeof item === "string").map((item) => item.trim()).flatMap((item) => {
    if (item === "app") return [item];
    const code = item.toLowerCase();
    return languageNameForCode(code) ? [code] : [];
  }))];
}
function appLocaleLanguage() {
  const locale = process.env.PERSEPHONE_LOCALE;
  if (typeof locale !== "string" || !locale.trim()) return null;
  const code = locale.trim().split(/[-_]/, 1)[0].toLowerCase();
  return languageNameForCode(code) ? code : null;
}
// A caller's own languages win; otherwise the board's "Languages" setting applies to every caller.
function allowedLanguages(requested) {
  const own = parseLanguages(requested);
  if (own.length) return own;
  return [...new Set(settings.languages.flatMap((code) => {
    if (code !== "app") return [code];
    const locale = appLocaleLanguage();
    return locale ? [locale] : [];
  }))];
}
async function inferOnce(request, server, wav, language, prompt = request.prompt || settings.vocabulary || "", timestamps = false, probabilities = false) {
  const form = new FormData();
  form.append("file", wav, "speech.wav");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0.0");
  form.append("no_timestamps", timestamps ? "false" : "true");
  // Probabilities cost a separate detection pass (~1.3 s), so only detection passes ask for them.
  form.append("no_language_probabilities", probabilities ? "false" : "true");
  // whisper-server splits segments at 60 characters; without this the split can fall inside a word ("т" + "екст").
  form.append("split_on_word", "true");
  form.append("language", language);
  form.append("prompt", prompt);
  const response = await fetch(`http://127.0.0.1:${server.port}/inference`, { method: "POST", body: form, signal: request.controller.signal });
  if (!response.ok) throw new Error(`whisper-server returned HTTP ${response.status}.`);
  const result = await response.json();
  if (typeof result.text !== "string") throw new Error("whisper-server returned an invalid response.");
  return result;
}
// The probability whisper gave a language code on a detection pass (0 when it was not reported).
function languageProbability(result, code) {
  const probabilities = result?.language_probabilities;
  return probabilities && typeof probabilities === "object" && typeof probabilities[code] === "number" ? probabilities[code] : 0;
}
// Keep a detected language that is allowed; otherwise re-run in the allowed language whisper rated likeliest.
// Whisper often hears Ukrainian as Russian, and without probabilities this used to fall back to the first
// allowed code, which with "en,uk" forced English and translated the Ukrainian speech.
async function settleDetectedLanguage(request, server, wav, prompt, timestamps, allowed, result) {
  const detected = languageCodeForName(result.language);
  if (!allowed.length || allowed.includes(detected)) return { language: detected, result };
  const language = allowed.reduce((best, code) => languageProbability(result, code) > languageProbability(result, best) ? code : best, allowed[0]);
  const forced = await inferOnce(request, server, wav, language, prompt, timestamps);
  return { language, result: { ...forced, language_probabilities: result.language_probabilities } };
}
// Token-weighted average log probability of the decoded text; higher means whisper was more certain.
function confidence(result) {
  let total = 0, tokens = 0;
  for (const segment of Array.isArray(result.segments) ? result.segments : []) {
    const count = Array.isArray(segment.tokens) ? segment.tokens.length : 0;
    if (count && Number.isFinite(segment.avg_logprob)) { total += segment.avg_logprob * count; tokens += count; }
  }
  return tokens ? total / tokens : -Infinity;
}
function audioRange(request, range) {
  if (request.live) return request.stream.slice(range.start, range.end);
  return request.chunks;
}
function jobWav(request, range) {
  const chunks = audioRange(request, range);
  const bytes = chunks.reduce((total, chunk) => total + chunk.length, 0);
  return { wav: makeWav(chunks, bytes), bytes };
}
// Whitespace tokens keep their punctuation and case for emitted text; comparison uses the normalized form.
const splitWords = (text) => String(text || "").split(/\s+/).filter(Boolean);
const normalizeWord = (word) => word.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, "");
const normalizedWords = (text) => splitWords(text).map((word) => ({ original: word, normalized: normalizeWord(word) })).filter((word) => word.normalized);
// Whisper rewrites committed words between passes ("14" -> "14-й", "фраз" -> "фраза"); treat those as the same word.
function sameWord(left, right) {
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 2 && long.startsWith(short) && long.length - short.length <= 2;
}
function alignCommitted(words, committed) {
  const norms = words.map((word) => word.normalized), prefix = committed.map((word) => word.normalized);
  if (!prefix.length) return { offset: 0, matched: 0 };
  let at = 0;
  while (at < prefix.length && at < norms.length && sameWord(norms[at], prefix[at])) at++;
  if (at === prefix.length) return { offset: at, matched: at };
  // Whisper may reword or drop committed words; they sit at the start of the window, so look near it.
  const reach = Math.min(norms.length, prefix.length + 3);
  for (let length = Math.min(prefix.length, reach); length > 0; length--) {
    const suffix = prefix.slice(-length);
    const found = norms.findIndex((_, index) => index + length <= reach && suffix.every((word, offset) => index + offset < norms.length && sameWord(norms[index + offset], word)));
    if (found >= 0) return { offset: found + length, matched: length };
  }
  // No anchor: committed words are still in this window (trims stop at fully committed segments), so skip that many.
  return { offset: Math.min(prefix.length, norms.length), matched: 0 };
}
function longestCommonPrefix(sequences) {
  if (!sequences.length) return [];
  let length = Math.min(...sequences.map((sequence) => sequence.length));
  for (let index = 0; index < length; index++) {
    if (sequences.some((sequence) => sequence[index].normalized !== sequences[0][index].normalized)) { length = index; break; }
  }
  return sequences[0].slice(0, length);
}
async function infer(request, server, job) {
  const { wav, bytes } = jobWav(request, job.range);
  const allowed = allowedLanguages(request.languages);
  const committedText = request.live ? request.promptTail : "";
  const basePrompt = request.live ? (request.prompt || settings.vocabulary || "").slice(0, 400) : request.prompt || settings.vocabulary || "";
  const prompt = committedText ? `${basePrompt}${basePrompt ? " " : ""}${committedText}` : basePrompt;
  const latched = request.live && request.latchedLanguage;
  const timestamps = Boolean(request.live && request.partialMode && (job.kind === "partial" || job.kind === "commit"));
  let language, result, forcedLanguage = false;
  const startedAt = Date.now();
  if (job.kind === "partial") {
    const forced = latched || (allowed.length === 1 ? allowed[0] : null);
    language = forced || "auto";
    forcedLanguage = Boolean(forced);
    result = await inferOnce(request, server, wav, language, prompt, timestamps, !forced);
    if (!forced) {
      ({ language, result } = await settleDetectedLanguage(request, server, wav, prompt, timestamps, allowed, result));
      // Detecting the language makes every pass slower, so a confident pass fixes it until the utterance commits.
      if (job.speechSamples >= LIVE_TUNING.languageLatchSpeechMs * 16 && languageProbability(result, language) >= LIVE_TUNING.languageLatchMinProbability) request.latchedLanguage = language;
    }
    return { text: result.text.trim(), language, segments: result.segments, forcedLanguage, elapsedPassMs: Date.now() - startedAt, speechSamples: job.speechSamples, range: job.range };
  }
  // A live commit re-detects even when latched, so a wrong early latch corrects itself at the next utterance.
  if (allowed.length === 1 || (latched && !(request.live && job.kind === "commit"))) {
    language = allowed.length === 1 ? allowed[0] : latched;
    forcedLanguage = true;
    result = await inferOnce(request, server, wav, language, prompt, timestamps);
  } else if (job.kind === "draft") {
    result = await inferOnce(request, server, wav, "auto", prompt, timestamps);
    language = languageCodeForName(result.language);
    if (allowed.length && !allowed.includes(language)) return null;
  } else {
    if (allowed.length === 1) {
      language = allowed[0];
      result = await inferOnce(request, server, wav, language, prompt, timestamps);
    } else {
      result = await inferOnce(request, server, wav, "auto", prompt, timestamps, request.live);
      language = languageCodeForName(result.language);
      if (request.live) ({ language, result } = await settleDetectedLanguage(request, server, wav, prompt, timestamps, allowed, result));
      else if (allowed.length && !allowed.includes(language)) {
        let best = null;
        for (const code of allowed.slice(0, MAX_RETRY_LANGUAGES)) {
          const candidate = await inferOnce(request, server, wav, code, prompt, timestamps);
          if (!best || confidence(candidate) > confidence(best.result)) best = { code, result: candidate };
        }
        language = best.code;
        result = best.result;
      }
    }
    if (request.live && job.speechSamples >= 32000 && language) request.latchedLanguage = language;
  }
  const text = request.live ? result.text.trim() : result.text;
  if (!request.live) return { text, language, audioMs: Math.round(bytes / 32000 * 1000), elapsedMs: Math.max(0, Date.now() - request.endedAt) };
  return { text, language, segments: result.segments, forcedLanguage, elapsedPassMs: Date.now() - startedAt, speechSamples: job.speechSamples, range: job.range, audioMs: Math.round(request.bytes / 32000 * 1000), elapsedMs: Math.max(0, Date.now() - request.startedAt) };
}
function draftIsStale(job) {
  const request = job.request;
  if (job.kind !== "draft" && job.kind !== "partial") return false;
  return request.terminal || request.draftsInvalid || request.finishedIds.has(job.range.utterance) ||
    queue.some((item) => item.request === request && item.range.utterance === job.range.utterance && (item.kind === "commit" || item.kind === "draft" && item.version > job.version));
}
// The prompt carries only words whose audio has left the window: a prompt repeating words the
// audio still holds makes Whisper skip ahead, and the alignment then drops the words between.
function addPromptTail(request, words) {
  const text = words.map((word) => word.original).join(" ");
  if (text) request.promptTail = `${request.promptTail}${request.promptTail ? " " : ""}${text}`.slice(-200);
}
async function emitSegment(request, utterance, words, language, range, final = false) {
  const deliver = async (message) => {
    if (!request.channel.writable) await request.channel.whenWritable();
    if (!final && (request.finishedIds.has(utterance) || request.draftsInvalid)) return false;
    return send(request.channel, message);
  };
  if (!words.length) {
    if (final) await deliver({ type: "segment", utterance, text: "", language, startMs: Math.round(range.start / 16), endMs: Math.round(range.end / 16) });
    return true;
  }
  const text = words.map((word) => word.original).join(" ");
  if (!await deliver({ type: "segment", utterance, text, language, startMs: Math.round(range.start / 16), endMs: Math.round(range.end / 16) })) return false;
  request.committedText += `${request.committedText ? " " : ""}${text}`;
  request.lastCommittedLanguage = language;
  request.committedInWindow.push(...words);
  return true;
}
async function sendLiveDraft(request, utterance, text, range) {
  if (!request.channel.writable) await request.channel.whenWritable();
  if (request.finishedIds.has(utterance) || request.terminal || request.draftsInvalid) return;
  await send(request.channel, { type: "draft", utterance, text, startMs: Math.round(range.start / 16), endMs: Math.round(range.end / 16) });
}
async function commitStablePartial(request, job, result) {
  if (!result || request.terminal || request.draftsInvalid || request.finishedIds.has(job.range.utterance)) return;
  const latestWords = normalizedWords(result.text);
  request.hypotheses.push({ words: latestWords, language: result.language, segments: result.segments, range: job.range });
  request.hypotheses = request.hypotheses.slice(-LIVE_TUNING.agreementCount);
  const aligned = request.hypotheses.map((hypothesis) => ({ hypothesis, words: hypothesis.words.slice(alignCommitted(hypothesis.words, request.committedInWindow).offset) }));
  const sameLanguage = aligned.length === LIVE_TUNING.agreementCount && aligned.every(({ hypothesis }) => hypothesis.language && hypothesis.language === aligned[0].hypothesis.language);
  const agreed = sameLanguage ? longestCommonPrefix(aligned.map(({ words }) => words).reverse()) : [];
  // The latest pass may end mid-word ("т" of "текст"), so its last word waits for the next pass.
  const stable = agreed.slice(0, Math.max(0, Math.min(agreed.length, aligned.at(-1).words.length - 1)));
  if (stable.length >= LIVE_TUNING.minNewWords) {
    if (!await emitSegment(request, job.range.utterance, stable, result.language, job.range)) return;
    if (!request.latchedLanguage && result.speechSamples >= 32000 && sameLanguage) request.latchedLanguage = result.language;
  }
  const tail = latestWords.slice(alignCommitted(latestWords, request.committedInWindow).offset);
  if (tail.length && !request.finishedIds.has(job.range.utterance)) {
    await sendLiveDraft(request, job.range.utterance, tail.map((word) => word.original).join(" "), job.range);
  }
  if (sameLanguage) trimCommittedWindow(request, job, result);
}
function trimCommittedWindow(request, job, result) {
  if (!request.partialMode || job.range.end - job.range.start <= LIVE_TUNING.trimAfterMs * 16) return;
  if (!Array.isArray(result?.segments) || !result.segments.length) return;
  let committedCount = 0, safeEnd = null;
  const committed = request.committedInWindow;
  const keep = job.range.end - 16000;
  for (const [index, segment] of result.segments.entries()) {
    const words = normalizedWords(segment?.text).map((word) => word.normalized);
    // Whisper returns zero-length punctuation-only segments; they hold no words to match.
    if (!words.length) continue;
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) break;
    const next = committed.slice(committedCount, committedCount + words.length).map((word) => word.normalized);
    if (words.length !== next.length || words.some((word, position) => word !== next[position])) break;
    // Whisper squashes the last segment and stretches the one before it over its audio, so a segment
    // end is trusted only when a normally timed segment follows it.
    const following = result.segments.slice(index + 1).find((item) => normalizedWords(item?.text).length);
    const end = job.range.start + Math.floor(segment.end * 16000);
    const plausible = following && following.end - following.start >= Math.max(0.3, 0.2 * normalizedWords(following.text).length);
    if (!plausible || following.start < segment.end - 0.05 || end > keep) break;
    committedCount += words.length;
    safeEnd = end;
  }
  if (!committedCount || !Number.isSafeInteger(safeEnd) || safeEnd <= request.stream.baseSample) return;
  const moved = committed.splice(0, committedCount);
  addPromptTail(request, moved);
  request.stream.trimBefore(safeEnd);
  // Keep earlier passes for agreement: drop the words whose audio was just trimmed.
  request.hypotheses = request.hypotheses.map((hypothesis) => ({ ...hypothesis, words: hypothesis.words.slice(alignCommitted(hypothesis.words, moved).offset) }));
}
async function finishPartialRequest(request, job, result) {
  if (!result || request.terminal) return;
  const words = normalizedWords(result.text);
  // Trimmed words are no longer in this audio, so only words still in the window can repeat.
  const alreadyCommitted = request.committedInWindow;
  const alignment = alignCommitted(words, alreadyCommitted);
  if (alreadyCommitted.length && !alignment.matched) console.error("[speech-to-text] final hypothesis did not align with committed live text; skipping the committed word count.");
  const tail = words.slice(alignment.offset);
  await emitSegment(request, job.range.utterance, tail, result.language, job.range, true);
  if (!request.latchedLanguage && job.speechSamples >= 32000 && result.language) request.latchedLanguage = result.language;
  request.committedSampleEnd = Math.max(request.committedSampleEnd, job.range.end);
  request.stream.trimBefore(job.range.end);
  addPromptTail(request, request.committedInWindow);
  request.committedInWindow = [];
  request.hypotheses = [];
}
function enqueueJob(request, kind, range) {
  if ((kind === "draft" || kind === "partial") && queuedCommitMs() >= LIVE_QUEUE_TUNING.draftPartialSkipMs) {
    if (kind === "partial") request.stream?.segmenter.partialComplete(request.stream.samples, range.utterance);
    return;
  }
  const job = { request, kind, range, speechSamples: range.speechSamples || 0, version: 0 };
  if (kind === "draft") {
    job.version = (request.draftVersions.get(range.utterance) || 0) + 1;
    request.draftVersions.set(range.utterance, job.version);
  }
  if (kind === "partial") request.partialPending = true;
  request.pending++;
  queue.push(job);
  if (kind === "commit" && queuedCommitMs() >= LIVE_QUEUE_TUNING.draftPartialSkipMs) discardQueuedLowPriority();
  if (kind === "commit" && liveQueueHardCapped()) request.backlogError = { type: "error", code: "engine-failed", message: "Live transcription stopped because the shared transcription queue reached its limit." };
  void pumpQueue();
}
async function waitJobs(request) {
  if (!request.pending) return;
  await new Promise((resolve) => request.waiters.push(resolve));
}
async function pumpQueue() {
  if (queuePump) return queuePump;
  queuePump = (async () => {
    while (!stopping && queue.length) {
      const job = queue.shift(), request = job.request;
      if (request.terminal || request.channel.closed || draftIsStale(job)) {
        request.pending--;
        if (job.kind === "partial") { request.partialPending = false; request.stream?.segmenter.partialComplete(request.stream.samples, job.range.utterance); }
        liveDone(request); continue;
      }
      activeRequest = job;
      try {
        const model = await getActiveModel();
        request.controller = new AbortController();
        const loading = !engine?.ready || engine.fingerprint !== `${model}:${settings.gpu}`;
        if (loading && (!request.live || !request.ended) && !request.preparingSent) {
          request.preparingSent = true;
          await send(request.channel, { type: "status", state: "preparing" });
        }
        if (request.live && request.warmup) await request.warmup.catch(() => {});
        const server = await ensureEngine(model);
        if (request.terminal || request.channel.closed) continue;
        request.controller = new AbortController();
        if (!request.live) await send(request.channel, { type: "status", state: "transcribing" });
        const result = await infer(request, server, job);
        if (request.live && job.kind === "partial") {
          if (result?.forcedLanguage) {
            if (result.elapsedPassMs > LIVE_TUNING.maxPassMs) request.slowPasses++;
            else request.slowPasses = 0;
            if (request.slowPasses >= LIVE_TUNING.slowPassesBeforeFallback) {
              request.partialMode = false;
              request.stream.segmenter.disablePartials();
              request.hypotheses = [];
              console.warn("[speech-to-text] partial inference disabled after consecutive slow forced-language passes.");
            }
          }
          if (!request.terminal && !request.finishedIds.has(job.range.utterance)) await commitStablePartial(request, job, result);
        } else if (request.live && job.kind === "draft") {
          if (result) await sendLiveDraft(request, job.range.utterance, result.text, job.range);
        } else if (request.live) {
          request.finishedIds.add(job.range.utterance);
          await finishPartialRequest(request, job, result);
        } else await terminal(request, { type: "result", ...result });
      } catch (error) {
        if (!request.terminal) await terminal(request, { type: "error", code: "engine-failed", message: error?.message || "Transcription failed." });
      } finally {
        if (job.kind === "partial") {
          request.partialPending = false;
          request.stream?.segmenter.partialComplete(request.stream.samples, job.range.utterance);
        }
        request.pending = Math.max(0, request.pending - 1);
        liveDone(request);
        if (activeRequest === job) activeRequest = null;
        lastUseAt = Date.now();
        if (queue.length === 0) scheduleIdleStop();
      }
    }
  })().finally(() => { queuePump = null; });
  return queuePump;
}
function startTranscription(channel, open, early = []) {
  clearTimeout(idleTimer);
  const live = open.live === true;
  const request = { channel, live, chunks: [], bytes: 0, totalSamples: 0, languages: Array.isArray(open.languages) ? open.languages.slice(0, 32) : [], prompt: typeof open.prompt === "string" ? open.prompt.slice(0, 4000) : "", terminal: false, controller: null, endedAt: 0, startedAt: Date.now(), ended: false, pending: 0, waiters: [], committedText: "", promptTail: "", lastCommittedLanguage: "", committedInWindow: [], hypotheses: [], slowPasses: 0, partialMode: true, partialPending: false, finishedIds: new Set(), committedSampleEnd: 0, scheduledCommitEnd: 0, lastUtterance: 0, warmup: null, draftVersions: new Map(), draftsInvalid: false, latchedLanguage: null, preparingSent: false, stream: null, backlogError: null };
  requests.add(request);
  const stopRequest = () => {
    if (request.terminal) return;
    request.terminal = true;
    request.chunks.length = 0;
    requests.delete(request);
    liveRequests.delete(request);
    removeJobs(request);
    request.controller?.abort(new Error("Channel closed."));
    if (request.stream) void request.stream.stop();
    liveDone(request);
    if (engine && !activeRequest && queue.length === 0) scheduleIdleStop();
  };
  channel.onClose(stopRequest);
  request.ready = send(channel, { type: "status", state: "listening" }).then(async () => {
    if (live && !request.terminal) {
      liveRequests.add(request);
      const runtime = path.join(root, "runtime", RUNTIME.id);
      request.stream = new LiveStream({ runtime,
        onEvent: (event) => {
          if (request.terminal || (event.type === "draft" && request.draftsInvalid)) return;
          request.lastUtterance = Math.max(request.lastUtterance, event.utterance);
          if (event.type === "commit") {
            request.scheduledCommitEnd = Math.max(request.scheduledCommitEnd, event.end);
            request.finishedIds.add(event.utterance);
          }
          if (event.type === "partial") {
            if (!request.partialMode || request.partialPending || request.finishedIds.has(event.utterance) || queue.some((job) => job.request === request && job.kind === "commit") || activeRequest?.request === request && activeRequest.kind === "commit") {
              request.stream?.segmenter.partialComplete(request.stream.samples, event.utterance);
              return;
            }
          }
          if (event.type === "partial-cancel") return;
          enqueueJob(request, event.type, event);
        },
        onFailure: () => {
          request.draftsInvalid = true;
          request.partialMode = false;
          for (let i = queue.length - 1; i >= 0; i--) if (queue[i].request === request && ["draft", "partial"].includes(queue[i].kind)) { if (queue[i].kind === "partial") request.partialPending = false; queue.splice(i, 1); request.pending--; }
          liveDone(request);
        },
      });
      request.warmup = getActiveModel().then((model) => ensureEngine(model));
      void request.warmup.then(() => { if (request.terminal) { lastUseAt = Date.now(); scheduleIdleStop(); } }, (error) => console.error("[speech-to-text] whisper-server warmup failed:", error?.message || error));
    }
  });
  const handle = async (message) => {
    await request.ready;
    if (request.terminal || request.ended || !message || typeof message !== "object") return;
    if (message.type === "audio") {
      if (!(message.data instanceof ArrayBuffer) || message.data.byteLength % 2 !== 0) return void terminal(request, { type: "error", code: "unsupported-format", message: "Audio chunks must contain complete PCM s16le samples." });
      if (live && (request.backlogError || liveQueueHardCapped())) {
        request.ended = true;
        request.backlogError ||= { type: "error", code: "engine-failed", message: "Live transcription stopped because the shared transcription queue reached its limit." };
        void (async () => {
          await request.stream?.finish();
          await waitJobs(request);
          if (!request.terminal) await terminal(request, request.backlogError);
        })().catch((error) => { if (!request.terminal) void terminal(request, { type: "error", code: "engine-failed", message: error?.message || "Transcription failed." }); });
        return;
      }
      request.bytes += message.data.byteLength;
      if (!live && request.bytes / 32000 * 1000 > MAX_AUDIO_MS) return void terminal(request, { type: "error", code: "too-long", message: "Recording exceeds the five-minute limit." });
      const bytes = Buffer.from(message.data);
      request.totalSamples += bytes.length / 2;
      if (live) {
        if (!request.stream) return void terminal(request, { type: "error", code: "engine-failed", message: "Live audio stream was not ready." });
        try { request.stream.append(bytes); }
        catch { request.draftsInvalid = true; }
      } else request.chunks.push(bytes);
    } else if (message.type === "end") {
      request.ended = true;
      request.endedAt = Date.now();
      if (!live) enqueueJob(request, "final", { start: 0, end: request.totalSamples });
      else {
        await send(channel, { type: "status", state: "transcribing" });
        void (async () => {
          await request.stream.finish();
          // The helper heard speech but no utterance was ever detected: transcribe it all rather than return nothing.
          const unsegmented = !request.stream.failed && !request.lastUtterance && request.stream.maxProbability >= 0.5;
          if (unsegmented) console.error("[speech-to-text] live stream ended with speech but no utterances; transcribing it whole.");
          if (request.stream.failed || unsegmented) {
            request.draftsInvalid = true;
            const start = Math.max(request.scheduledCommitEnd, request.stream.baseSample);
            if (request.totalSamples > start) enqueueJob(request, "commit", { utterance: ++request.lastUtterance, start, end: request.totalSamples, speechSamples: 0 });
          }
          await waitJobs(request);
          if (request.terminal) return;
          if (request.backlogError) return void await terminal(request, request.backlogError);
          const text = request.committedText;
          const language = request.lastCommittedLanguage || request.latchedLanguage || "";
          await terminal(request, { type: "result", text, language, audioMs: Math.round(request.bytes / 32000 * 1000), elapsedMs: Math.max(0, Date.now() - request.startedAt) });
        })().catch((error) => { if (!request.terminal) void terminal(request, { type: "error", code: "engine-failed", message: error?.message || "Transcription failed." }); });
      }
    } else if (message.type === "cancel") {
      request.controller?.abort(new Error("Cancelled."));
      await terminal(request, { type: "error", code: "cancelled", message: "Transcription cancelled." });
    }
  };
  channel.onMessage(handle);
  for (const message of early) void handle(message);
}

const ASSET_ROOT = (asset) => asset === "runtime" ? path.join(root, "runtime", RUNTIME.id) : path.join(root, "models", asset);
function beginDownload(channel, asset) {
  const model = modelByName.get(asset);
  if (asset !== "runtime" && !model) return void send(channel, { type: "error", message: "Unknown download asset." });
  if (downloads.has(asset)) return;
  const controller = new AbortController();
  const progress = { asset, phase: "downloading", loaded: 0, total: asset === "runtime" ? RUNTIME.bytes : model.bytes, controller, task: null };
  downloads.set(asset, progress);
  progress.task = (async () => {
    try {
      if (asset === "runtime") {
        runtimeVerified = null;
        await installRuntime({ root, signal: controller.signal, onPhase: (phase) => { progress.phase = phase; void publishManagement(); }, onProgress: (loaded, total) => {
          progress.loaded = loaded; progress.total = total;
          const now = Date.now();
          if (now - (progress.lastBroadcast || 0) >= 500) { progress.lastBroadcast = now; void publishManagement(); }
        } });
      } else {
        progress.phase = "downloading";
        await mkdir(path.join(root, "models"), { recursive: true });
        await downloadVerified({ url: model.url, part: path.join(root, "models", `${asset}.part`), destination: ASSET_ROOT(asset), bytes: model.bytes, sha256: model.sha256, signal: controller.signal, onPhase: (phase) => { progress.phase = phase; void publishManagement(); }, onProgress: (loaded, total) => {
          progress.loaded = loaded; progress.total = total;
          const now = Date.now();
          if (now - (progress.lastBroadcast || 0) >= 500) { progress.lastBroadcast = now; void publishManagement(); }
        } });
        verifiedModels.delete(asset);
      }
      progress.phase = "ready";
      progress.loaded = progress.total;
    } catch (error) {
      progress.phase = controller.signal.aborted ? "cancelled" : "failed";
      progress.error = error?.message || "Download failed.";
    } finally {
      if (downloads.get(asset) === progress) downloads.delete(asset);
      await publishManagement({ lastDownload: { asset, phase: progress.phase, error: progress.error } });
    }
  })();
}
async function cancelDownload(asset) {
  const current = downloads.get(asset);
  if (current) { current.controller.abort(new Error("Download cancelled.")); await current.task; }
}
async function removeAsset(asset) {
  await cancelDownload(asset);
  if (asset === "runtime" || (engine && asset === path.basename(engine.fingerprint.split(":")[0]))) await stopEngine();
  if (asset !== "runtime" && !modelByName.has(asset)) throw new Error("Unknown asset.");
  const file = ASSET_ROOT(asset);
  await rm(file, { recursive: true, force: true });
  if (asset !== "runtime") await rm(`${file}.part`, { force: true });
  verifiedModels.delete(asset);
  if (asset === "runtime") { runtimeVerified = null; await rm(path.join(root, "runtime"), { recursive: true, force: true }); }
  await publishManagement();
}
async function managementCommand(channel, message) {
  try {
    if (message.type === "download") beginDownload(channel, message.asset);
    else if (message.type === "cancel") await cancelDownload(message.asset);
    else if (message.type === "remove") await removeAsset(message.asset);
    else if (message.type === "use") {
      if (!await installedModel(message.model)) throw new Error("Download and verify this model before using it.");
      const previous = await getActiveModel();
      await persephone.storage.set(ACTIVE_MODEL_KEY, message.model);
      if (previous !== message.model && !activeRequest) await stopEngine();
    } else if (message.type === "license") {
      // The page cannot read the runtime folder, so notices travel over the channel; only bundled names are served.
      if (typeof message.file !== "string" || !/^licenses\/[A-Za-z0-9._-]+\.txt$/.test(message.file)) throw new Error("Unknown license notice.");
      const text = await readFile(path.join(ASSET_ROOT("runtime"), ...message.file.split("/")), "utf8");
      return void await send(channel, { type: "license-text", file: message.file, text });
    } else return;
    await publishManagement();
  } catch (error) { await send(channel, { type: "error", message: error?.message || "The operation failed." }); }
}

function applySetting(id, value) {
  if (id === "use-gpu") {
    const next = value !== false;
    if (settings.gpu !== next) { settings.gpu = next; if (!activeRequest) void stopEngine().then(() => publishManagement()); }
  } else if (id === "idle-unload-minutes") {
    settings.idleMinutes = value;
    if (engine && !activeRequest && !queue.length && !liveRequests.size) scheduleIdleStop();
  } else if (id === "caller-approval-policy") settings.approval = value === "same-board-only" ? value : "accept-granted";
  else if (id === "vocabulary-prompt") settings.vocabulary = String(value || "").slice(0, 4000);
  else if (id === "language-hints") settings.languages = parseLanguageHints(value);
}
persephone.settings.onChange(({ id, value }) => applySetting(id, value));
// onChange reports only later edits, so read the stored values once at startup.
const settingsReady = Promise.all(SETTING_IDS.map(async (id) => applySetting(id, await persephone.settings.get(id)))).catch(() => {});

persephone.service.onChannel(async (channel, open, info) => {
  // The host drops messages that arrive before a handler exists, and consumers may stream right after
  // connect, so collect from the first line and replay once the request is accepted.
  const early = [];
  const stopEarly = channel.onMessage((message) => early.push(message));
  await settingsReady;
  const crossBoard = Boolean(info?.interface);
  if (!checkCaller(info)) return refuse(channel);
  if (open?.type === "downloads") {
    if (crossBoard) return refuse(channel);
    management.add(channel);
    channel.onClose(() => management.delete(channel));
    stopEarly();
    channel.onMessage((message) => void managementCommand(channel, message));
    for (const message of early) void managementCommand(channel, message);
    await publishManagement();
    return;
  }
  if (open?.type === "describe") {
    await send(channel, { type: "description", engine: "whisper.cpp", model: await getActiveModel(), languages: "auto", local: true, maxAudioMs: MAX_AUDIO_MS, features: ["live"] });
    close(channel);
    return;
  }
  if (open?.type !== "transcribe") return refuse(channel);
  if (!validFormat(open.format)) return failOpen(channel, "unsupported-format", "Use mono PCM s16le audio at 16 kHz.");
  const model = await getActiveModel();
  if (!await installedModel(model) || !await installedRuntime()) return failOpen(channel, "not-ready", "Install the whisper.cpp runtime and choose an installed model in the Speech to Text board.");
  stopEarly();
  startTranscription(channel, open, early);
});

persephone.service.onShutdown(async () => {
  stopping = true;
  clearTimeout(idleTimer);
  for (const download of downloads.values()) download.controller.abort(new Error("Service is shutting down."));
  const streams = [];
  for (const request of requests) { request.controller?.abort(new Error("Service is shutting down.")); if (request.stream) streams.push(request.stream.stop()); }
  queue.length = 0;
  const cleanup = Promise.all([...downloads.values()].map((entry) => entry.task).filter(Boolean).concat(streams, stopEngine()));
  let timeout;
  await Promise.race([cleanup, new Promise((resolve) => { timeout = setTimeout(resolve, 1800); })]);
  clearTimeout(timeout);
});
