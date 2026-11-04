(() => {
  // HPSS tuning: frequencies in Hz, levels in dB, and smoothing times in seconds.
  const LOW = 30, HIGH = 8000, TIME_FRAMES = 17, FREQ_HALF_WIDTH = 8;
  const MIN_DB = -90, MAX_DB = -20, ATTACK = .025, RELEASE = .15;
  const BANDS = { kick: [40, 150, true], hats: [2000, 10000, true], bass: [40, 250, false], vocals: [250, 4000, false], other: [4000, 8000, false] };
  // Per-note (pitch-class) volume from the harmonic part. Below ~400 Hz a 2048-point bin is wider than a semitone, so those bins are skipped.
  const CHROMA_LOW = 400, CHROMA_HIGH = 5000, C0_HZ = 16.3516, CHROMA_ATTACK = .04, CHROMA_RELEASE = .25;
  function create(analyser) {
    const data = new Float32Array(analyser.frequencyBinCount), binHz = analyser.context.sampleRate / analyser.fftSize;
    const start = Math.max(0, Math.ceil(LOW / binHz)), end = Math.min(data.length - 1, Math.floor(HIGH / binHz));
    const frames = Array.from({ length: TIME_FRAMES }, () => new Float32Array(data.length));
    const harmonic = new Float32Array(data.length), percussive = new Float32Array(data.length), scratch = new Float32Array(TIME_FRAMES);
    const groups = Object.fromEntries(Object.keys(BANDS).map((key) => [key, 0]));
    const notes = new Float32Array(12), noteSums = new Float32Array(12), chromaStart = Math.max(start, Math.ceil(CHROMA_LOW / binHz)), chromaEnd = Math.min(end, Math.floor(CHROMA_HIGH / binHz));
    const noteOfBin = new Int8Array(data.length).fill(-1); for (let i = chromaStart; i <= chromaEnd; i++) noteOfBin[i] = ((Math.round(12 * Math.log2(i * binHz / C0_HZ)) % 12) + 12) % 12;
    let head = 0, count = 0, lastTime = null;
    function median(length) {
      for (let i = 1; i < length; i++) { const value = scratch[i]; let j = i - 1; while (j >= 0 && scratch[j] > value) { scratch[j + 1] = scratch[j]; j--; } scratch[j + 1] = value; }
      const middle = Math.floor(length / 2); return length % 2 ? scratch[middle] : (scratch[middle - 1] + scratch[middle]) / 2;
    }
    function reset() { frames.forEach((frame) => frame.fill(0)); harmonic.fill(0); percussive.fill(0); notes.fill(0); head = 0; count = 0; lastTime = null; for (const key of Object.keys(groups)) groups[key] = 0; }
    function update(nowSeconds) {
      const dt = lastTime === null ? 0 : Math.max(0, nowSeconds - lastTime); lastTime = nowSeconds;
      analyser.getFloatFrequencyData(data); const frame = frames[head];
      for (let i = start; i <= end; i++) frame[i] = Number.isFinite(data[i]) ? 10 ** (data[i] / 20) : 0;
      head = (head + 1) % TIME_FRAMES; count = Math.min(count + 1, TIME_FRAMES);
      for (let i = start; i <= end; i++) {
        for (let j = 0; j < count; j++) scratch[j] = frames[j][i];
        const h = median(count); let n = 0;
        for (let j = Math.max(start, i - FREQ_HALF_WIDTH); j <= Math.min(end, i + FREQ_HALF_WIDTH); j++) scratch[n++] = frame[j];
        const p = median(n), h2 = h * h, p2 = p * p, sum = h2 + p2;
        harmonic[i] = sum ? frame[i] * h2 / sum : 0; percussive[i] = sum ? frame[i] * p2 / sum : 0;
      }
      for (const [key, [low, high, perc]] of Object.entries(BANDS)) {
        const first = Math.max(start, Math.ceil(low / binHz)), last = Math.min(end, Math.floor(high / binHz)), spectrum = perc ? percussive : harmonic;
        let sum = 0; for (let i = first; i <= last; i++) sum += spectrum[i];
        const mean = last >= first ? sum / (last - first + 1) : 0, db = mean > 0 ? 20 * Math.log10(mean) : MIN_DB;
        const level = Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB))), tau = level > groups[key] ? ATTACK : RELEASE;
        groups[key] += (level - groups[key]) * (count === 1 ? 1 : 1 - Math.exp(-dt / tau));
      }
      // Each note: its share of the strongest note, scaled by that note's absolute loudness so silence stays dark.
      noteSums.fill(0); for (let i = chromaStart; i <= chromaEnd; i++) noteSums[noteOfBin[i]] += harmonic[i];
      let strongest = 0; for (let n = 0; n < 12; n++) strongest = Math.max(strongest, noteSums[n]);
      const loudDb = strongest > 0 ? 20 * Math.log10(strongest) : MIN_DB, loudness = Math.max(0, Math.min(1, (loudDb - MIN_DB) / (MAX_DB - MIN_DB)));
      for (let n = 0; n < 12; n++) { const share = strongest > 0 ? noteSums[n] / strongest : 0, level = share * share * loudness, tau = level > notes[n] ? CHROMA_ATTACK : CHROMA_RELEASE; notes[n] += (level - notes[n]) * (count === 1 ? 1 : 1 - Math.exp(-dt / tau)); }
    }
    return { update, reset, groups, notes, harmonic, percussive };
  }
  window.AudioHPSS = { create };
})();
