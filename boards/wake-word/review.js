"use strict";
(() => {
  const el = id => document.getElementById(id);
  const dialog = el("review-dialog"), visual = el("review-visual");
  const handles = [el("review-start"), el("review-end")];
  const spectrum = document.createElement("canvas");
  let spectrumDirty = true;
  let clip = null, bounds = [0, 0], decide = null, context = null, source = null, previousFocus = null, saving = false;

  function stop() { if (source) { try { source.stop(); } catch {} source.disconnect(); source = null; } }
  function dismiss() {
    stop();
    if (context) { void context.close(); context = null; }
    clip = null; decide = null; saving = false;
    spectrum.width = spectrum.height = 0; spectrumDirty = true;
    for (const id of ["review-waveform", "review-spectrogram"]) { const canvas = el(id); canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); }
    if (dialog.open) dialog.close();
    previousFocus?.focus(); previousFocus = null;
  }
  function paint() {
    if (!clip || !dialog.open) return;
    const width = Math.max(1, Math.round(visual.clientWidth)), height = 100;
    const wave = el("review-waveform"), spec = el("review-spectrogram");
    for (const canvas of [wave, spec]) { canvas.width = width; canvas.height = height; }
    const ctx = wave.getContext("2d"), theme = getComputedStyle(document.documentElement);
    ctx.fillStyle = theme.getPropertyValue("--p-bg").trim(); ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = theme.getPropertyValue("--p-accent").trim(); ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const first = Math.floor(x * clip.length / width), last = Math.max(first + 1, Math.floor((x + 1) * clip.length / width));
      let min = 0, max = 0;
      for (let i = first; i < last && i < clip.length; i++) { min = Math.min(min, clip[i]); max = Math.max(max, clip[i]); }
      ctx.moveTo(x, (1 - max) * height / 2); ctx.lineTo(x, (1 - min) * height / 2);
    }
    ctx.stroke();
    if (spectrumDirty || spectrum.width !== width || spectrum.height !== height) {
      spectrum.width = width; spectrum.height = height; drawSpectrogram(spectrum, clip, 16000); spectrumDirty = false;
    }
    spec.getContext("2d").drawImage(spectrum, 0, 0);
    for (const canvas of [wave, spec]) {
      const c = canvas.getContext("2d"); c.fillStyle = theme.getPropertyValue("--p-bg").trim(); c.globalAlpha = 0.65;
      c.fillRect(0, 0, width * bounds[0] / clip.length, height);
      c.fillRect(width * bounds[1] / clip.length, 0, width * (clip.length - bounds[1]) / clip.length, height); c.globalAlpha = 1;
    }
    handles.forEach((handle, i) => {
      handle.style.left = `${bounds[i] / clip.length * 100}%`;
      handle.setAttribute("aria-label", t(i ? "review.end" : "review.start"));
      handle.setAttribute("aria-valuemin", "0"); handle.setAttribute("aria-valuemax", (clip.length / 16000).toFixed(2));
      handle.setAttribute("aria-valuenow", (bounds[i] / 16000).toFixed(2));
      handle.setAttribute("aria-valuetext", `${(bounds[i] / 16000).toFixed(2)} s`);
    });
    el("review-length").textContent = t("review.length", { seconds: ((bounds[1] - bounds[0]) / 16000).toFixed(2) });
    el("review-times").replaceChildren(...["0.00 s", `${(clip.length / 16000).toFixed(2)} s`].map(value => { const label = document.createElement("span"); label.textContent = value; return label; }));
  }
  function setBound(i, value) {
    if (!clip || saving) return;
    bounds[i] = i === 0 ? Math.max(0, Math.min(bounds[1] - 1, value)) : Math.min(clip.length, Math.max(bounds[0] + 1, value));
    paint();
  }
  handles.forEach((handle, i) => {
    handle.addEventListener("pointerdown", event => { if (saving) return; event.preventDefault(); handle.setPointerCapture(event.pointerId); });
    handle.addEventListener("pointermove", event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const rect = visual.getBoundingClientRect(); setBound(i, Math.round((event.clientX - rect.left) / rect.width * clip.length));
    });
    handle.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) return;
      event.preventDefault(); setBound(i, bounds[i] + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) * (event.shiftKey ? 1600 : 160));
    });
  });
  async function play(all) {
    if (!clip) return;
    try {
      stop(); context ||= new AudioContext(); await context.resume();
      if (!clip || !dialog.open) return;
      const start = all ? 0 : bounds[0], end = all ? clip.length : bounds[1];
      const buffer = context.createBuffer(1, end - start, 16000); buffer.copyToChannel(clip.subarray(start, end), 0);
      source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
    } catch { el("review-error").textContent = t("review.playError"); }
  }
  el("review-play-selection").addEventListener("click", () => void play(false));
  el("review-play-all").addEventListener("click", () => void play(true));
  function cancel() { if (saving) return; const callback = decide; dismiss(); callback?.({ type: "cancel" }); }
  el("review-cancel").addEventListener("click", cancel);
  dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not(:disabled)")];
    if (!focusable.length) { event.preventDefault(); return; }
    const index = focusable.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
  });
  el("review-add").addEventListener("click", () => {
    if (!clip || saving) return;
    saving = true; stop();
    el("review-add").disabled = el("review-cancel").disabled = true;
    el("review-add").textContent = t("review.saving");
    decide?.({ type: "commit", speechStart: bounds[0], speechEnd: bounds[1] });
  });
  new ResizeObserver(paint).observe(visual);
  new MutationObserver(() => { spectrumDirty = true; paint(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  persephone.onThemeChange(() => { spectrumDirty = true; requestAnimationFrame(paint); });
  globalThis.wakeReview = {
    open(message, callback) {
      const bytes = Uint8Array.from(atob(message.pcm), ch => ch.charCodeAt(0));
      if (message.sampleRate !== 16000 || !bytes.length || bytes.length % 2) throw new Error(t("review.invalid"));
      const view = new DataView(bytes.buffer); clip = new Float32Array(bytes.length / 2);
      for (let i = 0; i < clip.length; i++) clip[i] = view.getInt16(i * 2, true) / 32768;
      if (!Number.isInteger(message.speechStart) || !Number.isInteger(message.speechEnd) || message.speechStart < 0 || message.speechStart >= message.speechEnd || message.speechEnd > clip.length) { clip = null; throw new Error(t("review.invalid")); }
      bounds = [message.speechStart, message.speechEnd]; decide = callback; previousFocus = document.activeElement; saving = false; spectrumDirty = true;
      el("review-error").textContent = ""; el("review-add").textContent = t("review.add"); el("review-add").disabled = el("review-cancel").disabled = false;
      dialog.showModal(); paint(); handles[0].focus();
    }, dismiss
  };
})();
