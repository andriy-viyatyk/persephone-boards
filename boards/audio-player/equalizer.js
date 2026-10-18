(() => {
  const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = {
    flat: [0,0,0,0,0,0,0,0,0,0], bass: [6,5,4,3,1,0,-1,-2,-2,-2],
    treble: [-2,-2,-1,0,1,2,3,4,5,6], vocal: [-2,-1,0,2,4,4,2,0,-1,-2],
  };
  const clamp = (n) => Math.max(-12, Math.min(12, Number.isFinite(Number(n)) ? Number(n) : 0));
  function normalize(value = {}) {
    const bandsDb = Array.isArray(value.bandsDb) && value.bandsDb.length === 10 ? value.bandsDb.map(clamp) : [...PRESETS.flat];
    const preset = ["flat","bass","treble","vocal","custom"].includes(value.preset) ? value.preset : "flat";
    return { enabled: !!value.enabled, bandsDb, preset };
  }
  function create(context) {
    const filters = FREQUENCIES.map((frequency, index) => {
      const filter = context.createBiquadFilter(); filter.type = index === 0 ? "lowshelf" : index === 9 ? "highshelf" : "peaking";
      filter.frequency.value = frequency; filter.Q.value = 1.4; filter.gain.value = 0; return filter;
    });
    for (let i=0;i<filters.length-1;i++) filters[i].connect(filters[i+1]);
    return { input: filters[0], output: filters.at(-1), filters,
      set(value) { const state=normalize(value); filters.forEach((node,i)=>node.gain.setTargetAtTime(state.enabled?state.bandsDb[i]:0,context.currentTime,0.015)); },
      dispose() { for (const node of filters) node.disconnect(); } };
  }
  window.AudioEqualizer = { FREQUENCIES, PRESETS, clamp, normalize, create };
})();
