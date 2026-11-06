"use strict";
(() => {
  const $ = (id) => document.getElementById(id), format = { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 };
  const DEFAULT_PERSON = "Me";
  let current = null, diagnostics = null, capture = null, sendQueue = Promise.resolve(), mode = "", timer = null, devices = [];
  const say = (key, params) => t(key, params);
  function setStatus(key) { $("status").textContent = say(key); }
  function showError(error) { $("error").hidden = false; $("error").textContent = error?.message || String(error); }
  function clearError() { $("error").hidden = true; $("error").textContent = ""; }
  async function send(message) {
    if (!current || current.closed) return;
    if (!current.writable) await current.whenWritable();
    if (current && !current.closed) current.send(message);
  }
  async function open(openMessage) {
    current = await persephone.service.openChannel(openMessage);
    current.onMessage((message) => {
      if (message.type === "error") { showError(`${message.code}: ${message.message}`); stopCapture(); setStatus("status.error"); }
      else if (message.type === "enrolled") {
        $("recording").textContent = message.quality.accepted ? say("enroll.accepted", { match: message.match === null ? say("common.first") : `${Math.round(message.match * 100)}%` }) : say(`quality.${message.quality.reason || "rejected"}`);
        setStatus(message.quality.accepted ? "status.ready" : "status.quality"); refreshList();
      } else if (message.type === "diagnostic") $("live-score").textContent = say("live.score", { score: message.score.toFixed(3) });
      else if (message.type === "wake" || message.type === "stop") {
        const custom = message.phrase !== message.type ? ` “${message.phrase}”` : "";
        const li = document.createElement("li"); li.textContent = `${say(`kind.${message.type}`)}${custom} · ${message.person} · ${(message.score * 100).toFixed(1)}% · ${(message.time / 1000).toFixed(2)} s`;
        $("events").prepend(li); while ($("events").children.length > 30) $("events").lastElementChild.remove();
      } else if (message.type === "enrollments") renderList(message.phrases);
      else if (message.type === "deleted") { setStatus("status.deleted"); refreshList(); }
      else if (message.type === "description") $("threshold").value = message.defaultThreshold;
      else if (message.type === "done") { stopCapture(); setStatus("status.ready"); }
    });
    current.onClose(() => { if (mode) { stopCapture(); mode = ""; if (diagnostics && !diagnostics.closed) diagnostics.close(); diagnostics = null; } });
    return current;
  }
  async function startCapture() {
    const deviceId = $("microphone").value;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const context = new AudioContext(); await context.audioWorklet.addModule("./audio-capture-worklet.js");
    const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, "wake-capture"), mute = context.createGain();
    mute.gain.value = 0;
    node.port.onmessage = (event) => {
      if (event.data?.type !== "audio" || !current || current.closed) return;
      sendQueue = sendQueue.then(() => send({ type: "audio", data: event.data.data })).catch(showError);
    };
    source.connect(node); node.connect(mute); mute.connect(context.destination);
    capture = { stream, context, source, node, mute };
  }
  function stopCapture() {
    clearTimeout(timer); timer = null;
    if (!capture) return;
    try { capture.node.port.postMessage({ type: "stop" }); capture.source.disconnect(); capture.node.disconnect(); capture.mute.disconnect(); } catch {}
    for (const track of capture.stream.getTracks()) track.stop();
    void capture.context.close(); capture = null;
  }
  async function finishStream() { await new Promise((resolve) => setTimeout(resolve, 120)); stopCapture(); await sendQueue; await send({ type: "end" }); }
  async function beginEnrollment() {
    // Every enrolled sample of a kind is a wake (or stop) word, so the contract's phrase is just the
    // kind. The person tells the assistant's agent who is speaking; empty means "Me" (not translated,
    // so a person's samples stay together whatever the interface language).
    clearError(); const kind = $("kind").value, phrase = kind, person = $("person").value.trim() || DEFAULT_PERSON;
    try {
      mode = "enroll"; $("record").disabled = true; $("recording").textContent = say("enroll.recording"); setStatus("status.recording");
      await open({ type: "enroll", phrase, kind, person, format }); await startCapture();
      timer = setTimeout(() => { void finishStream().catch(showError); $("record").disabled = false; }, 2500);
    } catch (error) { stopCapture(); $("record").disabled = false; mode = ""; showError(error); setStatus("status.error"); }
  }
  async function beginListen() {
    clearError(); const threshold = Number($("threshold").value);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) { showError(say("error.threshold")); return; }
    try {
      mode = "listen"; $("listen").textContent = say("live.stop"); setStatus("status.listening");
      diagnostics = await open({ type: "diagnostics" });
      await open({ type: "listen", format, threshold }); await startCapture();
    } catch (error) { stopCapture(); if (diagnostics && !diagnostics.closed) diagnostics.close(); diagnostics = null; mode = ""; $("listen").textContent = say("live.start"); showError(error); setStatus("status.error"); }
  }
  async function stopListen() {
    stopCapture(); await sendQueue.catch(() => {}); await send({ type: "end" }).catch(() => {});
    if (current && !current.closed) current.close(); current = null; mode = ""; $("listen").textContent = say("live.start"); setStatus("status.ready");
    if (diagnostics && !diagnostics.closed) diagnostics.close(); diagnostics = null;
  }
  function renderList(groups) {
    const host = $("samples"); host.replaceChildren();
    if (!groups?.length) { host.textContent = say("samples.empty"); return; }
    for (const group of groups) {
      const row = document.createElement("div"); row.className = "sample-group";
      // Samples enrolled before the phrase input was removed keep their own phrase as a label.
      const custom = group.phrase !== group.kind ? `${group.phrase} · ` : "";
      const label = document.createElement("strong"); label.textContent = `${custom}${say(`kind.${group.kind}`)} · ${group.person}`; row.append(label);
      const ids = document.createElement("span"); ids.className = "muted"; ids.textContent = say("samples.count", { count: group.samples.length }); row.append(ids);
      for (const sample of group.samples) {
        const button = document.createElement("button"); button.textContent = say("delete.sample"); button.title = sample.sampleId;
        button.addEventListener("click", () => void removeTarget({ sampleId: sample.sampleId })); row.append(button);
      }
      host.append(row);
    }
  }
  function refreshList() { void open({ type: "list" }).catch(showError); }
  async function removeTarget(target) { try { await open({ type: "delete", target }); } catch (error) { showError(error); } }
  async function loadDevices() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audioinput");
      const select = $("microphone"); select.replaceChildren();
      for (const [index, device] of devices.entries()) { const option = document.createElement("option"); option.value = device.deviceId; option.textContent = device.label || say("field.microphoneNumber", { number: index + 1 }); select.append(option); }
    } catch { $("microphone").innerHTML = `<option value="">${say("microphone.default")}</option>`; }
  }
  async function describe() { try { await open({ type: "describe" }); } catch (error) { showError(error); } }
  $("record").addEventListener("click", () => void beginEnrollment());
  $("listen").addEventListener("click", () => mode === "listen" ? void stopListen() : void beginListen());
  $("refresh").addEventListener("click", refreshList);
  $("delete-person-button").addEventListener("click", () => $("delete-person").value.trim() && void removeTarget({ person: $("delete-person").value }));  window.addEventListener("pagehide", () => { stopCapture(); if (current && !current.closed) current.close(); if (diagnostics && !diagnostics.closed) diagnostics.close(); });
  applyI18n(); void loadDevices(); void describe(); refreshList();
})();
