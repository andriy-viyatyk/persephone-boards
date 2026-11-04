(() => {
  // Kick detection and inner-ring tuning (frequencies in Hz, times in seconds).
  const BAND_LOW = 40, BAND_HIGH = 150, HISTORY = .75, THRESHOLD_K = 1.5, FLOOR = .001;
  const REFRACTORY = .11, DECAY = .14, AGC_DECAY = 2;
  function create(analyser) {
    const data = new Float32Array(analyser.frequencyBinCount), previous = new Float32Array(data.length);
    const binHz = analyser.context.sampleRate / analyser.fftSize, start = Math.max(0, Math.round(BAND_LOW / binHz)), end = Math.min(data.length - 1, Math.round(BAND_HIGH / binHz));
    const features = { kick: 0, kickLevel: 0 };
    let history = [], head = 0, count = 0, lastTime = null, lastOnset = -Infinity, maximum = 0, primed = false;
    function reset() { history = []; head = 0; count = 0; lastTime = null; lastOnset = -Infinity; maximum = 0; primed = false; previous.fill(0); features.kick = 0; features.kickLevel = 0; }
    function update(nowSeconds) {
      const dt = lastTime === null ? 0 : Math.max(0, nowSeconds - lastTime); lastTime = nowSeconds;
      analyser.getFloatFrequencyData(data);
      let flux = 0, level = 0;
      for (let i = start; i <= end; i++) { const magnitude = Number.isFinite(data[i]) ? 10 ** (data[i] / 20) : 0; level += magnitude; if (primed) flux += Math.max(0, magnitude - previous[i]); previous[i] = magnitude; }
      primed = true; level /= end - start + 1;
      maximum = Math.max(level, maximum * Math.exp(-dt / AGC_DECAY)); features.kickLevel = maximum > 0 ? Math.min(1, level / maximum) : 0;
      while (count && nowSeconds - history[head].time > HISTORY) { head = (head + 1) % history.length; count--; }
      let sum = 0, squares = 0; for (let i = 0; i < count; i++) { const value = history[(head + i) % history.length].flux; sum += value; squares += value * value; }
      const mean = count ? sum / count : 0, threshold = mean + THRESHOLD_K * Math.sqrt(Math.max(0, count ? squares / count - mean * mean : 0));
      features.kick *= Math.exp(-dt / DECAY);
      if (flux > threshold && flux > FLOOR && nowSeconds - lastOnset >= REFRACTORY) { features.kick = .6 + .4 * Math.min(1, flux / Math.max(threshold, FLOOR) - 1); lastOnset = nowSeconds; }
      if (count === history.length) { const grown = new Array(Math.max(1, history.length * 2)); for (let i = 0; i < count; i++) grown[i] = history[(head + i) % history.length]; history = grown; head = 0; }
      history[(head + count) % history.length] = { time: nowSeconds, flux }; count++;
    }
    return { update, features, reset };
  }
  window.AudioBeatDetector = { create };
})();
