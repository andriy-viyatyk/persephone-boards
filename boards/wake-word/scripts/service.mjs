import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { add, list, remove, templates } from "./enrollments.mjs";
import {
  StreamingFrontend, TEMPLATE_VERSION, VAD_FRAME_SAMPLES, createVadState, embed, encodeTemplate,
  matchWindow, pcmToFloat, phraseStartSample, sampleDistance, similarity, subsequenceDistance,
  vadProbability,
} from "./engine.mjs";

const MODEL = fileURLToPath(new URL("../model/speech-embedding.onnx", import.meta.url));
const DEFAULT_THRESHOLD = 0.85;
const ENROLL_SAMPLES = 40000;
const MAX_QUEUE = 32;
const REFRACTORY_MS = 1500;
// Level gate (as in BT-083): match only while there is speech-level sound. Quiet audio (room or fan
// noise) is never compared with the samples, and a pause longer than the hold clears the match
// history, so a phrase is matched within one stretch of sound. Without it, noise alone could match.
//
// GATE_RMS alone is an ABSOLUTE floor and only holds when ambient noise sits below it. On a machine
// whose fan reaches it the gate latches open — one window above the floor holds it open for
// GATE_HOLD_MS, the history below is only ever cleared when the gate CLOSES, and subsequence DTW
// then scores an unbounded stretch of noise until something crosses the caller's threshold; the
// refractory becomes the only rate limit (BT-091). So the bar also rises with measured noise, the
// same rule acceptClip() already applies to enrollment: a fixed floor cannot work for a fan that
// changes speed. The floor is a low percentile so that speech, a minority of windows, does not
// raise the bar against itself.
//
// GATE_NOISE_FACTOR is 3.5 rather than the 2.4 acceptClip() uses, measured on a loud-fan laptop:
// over 10 s of that fan (p20 0.00438, max 0.0127) a 2.4 factor still left 1.24% of windows above
// the bar — about six openings per 10 s, each latching for GATE_HOLD_MS — while 3.0 and above left
// none. 3.5 keeps roughly 20% margin over that fan's peak and still sits well under speech at a
// laptop microphone. acceptClip() can be stricter because it judges a whole deliberate recording;
// this gate must survive a continuous stream. Lower it if a quiet speaker stops opening the gate:
// the board's live readout shows the current level against the gate.
//
// BT-094: the level gate above answers "is there sound?", which is the wrong question — typing and a
// finger tapping the table are genuinely loud, open it correctly, and then match, because
// speech_embedding has no not-speech output and subsequenceDistance searches a rolling history for
// the BEST alignment. Worse, each transient re-arms GATE_HOLD_MS, so a burst of unrelated taps never
// lets the gate close and the history stitches them into one pseudo-utterance. Silero VAD answers
// the right question instead and is the primary gate; the level gate below is now only the fallback
// for when the VAD model cannot be loaded. Hysteresis matches speech-to-text's live transcription.
const VAD_SPEECH_ON = 0.5;
const VAD_SPEECH_OFF = 0.35;
const GATE_RMS = 0.006;
const GATE_HOLD_MS = 400;
const GATE_NOISE_FACTOR = 3.5;
const GATE_NOISE_PERCENTILE = 0.2;
const GATE_NOISE_WINDOW_MS = 5000;
const GATE_NOISE_MIN_WINDOWS = 20;

// A microphone hit waits 300 + 400 + 200 ms after its detection audio time, measured on a
// monotonic wall clock from receipt of the microphone chunk containing that time, accounting
// for the offset within the chunk. Expect about 0.8–1 s latency; tune the margin with live TTS.
// Only the detection message is delayed. Agent Chat retains request audio from the audio service
// by timestamp across this delay, so the request audio is not lost.
const LOOK_BEHIND_MS = 1500;
const LOOK_AHEAD_MS = 300;
const GATE_PRE_ROLL_ALLOWANCE_MS = 400;
const PROCESSING_MARGIN_MS = 200;

const sessions = new Map();
const listeners = new Set();
const operations = new Set();
const diagnostics = new Set();
let audioPromise;
let currentEpoch = null;
let templateSnapshot = [];
let snapshotQueue = Promise.resolve();
let policy = "accept-granted";
const settingsReady = persephone.settings.get("caller-approval-policy").then(value => {
  policy = value === "same-board-only" ? value : "accept-granted";
}).catch(() => {});
persephone.settings.onChange(({ id, value }) => {
  if (id === "caller-approval-policy") policy = value === "same-board-only" ? value : "accept-granted";
});

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function validText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function objectWithKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

function close(channel, reason) {
  if (!channel.closed) channel.close(reason);
}

async function send(channel, message) {
  if (channel.closed) return false;
  if (!channel.writable) await channel.whenWritable();
  if (channel.closed) return false;
  channel.send(message);
  return true;
}

function output(operation, message) {
  if (operation.closed) return;
  operation.outstanding++;
  if (operation.outstanding > MAX_QUEUE) {
    terminate(operation, failure("channel-backpressure", "The outgoing message queue is full."));
    return;
  }
  operation.output = operation.output.then(() => {
    if (!operation.closed) return send(operation.channel, message);
    return false;
  }).catch(() => {
    cleanup(operation);
  }).finally(() => {
    operation.outstanding--;
  });
}

function cleanup(operation) {
  if (operation.closed) return;
  operation.closed = true;
  listeners.delete(operation);
  operations.delete(operation);
  for (const timer of operation.timers) clearTimeout(timer);
  operation.timers.clear();
  for (const release of operation.releases.splice(0)) release();
  operation.controller.abort();
}

function terminate(operation, error) {
  if (operation.closed) return;
  const channel = operation.channel;
  cleanup(operation);
  void send(channel, { type: "error", code: error.code || "rejected", message: error.message || "Wake service failed." })
    .catch(() => {}).finally(() => close(channel));
}

function refreshTemplates() {
  const task = snapshotQueue.then(async () => {
    templateSnapshot = await templates();
  });
  snapshotQueue = task.catch(() => {});
  return task;
}

async function authorizeCall(context) {
  await settingsReady;
  if (policy !== "accept-granted") throw failure("permission-denied", "Caller refused.");
  if (context.signal.aborted) throw failure("cancelled", "Request cancelled.");
}

function validateTarget(target) {
  if (!objectWithKeys(target, ["phrase", "kind", "person", "sampleId"]) || !validText(target.phrase)
    || (target.kind !== undefined && !["wake", "stop"].includes(target.kind))
    || (target.person !== undefined && !validText(target.person))
    || (target.sampleId !== undefined && !validText(target.sampleId))) {
    throw failure("rejected", "Invalid delete target.");
  }
}

persephone.capabilities.handle("speech.wake", "describe", async (args, context) => {
  await authorizeCall(context);
  if (args.length) throw failure("rejected", "Describe takes no arguments.");
  return { local: true, features: [], defaultThreshold: DEFAULT_THRESHOLD, maxEnrollMs: 3000 };
});

persephone.capabilities.handle("speech.wake", "list", async (args, context) => {
  await authorizeCall(context);
  if (args.length !== 1 || !validText(args[0])) throw failure("rejected", "A nonempty phrase is required.");
  return list(args[0]);
});

persephone.capabilities.handle("speech.wake", "delete", async (args, context) => {
  await authorizeCall(context);
  if (args.length !== 1) throw failure("rejected", "A delete target is required.");
  validateTarget(args[0]);
  const count = await remove(args[0], context.signal);
  await refreshTemplates();
  return { count };
});

function resetSpotter(session) {
  session.frontend = new StreamingFrontend();
  session.history = [];
  session.sampleEnds = [];
  session.gateUntil = -Infinity;
  session.levels = [];
  session.vadPending = new Float32Array(0);
  session.vadState = createVadState();
  session.speech = false;
  session.speechProbability = 0;
  session.segmentTime = null;
  session.nextTime = null;
}

// Returns whether the audio so far is speech. Buffers to Silero's fixed frame size and keeps the
// carried LSTM state per capture session. A VAD failure is reported once and then degrades to the
// adaptive level gate rather than taking the board's detection offline.
async function updateSpeech(session, samples, message) {
  if (session.vadFailed) return session.rms > session.gate;
  const joined = new Float32Array(session.vadPending.length + samples.length);
  joined.set(session.vadPending);
  joined.set(samples, session.vadPending.length);
  let offset = 0;
  try {
    while (joined.length - offset >= VAD_FRAME_SAMPLES) {
      const { probability, state } = await vadProbability(session.vadState, joined.subarray(offset, offset + VAD_FRAME_SAMPLES));
      if (session.closed || message.epoch !== currentEpoch) return false;
      session.vadState = state;
      session.speechProbability = probability;
      session.speech = probability >= (session.speech ? VAD_SPEECH_OFF : VAD_SPEECH_ON);
      offset += VAD_FRAME_SAMPLES;
    }
  } catch (error) {
    session.vadFailed = true;
    console.error("[wake-word] Silero VAD unavailable; falling back to the level gate:", error?.message || error);
    return session.rms > session.gate;
  }
  session.vadPending = joined.slice(offset);
  return session.speech;
}

// The noise floor of the last GATE_NOISE_WINDOW_MS, as a low percentile of chunk RMS. Until enough
// audio has arrived to estimate it, the absolute floor stands on its own.
function gateLevel(session) {
  if (session.levels.length < GATE_NOISE_MIN_WINDOWS) return GATE_RMS;
  const sorted = session.levels.map(level => level.rms).sort((a, b) => a - b);
  const noise = sorted[Math.floor((sorted.length - 1) * GATE_NOISE_PERCENTILE)] || 0;
  return Math.max(GATE_RMS, noise * GATE_NOISE_FACTOR);
}

function resetEpoch(epoch) {
  currentEpoch = epoch;
  for (const session of sessions.values()) resetSpotter(session);
  for (const operation of listeners) {
    operation.refractory.clear();
    operation.computerHits.length = 0;
    operation.pendingHits.clear();
    for (const timer of operation.timers) clearTimeout(timer);
    operation.timers.clear();
    output(operation, { type: "status", status: "reset", epoch });
  }
}

function receiveEpoch(epoch) {
  if (currentEpoch === null) {
    currentEpoch = epoch;
    return true;
  }
  if (epoch < currentEpoch) return false;
  if (epoch > currentEpoch) resetEpoch(epoch);
  return true;
}

function audioCapability() {
  if (!audioPromise) {
    audioPromise = persephone.getCapability("audio", { version: 1 }).then(capability => {
      if (!capability) throw failure("no-handler", "The audio provider is unavailable.");
      return capability;
    }).catch(error => {
      audioPromise = null;
      throw error;
    });
  }
  return audioPromise;
}

function sessionKey(source, deviceId, echoCancel) {
  return JSON.stringify(source === "computer" ? [source] : [source, deviceId || "", echoCancel]);
}

function subscribe(source, deviceId, echoCancel, subscriber) {
  const key = sessionKey(source, deviceId, echoCancel);
  let session = sessions.get(key);
  if (!session) {
    session = {
      key, source, subscribers: new Set(), channel: null, closed: false,
      queue: Promise.resolve(), pending: 0,
    };
    resetSpotter(session);
    sessions.set(key, session);
    session.ready = openCapture(session, deviceId, echoCancel);
    session.ready.catch(() => {});
  }
  session.subscribers.add(subscriber);
  let released = false;
  return {
    ready: session.ready,
    session,
    release() {
      if (released) return;
      released = true;
      session.subscribers.delete(subscriber);
      if (!session.subscribers.size) {
        session.closed = true;
        if (sessions.get(key) === session) sessions.delete(key);
        if (session.channel) close(session.channel);
        forgetEpochWhenIdle();
      }
    },
  };
}

async function openCapture(session, deviceId, echoCancel) {
  try {
    const audio = await audioCapability();
    if (session.closed) return;
    const options = session.source === "computer"
      ? { source: "computer" }
      : { source: "microphone", echoCancel, ...(deviceId ? { deviceId } : {}) };
    const channel = await audio.capture(options);
    if (session.closed) {
      close(channel);
      return;
    }
    session.channel = channel;
    channel.onMessage(message => captureMessage(session, message));
    channel.onClose(reason => {
      if (!session.closed) captureFailed(session, failure(reason?.code || "channel-closed", reason?.message || "Audio capture closed."));
    });
  } catch (error) {
    captureFailed(session, error);
    throw error;
  }
}

function captureFailed(session, error) {
  if (session.closed) return;
  session.closed = true;
  if (sessions.get(session.key) === session) sessions.delete(session.key);
  if (session.channel) close(session.channel);
  for (const subscriber of [...session.subscribers]) subscriber.fail(error);
  forgetEpochWhenIdle();
}

// The audio window closes when idle and its next start is a new epoch. With no capture open,
// nothing can be compared across that change, so a later listener must not be told "reset".
function forgetEpochWhenIdle() {
  if (!sessions.size) currentEpoch = null;
}

function captureMessage(session, message) {
  if (session.closed) return;
  if (message?.type === "error") {
    captureFailed(session, failure(message.code || "rejected", message.message || "Audio capture failed."));
    return;
  }
  if (message?.type !== "chunk" || !Number.isSafeInteger(message.epoch)
    || !Number.isFinite(message.timeMs) || message.sampleRate !== 16000
    || !(message.data instanceof ArrayBuffer) || !message.data.byteLength || message.data.byteLength % 2) {
    captureFailed(session, failure("rejected", "Invalid audio capture message."));
    return;
  }
  const receivedAt = performance.now();
  if (!receiveEpoch(message.epoch)) {
    captureFailed(session, failure("rejected", "Audio sources no longer share an epoch."));
    return;
  }
  for (const subscriber of [...session.subscribers]) subscriber.chunk?.(message);
  if (![...session.subscribers].some(subscriber => subscriber.spot)) return;
  session.pending++;
  if (session.pending > MAX_QUEUE) {
    captureFailed(session, failure("channel-backpressure", "The audio processing queue is full."));
    return;
  }
  session.queue = session.queue.then(() => processChunk(session, message, receivedAt)).catch(error => {
    captureFailed(session, error);
  }).finally(() => {
    session.pending--;
  });
}

async function processChunk(session, message, receivedAt) {
  if (session.closed || message.epoch !== currentEpoch) return;
  const samples = pcmToFloat(message.data);
  if (session.nextTime === null || Math.abs(message.timeMs - session.nextTime) > 1) {
    resetSpotter(session);
    session.segmentTime = message.timeMs;
    for (const subscriber of session.subscribers) subscriber.gap?.(session.source);
  }
  session.nextTime = message.timeMs + samples.length / 16;
  session.frontend.push(samples);
  const windows = session.frontend.takeReady();
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  session.levels.push({ timeMs: message.timeMs, rms });
  const oldest = message.timeMs - GATE_NOISE_WINDOW_MS;
  while (session.levels.length && session.levels[0].timeMs < oldest) session.levels.shift();
  session.gate = gateLevel(session);
  session.rms = rms;
  const speaking = await updateSpeech(session, samples, message);
  if (session.closed || message.epoch !== currentEpoch) return;
  if (speaking) session.gateUntil = session.nextTime + GATE_HOLD_MS;
  if (!(session.gateUntil > message.timeMs)) {
    session.history = [];
    session.sampleEnds = [];
    // Report while the gate is SHUT too, throttled: a silent readout is useless precisely when
    // someone is asking why nothing triggers (or why something does). Score is 0 — nothing matched.
    if (message.timeMs - (session.lastDiagnostic ?? -Infinity) >= 100) {
      session.lastDiagnostic = message.timeMs;
      sendDiagnostic(session, 0, message.timeMs);
    }
    return;
  }
  for (const window of windows) {
    if (session.closed || message.epoch !== currentEpoch) return;
    const vector = await embed(window.features);
    if (session.closed || message.epoch !== currentEpoch) return;
    session.history.push(Array.from(vector));
    session.sampleEnds.push(window.sampleEnd);
    if (session.history.length > 100) {
      session.history.shift();
      session.sampleEnds.shift();
    }
    const matches = new Map();
    for (const sample of templateSnapshot) {
      if (!sample.embeddings?.length || session.history.length < sample.embeddings.length) continue;
      if (![...session.subscribers].some(subscriber => subscriber.spot && subscriber.phrases.has(sample.phrase))) continue;
      const history = matchWindow(sample.embeddings, session.history);
      const match = subsequenceDistance(sample.embeddings, history);
      // Keyed WITHOUT person (BT-093): one utterance legitimately matches every person enrolled for
      // the phrase, so emitting one detection each made a shared wake word fire N times. The best
      // scoring person wins and rides along on the hit, which keeps `person` meaningful for the
      // caller (Agent Chat labels the request with it) while the phrase is reported once.
      const key = JSON.stringify([sample.phrase, sample.kind]);
      if (!matches.has(key) || match.distance < matches.get(key).distance) {
        matches.set(key, { sample, distance: match.distance, index: session.history.length - history.length + match.startIndex });
      }
    }
    const timeMs = session.segmentTime + window.sampleEnd / 16;
    for (const match of matches.values()) {
      const score = similarity(match.distance);
      const startMs = Math.max(session.segmentTime, Math.min(timeMs, session.segmentTime + phraseStartSample(session.sampleEnds[match.index]) / 16));
      const hit = {
        type: "detection", phrase: match.sample.phrase, kind: match.sample.kind,
        person: match.sample.person, score,
        time: { epoch: message.epoch, timeMs }, start: { epoch: message.epoch, timeMs: startMs },
      };
      for (const subscriber of [...session.subscribers]) subscriber.hit?.(session.source, hit, receivedAt, message.timeMs);
    }
    session.lastDiagnostic = message.timeMs;
    sendDiagnostic(session, Math.max(0, ...[...matches.values()].map(match => similarity(match.distance))), timeMs);
  }
}

function sendDiagnostic(session, score, timeMs) {
  if (!diagnostics.size) return;
  for (const channel of diagnostics) {
    try {
      if (!channel.writable) {
        close(channel, { code: "channel-backpressure", message: "Diagnostics consumer is too slow." });
      } else {
        channel.send({ type: "diagnostic", score, time: timeMs, rms: session.rms, gate: session.gate, speech: session.speechProbability });
      }
    } catch {
      close(channel);
    }
  }
}

function validCaptureOptions(open) {
  if (open.deviceId !== undefined && !validText(open.deviceId)) return false;
  if (open.echoCancel !== undefined && typeof open.echoCancel !== "boolean") return false;
  return true;
}

function validateListen(open) {
  if (!objectWithKeys(open, ["type", "phrases", "sources", "deviceId", "threshold", "echoCancel"])
    || !Array.isArray(open.phrases) || !open.phrases.length || !open.phrases.every(validText)
    || new Set(open.phrases).size !== open.phrases.length
    || !Array.isArray(open.sources) || !open.sources.length
    || !open.sources.every(source => ["microphone", "computer"].includes(source))
    || new Set(open.sources).size !== open.sources.length || !validCaptureOptions(open)
    || (open.threshold !== undefined && (typeof open.threshold !== "number" || !Number.isFinite(open.threshold) || open.threshold < 0 || open.threshold > 1))
    || (!open.sources.includes("microphone") && (open.deviceId !== undefined || open.echoCancel !== undefined))) {
    throw failure("rejected", "Invalid listen arguments.");
  }
}

function validateEnroll(open) {
  if (!objectWithKeys(open, ["type", "phrase", "kind", "person", "deviceId", "echoCancel"])
    || !validText(open.phrase) || !validText(open.person) || !["wake", "stop"].includes(open.kind)
    || !validCaptureOptions(open)) {
    throw failure("rejected", "Invalid enrollment arguments.");
  }
}

function quality(samples) {
  const levels = [];
  for (let start = 0; start + 1600 <= samples.length; start += 1600) {
    let sum = 0;
    for (let index = start; index < start + 1600; index++) sum += samples[index] * samples[index];
    levels.push({ start, end: start + 1600, rms: Math.sqrt(sum / 1600) });
  }
  const sorted = levels.map(level => level.rms).sort((a, b) => a - b);
  const noise = sorted[Math.floor((sorted.length - 1) * 0.2)] || 0;
  const active = levels.filter(level => level.rms > Math.max(0.006, noise * 2.4));
  if (!active.length || active.reduce((sum, level) => sum + level.rms, 0) / active.length < 0.009) return { accepted: false, reason: "silence" };
  const speechStart = active[0].start;
  const speechEnd = active.at(-1).end;
  if (speechEnd - speechStart < 3200) return { accepted: false, reason: "short" };
  let peak = 0;
  for (let index = speechStart; index < speechEnd; index++) peak = Math.max(peak, Math.abs(samples[index]));
  if (peak > 0.995 || peak < 0.02) return { accepted: false, reason: "noise" };
  return { accepted: true, speechStart, speechEnd };
}

// Analyze the same captured samples with a fresh recurrent state. A failed or silent VAD
// leaves the already accepted loudness bounds intact.
async function suggestSpeechBounds(clip, fallback, signal) {
  let state = createVadState();
  let speaking = false;
  let start = null;
  let end = null;
  try {
    for (let offset = 0; offset < clip.length; offset += VAD_FRAME_SAMPLES) {
      if (signal.aborted) return fallback;
      const frame = new Float32Array(VAD_FRAME_SAMPLES);
      frame.set(clip.subarray(offset, offset + VAD_FRAME_SAMPLES));
      const result = await vadProbability(state, frame);
      state = result.state;
      speaking = result.probability >= (speaking ? VAD_SPEECH_OFF : VAD_SPEECH_ON);
      if (speaking) {
        if (start === null) start = offset;
        end = Math.min(offset + VAD_FRAME_SAMPLES, clip.length);
      }
    }
  } catch {
    return fallback;
  }
  return start === null ? fallback : {
    speechStart: Math.max(0, start - 1600),
    speechEnd: Math.min(clip.length, end + 1600),
  };
}

function makeOperation(channel) {
  const operation = {
    channel, closed: false, controller: new AbortController(), releases: [], timers: new Set(),
    output: Promise.resolve(), outstanding: 0,
  };
  operations.add(operation);
  channel.onClose(() => cleanup(operation));
  channel.onMessage(message => {
    if (operation.onInput) operation.onInput(message);
    else terminate(operation, failure("rejected", "Incoming audio and messages are not accepted."));
  });
  return operation;
}

async function startListen(operation, open) {
  validateListen(open);
  await refreshTemplates();
  if (!templateSnapshot.some(sample => open.phrases.includes(sample.phrase))) {
    throw failure("no-enrollments", "No current enrollments match the requested phrases.");
  }
  await embed(new Float32Array(76 * 32));
  if (operation.closed) return;
  operation.phrases = new Set(open.phrases);
  operation.sources = new Set(open.sources);
  operation.threshold = open.threshold ?? DEFAULT_THRESHOLD;
  operation.refractory = new Map();
  operation.computerHits = [];
  operation.pendingHits = new Set();
  operation.active = false;
  operation.spot = true;
  operation.fail = error => terminate(operation, error);
  operation.gap = source => {
    for (const key of operation.refractory.keys()) {
      if (key.startsWith(source + ":")) operation.refractory.delete(key);
    }
  };
  operation.hit = (source, hit, receivedAt, chunkTime) => handleHit(operation, source, hit, receivedAt, chunkTime);
  listeners.add(operation);
  const sources = operation.sources.has("microphone") ? ["microphone", "computer"] : ["computer"];
  const captures = sources.map(source => subscribe(source, open.deviceId, open.echoCancel ?? true, operation));
  for (const capture of captures) operation.releases.push(capture.release);
  operation.computerSession = captures.find(capture => capture.session.source === "computer")?.session;
  await Promise.all(captures.map(capture => capture.ready));
  if (operation.closed) return;
  if (captures.some(capture => capture.session.closed)) throw failure("channel-closed", "Audio capture closed during startup.");
  operation.active = true;
  output(operation, { type: "status", status: "listening" });
}

function handleHit(operation, source, hit, receivedAt, chunkTime) {
  if (!operation.active || operation.closed || !operation.phrases.has(hit.phrase) || hit.score < operation.threshold) return;
  // Also person-free (BT-093): the per-window pick above collapses persons matched in the SAME
  // window, but the two can land in adjacent windows a few hundred ms apart. A person-keyed
  // refractory would let the runner-up through; this suppresses it for REFRACTORY_MS. The computer
  // suppression below already compares phrase only, so this makes identity consistent throughout.
  const key = source + ":" + JSON.stringify([hit.phrase, hit.kind]);
  const previous = operation.refractory.get(key) ?? -Infinity;
  if (source === "computer") {
    operation.computerHits.push(hit);
    let cutoff = hit.time.timeMs - LOOK_BEHIND_MS - LOOK_AHEAD_MS - 5000;
    for (const pending of operation.pendingHits) {
      cutoff = Math.min(cutoff, pending.time.timeMs - LOOK_BEHIND_MS);
    }
    operation.computerHits = operation.computerHits.filter(item => item.time.epoch === hit.time.epoch && item.time.timeMs >= cutoff);
    if (operation.computerHits.length > 4096) {
      terminate(operation, failure("channel-backpressure", "The computer detection history is full."));
      return;
    }
    if (hit.time.timeMs - previous >= REFRACTORY_MS) {
      operation.refractory.set(key, hit.time.timeMs);
      if (operation.sources.has("computer")) output(operation, hit);
    }
    return;
  }
  if (hit.time.timeMs - previous < REFRACTORY_MS) return;
  operation.refractory.set(key, hit.time.timeMs);
  if (operation.pendingHits.size >= 512) {
    terminate(operation, failure("channel-backpressure", "The pending detection queue is full."));
    return;
  }
  const delay = LOOK_AHEAD_MS + GATE_PRE_ROLL_ALLOWANCE_MS + PROCESSING_MARGIN_MS;
  const deadline = receivedAt + (hit.time.timeMs - chunkTime) + delay;
  operation.pendingHits.add(hit);
  const timer = setTimeout(() => {
    operation.timers.delete(timer);
    const queued = operation.computerSession?.queue || Promise.resolve();
    void queued.then(() => {
      operation.pendingHits.delete(hit);
      if (operation.closed || hit.time.epoch !== currentEpoch) return;
      const suppressed = operation.computerHits.some(computer => computer.time.epoch === hit.time.epoch
        && computer.phrase === hit.phrase && computer.time.timeMs >= hit.time.timeMs - LOOK_BEHIND_MS
        && computer.time.timeMs <= hit.time.timeMs + LOOK_AHEAD_MS);
      if (!suppressed) output(operation, hit);
    });
  }, Math.max(0, deadline - performance.now()));
  operation.timers.add(timer);
}

async function startEnroll(operation, open, ownPage) {
  validateEnroll(open);
  const parts = [];
  let samples = 0;
  let epoch = null;
  let nextTime = null;
  let finishing = false;
  const subscriber = {
    fail: error => terminate(operation, error),
    chunk(message) {
      if (finishing || operation.closed) return;
      if (epoch !== null && (message.epoch !== epoch || Math.abs(message.timeMs - nextTime) > 1)) {
        terminate(operation, failure("rejected", "Microphone timing changed during enrollment."));
        return;
      }
      epoch = message.epoch;
      const pcm = pcmToFloat(message.data);
      nextTime = message.timeMs + pcm.length / 16;
      const part = pcm.subarray(0, Math.min(pcm.length, ENROLL_SAMPLES - samples));
      parts.push(part);
      samples += part.length;
      if (samples >= ENROLL_SAMPLES) {
        finishing = true;
        void finishEnrollment(operation, open, parts, samples, ownPage).catch(error => terminate(operation, error));
      }
    },
  };
  const capture = subscribe("microphone", open.deviceId, open.echoCancel ?? true, subscriber);
  operation.releases.push(capture.release);
  await capture.ready;
  if (operation.closed) return;
}

async function reviewClip(operation, clip, suggested) {
  const bytes = Buffer.allocUnsafe(clip.length * 2);
  for (let i = 0; i < clip.length; i++) bytes.writeInt16LE(Math.round(clip[i] * 32768), i * 2);
  let decide;
  const decision = new Promise(resolve => { decide = resolve; });
  let phase = "sending";
  operation.onInput = message => {
    if (phase !== "review") {
      if (phase !== "committing") terminate(operation, failure("rejected", "Unexpected review decision."));
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      terminate(operation, failure("rejected", "Invalid review decision."));
    } else if (message.type === "cancel" && Object.keys(message).length === 1) {
      phase = "cancelled";
      decide(null);
    } else if (message.type === "commit" && Object.keys(message).length === 3
      && Object.keys(message).every(key => ["type", "speechStart", "speechEnd"].includes(key))
      && Number.isInteger(message.speechStart) && Number.isInteger(message.speechEnd)
      && message.speechStart >= 0 && message.speechStart < message.speechEnd && message.speechEnd <= clip.length) {
      phase = "committing";
      decide({ speechStart: message.speechStart, speechEnd: message.speechEnd });
    } else {
      terminate(operation, failure("invalid-selection", "Invalid review selection."));
    }
  };
  const abort = () => decide(null);
  operation.controller.signal.addEventListener("abort", abort, { once: true });
  try {
    // Install the listener before sending; the ordered channel may reply immediately.
    if (!await send(operation.channel, { type: "review", sampleRate: 16000, pcm: bytes.toString("base64"), ...suggested })) return null;
    if (operation.closed) return null;
    phase = "review";
    const timer = setTimeout(() => terminate(operation, failure("review-timeout", "Review timed out.")), 120000);
    operation.timers.add(timer);
    try { return await decision; } finally { clearTimeout(timer); operation.timers.delete(timer); }
  } finally {
    operation.controller.signal.removeEventListener("abort", abort);
  }
}

async function finishEnrollment(operation, open, parts, sampleCount, ownPage) {
  for (const release of operation.releases.splice(0)) release();
  const clip = new Float32Array(sampleCount);
  let offset = 0;
  for (const part of parts) {
    clip.set(part, offset);
    offset += part.length;
  }
  parts.length = 0;
  const assessed = quality(clip);
  if (!assessed.accepted) {
    await send(operation.channel, { type: "enrolled", sampleId: "", quality: assessed, match: null });
  } else {
    let suggested = await suggestSpeechBounds(clip, { speechStart: assessed.speechStart, speechEnd: assessed.speechEnd }, operation.controller.signal);
    if (operation.closed) return;
    if (ownPage) {
      suggested = await reviewClip(operation, clip, suggested);
      if (operation.closed) return;
      if (!suggested) { cleanup(operation); close(operation.channel); return; }
      const selectedQuality = quality(clip.subarray(suggested.speechStart, suggested.speechEnd));
      if (!selectedQuality.accepted) {
        await send(operation.channel, { type: "enrolled", sampleId: "", quality: selectedQuality, match: null });
        cleanup(operation); close(operation.channel); return;
      }
    }
    const embeddings = await encodeTemplate(clip, suggested.speechStart, suggested.speechEnd, operation.controller.signal);
    if (operation.closed) return;
    if (!embeddings.length) {
      await send(operation.channel, { type: "enrolled", sampleId: "", quality: { accepted: false, reason: "short" }, match: null });
    } else {
      const saved = await add({ phrase: open.phrase, kind: open.kind, person: open.person, embeddings, echoCancel: open.echoCancel ?? true }, operation.controller.signal);
      await refreshTemplates();
      const earlier = saved.earlier.filter(sample => sample.frontendVersion === TEMPLATE_VERSION);
      let match = null;
      for (const sample of earlier) {
        const score = similarity(sampleDistance(embeddings, sample.embeddings));
        match = match === null ? score : Math.max(match, score);
      }
      if (!operation.closed) await send(operation.channel, { type: "enrolled", sampleId: saved.sampleId, quality: { accepted: true }, match });
    }
  }
  cleanup(operation);
  close(operation.channel);
}

async function handleChannel(operation, open, info) {
  await settingsReady;
  if (operation.closed) return;
  const ownPage = !info?.interface;
  if (!ownPage && (policy !== "accept-granted" || info.interface.id !== "speech.wake" || info.interface.version !== 1)) {
    cleanup(operation);
    close(operation.channel, { code: "connection-refused", message: "Caller refused." });
    return;
  }
  if (!open || typeof open !== "object" || Array.isArray(open)) throw failure("rejected", "Invalid opening request.");
  if (open.type === "diagnostics" && ownPage && Object.keys(open).length === 1) {
    diagnostics.add(operation.channel);
    operation.channel.onClose(() => diagnostics.delete(operation.channel));
    output(operation, { type: "diagnostics-ready" });
    return;
  }
  if (ownPage && open.type === "describe" && Object.keys(open).length === 1) {
    await send(operation.channel, { type: "description", local: true, features: [], defaultThreshold: DEFAULT_THRESHOLD, maxEnrollMs: 3000 });
    cleanup(operation);
    close(operation.channel);
    return;
  }
  if (ownPage && open.type === "list" && objectWithKeys(open, ["type", "phrase"]) && validText(open.phrase)) {
    await send(operation.channel, { type: "enrollments", phrases: await list(open.phrase, { privateDetails: true }) });
    cleanup(operation);
    close(operation.channel);
    return;
  }
  if (ownPage && open.type === "delete" && objectWithKeys(open, ["type", "target"])) {
    validateTarget(open.target);
    const count = await remove(open.target, operation.controller.signal);
    await refreshTemplates();
    await send(operation.channel, { type: "deleted", count });
    cleanup(operation);
    close(operation.channel);
    return;
  }
  if (!existsSync(MODEL) || !existsSync(path.resolve(path.dirname(MODEL), "../vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"))) {
    throw failure("rejected", "The bundled model or runtime is missing.");
  }
  if (open.type === "listen") return startListen(operation, open);
  if (open.type === "enroll") return startEnroll(operation, open, ownPage);
  throw failure("rejected", "Unsupported operation.");
}

persephone.service.onChannel((channel, open, info) => {
  const operation = makeOperation(channel);
  void handleChannel(operation, open, info).catch(error => terminate(operation, error));
});

persephone.service.onShutdown(() => {
  for (const operation of [...operations]) {
    cleanup(operation);
    close(operation.channel);
  }
  for (const session of sessions.values()) {
    session.closed = true;
    if (session.channel) close(session.channel);
  }
  sessions.clear();
});
