"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { channel: null, pairs: [], active: new Map(), codes: [], names: new Map() };
  const languageLocale = () => persephone.locale?.code || "en";
  const displayNames = () => { try { return new Intl.DisplayNames([languageLocale()], { type: "language" }); } catch { return new Intl.DisplayNames(["en"], { type: "language" }); } };
  const size = (bytes) => bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
  function name(code) {
    try { return displayNames().of(code) || code; } catch { return code; }
  }
  function error(message) { const el = $("#error"); el.textContent = message || ""; el.hidden = !message; }
  // Themed replacement for window.confirm, whose native Chromium dialog ignores the Persephone theme.
  function askConfirm(title, message, okLabel) {
    const dialog = $("#confirm-dialog");
    $("#confirm-title").textContent = title; $("#confirm-message").textContent = message; $("#confirm-ok").textContent = okLabel;
    return new Promise((resolve) => {
      let confirmed = false;
      $("#confirm-ok").onclick = () => { confirmed = true; dialog.close(); };
      $("#confirm-cancel").onclick = () => dialog.close();
      dialog.addEventListener("close", () => resolve(confirmed), { once: true });
      dialog.showModal(); $("#confirm-ok").focus();
    });
  }
  function sendManagement(message) {
    if (!state.channel) return error(t("error.generic"));
    try { state.channel.send(message); } catch (reason) { error(reason.message || t("error.generic")); }
  }
  function renderPairs() {
    const host = $("#languages"), filter = $("#filter").value.trim().toLocaleLowerCase();
    const english = state.pairs.filter((pair) => pair.from === "en" || pair.to === "en");
    const codes = [...new Set(english.flatMap((pair) => [pair.from, pair.to]).filter((code) => code !== "en"))];
    const display = displayNames();
    state.names = new Map(codes.map((code) => [code, (() => { try { return display.of(code) || code; } catch { return code; } })()]));
    const chinese = ["zh-Hans", "zh-Hant"];
    if (chinese.every((code) => codes.includes(code)) && state.names.get(chinese[0]) === state.names.get(chinese[1])) {
      state.names.set("zh-Hans", `${state.names.get("zh-Hans")} (Simplified)`);
      state.names.set("zh-Hant", `${state.names.get("zh-Hant")} (Traditional)`);
    }
    const filtered = codes.filter((code) => `${state.names.get(code)} ${code}`.toLocaleLowerCase().includes(filter)).sort((a, b) => state.names.get(a).localeCompare(state.names.get(b), languageLocale()) || a.localeCompare(b));
    host.replaceChildren();
    for (const code of filtered) {
      const row = document.createElement("article"); row.className = "language-row";
      const heading = document.createElement("div");
      const label = document.createElement("div"); label.className = "language-name"; label.textContent = state.names.get(code);
      const codeLabel = document.createElement("div"); codeLabel.className = "language-code"; codeLabel.textContent = code;
      heading.append(label, codeLabel);
      const directions = document.createElement("div"); directions.className = "directions";
      directions.append(makeDirection(code, "en", t("models.fromEnglish", { language: state.names.get(code) })));
      directions.append(makeDirection("en", code, t("models.toEnglish", { language: state.names.get(code) })));
      row.append(heading, directions); host.append(row);
    }
    state.codes = ["en", ...codes].sort((a, b) => (state.names.get(a) || "English").localeCompare(state.names.get(b) || "English", languageLocale()));
    fillLanguageSelects();
  }
  function makeDirection(from, to, labelText) {
    const row = document.createElement("div"); row.className = "direction";
    const label = document.createElement("span"); label.className = "direction-label"; label.textContent = labelText;
    const pair = state.pairs.find((item) => item.from === from && item.to === to);
    const meta = document.createElement("span"); meta.className = "direction-meta";
    if (!pair) { meta.textContent = t("models.unsupported"); const button = document.createElement("button"); button.disabled = true; row.append(label, meta, button); return row; }
    const active = state.active.get(`${from}-${to}`);
    meta.textContent = active ? t("models.downloading", { loaded: size(active.loadedBytes || 0), total: size(active.totalBytes || pair.sizeBytes) }) : pair.installed ? t("models.installed", { size: size(pair.sizeBytes) }) : t("models.missing", { size: size(pair.sizeBytes) });
    const button = document.createElement("button");
    if (active) { button.textContent = t("models.cancel"); button.addEventListener("click", () => sendManagement({ type: "cancel", from, to, version: pair.version })); }
    else if (pair.installed) { button.textContent = t("models.remove"); button.addEventListener("click", () => sendManagement({ type: "remove", from, to, version: pair.version })); }
    else { button.textContent = t("models.download"); button.addEventListener("click", async () => {
      const message = t("confirm.downloadMessage", { from: name(from), to: name(to), size: size(pair.sizeBytes) });
      if (!(await askConfirm(t("confirm.downloadTitle"), message, t("confirm.download")))) return;
      sendManagement({ type: "download", from, to });
    }); }
    row.append(label, meta, button); return row;
  }
  function fillLanguageSelects() {
    for (const selector of [$("#source-language"), $("#target-language")]) {
      const previous = selector.value; selector.replaceChildren();
      for (const code of state.codes) { const option = document.createElement("option"); option.value = code; option.textContent = `${state.names.get(code) || "English"} (${code})`; selector.append(option); }
      // A rebuilt select falls back to its first option (Afrikaans), so default the target to English.
      if (state.codes.includes(previous)) selector.value = previous;
      else if (selector.id === "target-language") selector.value = "en";
    }
  }
  function openManagement() {
    const channel = persephone.service.openChannel({ type: "management" });
    return Promise.resolve(channel).then((opened) => {
      state.channel = opened;
      opened.onMessage((message) => {
        if (message.type === "snapshot") { state.pairs = message.pairs || []; state.active = new Map((message.downloads || []).map((item) => [`${item.from}-${item.to}`, item])); renderPairs(); }
        else if (message.type === "download-progress") { state.active.set(`${message.leg.from}-${message.leg.to}`, { ...message, loadedBytes: message.loadedBytes, totalBytes: message.totalBytes }); renderPairs(); }
        else if (message.type === "error") error(message.message || t("error.generic"));
      });
      opened.onClose(() => { if (state.channel === opened) state.channel = null; });
    });
  }
  function openOperation(open) {
    return Promise.resolve(persephone.service.openChannel(open)).then((channel) => new Promise((resolve, reject) => {
      channel.onMessage((message) => {
        if (message.type === "detection") resolve(message);
        else if (message.type === "result") resolve(message);
        else if (message.type === "error") reject(new Error(`${message.code}: ${message.message}`));
      });
      channel.onClose((reason) => { if (reason?.code && reason.code !== "channel-closed") reject(new Error(reason.message || reason.code)); });
    }));
  }
  function showDetection(result) {
    const code = result.language || "";
    if (state.codes.includes(code)) $("#source-language").value = code;
    const candidates = result.candidates.map((candidate) => `${state.names.get(candidate.language) || candidate.language} ${Math.round(candidate.score * 100)}%`).join(", ");
    $("#detection").textContent = t("test.detected", { language: state.names.get(code) || code || "Unknown", confidence: result.confidence, count: result.sampleChars, candidates: candidates || "—" });
  }
  async function detect() {
    error("");
    try { const result = await openOperation({ type: "detect", text: $("#source").value, htmlLang: $("#html-lang").value || undefined }); showDetection(result); }
    catch (reason) { error(reason.message || t("error.generic")); }
  }
  async function translate() {
    error("");
    const from = $("#source-language").value, to = $("#target-language").value;
    const pair = (a, b) => state.pairs.find((item) => item.from === a && item.to === b);
    const legs = pair(from, to) ? [[from, to]] : from !== "en" && to !== "en" ? [[from, "en"], ["en", to]] : [];
    const route = legs.length === 1 ? t("test.routeDirect", { from, to }) : legs.length ? t("test.routePivot", { from, to }) : t("test.noRoute");
    const legStatus = legs.map(([a, b]) => `${a} → ${b} (${pair(a, b)?.installed ? t("models.installed", { size: size(pair(a, b).sizeBytes) }) : t("models.missing", { size: size(pair(a, b)?.sizeBytes || 0) })})`).join("; ");
    $("#route").textContent = `${route}${legStatus ? ` ${t("test.requiredLegs", { legs: legStatus })}` : ""}`;
    if (!legs.length || legs.some(([a, b]) => !pair(a, b)?.installed)) { $("#result").value = ""; error(t("test.missingModels")); return; }
    try {
      const result = await openOperation({ type: "translate", id: `paste-${Date.now()}`, from, to, priority: "visible", items: [{ key: "paste", text: $("#source").value, format: "text" }] });
      const item = result.items.find((entry) => entry.key === "paste");
      if (!item?.ok) throw new Error(item?.error?.message || t("error.generic"));
      $("#result").value = item.text;
    } catch (reason) { error(reason.message || t("error.generic")); }
  }
  $("#refresh").addEventListener("click", () => sendManagement({ type: "refresh" }));
  $("#filter").addEventListener("input", renderPairs);
  $("#detect").addEventListener("click", () => void detect());
  $("#translate").addEventListener("click", () => void translate());
  void openManagement().catch((reason) => error(reason.message || t("error.generic")));
})();
