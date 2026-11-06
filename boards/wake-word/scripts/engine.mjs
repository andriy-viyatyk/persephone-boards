import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = path.join(ROOT, "vendor", "onnxruntime-web");
const MODEL = path.join(ROOT, "model", "speech-embedding.onnx");
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

async function session() {
  if (!sessionPromise) sessionPromise = (async () => {
    const ort = await import(pathToFileURL(path.join(RUNTIME, "dist", "ort.node.min.mjs")));
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: pathToFileURL(path.join(RUNTIME, "dist", "ort-wasm-simd-threaded.mjs")).href,
      wasm: pathToFileURL(path.join(RUNTIME, "dist", "ort-wasm-simd-threaded.wasm")).href,
    };
    const model = await import("node:fs/promises").then(({ readFile }) => readFile(MODEL));
    const instance = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], intraOpNumThreads: 1, interOpNumThreads: 1, graphOptimizationLevel: "all" });
    return { ort, instance };
  })();
  return sessionPromise;
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
    while (this.frames.length >= this.nextInferenceFrame) { ready.push(this.latestWindow()); this.nextInferenceFrame += 8; }
    return ready;
  }
  latestWindow() {
    if (this.frames.length < 76) return null;
    const rows = this.frames.slice(-76), out = new Float32Array(76 * BANDS);
    rows.forEach((row, i) => out.set(row, i * BANDS));
    return { features: out, sampleEnd: this.frameEndSamples.at(-1) };
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

// One model window of silence before an enrollment clip, as the research prototype did: a quickly
// called name (~0.5 s) is shorter than the 775 ms the model needs for its first embedding, so without
// it a short name yields no embedding at all. Windows lying entirely in the padding are skipped.
const ENROLL_PAD_SAMPLES = 12800;
const FIRST_SPEECH_END_FRAME = 84;

export async function encodeSamples(samples) {
  const padded = new Float32Array(ENROLL_PAD_SAMPLES + samples.length);
  padded.set(samples, ENROLL_PAD_SAMPLES);
  const features = logMel(padded);
  const sequence = [];
  for (let end = FIRST_SPEECH_END_FRAME; end <= Math.floor(features.length / BANDS); end += 8) {
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
export function subsequenceDistance(template, history) {
  if (!template?.length || !history?.length) return Infinity;
  let previous = new Float64Array(history.length + 1);
  for (let i = 1; i <= template.length; i++) {
    const current = new Float64Array(history.length + 1); current[0] = Infinity;
    for (let j = 1; j <= history.length; j++) current[j] = cosineDistance(template[i - 1], history[j - 1]) + Math.min(previous[j], current[j - 1], previous[j - 1]);
    previous = current;
  }
  return Math.min(...Array.from(previous.slice(1), (cost) => cost / template.length));
}

export function pcmToFloat(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength % 2) throw new TypeError("PCM must be an even-length ArrayBuffer.");
  const view = new DataView(buffer), out = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
