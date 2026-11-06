// TF Hub speech_embedding/1 frontend: 16 kHz mono float waveform.
const N = 512, FRAME = 400, HOP = 160, BANDS = 32;
const hzToMel = f => 1127 * Math.log(1 + f / 700);
const edges = Array.from({ length: BANDS + 2 }, (_, i) => hzToMel(60) + i * (hzToMel(3800) - hzToMel(60)) / (BANDS + 1));
const weights = Array.from({ length: BANDS }, (_, b) => Float64Array.from({ length: N / 2 + 1 }, (_, k) => {
  if (!k) return 0;
  const m = hzToMel(k * 16000 / N);
  return Math.max(0, Math.min((m - edges[b]) / (edges[b + 1] - edges[b]), (edges[b + 2] - m) / (edges[b + 2] - edges[b + 1])));
}));
const hann = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
function magnitude(samples, start) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < FRAME; i++) re[i] = samples[start + i] * hann[i];
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let base = 0; base < N; base += len) for (let j = 0; j < len / 2; j++) {
      const c = Math.cos(ang * j), s = Math.sin(ang * j), q = base + j + len / 2, p = base + j;
      const tr = re[q] * c - im[q] * s, ti = re[q] * s + im[q] * c;
      re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
    }
  }
  return Float64Array.from({ length: N / 2 + 1 }, (_, i) => Math.hypot(re[i], im[i]));
}
export function logMel(samples) {
  const count = Math.max(0, 1 + Math.floor((samples.length - FRAME) / HOP));
  const out = new Float32Array(count * BANDS);
  for (let f = 0; f < count; f++) {
    const mag = magnitude(samples, f * HOP);
    for (let b = 0; b < BANDS; b++) { let sum = 0; for (let k = 1; k <= N / 2; k++) sum += mag[k] * weights[b][k]; out[f * BANDS + b] = Math.log(sum + 0.001); }
  }
  return out;
}
