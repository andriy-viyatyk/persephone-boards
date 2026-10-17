(() => {
  const FFT_SIZE = 256;
  const canvas = document.querySelector("#canvas"), host = document.querySelector("#visualizer"), metadata = document.querySelector("#metadata");
  const page = window.persephone?.page;
  let audioContext = null, analyser = null, effect = null, raf = 0, selected = "bars", visible = true, pageVisible = typeof page?.visible === "boolean" ? page.visible : true, inert = false, dark = false, graph = null;
  const ctx = canvas.getContext("2d");
  function measure() { const rect = host.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }
  function draw() { if (inert || selected === "none" || !pageVisible || !visible || !analyser || !effect) return; const w = host.clientWidth, h = host.clientHeight; effect.draw(ctx, analyser, w, h, dark); raf = requestAnimationFrame(draw); }
  function sync() { stop(); if (selected === "none") { clear(); metadata.hidden = !window.currentTrack; return; } metadata.hidden = true; if (pageVisible && visible && analyser && effect) raf = requestAnimationFrame(draw); }
  function ensureGraph(decks) {
    if (audioContext || inert) return graph;
    audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = FFT_SIZE; analyser.smoothingTimeConstant = 0.8;
    const master = audioContext.createGain(); master.gain.value = 0.8;
    const nodes = decks.map((audio) => { const source=audioContext.createMediaElementSource(audio), deckGain=audioContext.createGain(), eq=window.AudioEqualizer.create(audioContext); source.connect(deckGain); deckGain.connect(eq.input); eq.output.connect(master); deckGain.gain.value=0; return {audio,source,gain:deckGain,eq}; });
    master.connect(analyser); analyser.connect(audioContext.destination); graph={context:audioContext,master,nodes}; return graph;
  }
  function applyEqualizer(value) { if (!graph) return; graph.nodes.forEach((node)=>node.eq.set(value)); }
  function setMaster(value, muted=false) { if (graph) graph.master.gain.setTargetAtTime(muted?0:Math.max(0,Math.min(1,value)),audioContext.currentTime,0.015); }
  function setDeckGain(index,value,when=audioContext?.currentTime||0) { const node=graph?.nodes[index]; if(node) node.gain.gain.setValueAtTime(Math.max(0,Math.min(1,value)),when); }
  function rampDeck(index,value,seconds) { const node=graph?.nodes[index]; if(!node)return; const now=audioContext.currentTime; node.gain.gain.cancelScheduledValues(now); node.gain.gain.setValueAtTime(node.gain.gain.value,now); node.gain.gain.linearRampToValueAtTime(Math.max(0,Math.min(1,value)),now+seconds); }
  function getTrackInfo(item) {
    const basename = String(item?.href || "").replace(/\\/g, "/").split("/").pop() || "";
    const filename = (item?.title || basename).replace(/\.[^.]+$/, "").trim();
    const separator = filename.includes(" – ") ? " – " : filename.includes(" - ") ? " - " : null;
    if (item?.artist) return { title: item.title || filename, artist: item.artist };
    if (separator) { const index = filename.indexOf(separator); return { artist: filename.slice(0, index).trim(), title: filename.slice(index + separator.length).trim() }; }
    return { title: filename, artist: "" };
  }
  function setEffect(type) { selected = type; effect?.dispose?.(); effect = window.AudioPlayerEffects.create(type); document.querySelectorAll("[data-effect]").forEach((button) => button.classList.toggle("active", button.dataset.effect === type)); sync(); }
  document.querySelectorAll("[data-effect]").forEach((button) => button.addEventListener("click", async () => { setEffect(button.dataset.effect); await window.updatePrefs({ visualizer: selected }); }));
  const resize = new ResizeObserver(() => { measure(); if (selected === "none") clear(); }); resize.observe(host);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0 }); intersection.observe(host);
  const disposeVisibility = typeof page?.onVisibilityChange === "function" ? page.onVisibilityChange((isVisible) => {
    pageVisible = !!isVisible;
    // A fresh effect drops paused particles, so a returning page starts from the center as the built-in player does.
    if (!pageVisible) { stop(); clear(); if (effect) { effect.dispose?.(); effect = window.AudioPlayerEffects.create(selected); } }
    else { measure(); sync(); }
  }) : null;
  window.persephone.onThemeChange((theme) => { dark = !!theme.isDark; });
  window.AudioVisualizer = {
    attach(decks) { ensureGraph(Array.isArray(decks)?decks:[decks]); measure(); sync(); return graph; },
    get graph() { return graph; },
    applyEqualizer, setMaster, setDeckGain, rampDeck,
    setTrack(item) { window.currentTrack = item; this.trackInfo = item ? getTrackInfo(item) : null; document.querySelector("#now-playing-title").textContent = this.trackInfo?.title || ""; document.querySelector("#now-playing-artist").textContent = this.trackInfo?.artist || ""; metadata.hidden = selected !== "none" || !item; const chip = document.querySelector("#track-chip"); document.querySelector("#track-chip-title").textContent = this.trackInfo?.title || ""; document.querySelector("#track-chip-artist").textContent = this.trackInfo?.artist || ""; chip.title = [this.trackInfo?.artist, this.trackInfo?.title].filter(Boolean).join(" - "); chip.hidden = !item; },
    async start() { if (audioContext?.state === "suspended") await audioContext.resume(); sync(); },
    setEffect,
    dispose() { inert = true; stop(); disposeVisibility?.(); resize.disconnect(); intersection.disconnect(); effect?.dispose?.(); effect = null; analyser?.disconnect(); analyser = null; if(graph){for(const node of graph.nodes){node.source.disconnect();node.eq.dispose();node.gain.disconnect();}graph.master.disconnect();graph=null;} if (audioContext) void audioContext.close().catch(() => {}); audioContext = null; },
  };
})();
