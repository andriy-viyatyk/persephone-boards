"use strict";
applyI18n();

const MODEL_ROWS = [
  { file: "ggml-large-v3-turbo-q5_0.bin", bytes: 574041195, label: "models.large" },
  { file: "ggml-small-q5_1.bin", bytes: 190085487, label: "models.small" },
  { file: "ggml-base-q5_1.bin", bytes: 59707625, label: "models.base" },
  { file: "ggml-medium-q5_0.bin", bytes: 539212467, label: "models.medium" },
  { file: "ggml-large-v3-q5_0.bin", bytes: 1081140203, label: "models.largeV3" },
];
const RUNTIME_BYTES = 19958389;
const $ = (selector) => document.querySelector(selector);
const state = { channel: null, snapshot: null, capture: null, chunksQueued: Promise.resolve(), settings: {}, phase: "idle", setupInitialized: false, committed: [], drafts: new Map() };
const formatBytes = (bytes) => `${Number(bytes).toLocaleString()} bytes (${(bytes / 1_000_000).toFixed(1)} MB)`;
const formatTime = (ms) => `${(ms / 1000).toFixed(1)} s`;
const isReady = (snapshot) => Boolean(snapshot?.assets?.runtime && snapshot.assets.models?.[snapshot.activeModel] === true);
const selectedMode = () => document.querySelector('input[name="test-mode"]:checked')?.value || "record";
const showError = (message) => { $("#error").textContent = message; $("#error").hidden = !message; };
function setPhase(phase) {
  state.phase = phase;
  const busy = phase === "preparing" || phase === "finishing";
  const recording = phase === "recording";
  const ready = isReady(state.snapshot);
  $("#test-button").disabled = busy || (!recording && !ready);
  $("#test-button").classList.toggle("is-recording", recording);
  $("#test-button-label").textContent = t(busy ? "recorder.transcribing" : recording ? "test.stop" : "test.start");
  $("#mode-switch").disabled = busy || recording;
  $("#microphones").disabled = busy || recording;
  $("#not-ready-hint").hidden = ready || busy || recording;
}
function button(label, action, disabled = false, primary = false) {
  const node = document.createElement("button");
  node.textContent = t(label);
  node.disabled = disabled;
  if (primary) node.className = "primary";
  node.addEventListener("click", action);
  return node;
}
function renderAssetRow(asset, title, bytes, installed, progress, active) {
  const row = document.createElement("div");
  row.className = "asset-row";
  const name = document.createElement("span"); name.className = "asset-name"; name.textContent = title;
  const info = document.createElement("span"); info.className = "asset-meta";
  info.textContent = progress ? t("models.progress", { phase: progress.phase, loaded: formatBytes(progress.loaded), total: formatBytes(progress.total) }) : installed ? t("models.installed") : `${t("models.missing")} · ${formatBytes(bytes)}`;
  if (progress) {
    const meter = document.createElement("progress"); meter.max = progress.total || bytes; meter.value = progress.loaded || 0; meter.setAttribute("aria-label", `${progress.phase} ${title}`);
    info.append(document.createElement("br"), meter);
  }
  const actions = document.createElement("span"); actions.className = "asset-actions";
  if (progress) actions.append(button("models.cancel", () => sendManagement({ type: "cancel", asset })));
  else if (!installed) actions.append(button("models.download", () => sendManagement({ type: "download", asset }), false, true));
  else {
    actions.append(button("models.remove", () => sendManagement({ type: "remove", asset })));
    if (!active && asset !== "runtime") actions.append(button("models.use", () => sendManagement({ type: "use", model: asset }), false, true));
  }
  row.append(name, info, actions);
  return row;
}
function render(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;
  const assets = snapshot.assets || { runtime: false, models: {}, licenses: [] };
  const progresses = new Map((snapshot.progress || []).map((item) => [item.asset, item]));
  $("#runtime-row").replaceChildren(renderAssetRow("runtime", t("models.runtime"), RUNTIME_BYTES, assets.runtime, progresses.get("runtime"), false));
  const list = $("#model-list"); list.replaceChildren();
  for (const model of MODEL_ROWS) {
    const installed = assets.models?.[model.file] === true;
    list.append(renderAssetRow(model.file, `${t(model.label)} · ${model.file}`, model.bytes, installed, progresses.get(model.file), snapshot.activeModel === model.file));
  }
  $("#active-model").textContent = t("models.active", { model: snapshot.activeModel || t("common.unknown") });
  const ready = isReady(snapshot);
  const selectedModel = MODEL_ROWS.find((model) => model.file === snapshot.activeModel);
  $("#setup-summary").textContent = ready
    ? t("models.panelReady", { version: snapshot.runtimeVersion || "", model: selectedModel ? t(selectedModel.label) : t("common.unknown") })
    : t("models.panelNeedsSetup");
  if (!state.setupInitialized) {
    $("#setup-panel").open = !ready;
    state.setupInitialized = true;
  }
  $("#engine-state").textContent = snapshot.engine === "running" ? t("engine.running") : ready ? t("engine.ready") : t("engine.notReady");
  renderLicenses(assets.licenses || []);
  setPhase(state.phase);
  if (snapshot.lastDownload?.phase === "failed") showError(t("models.downloadError", { message: snapshot.lastDownload.error || t("error.generic") }));
}
function renderLicenses(files) {
  const root = $("#runtime-licenses"); root.replaceChildren();
  if (!files.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = t("licenses.empty"); root.append(empty); return; }
  // The runtime lives outside the board folder, so each notice is fetched from the service when first opened.
  for (const file of files) {
    const details = document.createElement("details"); details.dataset.file = file;
    const summary = document.createElement("summary"); summary.textContent = file.replace(/^licenses\//, "");
    const text = document.createElement("pre"); text.className = "license-text";
    details.append(summary, text);
    details.addEventListener("toggle", () => { if (details.open && !text.textContent) sendManagement({ type: "license", file }); });
    root.append(details);
  }
}
function showLicense(file, text) {
  const details = [...document.querySelectorAll("#runtime-licenses details")].find((node) => node.dataset.file === file);
  if (details) details.querySelector("pre").textContent = text;
}
function sendManagement(message) {
  if (!state.channel) { showError(t("error.reconnecting")); void reconnectManagement(); return; }
  try { state.channel.send(message); } catch (error) { showError(error.message); }
}
// A service restart closes the channel; reconnecting starts the service again and brings a fresh snapshot.
const RECONNECT_CODES = new Set(["service-exited", "channel-closed"]);
async function openManagement() {
  const channel = await persephone.service.openChannel({ type: "downloads" });
  state.channel = channel;
  channel.onMessage((message) => {
    if (message.type === "snapshot") render(message);
    else if (message.type === "license-text") showLicense(message.file, message.text);
    else if (message.type === "error") showError(message.message || t("error.generic"));
  });
  channel.onClose((reason) => {
    if (state.channel !== channel) return;
    state.channel = null;
    if (RECONNECT_CODES.has(reason?.code)) setTimeout(() => { void reconnectManagement(); }, 1000);
    else showError(reason?.message || t("error.generic"));
  });
  channel.send({ type: "snapshot" });
}
async function reconnectManagement(attempt = 1) {
  if (state.channel) return;
  try { await openManagement(); showError(""); }
  catch (error) {
    if (attempt >= 5) { showError(error.message || t("error.generic")); return; }
    setTimeout(() => { void reconnectManagement(attempt + 1); }, 1000 * 2 ** attempt);
  }
}
async function refreshMicrophones() {
  const select = $("#microphones"), previous = select.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === "audioinput");
  select.replaceChildren();
  for (const [index, device] of microphones.entries()) {
    const option = document.createElement("option"); option.value = device.deviceId; option.textContent = device.label || t("recorder.microphoneNumber", { number: index + 1 }); select.append(option);
  }
  if (previous && microphones.some((device) => device.deviceId === previous)) select.value = previous;
  if (!microphones.length) { const option = document.createElement("option"); option.textContent = t("recorder.noDevices"); select.append(option); }
}
function setRecorderStatus(text) { $("#recording-status").textContent = text; }
function stopCaptureTracks(capture) {
  capture?.node?.port.close();
  capture?.source?.disconnect();
  capture?.node?.disconnect();
  capture?.stream?.getTracks().forEach((track) => track.stop());
  capture?.context?.close().catch(() => {});
  $("#level").style.width = "0%";
}
function pcmBuffer(samples) {
  const buffer = new ArrayBuffer(samples.length * 2), view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return buffer;
}
function queuePcm(samples, channel) {
  if (!samples.length) return;
  const data = pcmBuffer(samples);
  state.chunksQueued = state.chunksQueued.then(async () => {
    if (!channel.writable) await channel.whenWritable();
    channel.send({ type: "audio", data });
  });
}
function renderTranscript() {
  $("#committed-text").textContent = state.committed.join(" ");
  $("#draft-text").textContent = [...state.drafts.values()].filter(Boolean).join(" ");
}
function clearTranscript() {
  state.committed = [];
  state.drafts.clear();
  renderTranscript();
  $("#result-meta").textContent = "";
}
async function startRecording() {
  showError("");
  const snapshot = state.snapshot;
  if (!snapshot?.assets?.runtime || !snapshot.assets.models?.[snapshot.activeModel]) {
    showError(t("engine.notReady")); return;
  }
  setPhase("preparing");
  clearTranscript();
  setRecorderStatus(t("recorder.preparing"));
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...($("#microphones").value ? { deviceId: { exact: $("#microphones").value } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    await refreshMicrophones();
  } catch (error) { showError(`${t("recorder.permission")} ${error.message || ""}`); setRecorderStatus(t("recorder.idle")); setPhase("idle"); return; }
  let context, source, node, channel;
  try {
    context = await createAudioContext();
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "speech-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    context?.close().catch(() => {});
    showError(error.message || t("error.generic")); setRecorderStatus(t("recorder.idle")); setPhase("idle");
    return;
  }
  const mute = context.createGain(); mute.gain.value = 0;
  source.connect(node); node.connect(mute); mute.connect(context.destination);
  const open = {
    type: "transcribe",
    format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
    prompt: state.settings["vocabulary-prompt"] || "",
    ...(selectedMode() === "live" ? { live: true } : {}),
  };
  try { channel = await persephone.service.openChannel(open); }
  catch (error) {
    node.port.close(); source.disconnect(); node.disconnect(); stream.getTracks().forEach((track) => track.stop()); context.close().catch(() => {});
    showError(error.message || t("error.generic")); setRecorderStatus(t("recorder.idle")); setPhase("idle");
    return;
  }
  const capture = { stream, context, source, node, channel, sentSamples: 0, sourceBase: 0, sourceSamples: new Float32Array(0), nextSource: 0, pending: [], ended: false };
  state.capture = capture; state.chunksQueued = Promise.resolve();
  setPhase("recording");
  setRecorderStatus(t("recorder.listening"));
  node.port.onmessage = ({ data }) => {
    if (data.type === "level") $("#level").style.width = `${Math.min(100, data.value * 260)}%`;
    if (data.type === "samples" && state.capture === capture && !capture.ended) consumeSamples(capture, data.data);
  };
  channel.onMessage((message) => {
    if (message.type === "status") {
      const text = message.state === "listening" ? t("recorder.listening") : message.state === "preparing" ? t("recorder.preparing") : t("recorder.transcribing");
      setRecorderStatus(text);
      if (message.state === "transcribing" && state.phase === "recording") setPhase("finishing");
    } else if (message.type === "draft") {
      state.drafts.set(message.utterance, message.text || ""); renderTranscript();
    } else if (message.type === "segment") {
      if (message.text?.trim()) state.committed.push(message.text.trim());
      state.drafts.delete(message.utterance); renderTranscript();
    } else if (message.type === "result") {
      if (selectedMode() !== "live") { state.committed = message.text ? [message.text] : []; renderTranscript(); }
      state.drafts.clear(); renderTranscript();
      $("#result-meta").textContent = t("recorder.result", { language: message.language || t("common.unknown"), audio: formatTime(message.audioMs), elapsed: formatTime(message.elapsedMs) });
      setRecorderStatus(t("recorder.done"));
      finishCapture(capture);
    } else if (message.type === "error") {
      setRecorderStatus(message.code === "cancelled" ? t("recorder.cancelled") : message.message || t("error.generic"));
      if (message.code !== "cancelled") showError(message.message || t("error.generic"));
      finishCapture(capture);
    }
  });
  channel.onClose(() => {
    if (state.capture !== capture) return;
    setRecorderStatus(t("recorder.idle"));
    finishCapture(capture);
  });
}
async function createAudioContext() {
  let preferred;
  try {
    preferred = new AudioContext({ sampleRate: 16000 });
    await preferred.audioWorklet.addModule("./audio-capture-worklet.js");
    return preferred;
  } catch {
    preferred?.close().catch(() => {});
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule("./audio-capture-worklet.js");
      return context;
    } catch (error) {
      context.close().catch(() => {});
      throw error;
    }
  }
}
function consumeSamples(capture, samples) {
  const rate = capture.context.sampleRate / 16000;
  const output = [];
  const merged = new Float32Array(capture.sourceSamples.length + samples.length);
  merged.set(capture.sourceSamples);
  merged.set(samples, capture.sourceSamples.length);
  capture.sourceSamples = merged;
  const end = capture.sourceBase + merged.length;
  while (capture.nextSource + 1 < end) {
    const left = Math.floor(capture.nextSource), fraction = capture.nextSource - left;
    const offset = left - capture.sourceBase;
    output.push(merged[offset] * (1 - fraction) + merged[offset + 1] * fraction);
    capture.nextSource += rate;
  }
  const discard = Math.max(0, Math.floor(capture.nextSource) - capture.sourceBase);
  if (discard) {
    capture.sourceSamples = merged.slice(discard);
    capture.sourceBase += discard;
  }
  capture.sentSamples += output.length;
  if (capture.sentSamples / 16000 * 1000 > 300000) { showError(t("recorder.tooLong")); void cancelRecording(); return; }
  capture.pending.push(...output);
  while (capture.pending.length >= 3200) queuePcm(capture.pending.splice(0, 3200), capture.channel);
}
async function stopRecording() {
  const capture = state.capture;
  if (!capture || state.phase !== "recording") return;
  setPhase("finishing");
  capture.ended = true;
  // Flush an output sample whose next interpolation point fell beyond the last input frame.
  if (capture.nextSource < capture.sourceBase + capture.sourceSamples.length) {
    capture.pending.push(capture.sourceSamples[capture.sourceSamples.length - 1] || 0);
    capture.sentSamples++;
  }
  if (capture.pending.length) queuePcm(capture.pending.splice(0), capture.channel);
  capture.node.port.close();
  capture.stream.getTracks().forEach((track) => track.stop());
  capture.context.close().catch(() => {});
  $("#level").style.width = "0%";
  setRecorderStatus(t("recorder.transcribing"));
  try { await state.chunksQueued; capture.channel.send({ type: "end" }); }
  catch (error) { showError(error.message || t("error.generic")); finishCapture(capture); }
}
async function cancelRecording() {
  const capture = state.capture;
  if (!capture) return;
  setPhase("finishing");
  capture.ended = true;
  try { capture.channel.send({ type: "cancel" }); } catch { /* Channel may already have closed. */ }
  finishCapture(capture);
}
function finishCapture(capture) {
  if (state.capture !== capture) return;
  capture.ended = true;
  stopCaptureTracks(capture);
  state.capture = null;
  if (state.phase !== "idle") setPhase("idle");
}

$("#test-button").addEventListener("click", () => {
  if (state.phase === "idle") void startRecording().catch((error) => { showError(error.message || t("error.generic")); setPhase("idle"); });
  else if (state.phase === "recording") void stopRecording();
});
navigator.mediaDevices?.addEventListener?.("devicechange", () => { void refreshMicrophones(); });

(async () => {
  state.settings = Object.fromEntries(await Promise.all(["language-hints", "vocabulary-prompt"].map(async (id) => [id, await persephone.settings.get(id)])));
  persephone.settings.onChange(({ id, value }) => { state.settings[id] = value; });
  await openManagement();
  await refreshMicrophones().catch((error) => showError(error.message));
})().catch((error) => showError(error.message || t("error.generic")));
