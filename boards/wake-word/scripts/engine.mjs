import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = path.join(ROOT, "vendor", "onnxruntime-web");
const MODEL = path.join(ROOT, "model", "speech-embedding.onnx");
const VAD_MODEL = path.join(ROOT, "model", "silero-vad.onnx");
const FRAME = 400, HOP = 160, FFT = 512, BANDS = 32, RATE = 16000;
const mel = (hz) => 1127 * Math.log(1 + hz / 700);
const edges = Array.from({ length: BANDS + 2 }, (_, i) => mel(60) + i * (mel(3800) - mel(60)) / (BANDS + 1));
const weights = Array.from({ length: BANDS }, (_, b) => Float32Array.from({ length: FFT / 2 + 1 }, (_, k) => {
  if (!k) return 0;
  const m = mel(k * RATE / FFT);
  return Math.max(0, Math.min((m - edges[b]) / (edges[b + 1] - edges[b]), (edges[b + 2] - m) / (edges[b + 2] - edges[b + 1])));
}));
const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
let sessionPromise;
let runtimePromise;
let vadPromise;

// Both models share one configured ONNX Runtime import; configuring env.wasm twice would race.
async function runtime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const ort = await import(pathToFileURL(path.join(RUNTIME, "dist", "ort.node.min.mjs")));
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: pathToFileURL(path.join(RUNTIME, "dist", "ort-wasm-simd-threaded.mjs")).href,
      wasm: pathToFileURL(path.join(RUNTIME, "dist", "ort-wasm-simd-threaded.wasm")).href,
    };
    return ort;
  })();
  return runtimePromise;
}

async function loadSession(file) {
  const ort = await runtime();
  const model = await import("node:fs/promises").then(({ readFile }) => readFile(file));
  const instance = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], intraOpNumThreads: 1, interOpNumThreads: 1, graphOptimizationLevel: "all" });
  return { ort, instance };
}

async function session() {
  if (!sessionPromise) sessionPromise = loadSession(MODEL);
  return sessionPromise;
}

// Silero VAD v6 @ 16 kHz: a 512-sample frame PREFIXED with the previous 64 samples, a carried
// [2, 1, 128] LSTM state, and the sample rate; it returns the speech probability and the next state.
//
// The 64-sample context is not optional and not padding. The ONNX graph has a dynamic input axis, so
// feeding a bare 512-sample frame RUNS AND RETURNS PLAUSIBLE NUMBERS — just wrong ones: measured on a
// 4.33 s real-speech WAV, bare frames peaked at p=0.269 and never once crossed 0.5, while the same
// audio with context peaked at 1.000 and scored >=0.5 in 97 of 135 frames. Dropping it would silently
// wedge the gate shut and the wake word would simply never fire.
export const VAD_FRAME_SAMPLES = 512;
const VAD_CONTEXT_SAMPLES = 64;
export function createVadState() { return { lstm: new Float32Array(2 * 128), context: new Float32Array(VAD_CONTEXT_SAMPLES) }; }
export async function vadProbability(vad, frame) {
  if (!vadPromise) vadPromise = loadSession(VAD_MODEL);
  const { ort, instance } = await vadPromise;
  const input = new Float32Array(VAD_CONTEXT_SAMPLES + VAD_FRAME_SAMPLES);
  input.set(vad.context);
  input.set(frame, VAD_CONTEXT_SAMPLES);
  const out = await instance.run({
    input: new ort.Tensor("float32", input, [1, input.length]),
    state: new ort.Tensor("float32", vad.lstm, [2, 1, 128]),
    sr: new ort.Tensor("int64", BigInt64Array.from([16000n]), []),
  });
  return {
    probability: Number(out.output.data[0]),
    state: { lstm: Float32Array.from(out.stateN.data), context: Float32Array.from(frame.subarray(VAD_FRAME_SAMPLES - VAD_CONTEXT_SAMPLES)) },
  };
}

function makeFrame(samples, offset = 0) {
  const re = new Float32Array(FFT), im = new Float32Array(FFT);
  for (let i = 0; i < FRAME; i++) re[i] = samples[offset + i] * hann[i];
  for (let i = 1, j = 0; i < FFT; i++) {
    let bit = FFT >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= FFT; len <<= 1) {
    const angle = -2 * Math.PI / len;
    for (let base = 0; base < FFT; base += len) for (let j = 0; j < len / 2; j++) {
      const c = Math.cos(angle * j), s = Math.sin(angle * j), q = base + j + len / 2, p = base + j;
      const tr = re[q] * c - im[q] * s, ti = re[q] * s + im[q] * c;
      re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
    }
  }
  const out = new Float32Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    let sum = 0;
    for (let k = 1; k <= FFT / 2; k++) sum += Math.hypot(re[k], im[k]) * weights[b][k];
    out[b] = Math.log(sum + 0.001);
  }
  return out;
}

export function logMel(samples) {
  const frames = Math.max(0, 1 + Math.floor((samples.length - FRAME) / HOP));
  const out = new Float32Array(frames * BANDS);
  for (let i = 0; i < frames; i++) out.set(makeFrame(samples, i * HOP), i * BANDS);
  return out;
}

export class StreamingFrontend {
  constructor() { this.pending = new Float32Array(0); this.frames = []; this.sampleCount = 0; this.frameEndSamples = []; this.nextInferenceFrame = 76; }
  push(samples) {
    this.sampleCount += samples.length;
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending); joined.set(samples, this.pending.length);
    let offset = 0;
    while (joined.length - offset >= FRAME) {
      this.frames.push(makeFrame(joined, offset));
      this.frameEndSamples.push(this.sampleCount - joined.length + offset + FRAME);
      offset += HOP;
    }
    this.pending = joined.slice(offset);
    if (this.frames.length > 96) { const drop = this.frames.length - 96; this.frames.splice(0, drop); this.frameEndSamples.splice(0, drop); this.nextInferenceFrame = Math.max(76, this.nextInferenceFrame - drop); }
    return Math.floor(this.frames.length / 8);
  }
  takeReady() {
    const ready = [];
    while (this.frames.length >= this.nextInferenceFrame) {
      ready.push(this.windowEndingAt(this.nextInferenceFrame));
      this.nextInferenceFrame += 8;
    }
    return ready;
  }
  windowEndingAt(frameCount) {
    const rows = this.frames.slice(frameCount - 76, frameCount);
    const out = new Float32Array(76 * BANDS);
    rows.forEach((row, i) => out.set(row, i * BANDS));
    return { features: out, sampleEnd: this.frameEndSamples[frameCount - 1] };
  }
}

export async function embed(features) {
  const { ort, instance } = await session();
  if (!(features instanceof Float32Array) || features.length !== 76 * BANDS) throw new Error("Expected 76 by 32 log-mel features.");
  const result = await instance.run({ [instance.inputNames[0]]: new ort.Tensor("float32", features, [1, 76, 32]) });
  const raw = result[instance.outputNames[0]].data;
  const vector = Float32Array.from(raw);
  let norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (!Number.isFinite(norm) || norm < 1e-9) throw new Error("Model returned an invalid embedding.");
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

// Template building and matching follow the US-1783 research prototype, which the user tested.
const TEMPLATE = {
  padSamples: 12800, // one model window of silence before the clip: a short name still gets embeddings
  stepSamples: 1280, // one embedding every 80 ms
  leadSteps: 3,      // the template starts this many steps after speech starts (embedding lag)
  tailSteps: 4,      // ...and ends this many steps after speech ends
};
export const TEMPLATE_VERSION = 2;

// Include the full embedding window and the template's lead when estimating speech onset.
export function phraseStartSample(sampleEnd) { return sampleEnd - (75 * HOP + FRAME) - TEMPLATE.leadSteps * TEMPLATE.stepSamples; }

/** Embedding sequence for an enrolled name. `clip` is the whole recording; speech bounds are sample indices in it. */
export async function encodeTemplate(clip, speechStart, speechEnd) {
  const tail = TEMPLATE.tailSteps * TEMPLATE.stepSamples;
  const padded = new Float32Array(TEMPLATE.padSamples + clip.length + tail);
  padded.set(clip, TEMPLATE.padSamples);
  const features = logMel(padded), frames = Math.floor(features.length / BANDS);
  const first = TEMPLATE.padSamples + speechStart + TEMPLATE.leadSteps * TEMPLATE.stepSamples;
  const last = TEMPLATE.padSamples + speechEnd + tail;
  const sequence = [];
  for (let endSample = first; endSample <= last; endSample += TEMPLATE.stepSamples) {
    // An embedding uses the 76 frames whose last one ends at `endSample` (a frame ends 240 samples after its hop start).
    const end = Math.min(frames, Math.max(76, Math.round((endSample - (FRAME - HOP)) / HOP)));
    sequence.push(Array.from(await embed(features.slice((end - 76) * BANDS, end * BANDS))));
  }
  return sequence;
}

export function similarity(distance) { return Math.max(0, Math.min(1, 1 - Math.max(0, distance))); }
export function cosineDistance(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return 1 - dot / Math.max(1e-12, Math.sqrt(aa * bb));
}

/**
 * Mean path cost of the best alignment of `template` that ENDS at the newest frame of `stream`
 * (subsequence DTW, free start). The cost is divided by the path length, and the template may stretch
 * horizontally over at most 2L stream frames, as in the research prototype.
 */
export function subsequenceDistance(template, stream) {
  const L = template?.length ?? 0, N = stream?.length ?? 0;
  if (!L || !N) return { distance: Infinity, startIndex: null };
  let prevD = new Float64Array(N), prevS = new Float64Array(N), prevStart = new Uint32Array(N);
  for (let j = 0; j < N; j++) { prevD[j] = cosineDistance(template[0], stream[j]); prevS[j] = 1; prevStart[j] = j; }
  for (let i = 1; i < L; i++) {
    const D = new Float64Array(N), S = new Float64Array(N), start = new Uint32Array(N);
    for (let j = 0; j < N; j++) {
      let best = prevD[j], steps = prevS[j], first = prevStart[j];
      if (j && prevD[j - 1] < best) { best = prevD[j - 1]; steps = prevS[j - 1]; first = prevStart[j - 1]; }
      if (j && D[j - 1] < best && S[j - 1] < 2 * L) { best = D[j - 1]; steps = S[j - 1]; first = start[j - 1]; }
      D[j] = best + cosineDistance(template[i], stream[j]); S[j] = steps + 1; start[j] = first;
    }
    prevD = D; prevS = S; prevStart = start;
  }
  return { distance: prevD[N - 1] / prevS[N - 1], startIndex: prevStart[N - 1] };
}

/** The stream frames a template is matched against: the newest 2L + 4. */
export function matchWindow(template, history) { return history.slice(-(2 * template.length + 4)); }

/** Distance between two enrolled samples: the best alignment of one anywhere inside the other. */
export function sampleDistance(a, b) {
  const inside = (template, stream) => {
    let best = Infinity;
    for (let end = 1; end <= stream.length; end++) best = Math.min(best, subsequenceDistance(template, stream.slice(Math.max(0, end - 2 * template.length - 4), end)).distance);
    return best;
  };
  return Math.min(inside(a, b), inside(b, a));
}

export function pcmToFloat(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength % 2) throw new TypeError("PCM must be an even-length ArrayBuffer.");
  const view = new DataView(buffer), out = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
