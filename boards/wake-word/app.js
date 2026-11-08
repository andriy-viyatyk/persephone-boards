"use strict";

(() => {
  const element = id => document.getElementById(id);
  const channels = new Set();
  const defaultPhrases = { wake: "agent-wake", stop: "agent-stop" };
  let activity = null;
  let pageClosed = false;
  let listGeneration = 0;

  function setStatus(key) {
    element("status").textContent = t(key);
  }

  function showError(error) {
    element("error").hidden = false;
    element("error").textContent = error?.message || String(error);
    setStatus("status.error");
  }

  function clearError() {
    element("error").hidden = true;
    element("error").textContent = "";
  }

  function selectedPhrase() {
    const phrase = element("phrase").value.trim();
    if (!phrase) throw new Error(t("error.phrase"));
    return phrase;
  }

  function captureOptions() {
    const deviceId = element("microphone").value;
    return {
      ...(deviceId ? { deviceId } : {}),
      echoCancel: element("echo-cancel").value === "true",
    };
  }

  function updateControls() {
    const busy = activity !== null;
    element("record").disabled = busy;
    element("listen").disabled = busy && activity.kind !== "listen";
    element("listen").textContent = t(activity?.kind === "listen" ? "live.stop" : "live.start");
    for (const id of ["kind", "phrase", "person", "microphone", "echo-cancel", "refresh-devices"]) {
      element(id).disabled = busy;
    }
  }

  async function openChannel(message, onMessage, onClose) {
    const channel = await persephone.service.openChannel(message);
    if (pageClosed) {
      channel.close();
      return null;
    }
    channels.add(channel);
    channel.onMessage(onMessage);
    channel.onClose(reason => {
      channels.delete(channel);
      onClose?.(reason);
    });
    return channel;
  }

  function closeChannel(channel) {
    if (channel && !channel.closed) channel.close();
  }

  async function request(message, expectedType) {
    return new Promise((resolve, reject) => {
      let settled = false;
      void openChannel(message, reply => {
        if (settled) return;
        if (reply?.type === "error") {
          settled = true;
          reject(new Error(`${reply.code}: ${reply.message}`));
        } else if (reply?.type === expectedType) {
          settled = true;
          resolve(reply);
        }
      }, reason => {
        if (!settled && !pageClosed) {
          settled = true;
          reject(new Error(reason?.message || t("error.channel")));
        }
      }).then(channel => {
        if (!channel && !settled) {
          settled = true;
          reject(new Error(t("error.channel")));
        }
      }, reject);
    });
  }

  async function refreshList() {
    const generation = ++listGeneration;
    try {
      const phrase = selectedPhrase();
      const reply = await request({ type: "list", phrase }, "enrollments");
      if (generation === listGeneration && phrase === element("phrase").value.trim()) {
        renderList(reply.phrases);
      }
    } catch (error) {
      if (!pageClosed && generation === listGeneration) showError(error);
    }
  }

  // Chip rows show only the newest samples; "+N" expands a person to show all of them.
  const VISIBLE_SAMPLES = 3;
  const expandedPeople = new Set();
  const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7 7 17M7 7l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';

  function removeButton(label, target) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = CLOSE_ICON;
    button.addEventListener("click", () => void deleteTarget(target));
    return button;
  }

  function treeRow(className, text, remove) {
    const row = document.createElement("div");
    row.className = `tree-row ${className}`;
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = text;
    row.append(label, remove);
    return row;
  }

  function sampleChip(sample, number, phrase) {
    // Only the embedding is stored, so a sample has no audio to play back.
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.title = sample.sampleId;
    const provenance = sample.legacyCapture ? t("samples.legacy")
      : sample.echoCancel === true ? t("samples.echoOn")
        : sample.echoCancel === false ? t("samples.echoOff") : t("samples.echoUnknown");
    const compatibility = sample.frontendVersion !== 2 ? ` · ${t("samples.incompatible")}` : "";
    const text = document.createElement("span");
    text.textContent = `${number}. ${provenance}${compatibility}`;
    chip.append(text, removeButton(t("delete.sample"), { phrase, sampleId: sample.sampleId }));
    return chip;
  }

  // Tree: phrase · kind → person → sample chips. Each level has its own remove button.
  function renderList(groups) {
    const host = element("samples");
    host.replaceChildren();
    if (!groups?.length) {
      host.textContent = t("samples.empty");
      return;
    }
    const kinds = new Map();
    for (const group of groups) {
      const key = JSON.stringify([group.phrase, group.kind]);
      if (!kinds.has(key)) kinds.set(key, { phrase: group.phrase, kind: group.kind, people: [] });
      kinds.get(key).people.push(group);
    }
    for (const { phrase, kind, people } of kinds.values()) {
      const node = document.createElement("div");
      node.className = "tree-node";
      node.append(treeRow("tree-kind", `${phrase} · ${t(`kind.${kind}`)}`, removeButton(t("delete.kind"), { phrase, kind })));
      for (const group of people) {
        const personKey = JSON.stringify([phrase, kind, group.person]);
        const personNode = document.createElement("div");
        personNode.className = "tree-node tree-children";
        personNode.append(treeRow("tree-person", group.person, removeButton(t("delete.person"), { phrase, kind, person: group.person })));
        const chips = document.createElement("div");
        chips.className = "chips tree-children";
        const total = group.samples.length;
        const shown = expandedPeople.has(personKey) ? 0 : Math.max(0, total - VISIBLE_SAMPLES);
        if (shown > 0) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "chip more-chip";
          more.textContent = `+${shown}`;
          more.addEventListener("click", () => { expandedPeople.add(personKey); renderList(groups); });
          chips.append(more);
        }
        group.samples.forEach((sample, index) => { if (index >= shown) chips.append(sampleChip(sample, index + 1, phrase)); });
        personNode.append(chips);
        node.append(personNode);
      }
      host.append(node);
    }
  }

  async function deleteTarget(target) {
    clearError();
    try {
      await request({ type: "delete", target }, "deleted");
      setStatus("status.deleted");
      await refreshList();
    } catch (error) {
      if (!pageClosed) showError(error);
    }
  }

  async function loadDevices() {
    const select = element("microphone");
    const previous = select.value;
    select.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("microphone.default");
    select.append(defaultOption);
    try {
      const audio = await persephone.getCapability("audio", { version: 1 });
      if (!audio) throw new Error("audio@1 is unavailable.");
      const devices = await audio.devices();
      for (const [index, device] of devices.entries()) {
        if (!device.deviceId || device.isDefault) continue;
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || t("field.microphoneNumber", { number: index + 1 });
        select.append(option);
      }
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    } catch (error) {
      if (!pageClosed) showError(error);
    }
  }

  function finishActivity(current) {
    closeChannel(current.diagnostics);
    current.diagnostics = null;
    if (activity !== current) return;
    activity = null;
    updateControls();
  }

  async function beginEnrollment() {
    if (activity) return;
    clearError();
    let current = null;
    try {
      const phrase = selectedPhrase();
      current = { kind: "enroll", channel: null, finished: false };
      activity = current;
      updateControls();
      setStatus("status.starting");
      element("recording").textContent = t("enroll.recording");
      const open = {
        type: "enroll", phrase, kind: element("kind").value,
        person: element("person").value.trim() || "Me", ...captureOptions(),
      };
      current.channel = await openChannel(open, message => {
        if (message?.type === "error") {
          current.finished = true;
          showError(new Error(`${message.code}: ${message.message}`));
        } else if (message?.type === "enrolled") {
          current.finished = true;
          const match = message.match === null ? t("common.first") : `${Math.round(message.match * 100)}%`;
          element("recording").textContent = message.quality.accepted
            ? t("enroll.accepted", { match }) : t(`quality.${message.quality.reason || "silence"}`);
          setStatus(message.quality.accepted ? "status.ready" : "status.quality");
          void refreshList();
        }
      }, reason => {
        if (!current.finished && !pageClosed) showError(new Error(reason?.message || t("error.channel")));
        finishActivity(current);
      });
      if (activity !== current || pageClosed) closeChannel(current.channel);
      else if (!current.finished) setStatus("status.recording");
    } catch (error) {
      const stillCurrent = !current || activity === current;
      if (current) finishActivity(current);
      if (!pageClosed && stillCurrent) showError(error);
    }
  }

  function handleListenMessage(current, message) {
    if (message?.type === "error") {
      current.finished = true;
      showError(new Error(`${message.code}: ${message.message}`));
    } else if (message?.type === "status" && message.status === "listening") {
      setStatus("status.listening");
    } else if (message?.type === "status" && message.status === "reset") {
      element("events").replaceChildren();
      setStatus("status.reset");
    } else if (message?.type === "detection") {
      const item = document.createElement("li");
      item.textContent = `${message.phrase} · ${t(`kind.${message.kind}`)} · ${message.person} · ${(message.score * 100).toFixed(1)}% · ${message.time.epoch} / ${(message.time.timeMs / 1000).toFixed(2)} s`;
      element("events").prepend(item);
      while (element("events").children.length > 30) element("events").lastElementChild.remove();
    }
  }

  async function beginListen() {
    if (activity) return;
    clearError();
    let current = null;
    try {
      const phrase = selectedPhrase();
      const threshold = Number(element("threshold").value);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error(t("error.threshold"));
      current = { kind: "listen", channel: null, diagnostics: null, finished: false };
      activity = current;
      updateControls();
      setStatus("status.starting");
      current.diagnostics = await openChannel({ type: "diagnostics" }, message => {
        if (message?.type === "diagnostic") element("live-score").textContent = t("live.score", { score: message.score.toFixed(3) });
      });
      if (activity !== current || pageClosed) {
        closeChannel(current.diagnostics);
        current.diagnostics = null;
        return;
      }
      current.channel = await openChannel({
        type: "listen", phrases: [phrase], sources: ["microphone"], threshold, ...captureOptions(),
      }, message => handleListenMessage(current, message), reason => {
        if (!current.finished && activity === current && !pageClosed) showError(new Error(reason?.message || t("error.channel")));
        finishActivity(current);
      });
      if (activity !== current || pageClosed) closeChannel(current.channel);
    } catch (error) {
      const stillCurrent = !current || activity === current;
      if (current) finishActivity(current);
      if (!pageClosed && stillCurrent) showError(error);
    }
  }

  function stopListen() {
    const current = activity;
    if (!current || current.kind !== "listen") return;
    current.finished = true;
    closeChannel(current.channel);
    finishActivity(current);
    setStatus("status.ready");
  }

  element("kind").addEventListener("change", () => {
    const phrase = element("phrase");
    if (!phrase.value.trim() || Object.values(defaultPhrases).includes(phrase.value.trim())) {
      phrase.value = defaultPhrases[element("kind").value];
    }
    void refreshList();
  });
  element("phrase").addEventListener("change", () => void refreshList());
  element("refresh").addEventListener("click", () => void refreshList());
  element("refresh-devices").addEventListener("click", () => void loadDevices());
  element("record").addEventListener("click", () => void beginEnrollment());
  element("listen").addEventListener("click", () => activity?.kind === "listen" ? stopListen() : void beginListen());
  window.addEventListener("pagehide", () => {
    pageClosed = true;
    for (const channel of channels) closeChannel(channel);
    channels.clear();
  });
  applyI18n();
  updateControls();
  void loadDevices();
  void refreshList();
})();
