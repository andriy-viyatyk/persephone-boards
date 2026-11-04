// Procedural sound effects: every sound is synthesized with Web Audio (oscillators and filtered
// noise), so the board ships no audio files. play(name, { pan, gain }) is the only entry point.

const MASTER_VOLUME = 0.55;
const MAX_VOICES = 28;            // sounds playing at once; extra requests are dropped
// Minimum seconds between two plays of the same sound, so a dozen towers do not turn into noise.
const THROTTLE = { steal: 0.05, bolt: 0.05, frost: 0.07, storm: 0.06, mortarFire: 0.08, explosion: 0.06, death: 0.035, hit: 0.03 };
const AMBIENCE_VOLUME = 0.05;     // soft wind under the game

export function createSound() {
  let ctx = null, master = null, noise = null, ambience = null;
  let muted = false, voices = 0;
  const last = {};

  function ensure() {
    if (!ctx) {
      ctx = new AudioContext();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(compressor).connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  // Browsers only allow audio after a user gesture: start on the first press or key.
  const unlock = () => { ensure(); window.removeEventListener("pointerdown", unlock, true); window.removeEventListener("keydown", unlock, true); };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);

  // One voice: source -> optional filter -> envelope gain -> panner -> master.
  function output(at, duration, peak, attack, pan) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner).connect(master);
    return gain;
  }
  function filterNode(type, freq, freqEnd, q, at, duration) {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, at);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, at + duration);
    return filter;
  }
  function tone(o) {
    const at = ctx.currentTime + (o.delay || 0), duration = o.dur;
    const osc = ctx.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, at + duration);
    let node = osc;
    if (o.filter) node = node.connect(filterNode(o.filter, o.filterFreq, o.filterEnd, o.q ?? 1, at, duration));
    node.connect(output(at, duration, o.gain * o.level, o.attack ?? 0.005, o.pan));
    track(osc, at, duration);
  }
  function hiss(o) {
    const at = ctx.currentTime + (o.delay || 0), duration = o.dur;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = filterNode(o.filter || "lowpass", o.freq, o.freqEnd, o.q ?? 1, at, duration);
    source.connect(filter).connect(output(at, duration, o.gain * o.level, o.attack ?? 0.005, o.pan));
    track(source, at, duration, Math.random() * 0.8);
  }
  function track(source, at, duration, offset = 0) {
    voices++;
    source.onended = () => { voices--; };
    source.start(at, offset);
    source.stop(at + duration + 0.05);
  }

  // Small random detune so repeated sounds do not sound identical.
  const vary = (value, amount = 0.06) => value * (1 + (Math.random() * 2 - 1) * amount);

  const SOUNDS = {
    bolt: (p) => { tone({ ...p, type: "triangle", freq: vary(950), freqEnd: 320, dur: 0.09, gain: 0.16 }); hiss({ ...p, filter: "highpass", freq: 3500, dur: 0.05, gain: 0.07 }); },
    hit: (p) => tone({ ...p, type: "square", freq: vary(260), freqEnd: 140, dur: 0.05, gain: 0.04, filter: "lowpass", filterFreq: 1200 }),
    mortarFire: (p) => { tone({ ...p, freq: vary(130), freqEnd: 45, dur: 0.22, gain: 0.45 }); hiss({ ...p, freq: 900, freqEnd: 200, dur: 0.16, gain: 0.25 }); },
    explosion: (p) => { hiss({ ...p, freq: vary(1600), freqEnd: 160, dur: 0.5, gain: 0.5, attack: 0.004 }); tone({ ...p, freq: vary(85), freqEnd: 32, dur: 0.4, gain: 0.45 }); },
    frost: (p) => { tone({ ...p, freq: vary(1900, 0.04), freqEnd: 2600, dur: 0.16, gain: 0.07 }); tone({ ...p, freq: vary(2900, 0.04), dur: 0.22, gain: 0.04, delay: 0.025 }); hiss({ ...p, filter: "highpass", freq: 6000, dur: 0.12, gain: 0.04 }); },
    storm: (p) => { hiss({ ...p, filter: "bandpass", freq: vary(2600, 0.2), freqEnd: 900, q: 3, dur: 0.2, gain: 0.35 }); tone({ ...p, type: "sawtooth", freq: vary(220), freqEnd: 70, dur: 0.14, gain: 0.07, filter: "lowpass", filterFreq: 2500 }); },
    death: (p) => { tone({ ...p, type: "square", freq: vary(520, 0.12), freqEnd: 140, dur: 0.12, gain: 0.06, filter: "lowpass", filterFreq: 2200 }); hiss({ ...p, filter: "bandpass", freq: 1400, dur: 0.08, gain: 0.08 }); },
    steal: (p) => { tone({ ...p, type: "square", freq: 1180, freqEnd: 880, dur: 0.09, gain: 0.05, filter: "lowpass", filterFreq: 3000 }); tone({ ...p, type: "triangle", freq: 1480, dur: 0.12, gain: 0.06, delay: 0.06 }); },
    gemLost: (p) => { tone({ ...p, type: "triangle", freq: 880, freqEnd: 440, dur: 0.28, gain: 0.22 }); tone({ ...p, type: "triangle", freq: 587, freqEnd: 294, dur: 0.35, gain: 0.18, delay: 0.13 }); },
    build: (p) => { hiss({ ...p, freq: 450, freqEnd: 120, dur: 0.2, gain: 0.4 }); tone({ ...p, freq: 110, freqEnd: 60, dur: 0.18, gain: 0.3 }); tone({ ...p, type: "triangle", freq: 523, dur: 0.1, gain: 0.08, delay: 0.14 }); tone({ ...p, type: "triangle", freq: 784, dur: 0.16, gain: 0.08, delay: 0.22 }); },
    upgrade: (p) => [523, 659, 784, 1047].forEach((freq, i) => tone({ ...p, type: "triangle", freq, dur: 0.14, gain: 0.1, delay: i * 0.07 })),
    sell: (p) => { tone({ ...p, type: "square", freq: 1320, dur: 0.06, gain: 0.05, filter: "lowpass", filterFreq: 4000 }); tone({ ...p, type: "square", freq: 1760, dur: 0.16, gain: 0.05, delay: 0.07, filter: "lowpass", filterFreq: 4000 }); },
    waveStart: (p) => { tone({ ...p, type: "sawtooth", freq: 196, dur: 0.55, gain: 0.14, attack: 0.06, filter: "lowpass", filterFreq: 900 }); tone({ ...p, type: "sawtooth", freq: 294, dur: 0.75, gain: 0.14, attack: 0.06, delay: 0.28, filter: "lowpass", filterFreq: 1100 }); },
    meteorCast: (p) => hiss({ ...p, filter: "bandpass", freq: 300, freqEnd: 2200, q: 1.5, dur: 0.95, gain: 0.22, attack: 0.5 }),
    meteorImpact: (p) => { hiss({ ...p, freq: 2400, freqEnd: 90, dur: 1.1, gain: 0.7, attack: 0.003 }); tone({ ...p, freq: 70, freqEnd: 24, dur: 0.9, gain: 0.6 }); },
    win: (p) => { [523, 659, 784, 1047].forEach((freq, i) => tone({ ...p, type: "triangle", freq, dur: 0.22, gain: 0.14, delay: i * 0.13 })); [523, 659, 784].forEach((freq) => tone({ ...p, type: "triangle", freq: freq * 2, dur: 1.1, gain: 0.07, delay: 0.6 })); },
    lose: (p) => [392, 349, 311, 262].forEach((freq, i) => tone({ ...p, type: "triangle", freq, freqEnd: i === 3 ? 196 : undefined, dur: i === 3 ? 0.9 : 0.3, gain: 0.14, delay: i * 0.25 })),
    click: (p) => tone({ ...p, type: "triangle", freq: 1100, dur: 0.035, gain: 0.05 }),
    denied: (p) => tone({ ...p, type: "square", freq: 150, dur: 0.14, gain: 0.07, filter: "lowpass", filterFreq: 900 }),
  };

  function play(name, { pan = 0, gain = 1 } = {}) {
    if (muted || !ctx || ctx.state !== "running" || voices >= MAX_VOICES || gain <= 0.01) return;
    const now = ctx.currentTime;
    if (THROTTLE[name] && now - (last[name] ?? -1) < THROTTLE[name]) return;
    last[name] = now;
    SOUNDS[name]?.({ pan, level: gain });
  }

  // Soft looping wind, started with the first level and stopped on the menu.
  function setAmbience(on) {
    if (!ctx) return;
    if (on && !ambience) {
      const source = ctx.createBufferSource();
      source.buffer = noise; source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass"; filter.frequency.value = 420; filter.Q.value = 0.7;
      const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      lfo.frequency.value = 0.08; lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(filter.frequency);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(AMBIENCE_VOLUME, ctx.currentTime + 2);
      source.connect(filter).connect(gain).connect(master);
      source.start(); lfo.start();
      ambience = { source, lfo, gain };
    } else if (!on && ambience) {
      const { source, lfo, gain } = ambience;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      source.stop(ctx.currentTime + 0.7); lfo.stop(ctx.currentTime + 0.7);
      ambience = null;
    }
  }

  function setMuted(value) {
    muted = !!value;
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.03);
  }
  // Suspend while the tab is hidden so nothing keeps playing in the background.
  function setSuspended(value) {
    if (!ctx) return;
    if (value) ctx.suspend(); else ctx.resume();
  }

  return { play, setMuted, setSuspended, setAmbience, ensure, get muted() { return muted; } };
}
