"use strict";
applyI18n();

const $ = (selector) => document.querySelector(selector);
const state = { channel: null, sdkInstalled: false, models: [{ id: "", label: "Default", efforts: [] }], defaults: {}, settingsOff: null, sessionId: "", busy: false, approvals: new Map(), streamText: "", streamNode: null, lastText: "", thinkingNode: null };
const showError = (message) => { const node = $("#error"); node.textContent = message; node.classList.toggle("hidden", !message); };
const addEntry = (text, kind = "agent", title = "") => {
  const node = document.createElement("div");
  node.className = `entry ${kind}`;
  if (title) { const heading = document.createElement("strong"); heading.textContent = `${title}\n`; node.append(heading); }
  node.append(document.createTextNode(text));
  $("#transcript").append(node);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
  return node;
};
// Tool inputs arrive as a bounded JSON summary string; show its fields as "key: value" lines.
const describeInput = (input) => {
  const raw = typeof input === "string" ? input : input?.summary;
  try {
    const fields = JSON.parse(raw);
    return Object.entries(fields).filter(([key]) => key !== "kind").map(([key, value]) => `${key}: ${value}`).join("\n");
  } catch { return raw || ""; }
};
const formatUsage = (usage) => {
  if (!usage) return "";
  const parts = [];
  if (Number.isFinite(usage.inputTokens)) parts.push(`in ${usage.inputTokens}`);
  if (Number.isFinite(usage.outputTokens)) parts.push(`out ${usage.outputTokens}`);
  if (usage.cachedTokens) parts.push(`cached ${usage.cachedTokens}`);
  if (Number.isFinite(usage.costUsd)) parts.push(`$${usage.costUsd.toFixed(4)}`);
  return parts.join(" · ");
};
const channelSend = async (channel, message) => {
  if (!channel.writable) await channel.whenWritable();
  channel.send(message);
};
function renderModels(models) {
  state.models = models?.length ? models : [{ id: "", label: "Default", efforts: [] }];
  const selected = $("#model").value || state.defaults.model || "";
  $("#model").replaceChildren(new Option(t("default"), ""));
  state.models.filter((m) => m.id && m.id !== "default").forEach((model) => $("#model").add(new Option(model.label, model.id)));
  if (selected && [...$("#model").options].some((o) => o.value === selected)) $("#model").value = selected;
  renderEfforts();
}
function renderEfforts() {
  const selectedModel = state.models.find((m) => m.id === $("#model").value);
  const select = $("#effort");
  select.replaceChildren(new Option(t("default"), ""));
  (selectedModel?.efforts || []).forEach((effort) => select.add(new Option(effort, effort)));
  if (state.defaults.effort && [...select.options].some((option) => option.value === state.defaults.effort)) select.value = state.defaults.effort;
  if (select.options.length < 2) select.disabled = true; else select.disabled = false;
}
async function discovery(request) {
  const channel = await persephone.service.openChannel(request);
  return new Promise((resolve) => {
    channel.onMessage((message) => resolve({ message, channel }));
    channel.onClose(() => resolve({ message: null, channel }));
  });
}
async function refreshDescription() {
  const { message } = await discovery({ type: "describe" });
  if (message?.type === "description") {
    state.sdkInstalled = Boolean(message.sdkInstalled);
    renderModels(message.models);
  }
  $("#consent").classList.toggle("hidden", state.sdkInstalled);
}
async function showSessions() {
  $("#session-list").replaceChildren();
  const cwd = $("#cwd").value.trim();
  const { message } = await discovery({ type: "list-sessions", ...(cwd ? { cwd } : {}) });
  if (message?.type !== "sessions") {
    if (message?.type === "error") showError(`${message.code}: ${message.message}`);
    return;
  }
  message.sessions.forEach((item) => {
    const row = document.createElement("div"); row.className = "session-row";
    const title = document.createElement("span"); title.textContent = `${item.title} · ${item.cwd}`;
    const button = document.createElement("button"); button.textContent = t("resume");
    button.addEventListener("click", () => startSession(item.id));
    row.append(title, button); $("#session-list").append(row);
  });
}
async function consentSdk(accept) {
  $("#accept").disabled = true;
  if (!accept) { $("#consent").classList.add("hidden"); $("#accept").disabled = false; return; }
  const channel = await persephone.service.openChannel({ type: "consent-sdk" });
  channel.onMessage(async (message) => {
    if (message.type === "sdk-installed") { state.sdkInstalled = true; $("#consent").classList.add("hidden"); await refreshDescription(); }
    if (message.type === "sdk-install-error") { showError(message.message); $("#accept").disabled = false; }
  });
}
async function startSession(resume) {
  showError("");
  const cwd = $("#cwd").value.trim();
  if (!cwd) return showError("Enter an absolute working directory.");
  if (!state.sdkInstalled) { $("#consent").classList.remove("hidden"); return showError(t("consentRequired")); }
  const model = $("#model").value;
  const effort = $("#effort").value;
  const open = {
    type: "open", contractVersion: 1, model, cwd,
    permissionMode: $("#permission").value,
    mcp: { persephone: true },
    ...(effort ? { effort } : {}),
    ...(resume ? { resume } : {}),
  };
  const channel = await persephone.service.openChannel(open);
  state.channel = channel;
  $("#intro").classList.add("hidden"); $("#chat").classList.remove("hidden");
  $("#transcript").replaceChildren(); $("#approvals").replaceChildren();
  channel.onMessage((event) => handleEvent(event));
  channel.onClose((reason) => {
    state.channel = null; state.busy = false;
    $("#status").textContent = `${t("closed")}: ${reason?.code || "channel-closed"}`;
    $("#chat").classList.add("hidden"); $("#intro").classList.remove("hidden");
  });
}
function handleApproval(event) {
  const card = document.createElement("section"); card.className = "approval";
  const heading = document.createElement("strong"); heading.textContent = `${t("approval")} · ${event.kind}`;
  const summary = document.createElement("p"); summary.textContent = `${describeInput(event.summary)}${event.truncated ? ` ${t("truncated")}` : ""}`;
  const detail = document.createElement("p"); detail.textContent = event.detail && event.detail !== event.summary ? describeInput(event.detail) : "";
  const actions = document.createElement("div"); actions.className = "actions";
  for (const [decision, key] of [["allow", "allow"], ["allow-session", "allowSession"], ["deny", "deny"]]) {
    const button = document.createElement("button"); button.textContent = t(key);
    button.addEventListener("click", async () => {
      await channelSend(state.channel, { type: "approval-response", requestId: event.requestId, decision });
      card.remove(); state.approvals.delete(event.requestId);
    });
    actions.append(button);
  }
  card.append(heading, summary, detail, actions); $("#approvals").append(card); state.approvals.set(event.requestId, card);
}
function handleEvent(event) {
  switch (event.type) {
    case "session-started":
      state.sessionId = event.sessionId; $("#session-id").textContent = `${event.sessionId} · ${event.model} · ${event.permissionMode}`;
      $("#instructions-view").textContent = event.instructions?.composed || "";
      $("#status").textContent = t("idle"); break;
    case "turn-started": state.busy = true; $("#status").textContent = t("working"); $("#send").disabled = true; break;
    case "text-delta":
      if (!state.streamNode) state.streamNode = addEntry("", "agent");
      state.streamText += event.text || "";
      state.streamNode.append(document.createTextNode(`${event.text || ""}${event.truncated ? ` ${t("truncated")}` : ""}`));
      $("#transcript").scrollTop = $("#transcript").scrollHeight;
      break;
    case "text":
      if (event.text && event.text !== state.streamText && event.text !== state.lastText) addEntry(`${event.text}${event.truncated ? ` ${t("truncated")}` : ""}`, "agent");
      state.lastText = event.text || state.lastText;
      break;
    case "thinking-delta":
      if (!event.text?.trim()) break;
      if (!state.thinkingNode) state.thinkingNode = addEntry("", "thinking", t("thinking"));
      state.thinkingNode.append(document.createTextNode(event.text));
      break;
    case "tool-call": state.thinkingNode = null; state.streamNode = null; state.streamText = ""; addEntry(describeInput(event.input), "meta", `${t("tool")} · ${event.name}`); break;
    case "tool-result": addEntry(`${event.ok === false ? "✗" : "✓"} ${event.summary || ""}${event.truncated ? ` ${t("truncated")}` : ""}`, "meta", t("result")); break;
    case "file-change": addEntry(`${event.kind}: ${event.path}`, "meta", t("file")); break;
    case "approval-request": handleApproval(event); break;
    case "turn-ended": state.busy = false; $("#send").disabled = false; $("#status").textContent = t("idle"); addEntry([event.reason, formatUsage(event.usage)].filter(Boolean).join(" · "), "meta", t("turnEnded")); state.streamText = ""; state.streamNode = null; state.lastText = ""; state.thinkingNode = null; void refreshDescription(); break;
    case "error": showError(`${event.code}: ${event.message}`); if (event.fatal) $("#status").textContent = t("error"); if (event.code === "sdk-not-installed") { state.sdkInstalled = false; $("#consent").classList.remove("hidden"); } break;
    case "notice": addEntry(event.message, "meta", t("notice")); break;
  }
}
$("#model").addEventListener("change", renderEfforts);
$("#accept").addEventListener("click", () => void consentSdk(true));
$("#decline").addEventListener("click", () => void consentSdk(false));
$("#start").addEventListener("click", () => void startSession());
$("#refresh-sessions").addEventListener("click", () => void showSessions());
$("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("#prompt").value.trim();
  if (!text || !state.channel || state.busy) return;
  $("#prompt").value = ""; addEntry(text, "user", t("you"));
  try { await channelSend(state.channel, { type: "send", id: crypto.randomUUID(), text }); }
  catch (error) { showError(error.message); }
});
$("#interrupt").addEventListener("click", () => state.channel && void channelSend(state.channel, { type: "interrupt" }));
$("#close").addEventListener("click", () => state.channel && void channelSend(state.channel, { type: "close" }));
$("#show-instructions").addEventListener("click", () => $("#instructions-view").classList.toggle("hidden"));
void refreshDescription().catch((error) => showError(error.message));
for (const [id, target] of [["default-model", "#model"], ["default-effort", "#effort"], ["default-permission-mode", "#permission"]]) {
  void persephone.settings.get(id).then((value) => {
    if (value) {
      state.defaults[id === "default-model" ? "model" : id === "default-effort" ? "effort" : "permission"] = value;
      if (id !== "default-model" || [...$(target).options].some((option) => option.value === value)) $(target).value = value;
      if (id === "default-model") renderEfforts();
    }
  }).catch(() => {});
}
state.settingsOff = persephone.settings.onChange(({ id, value }) => {
  if (id === "default-permission-mode") { state.defaults.permission = value; $("#permission").value = value; }
  if (id === "default-model") { state.defaults.model = value; if ([...$("#model").options].some((option) => option.value === value)) $("#model").value = value; }
  if (id === "default-effort") { state.defaults.effort = value; if ([...$("#effort").options].some((option) => option.value === value)) $("#effort").value = value; }
  if (id === "default-model") renderEfforts();
});
