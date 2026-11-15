(function () {
  "use strict";
  const MAX_BYTES = 1920000, FFT_SIZE = 1024, HOP = 512, COLS = 640, BINS = 128;
  const $ = (id) => document.getElementById(id);
  const state = { channel: null, chunks: [], bytes: 0, id: null, recording: false, incomplete: false, atLimit: false, partial: false, armed: false, playing: false, offset: 0, context: null, source: null, raf: 0, samples: new Float32Array(FFT_SIZE), sampleCount: 0, visualQueue: new Float32Array(32000), visualRead: 0, visualWrite: 0, visualLength: 0, image: new Uint8ClampedArray(COLS * BINS * 4), displayImage: new Uint8ClampedArray(COLS * BINS * 4), columns: 0, wave: new Float32Array(COLS), waveAt: 0 };
  const spectrogramBuffer = document.createElement("canvas"); spectrogramBuffer.width = COLS; spectrogramBuffer.height = BINS;
  const status = (key, vars) => { $("debug-status").textContent = t(key, vars); };
  function colors() {
    const css = getComputedStyle(document.documentElement);
    return [css.getPropertyValue("--p-panel").trim(), css.getPropertyValue("--p-border").trim(), css.getPropertyValue("--p-accent").trim(), css.getPropertyValue("--p-text").trim()];
  }
  function rgba(color, alpha) {
    const probe = document.createElement("span"); probe.style.color = color; document.body.append(probe);
    const value = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number); probe.remove();
    if (!value) return [];
    return [value[0], value[1], value[2], alpha];
  }
  function paintColumn() {
    const n = FFT_SIZE, real = new Float32Array(n), imag = new Float32Array(n);
    for (let i = 0; i < n; i++) real[i] = state.samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [real[i], real[j]] = [real[j], real[i]]; } }
    for (let len = 2; len <= n; len <<= 1) { const angle = -2 * Math.PI / len, wr0 = Math.cos(angle), wi0 = Math.sin(angle); for (let i = 0; i < n; i += len) { let wr = 1, wi = 0; for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2, tr = wr * real[b] - wi * imag[b], ti = wr * imag[b] + wi * real[b]; real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti; const next = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = next; } } }
    const col = state.columns++ % COLS, palette = [rgba(colors()[0], 255), rgba(colors()[2], 255), rgba(colors()[3], 255)];
    for (let y = 0; y < BINS; y++) { const bin = Math.min(n / 2 - 1, y * 4), mag = Math.hypot(real[bin], imag[bin]) / (n / 2), db = 20 * Math.log10(Math.max(0.00001, mag)), level = Math.max(0, Math.min(1, (db + 80) / 72)); const c = level < .55 ? palette[0].map((v, i) => v + (palette[1][i] - v) * level / .55) : palette[1].map((v, i) => v + (palette[2][i] - v) * (level - .55) / .45); const p = ((BINS - 1 - y) * COLS + col) * 4; for (let k = 0; k < 4; k++) state.image[p + k] = c[k]; }
  }
  function processPcm(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    const available = Math.min(bytes.length, MAX_BYTES - state.bytes);
    const copy = bytes.slice(0, available); if (!available) return;
    state.chunks.push(copy); state.bytes += available;
    for (let i = 0; i + 1 < available; i += 2) {
      const sample = view.getInt16(i, true) / 32768;
      if (state.visualLength === state.visualQueue.length) { state.visualRead = (state.visualRead + 1) % state.visualQueue.length; state.visualLength--; }
      state.visualQueue[state.visualWrite] = sample; state.visualWrite = (state.visualWrite + 1) % state.visualQueue.length; state.visualLength++;
    }
    const dv = new DataView(copy.buffer); let sum = 0; for (let i = 0; i < copy.byteLength; i += 2) { const v = dv.getInt16(i, true) / 32768; sum += v * v; }
    state.wave[state.waveAt++ % COLS] = Math.sqrt(sum / Math.max(1, copy.byteLength / 2));
    if (available < bytes.length || state.bytes >= MAX_BYTES) { state.incomplete = true; state.atLimit = true; state.recording = false; state.armed = false; if (!state.local) state.channel?.send({ type: "limit" }); status("debug.limit"); }
    schedule(); refresh();
  }
  function schedule() { if (!state.raf) state.raf = requestAnimationFrame(draw); }
  function draw() {
    state.raf = 0; const [bg, border, accent, text] = colors();
    let columnsThisFrame = 0;
    while (state.visualLength && columnsThisFrame < 6) {
      const sample = state.visualQueue[state.visualRead]; state.visualRead = (state.visualRead + 1) % state.visualQueue.length; state.visualLength--;
      state.samples[state.sampleCount % FFT_SIZE] = sample; state.sampleCount++;
      if (state.sampleCount >= FFT_SIZE && (state.sampleCount - FFT_SIZE) % HOP === 0) {
        const ordered = new Float32Array(FFT_SIZE), start = state.sampleCount % FFT_SIZE;
        for (let i = 0; i < FFT_SIZE; i++) ordered[i] = state.samples[(start + i) % FFT_SIZE];
        state.samples.set(ordered); paintColumn(); columnsThisFrame++;
      }
    }
    const canvas = $("debug-spectrogram"), ctx = canvas.getContext("2d", { alpha: false });
    if (canvas.width !== Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio))) canvas.width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const first = state.columns >= COLS ? state.columns % COLS : 0;
    for (let x = 0; x < COLS; x++) { const sourceX = (first + x) % COLS; for (let y = 0; y < BINS; y++) { const from = (y * COLS + sourceX) * 4, to = (y * COLS + x) * 4; state.displayImage[to] = state.image[from]; state.displayImage[to + 1] = state.image[from + 1]; state.displayImage[to + 2] = state.image[from + 2]; state.displayImage[to + 3] = state.image[from + 3]; } }
    spectrogramBuffer.getContext("2d").putImageData(new ImageData(state.displayImage, COLS, BINS), 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(spectrogramBuffer, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = border; ctx.fillStyle = text; ctx.font = "11px sans-serif"; ctx.beginPath(); for (let i = 1; i < 4; i++) { const y = i * canvas.height / 4; ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); } ctx.stroke(); ctx.fillText("8 kHz", 5, 13); ctx.fillText("0 kHz", 5, canvas.height - 4); ctx.fillText("0 dB", canvas.width - 42, 13); ctx.fillText("-40", canvas.width - 35, canvas.height / 2); ctx.fillText("-80 dB", canvas.width - 42, canvas.height - 4);
    const wave = $("debug-waveform"), wctx = wave.getContext("2d"); if (wave.width !== Math.max(1, Math.floor(wave.clientWidth * devicePixelRatio))) wave.width = Math.max(1, Math.floor(wave.clientWidth * devicePixelRatio));
    wctx.clearRect(0, 0, wave.width, wave.height); wctx.strokeStyle = accent; wctx.beginPath(); for (let x = 0; x < wave.width; x++) { const i = Math.floor(x / wave.width * COLS), v = state.wave[(state.waveAt - COLS + i + COLS * 4) % COLS]; const y = (wave.height / 2) * (1 - Math.min(1, v * 8)); x ? wctx.lineTo(x, y) : wctx.moveTo(x, y); } wctx.stroke();
    drawCursor();
    if (state.visualLength) schedule();
  }
  function drawCursor() { const canvas = $("debug-spectrogram"), ctx = canvas.getContext("2d"), [,,accent] = colors(); if (!state.bytes) return; const fraction = state.playing ? playbackPosition() / duration() : Number($("debug-seek").value) / 1000; const x = Math.max(0, Math.min(canvas.width, fraction * canvas.width)); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  function duration() { return state.bytes / 32000; }
  function playbackPosition() { return state.offset + (state.playing && state.context ? state.context.currentTime - state.startedAt : 0); }
  function time(value) { const s = Math.max(0, Math.floor(value)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  function refresh() { const elapsed = state.playing ? playbackPosition() : state.recording ? duration() : Number($("debug-seek").value) / 1000 * duration(); $("debug-duration").textContent = `${time(elapsed)} / ${time(duration())}`; $("debug-seek").disabled = !state.bytes; $("debug-play").disabled = !state.bytes || state.recording || state.armed || Boolean(window.sttRecordingActive); $("debug-stop").disabled = !state.recording && !state.armed; $("debug-record").disabled = state.recording; $("debug-attach").disabled = !$("debug-requests").value || state.recording; $("debug-play-stop").disabled = !state.playing; }
  function clear() { releasePlayback(); state.chunks.length = 0; state.bytes = 0; state.id = null; state.recording = false; state.armed = false; state.incomplete = false; state.atLimit = false; state.partial = false; state.sampleCount = 0; state.visualRead = state.visualWrite = state.visualLength = 0; state.columns = 0; state.waveAt = 0; state.image.fill(0); state.displayImage.fill(0); state.wave.fill(0); state.samples.fill(0); state.channel?.send({ type: "clear" }); status("debug.idle"); $("debug-seek").value = "0"; schedule(); refresh(); }
  function startArm() { stopPlayback(); clearLocal(false); if (!state.channel) return status("debug.disconnected"); state.armed = true; state.channel.send({ type: "arm" }); status("debug.waiting"); refresh(); }
  function clearLocal(notify = true) { releasePlayback(); state.chunks.length = 0; state.bytes = 0; state.id = null; state.recording = false; state.armed = false; state.incomplete = false; state.atLimit = false; state.partial = false; state.sampleCount = 0; state.visualRead = state.visualWrite = state.visualLength = 0; state.columns = 0; state.waveAt = 0; state.image.fill(0); state.displayImage.fill(0); state.wave.fill(0); state.samples.fill(0); if (notify) state.channel?.send({ type: "clear" }); $("debug-seek").value = "0"; schedule(); refresh(); }
  function stopTap() { const hadAudio = state.bytes > 0; state.armed = false; state.recording = false; state.incomplete ||= hadAudio; state.channel?.send({ type: "stop" }); status(hadAudio ? "debug.incomplete" : "debug.stopped"); refresh(); }
  function stopPlayback() { if (state.source) { try { state.source.stop(); } catch {} try { state.source.disconnect(); } catch {} state.source = null; } state.playing = false; window.audioDebugPlaying = false; refresh(); }
  function releasePlayback() { stopPlayback(); if (state.context) { state.context.close().catch(() => {}); state.context = null; } }
  async function playAt(seconds = 0) { if (!state.bytes || state.recording || state.armed || window.sttRecordingActive) return; stopPlayback(); const bytes = new Uint8Array(state.bytes); let offset = 0; for (const chunk of state.chunks) { bytes.set(chunk, offset); offset += chunk.length; } state.context ||= new AudioContext(); const buffer = state.context.createBuffer(1, bytes.length / 2, 16000), data = buffer.getChannelData(0), view = new DataView(bytes.buffer); for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true) / 32768; const source = state.context.createBufferSource(); source.buffer = buffer; source.connect(state.context.destination); state.source = source; state.offset = Math.max(0, Math.min(duration(), seconds)); state.startedAt = state.context.currentTime; state.playing = true; window.audioDebugPlaying = true; source.onended = () => { if (state.source === source) { state.offset = duration(); stopPlayback(); $("debug-seek").value = "1000"; } }; source.start(0, state.offset); refresh(); }
  function onMessage(message) {
    if (message.type === "state") { state.armed = message.armed; const select = $("debug-requests"), previous = select.value; select.replaceChildren(new Option(t("debug.noRequests"), "")); for (const item of message.requests || []) select.add(new Option(`${item.id.slice(0, 8)} · ${time(item.elapsedMs / 1000)}${item.tapped ? ` · ${t("debug.active")}` : ""}`, item.id)); if ([...select.options].some((o) => o.value === previous)) select.value = previous; refresh(); }
    else if (message.type === "tap-started") { state.id = message.id; state.partial = message.partial; state.recording = true; state.incomplete = false; status(message.partial ? "debug.partial" : "debug.recording", { label: message.label || t("debug.unknown") }); }
    else if (message.type === "pcm" && message.id === state.id && state.recording) processPcm(message.data);
    else if (message.type === "tap-ended" && message.id === state.id) { state.recording = false; state.incomplete ||= message.incomplete; status(message.reason === "limit" ? "debug.limit" : message.incomplete ? "debug.incomplete" : "debug.stopped"); refresh(); }
    else if (message.type === "cleared") clearLocal(false);
    else if (message.type === "debug-error") { state.recording = false; state.armed = false; status("debug.failed", { message: message.message }); refresh(); }
  }
  async function connect() { try { const channel = await persephone.service.openChannel({ type: "audio-debug" }); state.channel = channel; channel.onMessage(onMessage); channel.onClose((reason) => { state.channel = null; clearLocal(false); status("debug.failed", { message: reason?.message || t("debug.disconnected") }); refresh(); }); if ($("audio-debug-panel").open) channel.send({ type: "visibility", visible: true }); status("debug.idle"); } catch (error) { status("debug.failed", { message: error.message || t("error.generic") }); } }
  $("debug-record").addEventListener("click", startArm); $("debug-stop").addEventListener("click", stopTap); $("debug-clear").addEventListener("click", clear); $("debug-play").addEventListener("click", () => { void playAt(0); }); $("debug-play-stop").addEventListener("click", stopPlayback);
  $("debug-attach").addEventListener("click", () => { clearLocal(false); state.channel?.send({ type: "select", id: $("debug-requests").value }); });
  $("debug-seek").addEventListener("input", () => { const position = Number($("debug-seek").value) / 1000 * duration(); if (state.playing) void playAt(position); else { state.offset = position; refresh(); drawCursor(); } });
  $("debug-spectrogram").addEventListener("click", (event) => { const rect = event.currentTarget.getBoundingClientRect(); const position = (event.clientX - rect.left) / rect.width; $("debug-seek").value = String(Math.round(position * 1000)); const seconds = position * duration(); if (state.playing) void playAt(seconds); else { state.offset = seconds; refresh(); drawCursor(); } });
  window.addEventListener("resize", schedule); $("audio-debug-panel").addEventListener("toggle", () => { schedule(); const visible = $("audio-debug-panel").open; state.channel?.send({ type: "visibility", visible }); if (!visible && (state.recording || state.armed)) stopTap(); });
  const themeObserver = new MutationObserver(schedule);
  for (const node of [document.documentElement, document.body]) themeObserver.observe(node, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  const resizeObserver = new ResizeObserver(schedule); resizeObserver.observe($("debug-spectrogram")); resizeObserver.observe($("debug-waveform"));
  const playbackTimer = setInterval(() => { if (state.playing) { const pos = playbackPosition(); $("debug-seek").value = String(Math.round(Math.min(1, pos / Math.max(.001, duration())) * 1000)); refresh(); schedule(); if (pos >= duration()) stopPlayback(); } }, 33);
  window.addEventListener("beforeunload", () => { clearInterval(playbackTimer); themeObserver.disconnect(); resizeObserver.disconnect(); state.channel?.send({ type: "clear" }); state.channel?.close(); releasePlayback(); state.chunks.length = 0; state.image = new Uint8ClampedArray(0); state.displayImage = new Uint8ClampedArray(0); });
  // The board's own Test recording always feeds the panel directly: the page already holds the exact
  // PCM it sends to the service, so no service tap or arming is involved.
  function beginLocal() {
    if (state.armed || (state.recording && !state.local)) stopTap();
    stopPlayback(); clearLocal(false);
    state.local = true; state.recording = true;
    const panel = $("audio-debug-panel"); if (!panel.open) panel.open = true;
    status("debug.recording"); refresh();
  }
  function pushLocal(data) { if (state.local && state.recording) processPcm(data); }
  function endLocal() { if (!state.local) return; state.local = false; if (state.recording) { state.recording = false; status("debug.stopped"); } refresh(); }
  window.AudioDebug = { connect, refresh, isPlaying: () => state.playing, stopPlayback, beginLocal, pushLocal, endLocal };
})();
