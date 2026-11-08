import { isReady, install, remove, supported } from "./downloads.mjs";
import { loadEngine, unloadEngine } from "./engine.mjs";
import { splitSentences } from "./text.mjs";

// Playback tuning: small chunks and a two-second lead leave room below the five-second cap.
const CHUNK_SECONDS = 0.25;
const LEAD_SECONDS = 2;
const IDLE_UNLOAD_MS = 10 * 60 * 1000;
// Volume: a gain on the synthesizer's level, set by the page slider and kept in persephone.storage.
// Each sentence's gain is capped so its loudest sample stays at PEAK_LIMIT: louder, never clipped.
const VOLUME_KEY = "volume";
const VOLUME_MIN = 0.25;
const VOLUME_MAX = 4;
const PEAK_LIMIT = 0.98;

const languages = "ar bg cs da de el en es et fi fr hi hr hu id it ja ko lt lv nl pl pt ro ru sk sl sv tr uk vi".split(" ");
const voices = Array.from({ length: 10 }, (_, index) => ({ index, name: `Voice ${index}` }));
const management = new Set();
let defaultVoice = 0;
let policy = "accept-granted";
let volume = 1;
let active = null;
let nativeWork = Promise.resolve();
let nativeBusy = 0;
let timer;
let maintenance = false;
let stopping = false;
let installController = null;
let installTask = null;
let readyCache = null;
let readyTask = null;
let state = { phase: "checking", loaded: 0, total: 0, error: "" };

function setting(id, value) {
  if (id === "default-voice") defaultVoice = Number.isInteger(value) && value >= 0 && value <= 9 ? value : 0;
  if (id === "caller-approval-policy") policy = value === "same-board-only" ? value : "accept-granted";
}

persephone.settings.onChange(({ id, value }) => setting(id, value));
function setVolume(value) {
  volume = typeof value === "number" && Number.isFinite(value) ? Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, value)) : 1;
}

const settingsReady = Promise.all([
  ...["default-voice", "caller-approval-policy"].map(async id => setting(id, await persephone.settings.get(id))),
  persephone.storage.get(VOLUME_KEY).then(setVolume)
]).catch(() => {});

function peakOf(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index]));
  return peak;
}

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

async function send(channel, message) {
  if (channel.closed) return false;
  try {
    if (!channel.writable) await channel.whenWritable();
    if (channel.closed) return false;
    channel.send(message);
    return true;
  } catch {
    return false;
  }
}

function close(channel, reason) {
  if (!channel.closed) channel.close(reason);
}

async function ready() {
  if (readyCache !== null) return readyCache;
  readyTask ??= isReady();
  try {
    readyCache = await readyTask;
    return readyCache;
  } finally {
    readyTask = null;
  }
}

async function publish() {
  const installed = await ready();
  const snapshot = { type: "snapshot", ...state, ready: installed, supported: supported() };
  await Promise.all([...management].map(channel => send(channel, snapshot)));
}

function scheduleIdle() {
  clearTimeout(timer);
  if (!active && !nativeBusy && !maintenance && !stopping) {
    timer = setTimeout(unloadEngine, IDLE_UNLOAD_MS);
    timer.unref?.();
  }
}

function interrupt(operation) {
  if (!operation || operation.controller.signal.aborted) return;
  operation.controller.abort();
  if (operation.channel) {
    try {
      operation.channel.send({ type: "stop" });
    } catch {
      close(operation.channel);
    }
  }
}

function stopSpeech() {
  interrupt(active);
}

function check(operation) {
  if (operation.controller.signal.aborted) throw failure("cancelled", "Speech interrupted.");
}

function cancellable(promise, operation) {
  const signal = operation.controller.signal;
  if (signal.aborted) return Promise.reject(failure("cancelled", "Speech interrupted."));
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure("cancelled", "Speech interrupted."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function generate(operation, text, selectedVoice, speed, lang) {
  await cancellable(nativeWork, operation);
  check(operation);
  nativeBusy++;
  const work = nativeWork.then(async () => {
    check(operation);
    const { sherpa, tts } = await loadEngine();
    check(operation);
    return tts.generateAsync({
      text,
      enableExternalBuffer: false,
      generationConfig: new sherpa.GenerationConfig({ sid: selectedVoice, speed, extra: { lang } })
    });
  });
  nativeWork = work.catch(() => {}).finally(() => {
    nativeBusy--;
    scheduleIdle();
  });
  return cancellable(work, operation);
}

async function speak(text, options = {}, signal, owner = null) {
  await settingsReady;
  if (signal?.aborted) return { status: "interrupted" };
  if (typeof text !== "string" || !text.trim() || !options || typeof options !== "object" || Array.isArray(options)) {
    throw failure("rejected", "Invalid speech request.");
  }
  const lang = options.lang === undefined ? (/\p{Script=Cyrillic}/u.test(text) ? "uk" : "en") : options.lang;
  const selectedVoice = options.voice === undefined ? defaultVoice : options.voice;
  const speed = options.speed === undefined ? 1 : options.speed;
  if (typeof lang !== "string" || !languages.includes(lang)) throw failure("rejected", "Unsupported language.");
  if (!Number.isInteger(selectedVoice) || selectedVoice < 0 || selectedVoice > 9) throw failure("rejected", "Unsupported voice.");
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.5 || speed > 2) throw failure("rejected", "Invalid speed.");
  const sentences = splitSentences(text);
  if (!sentences.length) throw failure("rejected", "Text contains no speakable content.");
  if (maintenance || stopping) throw failure("busy", "The runtime or model is being changed.");

  interrupt(active);
  const operation = { controller: new AbortController(), channel: null, owner };
  active = operation;
  clearTimeout(timer);
  const abort = () => interrupt(operation);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (!await cancellable(ready(), operation)) throw failure("rejected", "Install the runtime and model from the board page.");
    let next = generate(operation, sentences[0], selectedVoice, speed, lang);
    let sampleRate;
    let sentSeconds = 0;
    let firstSendTime;
    let ended;
    for (let index = 0; index < sentences.length; index++) {
      const audio = await next;
      check(operation);
      if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000) throw failure("rejected", "Invalid sample rate.");
      if (sampleRate && sampleRate !== audio.sampleRate) throw failure("rejected", "Sample rate changed during speech.");
      sampleRate = audio.sampleRate;
      if (!operation.channel) {
        const capability = await cancellable(persephone.getCapability("audio", { version: 1 }), operation);
        if (!capability) throw failure("no-handler", "Audio playback is unavailable.");
        const opening = capability.play({ sampleRate });
        opening.then(channel => {
          if (operation.controller.signal.aborted) close(channel);
        }, () => {});
        operation.channel = await cancellable(opening, operation);
        ended = new Promise((resolve, reject) => {
          let received = false;
          operation.channel.onMessage(message => {
            if (message?.type === "ended") {
              received = true;
              resolve(message.status);
            }
          });
          operation.channel.onClose(reason => {
            if (!received) reject(failure(reason?.code || "channel-closed", reason?.message || "Audio playback closed."));
          });
        });
        ended.catch(() => {});
      }
      if (index + 1 < sentences.length) {
        next = generate(operation, sentences[index + 1], selectedVoice, speed, lang);
        next.catch(() => {});
      }
      const peak = peakOf(audio.samples);
      const chunkSamples = Math.max(1, Math.floor(sampleRate * CHUNK_SECONDS));
      for (let start = 0; start < audio.samples.length; start += chunkSamples) {
        check(operation);
        const samples = audio.samples.subarray(start, start + chunkSamples);
        const duration = samples.length / sampleRate;
        if (firstSendTime !== undefined) {
          const delay = (sentSeconds + duration - LEAD_SECONDS) * 1000 - (performance.now() - firstSendTime);
          if (delay > 0) await cancellable(new Promise(resolve => setTimeout(resolve, delay)), operation);
        }
        // Read per chunk, so moving the slider during speech takes effect within a quarter second.
        const gain = peak > 0 ? Math.min(volume, PEAK_LIMIT / peak) : 1;
        const data = new ArrayBuffer(samples.length * 4);
        const view = new DataView(data);
        for (let sample = 0; sample < samples.length; sample++) {
          if (!Number.isFinite(samples[sample])) throw failure("rejected", "Synthesizer returned invalid audio.");
          view.setFloat32(sample * 4, samples[sample] * gain, true);
        }
        if (!operation.channel.writable) await cancellable(operation.channel.whenWritable(), operation);
        check(operation);
        operation.channel.send({ type: "chunk", data });
        firstSendTime ??= performance.now();
        sentSeconds += duration;
      }
    }
    if (!operation.channel.writable) await cancellable(operation.channel.whenWritable(), operation);
    check(operation);
    operation.channel.send({ type: "end" });
    const status = await cancellable(ended, operation);
    if (status !== "finished") throw failure("rejected", "Audio playback stopped unexpectedly.");
    return { status: "finished" };
  } catch (error) {
    if (operation.controller.signal.aborted) return { status: "interrupted" };
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (operation.channel) close(operation.channel);
    if (active === operation) active = null;
    scheduleIdle();
  }
}

persephone.capabilities.handle("speech.synthesize", "speak", async ([text, options], context) => {
  await settingsReady;
  if (policy !== "accept-granted") throw failure("permission-denied", "Caller refused.");
  // Agents often pass the language code itself ("en") as the second argument; read it as { lang }.
  return speak(text, typeof options === "string" ? { lang: options } : options, context.signal);
});

persephone.capabilities.handle("speech.synthesize", "stop", async (args, context) => {
  await settingsReady;
  if (policy !== "accept-granted") throw failure("permission-denied", "Caller refused.");
  if (args.length) throw failure("rejected", "Stop takes no arguments.");
  stopSpeech();
  return null;
});

async function changeAssets(action) {
  if (maintenance) return;
  maintenance = true;
  clearTimeout(timer);
  state = { phase: "waiting", loaded: 0, total: 0, error: "" };
  void publish();
  const controller = new AbortController();
  installController = controller;
  try {
    stopSpeech();
    await nativeWork;
    if (controller.signal.aborted || stopping) throw new Error("Cancelled.");
    unloadEngine();
    if (action === "install") {
      let last = 0;
      await install({ signal: controller.signal, onProgress: progress => {
        state = { ...progress, error: "" };
        if (Date.now() - last >= 200) {
          last = Date.now();
          void publish();
        }
      } });
    } else {
      await remove();
    }
    readyCache = null;
    state = { phase: action === "install" ? "ready" : "missing", loaded: 0, total: 0, error: "" };
  } catch (error) {
    readyCache = null;
    state = { phase: controller.signal.aborted ? "cancelled" : "failed", loaded: 0, total: 0, error: controller.signal.aborted ? "" : error?.message || "Operation failed." };
  } finally {
    installController = null;
    maintenance = false;
    await publish();
    scheduleIdle();
  }
}

function managementCommand(message) {
  if (message?.type === "cancel") installController?.abort();
  if ((message?.type === "install" || message?.type === "delete") && !maintenance) {
    installTask = changeAssets(message.type).finally(() => { installTask = null; });
  }
}

persephone.service.onChannel(async (channel, open, info) => {
  const early = [];
  const stopEarly = channel.onMessage(message => early.push(message));
  await settingsReady;
  if (channel.closed) return;
  const cross = Boolean(info?.interface);
  if (cross && (policy !== "accept-granted" || info.interface.id !== "speech.synthesize" || info.interface.version !== 1)) {
    close(channel, { code: "connection-refused", message: "Caller refused." });
    return;
  }
  if (!cross && open?.type === "downloads") {
    stopEarly();
    management.add(channel);
    channel.onClose(() => management.delete(channel));
    channel.onMessage(managementCommand);
    for (const message of early) managementCommand(message);
    if (state.phase === "checking") {
      const installed = await ready();
      if (state.phase === "checking") state.phase = installed ? "ready" : "missing";
    }
    await publish();
    return;
  }
  if (!cross && open?.type === "test") {
    const pageController = new AbortController();
    const handle = message => {
      if (message?.type === "stop") {
        stopSpeech();
      } else if (message?.type === "volume") {
        setVolume(message.value);
      } else if (message?.type === "speak") {
        void speak(message.text, message.options, pageController.signal, channel).then(
          result => send(channel, { type: "result", id: message.id, ...result }),
          error => send(channel, { type: "error", id: message.id, code: error.code || "rejected", message: error.message || "Synthesis failed." })
        );
      }
    };
    stopEarly();
    channel.onClose(() => {
      pageController.abort();
      if (active?.owner === channel) interrupt(active);
    });
    channel.onMessage(handle);
    for (const message of early) handle(message);
    return;
  }
  if (open?.type === "describe") {
    await send(channel, { type: "description", local: true, languages, voices, defaultVoice, sampleRate: 44100, encoding: "pcm-f32le" });
    close(channel);
    return;
  }
  close(channel, { code: "connection-refused", message: "Unsupported channel." });
});

persephone.service.onShutdown(async () => {
  stopping = true;
  clearTimeout(timer);
  installController?.abort();
  stopSpeech();
  await nativeWork;
  await installTask?.catch(() => {});
  unloadEngine();
});
