"use strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { assetSnapshot, dataRoot, downloadVerified, installRuntime, MODELS, RUNTIME, sha256File, stopProcessTree, verifyRuntime } from "./downloads.mjs";
import { languageCodeForName, languageNameForCode } from "./whisper-languages.mjs";

const MAX_AUDIO_MS = 300000;
const ACTIVE_MODEL_KEY = "speech-to-text.active-model";
const DEFAULT_MODEL = MODELS[0].file;
const root = dataRoot();
const modelByName = new Map(MODELS.map((model) => [model.file, model]));
const requests = new Set(), queue = [], management = new Set(), downloads = new Map();
const verifiedModels = new Map();
let engine = null, engineGeneration = 0, activeRequest = null;
let idleTimer = null, stopping = false, queuePump = null, lastUseAt = 0;
let settings = { gpu: true, idleMinutes: 10, approval: "accept-granted", vocabulary: "" };

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
const terminal = async (request, message) => {
  if (request.terminal) return;
  request.terminal = true;
  request.chunks.length = 0;
  requests.delete(request);
  await send(request.channel, message);
  close(request.channel);
  if (engine && !activeRequest && queue.length === 0) scheduleIdleStop();
};
const publishManagement = async (extra = {}) => {
  const installed = await assetSnapshot(root).catch(() => ({ runtime: false, models: {}, licenses: [] }));
  const activeModel = await getActiveModel();
  const snapshot = { type: "snapshot", assets: installed, activeModel, engine: engine ? "running" : "stopped", progress: [...downloads.values()].map(({ asset, phase, loaded, total, error }) => ({ asset, phase, loaded, total, ...(error ? { error } : {}) })), ...extra };
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
async function ensureEngine(modelName) {
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
function scheduleIdleStop() {
  clearTimeout(idleTimer);
  const minutes = Math.max(1, Math.min(120, Number(settings.idleMinutes) || 10));
  const idleMs = minutes * 60000;
  const remaining = lastUseAt ? Math.max(0, idleMs - (Date.now() - lastUseAt)) : idleMs;
  idleTimer = setTimeout(() => {
    if (!activeRequest && queue.length === 0) void stopEngine().then(() => publishManagement());
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
function languageChoice(languages) {
  const hints = Array.isArray(languages) ? languages.filter((item) => typeof item === "string" && languageNameForCode(item.toLowerCase())) : [];
  return hints.length === 1 ? { language: hints[0].toLowerCase(), result: hints[0] } : { language: "auto", result: null };
}
async function infer(request, server) {
  const wav = makeWav(request.chunks, request.bytes);
  const form = new FormData();
  form.append("file", wav, "speech.wav");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0.0");
  form.append("no_timestamps", "true");
  form.append("no_language_probabilities", "true");
  const language = languageChoice(request.languages);
  form.append("language", language.language);
  form.append("prompt", request.prompt || settings.vocabulary || "");
  const response = await fetch(`http://127.0.0.1:${server.port}/inference`, { method: "POST", body: form, signal: request.controller.signal });
  if (!response.ok) throw new Error(`whisper-server returned HTTP ${response.status}.`);
  const result = await response.json();
  if (typeof result.text !== "string") throw new Error("whisper-server returned an invalid response.");
  return { text: result.text, language: language.result || languageCodeForName(result.language), audioMs: Math.round(request.bytes / 32000 * 1000), elapsedMs: Math.max(0, Date.now() - request.endedAt) };
}
async function pumpQueue() {
  if (queuePump) return queuePump;
  queuePump = (async () => {
    while (!stopping && queue.length) {
      const request = queue.shift();
      if (request.terminal || request.channel.closed) continue;
      activeRequest = request;
      try {
        const model = await getActiveModel();
        request.controller = new AbortController();
        const loading = !engine?.ready || engine.fingerprint !== `${model}:${settings.gpu}`;
        if (loading) await send(request.channel, { type: "status", state: "preparing" });
        const server = await ensureEngine(model);
        if (request.terminal || request.channel.closed) continue;
        request.controller = new AbortController();
        await send(request.channel, { type: "status", state: "transcribing" });
        const result = await infer(request, server);
        await terminal(request, { type: "result", ...result });
      } catch (error) {
        if (!request.terminal) await terminal(request, { type: "error", code: "engine-failed", message: error?.message || "Transcription failed." });
      } finally {
        if (activeRequest === request) activeRequest = null;
        lastUseAt = Date.now();
        if (queue.length === 0) scheduleIdleStop();
      }
    }
  })().finally(() => { queuePump = null; });
  return queuePump;
}
function startTranscription(channel, open, early = []) {
  clearTimeout(idleTimer);
  const request = { channel, chunks: [], bytes: 0, languages: Array.isArray(open.languages) ? open.languages.slice(0, 32) : [], prompt: typeof open.prompt === "string" ? open.prompt.slice(0, 4000) : "", terminal: false, controller: null, endedAt: 0 };
  requests.add(request);
  channel.onClose(() => {
    if (request.terminal) return;
    request.terminal = true;
    request.chunks.length = 0;
    requests.delete(request);
    request.controller?.abort(new Error("Channel closed."));
    const index = queue.indexOf(request);
    if (index >= 0) queue.splice(index, 1);
    if (engine && !activeRequest && queue.length === 0) scheduleIdleStop();
  });
  void send(channel, { type: "status", state: "listening" });
  const handle = async (message) => {
    if (request.terminal || !message || typeof message !== "object") return;
    if (message.type === "audio") {
      if (!(message.data instanceof ArrayBuffer) || message.data.byteLength % 2 !== 0) return void terminal(request, { type: "error", code: "unsupported-format", message: "Audio chunks must contain complete PCM s16le samples." });
      request.bytes += message.data.byteLength;
      if (request.bytes / 32000 * 1000 > MAX_AUDIO_MS) return void terminal(request, { type: "error", code: "too-long", message: "Recording exceeds the five-minute limit." });
      request.chunks.push(Buffer.from(message.data));
    } else if (message.type === "end") {
      request.endedAt = Date.now();
      queue.push(request);
      void pumpQueue();
    } else if (message.type === "cancel") {
      request.controller?.abort(new Error("Cancelled."));
      const index = queue.indexOf(request);
      if (index >= 0) queue.splice(index, 1);
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

persephone.settings.onChange(({ id, value }) => {
  if (id === "use-gpu") {
    const next = value !== false;
    if (settings.gpu !== next) { settings.gpu = next; if (!activeRequest) void stopEngine().then(() => publishManagement()); }
  } else if (id === "idle-unload-minutes") {
    settings.idleMinutes = value;
    if (engine && !activeRequest && !queue.length) scheduleIdleStop();
  } else if (id === "caller-approval-policy") settings.approval = value === "same-board-only" ? value : "accept-granted";
  else if (id === "vocabulary-prompt") settings.vocabulary = String(value || "").slice(0, 4000);
});

persephone.service.onChannel(async (channel, open, info) => {
  // The host drops messages that arrive before a handler exists, and consumers may stream right after
  // connect, so collect from the first line and replay once the request is accepted.
  const early = [];
  const stopEarly = channel.onMessage((message) => early.push(message));
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
    await send(channel, { type: "description", engine: "whisper.cpp", model: await getActiveModel(), languages: "auto", local: true, maxAudioMs: MAX_AUDIO_MS, features: [] });
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
  for (const request of requests) request.controller?.abort(new Error("Service is shutting down."));
  queue.length = 0;
  const cleanup = Promise.all([...downloads.values()].map((entry) => entry.task).filter(Boolean).concat(stopEngine()));
  let timeout;
  await Promise.race([cleanup, new Promise((resolve) => { timeout = setTimeout(resolve, 1800); })]);
  clearTimeout(timeout);
});
