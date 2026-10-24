"use strict";
applyI18n();

const $ = (selector) => document.querySelector(selector);
const state = { sdkInstalled: null, models: [{ id: "", label: "Default", efforts: [] }], defaults: {}, settingsOff: null, sessions: [] };
const showError = (message) => { const node = $("#error"); node.textContent = message; node.classList.toggle("hidden", !message); };
// Transient state line above the prompt; empty (hidden) while the session is ready.
const setStatus = (text = "", busy = false) => { const node = $("#status"); node.textContent = text; node.classList.toggle("busy", busy); node.classList.toggle("hidden", !text); };

// ── Session views ──────────────────────────────────────────────────────────
// Each session the page holds is a view: its own transcript, channel and turn state. Live views (the board runs
// their Claude process) keep running while another view is shown, like terminal tabs. A view that is only being
// read is dropped when you leave it and reloaded from its transcript the next time it opens.
const views = new Set();
let current = null;
function createView(item = {}) {
  const view = {
    id: item.id || "", cwd: item.cwd || "", title: item.title || "", messages: element("div", "messages hidden"),
    channel: null, follow: null, live: false, busy: false, pendingPrompt: "", liveWaiters: [], controls: new Map(),
    stream: null, lastText: "", thinkingNode: null, tools: new Map(), commandTurn: false, historyToken: 0,
    footer: null, usage: null, sessionCost: 0, statusText: "", statusBusy: false, error: "",
    draft: "", unread: false, stick: true, scrollTop: 0,
    agents: [], agentsChannel: null, selectedAgentId: "", agentViews: new Map(),
    model: "", effort: "", defaults: null,
  };
  $("#views").append(view.messages);
  views.add(view);
  return view;
}
const viewFor = (id) => (id && [...views].find((view) => view.id === id)) || null;
function setViewStatus(view, text = "", busy = false) {
  view.statusText = text; view.statusBusy = busy;
  if (view === current) setStatus(text, busy);
}
function setViewError(view, message) {
  view.error = message;
  if (view === current) showError(message);
}

// ── Transcript rendering ────────────────────────────────────────────────────
const transcript = $("#transcript");
const nearBottom = () => transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
// Only the shown view scrolls (the main chat, or the subagent chat selected in it); a hidden one restores its position when it is shown again.
const isShown = (view) => Boolean(current) && (current.selectedAgentId ? current.agentViews.get(current.selectedAgentId) === view : view === current);
const sticks = (view) => isShown(view) && nearBottom();
const scrollToEnd = (stick) => { if (stick) transcript.scrollTop = transcript.scrollHeight; };
function appendMessage(view, node, forceScroll = false) {
  const stick = isShown(view) && (forceScroll || nearBottom());
  view.messages.append(node);
  scrollToEnd(stick);
  return node;
}
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// The text each message was made from; the message copy and open buttons use it.
const messageSources = new WeakMap();
// Agent text is Markdown; raw HTML in it is sanitized, never trusted.
function renderMarkdown(node, text) {
  messageSources.set(node, text || "");
  node.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text || "", { gfm: true, breaks: false }));
}
function addUserMessage(view, text, forceScroll = true) {
  const node = element("div", "msg user", text);
  messageSources.set(node, text);
  return appendMessage(view, node, forceScroll);
}
function addAgentMessage(view, text) {
  const node = element("div", "msg agent markdown-body");
  renderMarkdown(node, text);
  return appendMessage(view, node);
}
// Tool inputs arrive as a bounded JSON summary string; show its fields as "key: value" lines.
const describeInput = (input) => {
  const raw = typeof input === "string" ? input : input?.summary;
  try {
    const fields = JSON.parse(raw);
    return Object.entries(fields).filter(([key]) => key !== "kind").map(([key, value]) => `${key}: ${value}`).join("\n");
  } catch { return raw || ""; }
};
// A run of tool calls between messages collapses into one "Tool calls: N" line; expanding it lists the calls.
// While a group is the newest item, other activity lines (thinking, notices) join it so they do not split the run.
const openToolGroup = (view) => {
  const last = view.messages.lastElementChild;
  return last?.classList.contains("tool-group") ? last : null;
};
function addToolGroup(view) {
  const group = element("details", "tool-group");
  const summary = element("summary");
  summary.append(element("span", "label"), element("span", "fail"));
  group.append(summary, element("div", "tool-list"));
  return appendMessage(view, group);
}
function updateToolGroup(group) {
  if (!group) return;
  const calls = group.querySelectorAll(":scope > .tool-list > .activity.tool");
  const failed = [...calls].filter((call) => call.querySelector("summary .fail")).length;
  group.querySelector(":scope > summary .label").textContent = t("toolCalls", { count: calls.length });
  group.querySelector(":scope > summary .fail").textContent = failed ? ` · ${t("toolsFailed", { count: failed })}` : "";
}
function addActivity(view, label, body, className = "", group = openToolGroup(view)) {
  const details = element("details", `activity ${className}`.trim());
  const summary = element("summary");
  summary.append(element("span", "label", label));
  details.append(summary, element("pre", "", body || ""));
  if (!group) return appendMessage(view, details);
  const stick = sticks(view);
  group.querySelector(":scope > .tool-list").append(details);
  scrollToEnd(stick);
  return details;
}
function addToolCall(view, name, input, callId) {
  const body = describeInput(input);
  const firstLine = body.split("\n")[0] || "";
  const group = openToolGroup(view) || addToolGroup(view);
  const node = addActivity(view, `${t("tool")} · ${name}${firstLine ? ` — ${firstLine}` : ""}`, body, "tool", group);
  updateToolGroup(group);
  if (callId) view.tools.set(callId, node);
  if (callId) node.dataset.callId = callId;
  return node;
}
// A finished background task: one "Task · summary" line like a tool call; expanding it shows the notification.
// It stays on its own line rather than folding into a "Tool calls: N" group, as the terminal shows it.
const addTaskNotice = (view, summary, detail) => addActivity(view, `${t("task")} · ${summary}`, detail || summary, "task", null);
const addDivider = (view, text, className = "") => appendMessage(view, element("div", `divider ${className}`.trim(), text));
// Slash-command output: Markdown reports (/context) render as Markdown, plain text keeps its line layout.
function addCommandOutput(view, text) {
  const node = element("div", "msg command-output");
  if (/^#{1,6} |\n\|/m.test(text)) { node.classList.add("markdown-body"); renderMarkdown(node, text); }
  else { node.append(element("pre", "plain", text)); messageSources.set(node, text); }
  return appendMessage(view, node);
}
const addCommandMessage = (view, text, forceScroll) => { const node = addUserMessage(view, text, forceScroll); node.classList.add("command"); return node; };
const formatTokens = (value) => value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : value >= 1000 ? `${+(value / 1000).toFixed(1)}k` : String(value);
function addCompacted(view, event = {}) {
  const text = Number.isFinite(event.preTokens) && Number.isFinite(event.postTokens) ? t("compactedTokens", { before: formatTokens(event.preTokens), after: formatTokens(event.postTokens) }) : t("compacted");
  addDivider(view, text, "compacted");
}
// The summary the session continues from; collapsed, since it is long and rarely read.
function addCompactSummary(view, text) {
  if (!view.messages.lastElementChild?.classList.contains("compacted")) addCompacted(view);
  addActivity(view, t("compactSummary"), text, "compact-summary", null);
}

function startStream(view) {
  view.stream = { node: addAgentMessage(view, ""), text: "", frame: 0 };
  view.stream.node.classList.add("streaming");
  return view.stream;
}
function renderStream(view) {
  const stream = view.stream;
  if (!stream || stream.frame) return;
  stream.frame = requestAnimationFrame(() => {
    stream.frame = 0;
    const stick = sticks(view);
    renderMarkdown(stream.node, stream.text);
    scrollToEnd(stick);
  });
}
function endStream(view) {
  const stream = view.stream;
  if (!stream) return;
  if (stream.frame) cancelAnimationFrame(stream.frame);
  renderMarkdown(stream.node, stream.text);
  stream.node.classList.remove("streaming");
  if (!stream.text.trim()) stream.node.remove();
  view.stream = null;
}

// Links in rendered Markdown: web links are routed by the host; local paths open as Persephone pages.
$("#views").addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link) return;
  const href = link.getAttribute("href") || "";
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith("#")) return;
  event.preventDefault();
  let target = href.replace(/^file:\/\/\/?/i, "");
  try { target = decodeURI(target); } catch { /* keep the raw href */ }
  const absolute = /^[a-z]:[\\/]/i.test(target) || target.startsWith("\\\\") || target.startsWith("/");
  if (!absolute && current?.cwd) target = `${current.cwd.replace(/[\\/]+$/, "")}\\${target.replace(/\//g, "\\")}`;
  void Promise.resolve(persephone.openRawLink(target)).catch((error) => showError(error.message));
});

// Copy and open buttons for the hovered message. One toolbar moves into whichever message the pointer is over, so
// re-rendering a streaming message never leaves a stale copy behind.
const ICONS = {
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>',
  copied: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  open: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.5 2.5h5v5M13.5 2.5L7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
};
const messageActions = element("div", "msg-actions");
for (const [action, label] of [["copy", "message.copy"], ["open", "message.open"]]) {
  const button = element("button", "msg-action");
  button.type = "button"; button.dataset.action = action; button.title = t(label); button.setAttribute("aria-label", t(label));
  button.innerHTML = ICONS[action];
  messageActions.append(button);
}
$("#views").addEventListener("mouseover", (event) => {
  const message = event.target.closest?.(".msg");
  if (message && messageSources.has(message) && messageActions.parentNode !== message) message.append(messageActions);
});
const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
// Rendered HTML of a message without the toolbar, so formatted text pastes into apps like Teams.
function messageHtml(message) {
  if (!message.classList.contains("markdown-body")) return `<div style="white-space:pre-wrap">${escapeHtml(messageSources.get(message))}</div>`;
  const copy = message.cloneNode(true);
  copy.querySelector(".msg-actions")?.remove();
  return copy.innerHTML;
}
async function copyMessage(message, button) {
  const text = messageSources.get(message);
  try {
    const blob = (value, type) => new Blob([value], { type });
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob(text, "text/plain"), "text/html": blob(messageHtml(message), "text/html") })]);
  } catch {
    await persephone.clipboard.writeText(text);
  }
  button.innerHTML = ICONS.copied;
  setTimeout(() => { button.innerHTML = ICONS.copy; }, 1200);
}
// The page title is the message's first line without Markdown markers.
const messageTitle = (text) => (text.split("\n").map((line) => line.replace(/^[#>*\-\s`]+|[*_`]+/g, "").trim()).find(Boolean) || t("message.untitled")).slice(0, 60);
messageActions.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const message = messageActions.parentNode;
  if (!button || !messageSources.has(message)) return;
  event.stopPropagation();
  const text = messageSources.get(message);
  const action = button.dataset.action === "copy" ? copyMessage(message, button)
    : persephone.openContent({ editor: "md-view", language: "markdown", title: messageTitle(text), content: text });
  void Promise.resolve(action).catch((error) => showError(error.message));
});

const formatUsage = (usage) => {
  if (!usage) return "";
  const parts = [];
  if (Number.isFinite(usage.inputTokens)) parts.push(`in ${usage.inputTokens}`);
  if (Number.isFinite(usage.outputTokens)) parts.push(`out ${usage.outputTokens}`);
  if (usage.cachedTokens) parts.push(`cached ${usage.cachedTokens}`);
  if (Number.isFinite(usage.costUsd)) parts.push(`$${usage.costUsd.toFixed(4)}`);
  return parts.join(" · ");
};

// ── Footer status bar: plain text separated by thin dividers (the host caps the catalog at eight items) ──
// Model, effort and context fill show under the message box instead. The host has no divider item, and plain
// text in its start group stretches, so the two usage limits share one start item; the end group interleaves
// divider items, each shown only while both of its neighbours are.
const DIVIDER = "│";
const FOOTER_END = ["tokens", "turnCost", "sessionCost"];
const statusBar = persephone.statusBar;
const footerText = new Map();
const setChip = (id, text, patch = {}) => { footerText.set(id, text || ""); statusBar?.update(id, { text: text || "", hidden: !text, ...patch }); };
function updateDividers() {
  const shown = FOOTER_END.filter((id) => footerText.get(id));
  FOOTER_END.slice(0, -1).forEach((id, index) => statusBar?.update(`divider${index}`, { hidden: !shown.includes(id) || shown.at(-1) === id }));
}
function resetFooter() {
  footerText.clear();
  statusBar?.set([
    { id: "limits", type: "text", text: "", hidden: true },
    ...FOOTER_END.flatMap((id, index) => [
      ...(index ? [{ id: `divider${index - 1}`, type: "text", text: DIVIDER, tone: "muted", align: "end", hidden: true }] : []),
      { id, type: "text", text: "", tone: "muted", align: "end", hidden: true },
    ]),
  ]);
}
const percentTone = (percent) => percent >= 90 ? "error" : percent >= 70 ? "accent" : "normal";
const resetsTitle = (label, resetsAt) => resetsAt ? `${label} — ${t("resets")} ${new Date(resetsAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : label;
// Both limits in one item, toned by the fuller one; the tooltip lists each reset time.
function updateFooter(status) {
  const limits = [["limit5h", "fiveHour", "5h"], ["limit7d", "sevenDay", "7d"]]
    .map(([id, key, label]) => ({ id, label, limit: status.limits?.[key] })).filter((entry) => entry.limit);
  setChip("limits", limits.map(({ label, limit }) => `${label} ${limit.percent}%`).join(`  ${DIVIDER}  `), {
    tone: percentTone(Math.max(0, ...limits.map(({ limit }) => limit.percent))),
    title: limits.map(({ id, limit }) => resetsTitle(t(id), limit.resetsAt)).join("\n"),
  });
}
function updateFooterUsage(usage, sessionCost) {
  if (!usage) return;
  setChip("tokens", formatUsage({ ...usage, costUsd: undefined }), { title: t("lastTurnTokens") });
  setChip("turnCost", Number.isFinite(usage.costUsd) ? `$${usage.costUsd.toFixed(4)}` : "", { title: t("lastTurnCost") });
  setChip("sessionCost", sessionCost ? `${t("session")} $${sessionCost.toFixed(2)}` : "", { title: t("sessionCost") });
  updateDividers();
}
// The footer shows the view on screen; each view keeps its last status and usage.
function renderFooter(view) {
  resetFooter();
  if (view.footer) updateFooter(view.footer);
  updateFooterUsage(view.usage, view.sessionCost);
}

// ── Service channels ───────────────────────────────────────────────────────
const channelSend = async (channel, message) => {
  if (!channel.writable) await channel.whenWritable();
  channel.send(message);
};
async function discovery(request) {
  const channel = await persephone.service.openChannel(request);
  return new Promise((resolve) => {
    channel.onMessage((message) => resolve({ message, channel }));
    channel.onClose(() => resolve({ message: null, channel }));
  });
}
function applyDescription(message, view = null) {
  if (message.models?.length) state.models = message.models;
  if (view) view.defaults = message.defaults || null;
  else if (message.defaults) state.defaults = message.defaults;
  renderChips();
}
async function refreshDescription() {
  const { message } = await discovery({ type: "describe" });
  if (message?.type === "description") {
    state.sdkInstalled = Boolean(message.sdkInstalled);
    applyDescription(message);
  }
  $("#consent").classList.toggle("hidden", state.sdkInstalled);
  if (state.sdkInstalled && !state.sessions.length) await refreshSessions();
}
// Defaults depend on the folder (its project and local Claude settings), so a view not yet running asks for its own.
async function refreshDefaults(view) {
  const cwd = view.cwd || (view.id ? "" : $("#cwd").value.trim());
  const { message } = await discovery({ type: "describe", ...(cwd ? { cwd } : {}) });
  if (message?.type === "description") applyDescription(message, view);
}

// ── Model and effort chips under the composer ──────────────────────────────
// A view uses the model and effort picked for it, or else the defaults the service reports (the board settings,
// then Claude Code's own settings, then Opus at medium effort). A session the board runs reports what it uses.
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const isLive = (view) => Boolean(view?.channel && view.live);
// Listed ids show their display names; a full model id such as "claude-opus-5-5" shows as "Opus 5.5".
function modelLabel(id, models = state.models) {
  const listed = models.find((model) => model.id === id);
  if (listed?.label) return listed.label.replace(/\s*\(CLI alias\)$/, "");
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id || "");
  if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}${match[3] ? `.${match[3]}` : ""}${match[4] ? " 1M" : ""}`;
  return id ? id[0].toUpperCase() + id.slice(1) : t("default");
}
const viewDefaults = (view) => view.defaults || state.defaults;
const viewModel = (view) => (isLive(view) && view.footer?.model) || view.model || viewDefaults(view).model || "";
const viewEffort = (view) => (isLive(view) && view.footer?.effort) || view.effort || viewDefaults(view).effort || "";
function renderChips() {
  const view = current;
  $("#composer-meta").classList.toggle("hidden", !view || Boolean(view.selectedAgentId));
  if (!view) return;
  $("#model-chip").textContent = modelLabel(viewModel(view));
  $("#effort-chip").textContent = viewEffort(view) || t("defaultEffort");
  // Context fill, from the session's last status; it highlights at 70% and 90% like the footer's limit chips.
  const status = view.footer || {};
  const chip = $("#context-chip");
  chip.textContent = Number.isFinite(status.contextPercent) ? `${t("context")} ${status.contextPercent}%` : Number.isFinite(status.contextTokens) ? `${t("context")} ${formatTokens(status.contextTokens)}` : "";
  chip.classList.toggle("hidden", !chip.textContent);
  chip.dataset.tone = percentTone(status.contextPercent || 0);
  chip.title = status.contextWindow ? `${(status.contextTokens || 0).toLocaleString()} / ${status.contextWindow.toLocaleString()} ${t("tokens")}` : t("context");
}
const choiceMenu = $("#choice-menu");
let choiceAnchor = null;
function closeChoiceMenu() { choiceMenu.classList.add("hidden"); choiceAnchor?.classList.remove("open"); choiceAnchor = null; }
// A small menu above a chip; each item is { label, desc, current, disabled, run }.
function openChoiceMenu(anchor, items, note = "") {
  closeChoiceMenu();
  choiceMenu.replaceChildren(...items.map((item) => {
    const button = element("button", item.current ? "current" : "");
    button.type = "button"; button.disabled = Boolean(item.disabled);
    button.setAttribute("role", "menuitemradio"); button.setAttribute("aria-checked", String(Boolean(item.current)));
    button.append(element("span", "label", item.label));
    if (item.desc) button.append(element("span", "desc", item.desc));
    button.addEventListener("click", () => { closeChoiceMenu(); if (!item.current) void Promise.resolve(item.run()).catch((error) => showError(error.message)); });
    return button;
  }));
  if (note) choiceMenu.append(element("p", "note", note));
  choiceMenu.classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  choiceMenu.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - choiceMenu.offsetWidth - 4))}px`;
  choiceMenu.style.top = `${Math.max(4, rect.top - choiceMenu.offsetHeight - 4)}px`;
  anchor.classList.add("open"); choiceAnchor = anchor;
}
document.addEventListener("mousedown", (event) => { if (choiceAnchor && !choiceMenu.contains(event.target) && !choiceAnchor.contains(event.target)) closeChoiceMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && choiceAnchor) closeChoiceMenu(); });
// A running session lists its own models and answers which one it uses; a view that is not running uses the
// service's listing and applies the choice when the session starts or resumes.
async function modelListing(view) {
  if (isLive(view)) { const result = await control(view, "models"); return { models: result.models || [], selected: result.current }; }
  await refreshDefaults(view);
  return { models: state.models, selected: viewModel(view) };
}
// Like the terminal, a running session changes model or effort only between turns.
async function showModelMenu() {
  const view = current, anchor = $("#model-chip");
  if (choiceAnchor === anchor) { closeChoiceMenu(); return; }
  const live = isLive(view);
  const { models, selected } = await modelListing(view);
  if (view !== current) return;
  openChoiceMenu(anchor, models.filter((model) => model.id && model.id !== "default").map((model) => ({
    label: modelLabel(model.id, models), desc: model.description || "", current: model.id === selected, disabled: live && view.busy,
    run: async () => {
      if (live) { await control(view, "set-model", { model: model.id }); addDivider(view, t("modelSet", { model: modelLabel(model.id, models) })); return; }
      view.model = model.id;
      const efforts = model.efforts || [];
      if (efforts.length && !efforts.includes(viewEffort(view))) view.effort = efforts.includes("medium") ? "medium" : efforts[0];
      renderChips();
    },
  })), live ? t(view.busy ? "changeBusy" : "modelSwitchNote") : "");
}
async function showEffortMenu() {
  const view = current, anchor = $("#effort-chip");
  if (choiceAnchor === anchor) { closeChoiceMenu(); return; }
  const live = isLive(view);
  const { models, selected } = await modelListing(view);
  if (view !== current) return;
  const efforts = models.find((model) => model.id === selected)?.efforts;
  const effort = viewEffort(view);
  openChoiceMenu(anchor, (efforts?.length ? efforts : EFFORT_LEVELS).map((level) => ({
    label: level, current: level === effort, disabled: live && view.busy,
    run: async () => {
      // The CLI applies /effort to the running session only and answers with a confirmation line.
      if (live) { await sendPrompt(view, `/effort ${level}`); return; }
      view.effort = level; renderChips();
    },
  })), live && view.busy ? t("changeBusy") : "");
}
$("#context-chip").addEventListener("click", () => void showContextPanel().catch((error) => showError(error.message)));
$("#model-chip").addEventListener("click", () => void showModelMenu().catch((error) => showError(error.message)));
$("#effort-chip").addEventListener("click", () => void showEffortMenu().catch((error) => showError(error.message)));
$("#cwd").addEventListener("change", () => { if (current && !current.id) void refreshDefaults(current).catch(() => {}); });

async function consentSdk(accept) {
  $("#accept").disabled = true;
  if (!accept) { $("#consent").classList.add("hidden"); $("#accept").disabled = false; return; }
  const channel = await persephone.service.openChannel({ type: "consent-sdk" });
  channel.onMessage(async (message) => {
    if (message.type === "sdk-installed") { state.sdkInstalled = true; $("#consent").classList.add("hidden"); await refreshDescription(); }
    if (message.type === "sdk-install-error") { showError(message.message); $("#accept").disabled = false; }
  });
}

// ── Sidebar: recent sessions ───────────────────────────────────────────────
// Relative to today by calendar day: today, yesterday, -N days, then whole months, then whole years.
function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 864e5);
  if (days <= 0) return t("whenToday");
  if (days === 1) return t("whenYesterday");
  const months = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth() - (now.getDate() < date.getDate() ? 1 : 0);
  if (months < 1) return t("whenDays", { count: days });
  if (months < 12) return t(months === 1 ? "whenMonth" : "whenMonths", { count: months });
  const years = Math.floor(months / 12);
  return t(years === 1 ? "whenYear" : "whenYears", { count: years });
}
const formatWhenExact = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};
const folderName = (dir) => (dir || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir || "";
// Windows paths compare case-insensitively and with either slash.
const folderKey = (dir) => (dir || "").replace(/\//g, "\\").replace(/[\\]+$/, "").toLowerCase();

// Per-viewer UI conveniences only; the board works without them.
const prefs = {
  read(key, fallback) { try { const value = localStorage.getItem(`claude-agent:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(`claude-agent:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};
// Folder expansion is per page load: the most recent folder starts open, the rest collapsed.
const expandedFolders = new Set();
let folderTreeSeeded = false;

// Sessions grouped by working folder; folders ordered by their most recent session, sessions newest first.
function sessionGroups(rows) {
  const groups = new Map();
  for (const item of rows) {
    const key = folderKey(item.cwd);
    if (!groups.has(key)) groups.set(key, { key, cwd: item.cwd, sessions: [] });
    groups.get(key).sessions.push(item);
  }
  const newest = (group) => group.sessions[0]?.updatedAt || "";
  for (const group of groups.values()) group.sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return [...groups.values()].sort((a, b) => String(newest(b)).localeCompare(String(newest(a))) || folderName(a.cwd).localeCompare(folderName(b.cwd)));
}
function renderSessions() {
  const list = $("#session-list");
  const rows = state.sessions;
  list.replaceChildren();
  if (!rows.length) {
    // sdkInstalled is null until the first describe reply; say nothing rather than guess.
    if (state.sdkInstalled !== null) list.append(element("div", "empty", t(state.sdkInstalled ? "noSessions" : "consentRequired")));
    renderAgents();
    return;
  }
  const groups = sessionGroups(rows);
  if (!folderTreeSeeded) { folderTreeSeeded = true; expandedFolders.add(groups[0].key); }
  for (const group of groups) {
    const expanded = expandedFolders.has(group.key);
    const folder = element("div", `folder${expanded ? " expanded" : ""}`);
    const head = element("div", "folder-head");
    head.title = group.cwd;
    const toggle = element("button", "folder-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.append(element("span", "caret"), element("span", "folder-name", folderName(group.cwd)));
    // A collapsed folder still shows that one of its sessions is running.
    const running = group.sessions.map((item) => viewFor(item.id)).filter((view) => view?.channel);
    if (running.length && !expanded) toggle.append(element("span", `session-dot live${running.some((view) => view.busy) ? " busy" : ""}`));
    toggle.addEventListener("click", () => {
      if (expandedFolders.has(group.key)) expandedFolders.delete(group.key); else expandedFolders.add(group.key);
      renderSessions();
    });
    // The plus is drawn in CSS: a "+" glyph sits low in its line box and never centers.
    const add = element("button", "folder-new");
    add.type = "button";
    add.title = t("newSessionHere");
    add.setAttribute("aria-label", add.title);
    add.addEventListener("click", () => { showNewSession(group.cwd); prompt.focus(); });
    // The count comes last so the + button sits just before it.
    head.append(toggle, add, element("span", "count", String(group.sessions.length)));
    folder.append(head);
    if (expanded) {
      for (const item of group.sessions) {
        const view = viewFor(item.id);
        const button = element("button", `session-item${item.id && item.id === current?.id ? " active" : ""}${view?.unread ? " unread" : ""}`);
        button.type = "button";
        // Gray: not running. Green: the board runs it (pulsing while Claude works).
        const dotState = view?.channel ? (view.busy ? "live busy" : "live") : "";
        button.title = [item.title, formatWhenExact(item.updatedAt), t(view?.channel ? (view.busy ? "sessionWorking" : "sessionLive") : "sessionIdle")].filter(Boolean).join("\n");
        button.append(element("span", `session-dot ${dotState}`.trim()), element("span", "title", item.title), element("span", "when", formatWhen(item.updatedAt)));
        button.addEventListener("click", () => void openStoredSession(item));
        button.addEventListener("contextmenu", (event) => { event.preventDefault(); openSessionMenu(item, event.clientX, event.clientY); });
        folder.append(button);
      }
    }
    list.append(folder);
  }
  renderAgents();
}

// Inactive agents untouched for this long are not listed at all; their Agent tool-call rows still open them.
const AGENT_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
function renderAgents() {
  const panel = $("#agents-panel"), list = $("#agents-list");
  list.replaceChildren();
  // Running agents always show; recent inactive ones sit behind a toggle; the shown one stays until you switch away.
  const isRunning = (agent) => agent.running && !agent.finished;
  const isSelected = (agent) => agent.id === current.selectedAgentId;
  const recent = (agent) => Date.now() - (agent.mtime || 0) <= AGENT_LIST_MAX_AGE_MS;
  const agents = current?.id ? (current.agents || []).filter((agent) => isRunning(agent) || isSelected(agent) || recent(agent)) : [];
  panel.classList.toggle("hidden", !agents.length);
  if (!agents.length) return;
  const root = element("button", `agent-item agent-root${current.selectedAgentId ? "" : " active"}`);
  root.type = "button";
  root.append(element("span", `session-dot ${current.channel ? (current.busy ? "live busy" : "live") : ""}`.trim()), element("span", "agent-label", current.title || current.id));
  root.addEventListener("click", () => showMainTranscript(current));
  list.append(root);
  const inactive = agents.filter((agent) => !isRunning(agent) && !isSelected(agent)).length;
  for (const agent of agents) {
    const running = isRunning(agent);
    if (!running && !isSelected(agent) && !current.showInactiveAgents) continue;
    const row = element("button", `agent-item agent-child${isSelected(agent) ? " active" : ""}`);
    row.type = "button";
    row.title = `${agent.description} · ${agent.agentType}`;
    row.append(element("span", `session-dot ${running ? "live busy" : ""}`.trim()), element("span", "agent-label", agent.description), element("span", "agent-type", agent.agentType));
    row.addEventListener("click", () => void showAgentTranscript(current, agent.id));
    list.append(row);
  }
  if (inactive) {
    const toggle = element("button", "agent-toggle", t(current.showInactiveAgents ? "agents.hideInactive" : "agents.showInactive", { count: inactive }));
    toggle.type = "button";
    toggle.addEventListener("click", () => { current.showInactiveAgents = !current.showInactiveAgents; renderAgents(); });
    list.append(toggle);
  }
}

// ── Session context menu: Rename / Delete ──────────────────────────────────
const sessionMenu = $("#session-menu");
let menuItem = null;
function openSessionMenu(item, x, y) {
  menuItem = item;
  sessionMenu.querySelector("[data-action=disconnect]").classList.toggle("hidden", !viewFor(item.id)?.channel);
  sessionMenu.classList.remove("hidden");
  const { width, height } = sessionMenu.getBoundingClientRect();
  sessionMenu.style.left = `${Math.min(x, window.innerWidth - width - 4)}px`;
  sessionMenu.style.top = `${Math.min(y, window.innerHeight - height - 4)}px`;
  sessionMenu.querySelector("button").focus();
}
const closeSessionMenu = () => { sessionMenu.classList.add("hidden"); menuItem = null; };
window.addEventListener("pointerdown", (event) => { if (!sessionMenu.contains(event.target)) closeSessionMenu(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSessionMenu(); });
window.addEventListener("blur", closeSessionMenu);
$("#session-list").addEventListener("scroll", closeSessionMenu);
sessionMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  const item = menuItem;
  closeSessionMenu();
  if (item && action === "rename") void renameSession(item);
  if (item && action === "delete") void deleteSession(item);
  if (item && action === "disconnect") { const view = viewFor(item.id); if (view) disconnect(view); }
});

// Modal dialog; resolves with the input text (or "" without one) on confirm, null on cancel.
function askDialog({ title, message = "", value = null, confirmLabel, danger = false }) {
  const dialog = $("#dialog"), input = $("#dialog-input"), confirm = $("#dialog-confirm");
  $("#dialog-title").textContent = title;
  $("#dialog-message").textContent = message;
  $("#dialog-message").classList.toggle("hidden", !message);
  input.classList.toggle("hidden", value === null);
  input.value = value ?? "";
  confirm.textContent = confirmLabel;
  confirm.classList.toggle("danger", danger);
  confirm.classList.toggle("primary", !danger);
  dialog.returnValue = "";
  dialog.showModal();
  if (value !== null) input.select(); else confirm.focus();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm" ? input.value.trim() : null), { once: true });
  });
}
// Enter would submit through the form's first button (Cancel); make it confirm instead.
$("#dialog-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); $("#dialog").close("confirm"); }
});
async function manageSession(item, action, title) {
  const { message } = await discovery({ type: "manage-session", action, sessionId: item.id, cwd: item.cwd, ...(title ? { title } : {}) });
  if (message?.type === "session-updated") return true;
  showError(message?.type === "error" ? `${message.code}: ${message.message}` : t("error"));
  return false;
}
async function renameSession(item) {
  const title = await askDialog({ title: t("renameSession"), value: item.title, confirmLabel: t("save") });
  if (!title || title === item.title) return;
  if (!(await manageSession(item, "rename", title))) return;
  item.title = title;
  const view = viewFor(item.id);
  if (view) view.title = title;
  renderSessions();
}
async function deleteSession(item) {
  const answer = await askDialog({ title: t("deleteSession"), message: t("deleteConfirm", { title: item.title }), confirmLabel: t("delete"), danger: true });
  if (answer === null) return;
  const view = viewFor(item.id);
  if (view) { if (view === current) showNewSession(); dropView(view); }
  if (!(await manageSession(item, "delete"))) return;
  state.sessions = state.sessions.filter((row) => row.id !== item.id);
  renderSessions();
}

// Sidebar resizing: drag the splitter; the width is remembered per viewer.
const SIDEBAR_MIN = 180;
const applySidebarWidth = (width) => {
  const clamped = Math.round(Math.max(SIDEBAR_MIN, Math.min(width, window.innerWidth * 0.6)));
  $("#sidebar").style.width = `${clamped}px`;
  return clamped;
};
applySidebarWidth(prefs.read("sidebar-width", 280));
$("#splitter").addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const splitter = event.currentTarget;
  splitter.classList.add("dragging");
  document.body.classList.add("resizing");
  const startX = event.clientX;
  const startWidth = $("#sidebar").getBoundingClientRect().width;
  let width = startWidth;
  const move = (moveEvent) => { width = applySidebarWidth(startWidth + moveEvent.clientX - startX); };
  const end = () => {
    splitter.classList.remove("dragging");
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    prefs.write("sidebar-width", width);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
});
$("#splitter").addEventListener("dblclick", () => prefs.write("sidebar-width", applySidebarWidth(280)));
async function refreshSessions() {
  if (!state.sdkInstalled) { renderSessions(); return; }
  const { message } = await discovery({ type: "list-sessions" });
  if (message?.type === "sessions") {
    state.sessions = [...message.sessions].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const item of state.sessions) { const view = viewFor(item.id); if (view) view.title = item.title; }
  } else if (message?.type === "error") showError(`${message.code}: ${message.message}`);
  renderSessions();
}

// ── Page toolbar: the session folder in the text slot, every button on the right ──
// Toolbar controls cannot be hidden, so the catalog is re-declared only when its shape changes.
let toolbarShape = "";
function updateToolbar() {
  const interruptible = Boolean(current?.channel) && current.busy;
  if (String(interruptible) !== toolbarShape) {
    toolbarShape = String(interruptible);
    persephone.toolbar.set([
      // Interrupt comes first, so the buttons after it keep their place when it appears.
      ...(interruptible ? [{ id: "interrupt", type: "button", label: t("interrupt"), icon: { name: "stop" } }] : []),
      { id: "new-session", type: "button", label: t("newSession"), icon: { name: "plus" } },
      { id: "refresh-sessions", type: "button", title: t("refresh"), icon: { name: "refresh" } },
      { id: "instructions", type: "button", label: t("instructions"), icon: { name: "edit" } },
    ]);
  }
  persephone.toolbar.setText(current?.cwd || "");
}
persephone.toolbar.onAction(({ id }) => {
  if (id === "new-session") showNewSession();
  else if (id === "refresh-sessions") void refreshSessions();
  else if (id === "interrupt" && current?.channel) void channelSend(current.channel, { type: "interrupt" });
  else if (id === "instructions") void editInstructions();
});
function updateControls() {
  $("#intro").classList.toggle("hidden", Boolean(current?.id || current?.channel));
  $("#send").disabled = Boolean(current?.busy);
  updateToolbar(); renderChips();
}

// ── Instructions dialog: the provider instructions the service adds to every new or reopened session ──
let instructionsDefault = "";
async function editInstructions() {
  showError("");
  const { message } = await discovery({ type: "instructions", action: "get" });
  if (message?.type !== "instructions") { showError(message?.type === "error" ? `${message.code}: ${message.message}` : t("error")); return; }
  instructionsDefault = message.defaultText;
  const dialog = $("#instructions-dialog"), text = $("#instructions-text");
  text.value = message.text;
  dialog.returnValue = "";
  dialog.showModal();
  text.focus(); text.setSelectionRange(0, 0); text.scrollTop = 0;
  const saved = await new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "save"), { once: true }));
  if (!saved || text.value === message.text) return;
  const reply = await discovery({ type: "instructions", action: "set", text: text.value });
  if (reply.message?.type !== "instructions") showError(reply.message?.type === "error" ? `${reply.message.code}: ${reply.message.message}` : t("error"));
}
// Reset only fills the editor; nothing is stored until Save.
$("#instructions-reset").addEventListener("click", () => { $("#instructions-text").value = instructionsDefault; $("#instructions-text").focus(); });
// ── Session lifecycle ──────────────────────────────────────────────────────
// A live view is one whose channel the service has started; panels wait for it.
function endLive(view) {
  view.live = false;
  for (const resolve of view.liveWaiters.splice(0)) resolve(false);
  for (const [id, pending] of view.controls) { clearTimeout(pending.timer); pending.reject(new Error(t("closed"))); view.controls.delete(id); }
}
const closeChannel = (channel) => { if (channel) { try { channel.close(); } catch { /* already closed */ } } };
// Ends the board's Claude process for this view; the transcript stays on screen and is followed again.
function disconnect(view) {
  const channel = view.channel;
  view.channel = null; view.busy = false; view.pendingPrompt = "";
  endStream(view); endLive(view); closeChannel(channel);
  setViewStatus(view);
  if (view === current) { updateControls(); void startFollow(view); }
  else dropView(view);
  renderSessions();
}
function dropView(view) {
  stopAgentWatch(view);
  for (const child of view.agentViews.values()) { closeChannel(child.follow); child.messages.remove(); }
  view.agentViews.clear();
  stopFollow(view);
  const channel = view.channel;
  view.channel = null; view.historyToken++;
  endStream(view); endLive(view); closeChannel(channel);
  view.messages.remove();
  views.delete(view);
}
// Shows a view. The one it replaces keeps running if it is live; otherwise it is dropped.
function showView(view) {
  if (current === view) return;
  const previous = current;
  if (previous) {
    if (previous.selectedAgentId) {
      const child = previous.agentViews.get(previous.selectedAgentId);
      if (child) { child.scrollTop = transcript.scrollTop; child.messages.classList.add("hidden"); }
      stopAgentFollow(previous); previous.selectedAgentId = "";
    }
    stopAgentWatch(previous);
    previous.draft = prompt.textContent;
    previous.stick = nearBottom(); previous.scrollTop = transcript.scrollTop;
    previous.messages.classList.add("hidden");
    stopFollow(previous);
    if (!previous.channel) dropView(previous);
  }
  current = view;
  view.selectedAgentId = "";
  view.messages.classList.remove("hidden");
  $("#readonly-hint").classList.add("hidden");
  $("#prompt").classList.remove("hidden"); $("#send").classList.remove("hidden");
  view.unread = false;
  view.messages.classList.remove("hidden");
  prompt.textContent = view.draft; hideCommandMenu();
  showError(view.error); setStatus(view.statusText, view.statusBusy); renderFooter(view);
  // The first view (the form shown at load) must not overwrite the session the page is about to restore.
  if (previous) rememberSession();
  updateControls(); renderSessions();
  transcript.scrollTop = view.stick ? transcript.scrollHeight : view.scrollTop;
}

// ── Live view: while the board does not run the shown session, show turns that another process
// (a terminal Claude Code, another board) appends to its transcript. Connecting stops it; the board's own
// channel streams those turns instead.
function appendEntries(view, entries) {
  for (const entry of entries || []) {
    const suffix = entry.truncated ? ` ${t("truncated")}` : "";
    if (entry.role === "user") addUserMessage(view, entry.text + suffix, false);
    else if (entry.role === "agent") addAgentMessage(view, entry.text + suffix);
    else if (entry.role === "tool") addToolCall(view, entry.name, entry.input, entry.callId);
    else if (entry.role === "command") addCommandMessage(view, entry.text, false);
    else if (entry.role === "command-output") addCommandOutput(view, entry.text + suffix);
    else if (entry.role === "compacted") addCompacted(view);
    else if (entry.role === "compact") addCompactSummary(view, entry.text + suffix);
    else if (entry.role === "task") addTaskNotice(view, entry.text, entry.detail);
  }
}
function stopFollow(view) {
  const channel = view.follow;
  view.follow = null;
  closeChannel(channel);
}
async function startFollow(view) {
  stopFollow(view);
  if (!view.id || view.channel || view !== current) return;
  const channel = await persephone.service.openChannel({ type: "follow-session", sessionId: view.id });
  if (view !== current || view.channel || view.follow || !views.has(view)) { closeChannel(channel); return; }
  view.follow = channel;
  channel.onMessage((message) => { if (view.follow === channel && message.type === "history") appendEntries(view, message.entries); });
  channel.onClose((reason) => {
    if (view.follow !== channel) return;
    view.follow = null;
    if (reason?.code === "session-deleted") void refreshSessions();
  });
}

function stopAgentWatch(view) {
  const channel = view.agentsChannel;
  view.agentsChannel = null;
  closeChannel(channel);
}
function stopAgentFollow(view) {
  const selected = view.agentViews.get(view.selectedAgentId);
  if (selected?.follow) { closeChannel(selected.follow); selected.follow = null; }
}
function startAgentWatch(view) {
  stopAgentWatch(view);
  if (!view.id || view !== current) return;
  void persephone.service.openChannel({ type: "watch-subagents", sessionId: view.id, cwd: view.cwd }).then((channel) => {
    if (view !== current || view.agentsChannel) { closeChannel(channel); return; }
    view.agentsChannel = channel;
    channel.onMessage((message) => {
      if (view.agentsChannel !== channel || message.type !== "subagents") return;
      view.agents = message.agents || [];
      renderSessions();
    });
  }).catch((error) => setViewError(view, error.message));
}
function showMainTranscript(view) {
  if (!view?.selectedAgentId) return;
  const child = view.agentViews.get(view.selectedAgentId);
  if (child) { child.scrollTop = transcript.scrollTop; child.messages.classList.add("hidden"); }
  stopAgentFollow(view);
  view.selectedAgentId = "";
  view.messages.classList.remove("hidden");
  $("#readonly-hint").classList.add("hidden");
  $("#prompt").classList.remove("hidden"); $("#send").classList.remove("hidden");
  hideCommandMenu(); renderSessions(); renderChips();
  transcript.scrollTop = view.scrollTop;
}
async function showAgentTranscript(view, agentId) {
  if (!view || view !== current || !view.agents.some((agent) => agent.id === agentId)) return;
  const previous = view.agentViews.get(view.selectedAgentId);
  if (view.selectedAgentId) {
    if (previous) { previous.scrollTop = transcript.scrollTop; previous.messages.classList.add("hidden"); }
    stopAgentFollow(view);
  } else {
    view.scrollTop = transcript.scrollTop;
    view.messages.classList.add("hidden");
  }
  let child = view.agentViews.get(agentId);
  if (!child) {
    child = { id: agentId, messages: element("div", "messages hidden"), tools: new Map(), scrollTop: null, follow: null };
    $("#views").append(child.messages); view.agentViews.set(agentId, child);
  }
  child.messages.replaceChildren(); child.tools.clear();
  view.selectedAgentId = agentId;
  child.messages.classList.remove("hidden");
  $("#readonly-hint").classList.remove("hidden");
  $("#prompt").classList.add("hidden"); $("#send").classList.add("hidden");
  hideCommandMenu(); renderSessions(); renderChips(); closeChoiceMenu(); transcript.scrollTop = child.scrollTop ?? 0;
  const channel = await persephone.service.openChannel({ type: "subagent-history", sessionId: view.id, agentId, cwd: view.cwd });
  if (view !== current || view.selectedAgentId !== agentId) { closeChannel(channel); return; }
  child.follow = channel;
  channel.onMessage((message) => {
    if (child.follow !== channel) return;
    if (message.type === "history") {
      appendEntries(child, message.entries);
      // First open lands on the newest turns; reopening restores where you left it.
      if (message.done) transcript.scrollTop = child.scrollTop ?? transcript.scrollHeight;
    }
    else if (message.type === "error") setViewError(view, `${message.code}: ${message.message}`);
  });
  channel.onClose(() => { if (child.follow === channel) child.follow = null; });
}
$("#back-to-main").addEventListener("click", () => showMainTranscript(current));
$("#transcript").addEventListener("click", (event) => {
  const tool = event.target.closest(".activity.tool[data-call-id]");
  if (!tool || !current || current.selectedAgentId) return;
  const agent = current.agents.find((item) => item.toolUseId && item.toolUseId === tool.dataset.callId);
  if (agent) void showAgentTranscript(current, agent.id);
});

// The session list refreshes itself when any stored transcript changes (the service throttles the notices).
let refreshing = false, refreshAgain = false;
async function refreshFromWatch() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try { do { refreshAgain = false; await refreshSessions(); } while (refreshAgain); }
  finally { refreshing = false; }
}
async function watchSessionList() {
  const channel = await persephone.service.openChannel({ type: "watch-sessions" });
  channel.onMessage((message) => { if (message.type === "sessions-changed") void refreshFromWatch(); });
}
// The shown session is restorable page state, so the page reopens it after a reload, a restart, or a move to another window.
const rememberSession = () => persephone.state.merge({ session: current?.id ? { id: current.id, cwd: current.cwd } : null });
// Shows the New session form; a form already open (and not yet started) is reused.
// From a folder (its + button, /clear) the form only shows the folder; from the toolbar it asks for one.
function showNewSession(cwd = "") {
  if (!current || current.id || current.channel) showView(createView());
  if (cwd) $("#cwd").value = cwd;
  $("#cwd-field").classList.toggle("hidden", Boolean(cwd));
  $("#intro-folder").classList.toggle("hidden", !cwd);
  $("#intro-folder-path").textContent = cwd;
  $("#start-hint").textContent = t(cwd ? "startHintFolder" : "startHint");
  void refreshDefaults(current).catch(() => {});
  if (cwd) prompt.focus(); else $("#cwd").focus();
}
// A new session is named after the first words of its first message, or the time it started; rename it any time.
function sessionTitle(text) {
  const words = (text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let title = "";
  for (const word of words.slice(0, 6)) { if (title && title.length + word.length >= 48) break; title = title ? `${title} ${word}` : word.slice(0, 48); }
  if (title) return title.split(" ").length < words.length ? `${title}…` : title;
  const now = new Date(), pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
async function loadHistory(view) {
  const token = ++view.historyToken;
  setViewStatus(view, t("loadingHistory"), true);
  const channel = await persephone.service.openChannel({ type: "session-history", sessionId: view.id, cwd: view.cwd });
  await new Promise((resolve) => {
    channel.onMessage((message) => {
      if (token !== view.historyToken) return;
      if (message.type === "error") { setViewError(view, `${message.code}: ${message.message}`); return; }
      if (message.type === "history") appendEntries(view, message.entries);
    });
    channel.onClose(resolve);
  });
  if (token !== view.historyToken) return false;
  setViewStatus(view);
  view.stick = true;
  if (view === current) transcript.scrollTop = transcript.scrollHeight;
  return true;
}
// Selecting a session shows it live; the board resumes it (a Claude process of its own) only when you send from here.
async function openStoredSession(item) {
  const existing = viewFor(item.id);
  if (existing) {
    if (existing === current) return;
    showView(existing);
    startAgentWatch(existing);
    if (!existing.channel) await startFollow(existing);
    return;
  }
  const view = createView(item);
  expandedFolders.add(folderKey(item.cwd));
  showView(view);
  startAgentWatch(view);
  if (!(await loadHistory(view))) return;
  await startFollow(view);
}
async function connect(view) {
  setViewError(view, "");
  const resume = view.id || undefined;
  const cwd = resume ? view.cwd : $("#cwd").value.trim();
  if (!cwd) { setViewError(view, t("cwdRequired")); return false; }
  if (!state.sdkInstalled) { $("#consent").classList.remove("hidden"); setViewError(view, t("consentRequired")); return false; }
  stopFollow(view);
  const title = resume ? "" : sessionTitle(view.pendingPrompt);
  if (!resume) view.title = title;
  const open = {
    type: "open", contractVersion: 1, model: view.model, cwd,
    // Required by the agent.session contract; the service runs local page sessions unrestricted anyway.
    permissionMode: "full-auto",
    mcp: { persephone: true },
    ...(view.effort ? { effort: view.effort } : {}),
    ...(title ? { title } : {}),
    ...(resume ? { resume } : {}),
  };
  setViewStatus(view, t("connecting"), true);
  const channel = await persephone.service.openChannel(open);
  view.channel = channel; view.cwd = cwd;
  channel.onMessage((event) => { if (view.channel === channel) handleEvent(view, event); });
  channel.onClose((reason) => {
    if (view.channel !== channel) return;
    view.channel = null; view.busy = false; view.pendingPrompt = "";
    endStream(view); endLive(view);
    setViewStatus(view, `${t("closed")}: ${reason?.code || "channel-closed"}`);
    if (view === current) { updateControls(); void startFollow(view); }
    else view.unread = true;
    renderSessions();
  });
  updateControls(); renderSessions();
  return true;
}
function handleEvent(view, event) {
  switch (event.type) {
    case "session-started": {
      view.id = event.sessionId;
      if (view === current) rememberSession();
      // Keep the open session visible in the tree.
      expandedFolders.add(folderKey(view.cwd));
      startAgentWatch(view);
      setViewStatus(view); updateControls(); renderSessions();
      view.live = true;
      for (const resolve of view.liveWaiters.splice(0)) resolve(true);
      void refreshCommands(view);
      if (view.pendingPrompt) { const text = view.pendingPrompt; view.pendingPrompt = ""; void sendPrompt(view, text); }
      break;
    }
    case "control-result": {
      const pending = view.controls.get(event.id);
      if (!pending) break;
      view.controls.delete(event.id); clearTimeout(pending.timer);
      if (event.ok) pending.resolve(event); else pending.reject(new Error(event.message || t("error")));
      break;
    }
    case "compacted": endStream(view); addCompacted(view, event); break;
    case "compact-summary": addCompactSummary(view, event.text); break;
    case "session-status": view.footer = event; if (view === current) { updateFooter(event); renderChips(); } break;
    case "turn-started": view.busy = true; setViewStatus(view, t("working"), true); updateControls(); renderSessions(); break;
    case "text-delta":
      view.thinkingNode = null;
      (view.stream || startStream(view)).text += `${event.text || ""}${event.truncated ? ` ${t("truncated")}` : ""}`;
      renderStream(view);
      break;
    case "text":
      if (event.synthetic && view.commandTurn) { if (event.text) addCommandOutput(view, event.text); break; }
      if (event.text && !(view.stream?.text.includes(event.text)) && event.text !== view.lastText) addAgentMessage(view, `${event.text}${event.truncated ? ` ${t("truncated")}` : ""}`);
      view.lastText = event.text || view.lastText;
      break;
    case "thinking-delta":
      if (!event.text?.trim() && !view.thinkingNode) break;
      endStream(view);
      if (!view.thinkingNode) view.thinkingNode = addActivity(view, t("thinking"), "", "thinking");
      view.thinkingNode.querySelector("pre").append(document.createTextNode(event.text));
      break;
    case "tool-call": endStream(view); view.thinkingNode = null; addToolCall(view, event.name, event.input, event.callId); break;
    case "task": endStream(view); addTaskNotice(view, event.summary, event.detail); break;
    case "tool-result": {
      const node = view.tools.get(event.callId);
      const mark = element("span", event.ok === false ? "fail" : "ok", event.ok === false ? " ✗" : " ✓");
      if (node) {
        // tool_progress also arrives as ok results; keep a single status mark per call.
        node.querySelector("summary .ok, summary .fail")?.remove();
        node.querySelector("summary").append(mark);
        updateToolGroup(node.closest(".tool-group"));
        if (event.ok === false && event.summary) node.querySelector("pre").append(document.createTextNode(`\n${event.summary}`));
      } else if (event.ok === false) addActivity(view, `${t("tool")} ✗`, event.summary || "");
      break;
    }
    case "file-change": addActivity(view, `${t("file")} · ${event.kind} — ${event.path}`, event.path); break;
    case "turn-ended": {
      endStream(view);
      view.busy = false; view.lastText = ""; view.thinkingNode = null; view.commandTurn = false;
      // A session that finished while another one is shown is marked in the sidebar until you open it.
      if (view !== current) view.unread = true;
      setViewStatus(view); updateControls();
      if (event.usage) {
        if (Number.isFinite(event.usage.costUsd)) view.sessionCost += event.usage.costUsd;
        view.usage = event.usage;
        if (view === current) updateFooterUsage(view.usage, view.sessionCost);
      }
      if (event.reason && event.reason !== "completed") addDivider(view, event.reason);
      renderSessions();
      void refreshSessions(); void refreshDescription();
      break;
    }
    case "error":
      setViewError(view, `${event.code}: ${event.message}`);
      if (event.fatal) setViewStatus(view, t("error"));
      if (event.code === "sdk-not-installed") { state.sdkInstalled = false; $("#consent").classList.remove("hidden"); }
      break;
    case "notice":
      // The footer already shows the model the service picked.
      if (/^Claude selected model /.test(event.message)) break;
      if (/^Claude is compacting /.test(event.message)) { setViewStatus(view, t("compacting"), true); break; }
      addActivity(view, `${t("notice")} · ${event.message.split("\n")[0]}`, event.detail || event.message); break;
  }
}
async function sendPrompt(view, text) {
  view.commandTurn = text.startsWith("/");
  if (view.commandTurn) addCommandMessage(view, text); else addUserMessage(view, text);
  try { await channelSend(view.channel, { type: "send", id: crypto.randomUUID(), text }); }
  catch (error) { setViewError(view, error.message); }
}

// ── Composer ───────────────────────────────────────────────────────────────
// The prompt is a plaintext-only contenteditable div; innerText carries a trailing "\n" the user never typed.
const prompt = $("#prompt");
const promptText = () => { const text = prompt.innerText; return text === "\n" ? "" : text.endsWith("\n") ? text.slice(0, -1) : text; };
const clearPrompt = () => { prompt.textContent = ""; };
// Chromium can leave a stray <br> after deleting everything, which would hide the :empty placeholder.
prompt.addEventListener("input", () => { if (!promptText()) clearPrompt(); updateCommandMenu(); });
prompt.addEventListener("keydown", (event) => {
  if (commandMenuKey(event)) return;
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); $("#composer").requestSubmit(); }
});
prompt.addEventListener("blur", hideCommandMenu);
// The composer floats over the transcript; the transcript's bottom padding follows its height (it grows with
// the text and the status line), and a transcript scrolled to the end stays there. Watching the messages too
// catches the scrollbar appearing, so the composer stays aligned with them.
const composerLayout = new ResizeObserver(() => {
  const stick = nearBottom();
  transcript.style.setProperty("--composer-space", `${$("#composer-dock").offsetHeight + 16}px`);
  $("#composer-dock").style.setProperty("--scrollbar", `${transcript.offsetWidth - transcript.clientWidth}px`);
  scrollToEnd(stick);
});
composerLayout.observe($("#composer-dock"));
composerLayout.observe($("#views"));
$("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const view = current;
  const text = promptText().trim();
  hideCommandMenu();
  const boardCommand = text && boardCommandFor(text);
  if (boardCommand) { clearPrompt(); await boardCommand(); return; }
  if (!text || view.busy || view.pendingPrompt) return;
  clearPrompt();
  if (view.channel) { await sendPrompt(view, text); return; }
  // Not running yet: start a new session from the form, or resume the shown one, then send.
  view.pendingPrompt = text;
  const restore = () => { view.pendingPrompt = ""; if (view === current && !promptText()) setPrompt(text); else view.draft ||= text; };
  try {
    if (!(await connect(view))) { restore(); setViewStatus(view); }
  } catch (error) { restore(); setViewError(view, error.message); setViewStatus(view, t("error")); }
});

// ── Slash commands ─────────────────────────────────────────────────────────
// Typing "/" lists the session's commands (skills, custom and built-in ones). Most run by sending them as a
// message, exactly as the terminal does. The terminal draws its own UI for a few of them, which the SDK does
// not have, so the board handles those itself with panels.
const BOARD_COMMANDS = {
  mcp: { run: () => showMcpPanel(), anyArgs: true },
  model: { run: () => showModelMenu() },
  effort: { run: () => showEffortMenu() },
  context: { run: () => showContextPanel() },
  clear: { run: () => clearSession(), anyArgs: true },
  rename: { run: () => renameActiveSession() },
};
state.commands = prefs.read("commands", []);
// The list is cached from the last live session so the menu also works before the board connects.
async function refreshCommands(view) {
  try {
    const { commands } = await control(view, "commands");
    state.commands = commands || [];
    prefs.write("commands", state.commands);
  } catch { /* keep the cached list */ }
}
function boardCommandFor(text) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const command = match && Object.hasOwn(BOARD_COMMANDS, match[1]) ? BOARD_COMMANDS[match[1]] : null;
  if (!command || (match[2]?.trim() && !command.anyArgs)) return null;
  return command.run;
}
function commandList() {
  const byName = new Map(state.commands.map((command) => [command.name, command]));
  for (const name of Object.keys(BOARD_COMMANDS)) byName.set(name, { ...byName.get(name), name, description: t(`cmd.${name}`), board: true });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const commandMenu = $("#command-menu");
const menu = { items: [], index: 0 };
function updateCommandMenu() {
  if (current?.selectedAgentId) { hideCommandMenu(); return; }
  const match = /^\/(\S*)$/.exec(promptText());
  if (!match) { hideCommandMenu(); return; }
  const query = match[1].toLowerCase();
  const all = commandList();
  const starts = all.filter((command) => command.name.toLowerCase().startsWith(query));
  const contains = query ? all.filter((command) => !command.name.toLowerCase().startsWith(query) && command.name.toLowerCase().includes(query)) : [];
  menu.items = [...starts, ...contains];
  menu.index = 0;
  if (!menu.items.length) { hideCommandMenu(); return; }
  renderCommandMenu();
}
function renderCommandMenu() {
  commandMenu.replaceChildren(...menu.items.map((command, index) => {
    const item = element("div", `command-item${index === menu.index ? " selected" : ""}`);
    item.setAttribute("role", "option");
    item.append(element("span", "name", `/${command.name}`));
    if (command.argumentHint && !command.board) item.append(element("span", "hint", command.argumentHint));
    item.append(element("span", "desc", command.description || ""));
    if (command.board) item.append(element("span", "tag", t("board")));
    item.title = command.description || "";
    // Keep focus in the prompt so the caret and the menu survive the click.
    item.addEventListener("mousedown", (event) => event.preventDefault());
    item.addEventListener("click", () => { menu.index = index; pickCommand(); });
    return item;
  }));
  commandMenu.classList.remove("hidden");
  commandMenu.children[menu.index]?.scrollIntoView({ block: "nearest" });
}
function hideCommandMenu() { commandMenu.classList.add("hidden"); menu.items = []; }
function setPrompt(text) {
  prompt.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(prompt); range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  prompt.focus();
}
// Enter runs a command that needs no arguments; one that takes arguments (and Tab, always) completes its name.
function pickCommand(complete = false) {
  const command = menu.items[menu.index];
  if (!command) return;
  hideCommandMenu();
  if (complete || (command.argumentHint && !command.board)) { setPrompt(`/${command.name} `); return; }
  setPrompt(`/${command.name}`);
  $("#composer").requestSubmit();
}
function commandMenuKey(event) {
  if (commandMenu.classList.contains("hidden") || event.isComposing) return false;
  const move = (step) => { menu.index = (menu.index + step + menu.items.length) % menu.items.length; renderCommandMenu(); };
  if (event.key === "ArrowDown") move(1);
  else if (event.key === "ArrowUp") move(-1);
  else if (event.key === "Tab") pickCommand(true);
  else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) pickCommand();
  else if (event.key === "Escape") hideCommandMenu();
  else return false;
  event.preventDefault(); event.stopPropagation();
  return true;
}

// Session controls go over the live channel and are answered by a control-result with the same id.
let controlSeq = 0;
function control(view, action, args = {}) {
  const channel = view.channel;
  if (!channel || !view.live) return Promise.reject(new Error(t("noLiveSession")));
  const id = `control-${++controlSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { view.controls.delete(id); reject(new Error(t("controlTimeout"))); }, 120000);
    view.controls.set(id, { resolve, reject, timer });
    channelSend(channel, { type: "control", id, action, ...args }).catch((error) => { view.controls.delete(id); clearTimeout(timer); reject(error); });
  });
}
// Panels need a session the board runs: a shown stored session is resumed, the New session form starts one.
async function ensureLive(view) {
  if (view.channel && view.live) return true;
  if (!view.channel) {
    try { if (!(await connect(view))) return false; }
    catch (error) { setViewError(view, error.message); return false; }
  }
  return new Promise((resolve) => view.liveWaiters.push(resolve));
}

const panelDialog = $("#panel-dialog");
let panelToken = 0;
// Opens (or retitles) the panel and returns its body plus a check that it still shows this request.
function openPanel(title) {
  const token = ++panelToken;
  $("#panel-title").textContent = title;
  const body = $("#panel-body");
  body.replaceChildren(element("p", "muted", t("loading")));
  if (!panelDialog.open) panelDialog.showModal();
  return { body, view: current, current: () => token === panelToken && panelDialog.open };
}
const panelError = (body, error) => body.replaceChildren(element("p", "panel-error", error?.message || String(error)));
// The panel acts on the view shown when it opened; action and render receive it.
async function loadPanel(title, action, render) {
  const panel = openPanel(title);
  const view = panel.view;
  if (!(await ensureLive(view))) { if (panel.current()) panelError(panel.body, view.error || t("noLiveSession")); return null; }
  try { const result = await action(view); if (panel.current()) render(view, panel.body, result); }
  catch (error) { if (panel.current()) panelError(panel.body, error); }
  return panel;
}

// /mcp — servers with their state and the actions the terminal offers. Some servers (claude.ai connectors)
// load a few seconds after the session starts, so the open panel refreshes itself.
const MCP_REFRESH_MS = 3000;
let mcpActionRunning = false;
async function showMcpPanel() {
  const panel = await loadPanel(t("mcpServers"), (view) => control(view, "mcp-status"), renderMcp);
  while (panel?.current()) {
    await new Promise((resolve) => setTimeout(resolve, MCP_REFRESH_MS));
    if (!panel.current() || mcpActionRunning || !panel.view.live) continue;
    try { const result = await control(panel.view, "mcp-status"); if (panel.current() && !mcpActionRunning) renderMcp(panel.view, panel.body, result); }
    catch { /* keep the last list */ }
  }
}
function renderMcp(view, body, { servers = [] }) {
  // Keep expanded tool lists and action messages across refreshes.
  const expanded = new Set([...body.querySelectorAll(".mcp-tools[open]")].map((node) => node.dataset.server));
  const messages = [...body.querySelectorAll(":scope > .panel-error, :scope > .mcp-notice")];
  body.replaceChildren(...messages);
  if (!servers.length) { body.append(element("p", "muted", t("mcpNone"))); return; }
  const list = element("div", "mcp-list");
  const run = (button, request) => async () => {
    for (const other of list.querySelectorAll("button")) other.disabled = true;
    button.textContent = t("applying");
    mcpActionRunning = true;
    let result = { servers }, message = null;
    try {
      result = await request();
      if (result.url) {
        void Promise.resolve(persephone.openRawLink(result.url)).catch(() => {});
        message = element("p", "muted mcp-notice", t("mcpAuthOpened", { server: button.dataset.server }));
      }
    } catch (error) { message = element("p", "panel-error", error.message); }
    finally { mcpActionRunning = false; }
    body.replaceChildren(...(message ? [message] : []));
    renderMcp(view, body, result);
  };
  for (const server of servers) {
    const row = element("div", "mcp-server");
    const head = element("div", "mcp-head");
    const stateLabel = t(`mcpStatus.${server.status}`);
    head.append(element("span", `dot ${server.status}`), element("span", "mcp-name", server.name), element("span", "mcp-state", stateLabel.startsWith("mcpStatus.") ? server.status : stateLabel));
    const actions = element("div", "mcp-actions");
    const action = (label, request) => {
      const button = element("button", "", label);
      button.type = "button"; button.dataset.server = server.name;
      button.addEventListener("click", run(button, request));
      actions.append(button);
    };
    if (server.status === "needs-auth") action(t("authenticate"), () => control(view, "mcp-authenticate", { server: server.name }));
    if (server.status !== "disabled") action(t("reconnect"), () => control(view, "mcp-reconnect", { server: server.name }));
    const disabled = server.status === "disabled";
    action(disabled ? t("enable") : t("disable"), () => control(view, "mcp-toggle", { server: server.name, enabled: disabled }));
    head.append(actions);
    row.append(head);
    const meta = [server.scope && t("mcpScope", { scope: server.scope }), server.transport, server.host, server.info].filter(Boolean).join(" · ");
    if (meta) row.append(element("div", "mcp-meta", meta));
    if (server.error) row.append(element("div", "mcp-error", server.error));
    if (server.tools?.length) {
      const tools = element("details", "mcp-tools");
      tools.dataset.server = server.name;
      tools.open = expanded.has(server.name);
      tools.append(element("summary", "", t("mcpTools", { count: server.tools.length })), element("div", "", server.tools.join(", ")));
      row.append(tools);
    }
    list.append(row);
  }
  body.append(list);
}

// /context — what fills the context window, as a stacked bar and a table.
async function showContextPanel() {
  if (!current.channel && !current.id) { showError(t("contextNeedsSession")); return; }
  await loadPanel(t("contextUsage"), (view) => control(view, "context"), renderContext);
}
function renderContext(view, body, { usage }) {
  body.replaceChildren();
  const max = usage.maxTokens || 1;
  body.append(element("p", "", t("contextSummary", { model: usage.model || t("model"), used: formatTokens(usage.totalTokens), max: formatTokens(usage.maxTokens), percent: usage.percentage })));
  const bar = element("div", "context-bar");
  const table = element("table", "context-table");
  const colorFor = (index, kind) => kind === "free" ? "transparent" : kind === "deferred" ? "color-mix(in srgb, var(--p-text-muted) 35%, transparent)" : kind === "buffer" ? "color-mix(in srgb, var(--p-text-muted) 60%, transparent)" : `hsl(${(index * 57 + 200) % 360} 55% 55%)`;
  usage.categories.forEach((category, index) => {
    const color = colorFor(index, category.kind);
    if (category.kind !== "free" && category.kind !== "deferred" && category.tokens) {
      const segment = element("span");
      segment.style.width = `${Math.max(0.4, category.tokens / max * 100)}%`;
      segment.style.background = color;
      segment.title = `${category.name}: ${formatTokens(category.tokens)}`;
      bar.append(segment);
    }
    const row = element("tr", category.kind === "deferred" || category.kind === "free" ? "dim" : "");
    const name = element("td");
    const swatch = element("span", "swatch");
    swatch.style.background = color;
    if (category.kind === "free") swatch.style.border = "1px solid var(--p-border)";
    name.append(swatch, document.createTextNode(category.name));
    if (category.kind === "deferred") name.title = t("deferred");
    row.append(name, element("td", "num", formatTokens(category.tokens)), element("td", "num", `${(category.tokens / max * 100).toFixed(1)}%`));
    table.append(row);
  });
  body.append(bar, table);
  body.append(element("p", "muted", usage.autoCompact ? (usage.autoCompactThreshold ? t("autoCompactAt", { threshold: formatTokens(usage.autoCompactThreshold) }) : t("autoCompactOn")) : t("autoCompactOff")));
  const lines = [];
  if (usage.skills) lines.push(t("skillsLine", { count: usage.skills.count, tokens: formatTokens(usage.skills.tokens) }));
  if (usage.agents?.count) lines.push(t("agentsLine", { count: usage.agents.count, tokens: formatTokens(usage.agents.tokens) }));
  if (lines.length) body.append(element("p", "muted", lines.join(" · ")));
  const section = (title, rows) => {
    if (!rows.length) return;
    const details = element("details");
    const list = element("table", "context-table");
    for (const [label, tokens] of rows) { const row = element("tr"); row.append(element("td", "", label), element("td", "num", formatTokens(tokens))); list.append(row); }
    details.append(element("summary", "", `${title} (${rows.length})`), list);
    body.append(details);
  };
  section(t("memoryFiles"), usage.memoryFiles.map((file) => [file.path, file.tokens]));
  section(t("mcpToolsTitle"), [...usage.mcpTools].sort((a, b) => b.tokens - a.tokens).map((tool) => [tool.server ? `${tool.name} · ${tool.server}` : tool.name, tool.tokens]));
}

// /clear — the terminal starts a fresh conversation in place; here, a new session in the same folder.
// The session it leaves keeps running if it is live; Disconnect in its menu ends it.
function clearSession() {
  showNewSession(current.cwd);
  prompt.focus();
}
function renameActiveSession() {
  if (!current.id) return;
  void renameSession(state.sessions.find((item) => item.id === current.id) || { id: current.id, cwd: current.cwd, title: current.title });
}

$("#accept").addEventListener("click", () => void consentSdk(true));
$("#decline").addEventListener("click", () => void consentSdk(false));
persephone.state.init({ session: null }, { restorableKeys: ["session"] });
showNewSession();
void (async () => {
  const saved = (await persephone.state.get())?.session;
  await refreshDescription();
  if (state.sdkInstalled) void watchSessionList().catch(() => {});
  // A session missing from the list (older than the listing) still resumes by id.
  if (saved?.id && saved.cwd && !current.id && state.sdkInstalled) await openStoredSession(state.sessions.find((item) => item.id === saved.id) || { id: saved.id, cwd: saved.cwd, title: "" });
})().catch((error) => showError(error.message));
// The board's default model and effort settings change what a view that is not running would use.
state.settingsOff = persephone.settings.onChange(({ id }) => {
  if ((id === "default-model" || id === "default-effort") && current && !isLive(current)) void refreshDefaults(current).catch(() => {});
});
