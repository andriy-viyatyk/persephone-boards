"use strict";
applyI18n();

const $ = (selector) => document.querySelector(selector);
const state = { setup: null, capabilities: {}, descriptions: new Map(), catalog: [], defaultProvider: "", description: null, models: [{ id: "", label: "Default", efforts: [] }], defaults: {}, settingsOff: null, sessions: [], allSessions: [], groupIndex: [], sessionsLoaded: false };
let voiceProviders = [];
const voiceCapture = { request: null, descriptions: new Map(), selected: "" };
const sessionsByKey = new Map();
// Sessions deleted on this page, in flight or done (viewKey). A list refresh must never bring one back: a listing
// read while a delete was still removing files can arrive after that delete finished. A failed delete leaves the set.
const pendingDeletes = new Set();
// Master's "nothing to add" reply in a group chat; the service never shares it and history skips it.
const GROUP_PASS = "[[pass]]";
const sessionFor = (id, provider = "") => provider ? sessionsByKey.get(viewKey(id, provider)) : state.sessions.find((item) => item.id === id);
const showError = (message) => { $("#error-text").textContent = message; $("#error").classList.toggle("hidden", !message); };
// Dismissing also clears the chat's stored error, so switching back to it does not bring the message back.
$("#error-close").addEventListener("click", () => { if (current) current.error = ""; showError(""); });
// Transient state line above the prompt; empty (hidden) while the session is ready.
const setStatus = (text = "", busy = false) => { const node = $("#status"); node.textContent = text; node.classList.toggle("busy", busy); node.classList.toggle("hidden", !text); };

// ── Session views ──────────────────────────────────────────────────────────
// Each session the page holds is a view: its own transcript, channel and turn state. Live views (the board runs
// their Claude process) keep running while another view is shown, like terminal tabs. A view that is only being
// read is dropped when you leave it and reloaded from its transcript the next time it opens.
const views = new Set();
const viewsByKey = new Map();
const viewKey = (id, provider) => `${provider || ""}\u0000${id || ""}`;
const participantSessionIds = () => new Set((state.groupIndex || []).flatMap((group) => group.participants.map((participant) => participant.sessionId).filter(Boolean)));
let current = null;
function createView(item = {}) {
  const provider = item.provider || current?.provider || state.defaultProvider || "";
  const view = {
    id: item.id || "", provider, description: state.descriptions.get(provider) || null, cwd: item.cwd || "", title: item.title || "", messages: element("div", "messages hidden"),
    channel: null, follow: null, live: false, busy: false, pendingPrompt: "", liveWaiters: [], controls: new Map(), approvals: new Map(),
    stream: null, lastText: "", thinkingNode: null, tools: new Map(), commandTurn: false, historyToken: 0,
    footer: null, usage: null, sessionCost: 0, statusText: "", statusBusy: false, error: "",
    draft: "", unread: false, stick: true, scrollTop: 0,
    agents: [], agentsChannel: null, selectedAgentId: "", agentViews: new Map(), groupMain: false, groupMode: false, groupLoading: false, groupProfiles: [], groupParticipants: [], groupMessages: [], readOnlyParticipant: item.participant || null,
    model: item.model || "", effort: item.effort || "", defaults: null,
  };
  $("#views").append(view.messages);
  views.add(view);
  if (view.id) viewsByKey.set(viewKey(view.id, view.provider), view);
  return view;
}
const viewFor = (id, provider = "") => id ? (provider ? viewsByKey.get(viewKey(id, provider)) : [...views].find((view) => view.id === id)) || null : null;
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
function parseAuthorHeader(text) {
  const lines = String(text || "").split("\n"), messages = [];
  let author = null, body = [];
  const flush = () => { if (body.length) messages.push({ author, text: body.join("\n") }); body = []; };
  for (const line of lines) {
    const match = /^\[\[from: ([^\]\r\n]{1,80}?)(?: \| role: ([^\]\r\n]{1,80}?))?\]\]$/.exec(line);
    if (match) { flush(); author = { name: match[1], role: match[2] || "" }; }
    else body.push(line);
  }
  flush();
  return messages.length ? messages : [{ author: null, text: String(text || "") }];
}
function addAuthorBadge(node, author, provider = "") {
  if (!author || author.kind === "user") return;
  const badge = element("div", "author-badge");
  badge.dataset.authorName = author.name;
  badge.append(engineIcon(state.descriptions.get(provider), ""), element("span", "", [author.name, author.roleTitle || author.role].filter(Boolean).join(" · ")));
  node.append(badge);
}
function addGroupMessage(view, text, author, options = {}) {
  const node = element("div", `msg ${author?.kind === "user" ? "user" : "agent markdown-body"}${options.notice ? " group-notice" : ""}`);
  addAuthorBadge(node, author, author?.provider || author?.engine || "");
  if (author?.kind === "user") {
    const displayText = String(text || "").split("\n").map((line) => line.startsWith("\\[[from:") ? line.slice(1) : line).join("\n");
    const body = element("div", "group-message-body", displayText);
    node.append(body);
    messageSources.set(node, text);
  } else {
    const body = element("div", "markdown-body");
    renderMarkdown(body, text);
    node.append(body);
    messageSources.set(node, text);
  }
  if (options.summary) {
    const details = element("details", "");
    details.append(element("summary", "", t("group.summaryDisclosure")), element("div", "summary", `${options.summary}${options.reminder ? `\n\n${options.reminder}` : ""}`));
    node.append(details);
  }
  return appendMessage(view, node, options.forceScroll === true);
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

// Typing dots: a reply bubble with three dots lit in turn while the shown session works and no reply text is
// streaming (or waiting on an approval card). One node, placed after the shown view's messages, so it never counts
// as the last message (tool calls group with the message before them).
const typing = element("div", "msg agent typing");
typing.setAttribute("role", "status"); typing.setAttribute("aria-label", t("working"));
typing.append(element("span"), element("span"), element("span"));
function updateTyping() {
  const view = current;
  if (!view || view.selectedAgentId || !view.busy || view.stream || view.approvals.size) { typing.remove(); return; }
  if (typing.previousElementSibling === view.messages) return;
  const stick = nearBottom();
  view.messages.after(typing);
  scrollToEnd(stick);
}

function startStream(view) {
  view.stream = { node: addAgentMessage(view, ""), text: "", frame: 0 };
  view.stream.node.classList.add("streaming");
  updateTyping();
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
  updateTyping();
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
function updateFooter(status, view = current) {
  if (!capabilities(view).rateLimits) { setChip("limits", ""); return; }
  const limits = [["limit5h", "fiveHour", "5h"], ["limit7d", "sevenDay", "7d"]]
    .map(([id, key, label]) => ({ id, label, limit: status.limits?.[key] })).filter((entry) => entry.limit);
  setChip("limits", limits.map(({ label, limit }) => `${label} ${limit.percent}%`).join(`  ${DIVIDER}  `), {
    tone: percentTone(Math.max(0, ...limits.map(({ limit }) => limit.percent))),
    title: limits.map(({ id, limit }) => resetsTitle(t(id), limit.resetsAt)).join("\n"),
  });
}
function updateFooterUsage(usage, sessionCost, view = current) {
  if (!usage) return;
  setChip("tokens", capabilities(view).tokenUsage ? formatUsage({ ...usage, costUsd: undefined }) : "", { title: t("lastTurnTokens") });
  setChip("turnCost", capabilities(view).costUsage && Number.isFinite(usage.costUsd) ? `$${usage.costUsd.toFixed(4)}` : "", { title: t("lastTurnCost") });
  setChip("sessionCost", capabilities(view).costUsage && sessionCost ? `${t("session")} $${sessionCost.toFixed(2)}` : "", { title: t("sessionCost") });
  updateDividers();
}
// The footer shows the view on screen; each view keeps its last status and usage.
function renderFooter(view) {
  resetFooter();
  if (view.footer) updateFooter(view.footer, view);
  updateFooterUsage(view.usage, view.sessionCost, view);
}

// ── Service channels ───────────────────────────────────────────────────────
const channelSend = async (channel, message) => {
  if (!channel.writable) await channel.whenWritable();
  channel.send(message);
};
// A session's state marker: the engine icon its description names (icons/<icon>.svg, drawn as a mask so CSS colors it)
// in the engine's iconColor, or the plain dot when the description has no icon.
function engineIcon(description, stateClass, group = false) {
  const icon = group ? "group" : /^[a-z0-9-]{1,40}$/.test(description?.icon || "") ? description.icon : "";
  const marker = element("span", `${icon ? "engine-icon" : "session-dot"} ${stateClass}`.trim());
  if (group) { marker.setAttribute("role", "img"); marker.setAttribute("aria-label", t("group.iconLabel")); }
  if (icon) marker.style.setProperty("--engine-icon", `url("icons/${icon}.svg")`);
  if (icon && /^#[0-9a-f]{6}$/i.test(description.iconColor || "")) marker.style.setProperty("--engine-color", description.iconColor);
  return marker;
}
// A request with provider: null goes to the service unrouted (list-sessions then merges every engine).
async function discovery(request) {
  const { provider, ...rest } = request;
  const routed = provider === null ? null : provider || current?.provider || state.defaultProvider;
  const channel = await persephone.service.openChannel({ ...rest, ...(routed ? { provider: routed } : {}) });
  return new Promise((resolve) => {
    channel.onMessage((message) => resolve({ message, channel }));
    channel.onClose(() => resolve({ message: null, channel }));
  });
}
function applyDescription(message, view = null) {
  const provider = message.provider || "";
  state.descriptions.set(provider, message);
  if (Array.isArray(message.catalog)) {
    state.catalog = message.catalog;
    for (const item of state.catalog) if (item?.provider) state.descriptions.set(item.provider, item);
  }
  state.defaultProvider ||= provider;
  if (view) view.description = message; else state.description = message;
  state.capabilities = message.capabilities || {};
  state.setup = message.setup || { required: false, ready: true };
  if (message.models?.length) state.models = message.models;
  if (view) view.defaults = message.defaults || null;
  else if (message.defaults) state.defaults = message.defaults;
  renderChips();
}
const openViewChannel = (view, request) => persephone.service.openChannel({ ...request, ...(view?.provider ? { provider: view.provider } : {}) });
async function refreshDescription() {
  const { message } = await discovery({ type: "describe", ...(current?.provider ? { provider: current.provider } : {}) });
  if (message?.type === "description") {
    applyDescription(message, current?.provider ? current : null);
    if (current && !current.id && !current.channel && !current.provider) {
      current.provider = state.defaultProvider;
      current.description = state.descriptions.get(current.provider) || message;
    }
  }
  const caps = capabilities();
  $("#consent").classList.toggle("hidden", !caps.providerSetup || state.setup?.ready !== false);
  if (caps.sessionStore && !state.sessions.length) await refreshSessions();
  // No session store, or no description at all: nothing more will load, so drop the spinner.
  else if (!state.sessionsLoaded && (!caps.sessionStore || message?.type !== "description")) { state.sessionsLoaded = true; renderSessions(); }
}
// Defaults depend on the folder (its project and local Claude settings), so a view not yet running asks for its own.
async function refreshDefaults(view) {
  const cwd = view.cwd || (view.id ? "" : $("#cwd").value.trim());
  const { message } = await discovery({ type: "describe", ...(view.provider ? { provider: view.provider } : {}), ...(cwd ? { cwd } : {}) });
  if (message?.type === "description") applyDescription(message, view);
}
function capabilities(view = current) { return view?.description?.capabilities || state.description?.capabilities || {}; }
function providerDescription(view = current) { return view?.description || state.description || {}; }

// ── Model and effort chips under the composer ──────────────────────────────
// A view uses the model and effort picked for it, or else the defaults the service reports (the board settings,
// then Claude Code's own settings, then Opus at medium effort). A session the board runs reports what it uses.
const isLive = (view) => Boolean(view?.channel && view.live);
// Listed ids show their display names; a full model id such as "claude-opus-5-5" shows as "Opus 5.5".
function modelLabel(id, models = state.models) {
  const listed = models.find((model) => model.id === id);
  if (listed?.label) return listed.label.replace(/\s*\(CLI alias\)$/, "");
  return id || t("default");
}
const viewDefaults = (view) => view.defaults || providerDescription(view).defaults || state.defaults;
const viewModel = (view) => (isLive(view) && view.footer?.model) || view.model || viewDefaults(view).model || "";
const viewEffort = (view) => (isLive(view) && view.footer?.effort) || view.effort || viewDefaults(view).effort || "";
// Permission modes the page offers, as the terminal names them; a running session reports its own (which may be
// another one, such as "default" after a typed command). Every new chat starts in Auto; the last pick is not kept.
const modeDescriptors = (view = current) => providerDescription(view).chatOptions?.permissionModes || [];
const modeDescriptor = (id, view = current) => modeDescriptors(view).find((mode) => mode.id === id);
const viewMode = (view) => (isLive(view) && view.footer?.mode) || view.mode || viewDefaults(view).mode || modeDescriptors(view)[0]?.id || "";
function renderChips() {
  const view = current;
  $("#composer-meta").classList.toggle("hidden", !view || Boolean(view.selectedAgentId));
  if (!view) return;
  const mode = viewMode(view), selectedMode = modeDescriptor(mode, view);
  $("#mode-chip").textContent = selectedMode?.labelKey ? t(selectedMode.labelKey) : "";
  $("#mode-chip").dataset.mode = mode;
  const models = providerDescription(view).models || state.models;
  const engine = $("#engine-chip");
  engine.textContent = providerDescription(view).providerLabel || t(providerDescription(view).providerLabelKey || "provider.claude");
  engine.classList.toggle("hidden", Boolean(view.id || view.channel) || state.catalog.length < 2);
  $("#model-chip").textContent = (isLive(view) && view.footer?.modelLabel) || modelLabel(viewModel(view), models);
  $("#model-chip").classList.toggle("hidden", !capabilities().modelSelection);
  $("#effort-chip").classList.toggle("hidden", !capabilities().effortSelection);
  $("#mode-chip").classList.toggle("hidden", !capabilities().permissionModes);
  $("#effort-chip").textContent = viewEffort(view) || t("defaultEffort");
  // Context fill, from the session's last status; it highlights at 70% and 90% like the footer's limit chips.
  const status = view.footer || {};
  const chip = $("#context-chip");
  chip.textContent = capabilities(view).contextUsage ? Number.isFinite(status.contextPercent) ? `${t("context")} ${status.contextPercent}%` : Number.isFinite(status.contextTokens) ? `${t("context")} ${formatTokens(status.contextTokens)}` : "" : "";
  chip.classList.toggle("hidden", !chip.textContent);
  chip.dataset.tone = percentTone(status.contextPercent || 0);
  chip.title = capabilities(view).contextUsage && status.contextWindow ? `${(status.contextTokens || 0).toLocaleString()} / ${status.contextWindow.toLocaleString()} ${t("tokens")}` : t("context");
  const canInvite = Boolean(view && !view.selectedAgentId && !view.readOnlyParticipant);
  $("#group-invite").classList.toggle("hidden", !canInvite);
  $("#group-stop").classList.toggle("hidden", !view.groupMain || !view.channel || view.groupLoading || !view.groupParticipants.length);
}
function groupProfiles(view = current) { return view?.groupProfiles ?? state.profiles ?? []; }
function profileAvailability(profile) {
  const description = state.descriptions.get(profile.provider);
  if (!description || description.available === false || (profile.provider === "claude" && !description.setup?.ready)) return { available: false, reason: t("profiles.providerUnavailable") };
  const alias = profile.provider === "claude" && ["opus", "sonnet", "haiku"].includes(profile.model);
  if (!alias && !(description.models || []).some((model) => model.id === profile.model)) return { available: false, reason: t("profiles.modelUnavailable") };
  return { available: true, reason: "" };
}
function renderParticipantBadges(view = current) {
  for (const badge of view?.messages.querySelectorAll(".author-badge[data-author-name]") || []) {
    const participant = state.groupIndex.find((group) => group.mainSessionId === (view.readOnlyParticipant?.mainSessionId || view.id))?.participants.find((item) => item.name === badge.dataset.authorName);
    const provider = badge.dataset.authorName === "Master" ? view.provider : participant?.provider;
    if (!provider) continue;
    const label = badge.querySelector("span:last-child")?.textContent || badge.dataset.authorName;
    badge.replaceChildren(engineIcon(state.descriptions.get(provider), ""), element("span", "", label));
  }
}
async function ensureGroupChannel(view) {
  if (view.channel && view.groupMain && !view.groupLoading) return true;
  if (!view.cwd && !view.id) view.cwd = $("#cwd").value.trim();
  if (!view.cwd && !view.id) { setViewError(view, t("cwdRequired")); return false; }
  if (!view.channel) {
    view.groupLoading = true;
    const ready = new Promise((resolve) => view.liveWaiters.push(resolve));
    if (!(await connect(view))) return false;
    if (!(await ready)) return false;
  }
  if (view.groupLoading) await new Promise((resolve) => (view.groupDataWaiters ||= []).push(resolve));
  return Boolean(view.channel && view.groupMain);
}
async function inviteProfile(view, profile) {
  if (!(await ensureGroupChannel(view))) return;
  const historyText = view.groupMessages.map((item) => `${authorHeaderForUi(item.author)}\n${item.text}`).join("\n\n");
  await channelSend(view.channel, { type: "group", action: "invite", profileId: profile.id, historyText });
}
function authorHeaderForUi(author) { return author?.roleTitle || author?.role ? `[[from: ${author.name} | role: ${author.roleTitle || author.role}]]` : `[[from: ${author?.name || "user"}]]`; }
async function openInviteMenu() {
  if (!current) return;
  await refreshProfileCatalog();
  const view = current, profiles = groupProfiles(view);
  // A history-only chat has no live roster yet; the sidebar index knows who already joined.
  const participants = view.groupParticipants?.length ? view.groupParticipants : (state.groupIndex.find((group) => group.mainSessionId === view.id)?.participants || []).filter((item) => !item.removed);
  const items = profiles.map((profile) => {
    const duplicate = participants.some((item) => item.profileId === profile.id || item.name.toLowerCase() === profile.name.toLowerCase());
    const availability = profileAvailability(profile);
    const reason = duplicate ? t("profiles.alreadyJoined") : availability.reason;
    return { label: `${profile.name} (${profile.roleTitle})`, desc: reason, disabled: Boolean(reason), reason, run: () => inviteProfile(view, profile) };
  });
  items.push({ label: t("profiles.editAgents"), run: () => openConfig("profiles") });
  openChoiceMenu($("#group-invite"), items);
}
$("#group-invite").addEventListener("click", () => void openInviteMenu().catch((error) => showError(error.message || t("profiles.error"))));
$("#group-stop").addEventListener("click", () => current?.channel && void channelSend(current.channel, { type: "group", action: "stop-all" }));
$("#group-stop").addEventListener("click", () => void refreshSessions());
const choiceMenu = $("#choice-menu");
let choiceAnchor = null;
function closeChoiceMenu() { choiceMenu.classList.add("hidden"); choiceAnchor?.classList.remove("open"); choiceAnchor = null; }
// A small menu above a chip; each item is { label, desc, current, disabled, run }.
function openChoiceMenu(anchor, items, note = "") {
  closeChoiceMenu();
  choiceMenu.replaceChildren(...items.map((item) => {
    const button = element("button", item.current ? "current" : "");
    button.type = "button"; button.disabled = Boolean(item.disabled);
    if (item.disabled && item.reason) button.title = item.reason;
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
function changeEngine(view, description) {
  if (!view || !description?.provider || view.id || view.channel) return;
  view.provider = description.provider;
  view.description = description;
  view.model = "";
  view.effort = "";
  view.mode = description.defaults?.mode || "";
  view.defaults = description.defaults || {};
  rememberSession();
  renderChips();
  void refreshDefaults(view).catch(() => {});
}
function showEngineMenu() {
  const view = current, anchor = $("#engine-chip");
  if (!view || view.id || view.channel || state.catalog.length < 2) return;
  if (choiceAnchor === anchor) { closeChoiceMenu(); return; }
  const items = state.catalog.map((description) => ({
    label: description.providerLabel || t(description.providerLabelKey || "provider.claude"),
    desc: description.available === false ? t(description.unavailableReasonKey || "providerUnavailable") : "",
    current: description.provider === view.provider,
    disabled: description.available === false,
    run: () => changeEngine(view, description),
  }));
  openChoiceMenu(anchor, items);
}
document.addEventListener("mousedown", (event) => { if (choiceAnchor && !choiceMenu.contains(event.target) && !choiceAnchor.contains(event.target)) closeChoiceMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && choiceAnchor) closeChoiceMenu(); });
// A running session lists its own models and answers which one it uses; a view that is not running uses the
// service's listing and applies the choice when the session starts or resumes.
async function modelListing(view) {
  if (isLive(view)) { const result = await control(view, "models"); return { models: result.models || [], selected: result.current }; }
  await refreshDefaults(view);
  return { models: providerDescription(view).models || state.models, selected: viewModel(view) };
}
// Like the terminal, a running session changes model or effort only between turns.
async function showModelMenu() {
  if (!capabilities().modelSelection) return;
  const view = current, anchor = $("#model-chip");
  if (choiceAnchor === anchor) { closeChoiceMenu(); return; }
  const live = isLive(view);
  const { models, selected } = await modelListing(view);
  if (view !== current) return;
  const groups = live ? [{ description: providerDescription(view), models }] : (state.catalog.length ? state.catalog.filter((description) => description.capabilities?.modelSelection).map((description) => ({ description, models: description.models || [] })) : [{ description: providerDescription(view), models }]);
  openChoiceMenu(anchor, groups.flatMap(({ description, models: groupModels }) => description.available === false ? [{ label: description.providerLabel || t(description.providerLabelKey || "provider.claude"), desc: t(description.unavailableReasonKey || "providerUnavailable"), disabled: true, run: () => {} }] : groupModels.filter((model) => model.id && model.id !== "default").map((model) => ({
    label: `${description.providerLabel || t(description.providerLabelKey || "provider.claude")} · ${modelLabel(model.id, groupModels)}`, desc: model.description || "", current: description.provider === view.provider && model.id === selected, disabled: live && view.busy,
    run: async () => {
      if (description.provider !== view.provider) changeEngine(view, description);
      if (live) { await control(view, "set-model", { model: model.id }); addDivider(view, t("modelSet", { model: modelLabel(model.id, groupModels) })); return; }
      view.model = model.id;
      const efforts = model.efforts || [];
      if (efforts.length && !efforts.includes(viewEffort(view))) view.effort = efforts.includes("medium") ? "medium" : efforts[0];
      renderChips();
    },
  }))), live ? t(view.busy ? "changeBusy" : "modelSwitchNote") : "");
}
async function showEffortMenu() {
  if (!capabilities().effortSelection) return;
  const view = current, anchor = $("#effort-chip");
  if (choiceAnchor === anchor) { closeChoiceMenu(); return; }
  const live = isLive(view);
  const { models, selected } = await modelListing(view);
  if (view !== current) return;
  if (!capabilities(view).effortSelection) return;
  const efforts = models.find((model) => model.id === selected)?.efforts || [];
  const effort = viewEffort(view);
  if (!efforts.length) return;
  openChoiceMenu(anchor, efforts.map((level) => ({
    label: level, current: level === effort, disabled: live && view.busy,
    run: async () => {
      // The CLI applies /effort to the running session only and answers with a confirmation line.
      if (live) {
        if (capabilities(view).slashCommands) await sendPrompt(view, `/effort ${level}`);
        else await control(view, "set-effort", { effort: level });
        return;
      }
      view.effort = level; renderChips();
    },
  })), live && view.busy ? t("changeBusy") : "");
}
// Unlike model and effort, the terminal switches modes mid-turn too (Shift+Tab), so the menu never waits.
function showModeMenu() {
  const view = current, anchor = $("#mode-chip");
  if (choiceAnchor === anchor) { closeChoiceMenu(); return; }
  const live = isLive(view), mode = viewMode(view);
  if (!capabilities(view).permissionModes) return;
  openChoiceMenu(anchor, modeDescriptors(view).map((descriptor) => ({
    label: t(descriptor.labelKey), desc: t(descriptor.descriptionKey), current: descriptor.id === mode,
    run: async () => {
      if (live) { await control(view, "set-mode", { mode: descriptor.id }); return; }
      view.mode = descriptor.id; renderChips();
    },
  })), live ? t("modeNote") : "");
}
$("#mode-chip").addEventListener("click", () => showModeMenu());
$("#engine-chip").addEventListener("click", () => showEngineMenu());
$("#context-chip").addEventListener("click", () => void showContextPanel().catch((error) => showError(error.message)));
$("#model-chip").addEventListener("click", () => void showModelMenu().catch((error) => showError(error.message)));
$("#effort-chip").addEventListener("click", () => void showEffortMenu().catch((error) => showError(error.message)));
$("#cwd").addEventListener("change", () => { if (current && !current.id) void refreshDefaults(current).catch(() => {}); });
// Persephone's own Select Folder dialog, reached through the app scripting the board already holds. The dialog waits
// for the user, so the call gets an hour instead of the bridge's 30-second default.
$("#cwd-browse").innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>';
$("#cwd-browse").addEventListener("click", async () => {
  const input = $("#cwd");
  try {
    const folders = await persephone.call("fs.showFolderDialog", { args: [{ title: t("cwd"), ...(input.value.trim() ? { defaultPath: input.value.trim() } : {}) }], timeoutMs: 3_600_000 });
    if (!folders?.length) return;
    input.value = folders[0];
    input.dispatchEvent(new Event("change"));
    prompt.focus();
  } catch (error) { showError(error.message); }
});

async function consentSdk(accept) {
  $("#accept").disabled = true;
  if (!accept) { $("#consent").classList.add("hidden"); $("#accept").disabled = false; return; }
  const provider = current?.provider || state.defaultProvider;
  const channel = await persephone.service.openChannel({ type: "provider-setup", action: "install", ...(provider ? { provider } : {}) });
  channel.onMessage(async (message) => {
    if (message.type === "provider-setup") {
      if (message.ready === false) { showError(message.error || t("error")); $("#accept").disabled = false; return; }
      $("#consent").classList.add("hidden"); await refreshDescription();
    }
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
  const hiddenParticipants = participantSessionIds();
  const rows = state.sessions.filter((item) => !hiddenParticipants.has(item.id));
  list.replaceChildren();
  // Until the first listing arrives (the service starts and every engine answers), show a spinner, not an empty panel.
  if (!state.sessionsLoaded) {
    const loading = element("div", "loading");
    loading.append(element("span", "spinner"), element("span", "", t("loadingSessions")));
    list.append(loading);
    return;
  }
  if (!capabilities().sessionStore) { renderAgents(); return; }
  if (!rows.length) {
    if (state.setup) list.append(element("div", "empty", t(state.setup.ready ? "noSessions" : "consentRequired")));
    renderAgents();
    return;
  }
  const groups = sessionGroups(rows);
  if (!folderTreeSeeded) { folderTreeSeeded = true; expandedFolders.add(groups[0].key); }
  for (const group of groups) {
    const expanded = expandedFolders.has(group.key);
    const folder = element("div", `folder${expanded ? " expanded" : ""}`);
    const head = element("div", "folder-head");
    // A transcript with no messages (only metadata lines) records no working directory; its folder says so.
    head.title = group.cwd || t("noFolderHint");
    const toggle = element("button", "folder-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.append(element("span", "caret"), element("span", `folder-name${group.cwd ? "" : " no-folder"}`, group.cwd ? folderName(group.cwd) : t("noFolder")));
    // A collapsed folder still shows that one of its sessions is running.
    const running = group.sessions.map((item) => viewFor(item.id, item.provider)).filter((view) => view?.channel);
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
        const view = viewFor(item.id, item.provider);
        const button = element("button", `session-item${item.id && item.id === current?.id ? " active" : ""}${view?.unread ? " unread" : ""}`);
        button.type = "button";
        // The engine's icon, gray when not running, green when the board runs it (pulsing while the agent works).
        const dotState = view?.channel ? (view.busy ? "live busy" : "live") : "";
        const providerInfo = state.descriptions.get(item.provider || "");
        const engine = providerInfo ? providerInfo.providerLabel || t(providerInfo.providerLabelKey) : "";
        button.title = [item.title, engine, formatWhenExact(item.updatedAt), t(view?.channel ? (view.busy ? "sessionWorking" : "sessionLive") : "sessionIdle")].filter(Boolean).join("\n");
        const group = state.groupIndex.find((entry) => entry.mainSessionId === item.id);
        const hasParticipants = Boolean(group?.participants.some((participant) => !participant.removed));
        // A connected session also gets a green dot laid over the icon's left edge, so the row keeps its spacing.
        const marker = element("span", "session-marker");
        marker.append(engineIcon(providerInfo, dotState, hasParticipants));
        if (view?.channel) marker.append(element("span", "connected-dot"));
        button.append(marker, element("span", "title", item.title), element("span", "when", formatWhen(item.updatedAt)));
        button.addEventListener("click", () => void openStoredSession(item));
        button.addEventListener("contextmenu", (event) => { event.preventDefault(); openSessionMenu(item, event.clientX, event.clientY); });
        folder.append(button);
        if (group) for (const participant of group.participants) {
          const session = state.allSessions.find((candidate) => candidate.id === participant.sessionId);
          const child = element("button", `session-item participant-item${participant.removed ? " removed" : ""}${current?.readOnlyParticipant?.sessionId === participant.sessionId ? " active" : ""}`);
          child.type = "button"; child.title = participant.removed ? t("group.participantLeft") : t("group.participantHistory", { name: participant.name, role: participant.roleTitle });
          const provider = state.descriptions.get(participant.provider || "");
          child.append(engineIcon(provider, "", false), element("span", "title", `${participant.name} · ${participant.roleTitle}${participant.removed ? ` · ${t("group.leftState")}` : ""}`), element("span", "when", formatWhen(session?.updatedAt || "")));
          child.addEventListener("click", () => void openParticipantSession(item, participant, session));
          child.addEventListener("contextmenu", (event) => {
            if (participant.removed) return;
            event.preventDefault();
            void (async () => {
              const parentView = viewFor(item.id, item.provider);
              if (!parentView?.channel) { showError(t("group.openMainToRemove")); return; }
              const answer = await askDialog({ title: t("group.removeTitle"), message: t("group.removeConfirm", { name: participant.name }), confirmLabel: t("group.remove"), danger: true });
              if (answer !== null) { await channelSend(parentView.channel, { type: "group", action: "remove", participantId: participant.id }); await refreshSessions(); }
            })();
          });
          folder.append(child);
        }
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
  if (!capabilities(current).subagents) { panel.classList.add("hidden"); return; }
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
  const live = Boolean(viewFor(item.id, item.provider)?.channel);
  sessionMenu.querySelector("[data-action=disconnect]").classList.toggle("hidden", !live);
  sessionMenu.querySelector("[data-action=connect]").classList.toggle("hidden", live || Boolean(item.participant) || !capabilities(viewFor(item.id, item.provider)).sessionStore);
  sessionMenu.querySelectorAll("[data-action=rename], [data-action=delete]").forEach((button) => button.classList.toggle("hidden", !capabilities(viewFor(item.id, item.provider)).sessionStore));
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
  if (item && action === "disconnect") { const view = viewFor(item.id, item.provider); if (view) disconnect(view); }
  if (item && action === "connect") void connectStoredSession(item);
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
let profileEditor = { profiles: [], descriptions: [], selectedId: "", original: null, dirty: false, newIds: new Set() };
async function profileRequest(action, fields = {}) {
  const channel = await persephone.service.openChannel({ type: "manage-profiles", action, ...fields });
  return new Promise((resolve, reject) => {
    channel.onMessage((message) => {
      if (message.type === "profile-data") resolve(message);
      else if (message.type === "profile-error" || message.type === "error") reject(new Error(t("profiles.error")));
    });
    channel.onClose(() => {});
  });
}
async function refreshProfileCatalog() {
  const response = await profileRequest("get");
  state.profiles = response.profiles || [];
  for (const description of response.descriptions || []) { state.descriptions.set(description.provider, description); if (!state.catalog.some((item) => item.provider === description.provider)) state.catalog.push(description); }
  if (current) current.groupProfiles = state.profiles;
}
function profileDraft() {
  const currentProfile = profileEditor.profiles.find((profile) => profile.id === profileEditor.selectedId);
  if (!currentProfile) return null;
  return { id: currentProfile.id, name: $("#profile-name").value.trim(), roleTitle: $("#profile-role-title").value.trim(), instructions: $("#profile-instructions").value, summary: $("#profile-summary").value, provider: $("#profile-provider").value, model: $("#profile-model").value, effort: $("#profile-effort").value, permissionMode: $("#profile-permission").value };
}
function setProfileDirty() {
  profileEditor.dirty = JSON.stringify(profileDraft()) !== JSON.stringify(profileEditor.original);
  $("#profiles-warning").classList.toggle("hidden", !["ask", "auto-edit", "full-auto"].includes($("#profile-permission").value));
}
function profileProviderOptions() {
  const select = $("#profile-provider");
  select.replaceChildren(...state.catalog.map((description) => { const option = element("option", "", description.providerLabel || t(description.providerLabelKey)); option.value = description.provider; return option; }));
}
function refreshProfileModels(preferredModel = "", preferredEffort = "") {
  const provider = $("#profile-provider").value, description = state.descriptions.get(provider);
  let models = (description?.models || []).filter((model) => model.id);
  if (provider === "claude") models = [{ id: "opus", label: t("model.alias.opus"), efforts: ["low", "medium", "high", "xhigh", "max"] }, { id: "sonnet", label: t("model.alias.sonnet"), efforts: ["low", "medium", "high", "xhigh", "max"] }, { id: "haiku", label: t("model.alias.haiku"), efforts: ["low", "medium", "high", "xhigh", "max"] }, ...models.filter((item) => !["opus", "sonnet", "haiku"].includes(item.id))];
  const modelSelect = $("#profile-model");
  modelSelect.replaceChildren(...models.map((model) => { const option = element("option", "", model.label || model.id); option.value = model.id; return option; }));
  if (models.some((model) => model.id === preferredModel)) modelSelect.value = preferredModel;
  refreshProfileEfforts(preferredEffort);
}
function refreshProfileEfforts(preferred = "") {
  const info = state.descriptions.get($("#profile-provider").value)?.models?.find((item) => item.id === $("#profile-model").value);
  const levels = info?.efforts || (["opus", "sonnet", "haiku"].includes($("#profile-model").value) ? ["low", "medium", "high", "xhigh", "max"] : []);
  const select = $("#profile-effort");
  select.replaceChildren(...levels.map((level) => { const option = element("option", "", level); option.value = level; return option; }));
  if (levels.includes(preferred)) select.value = preferred;
}
function renderProfileEditor() {
  const list = $("#profiles-list");
  list.replaceChildren(...profileEditor.profiles.map((profile) => {
    const item = element("button", `profile-list-item${profile.id === profileEditor.selectedId ? " active" : ""}`, `${profile.name} (${profile.roleTitle})`);
    item.type = "button"; item.addEventListener("click", () => void selectProfile(profile.id)); return item;
  }));
  const profile = profileEditor.profiles.find((item) => item.id === profileEditor.selectedId);
  const permission = $("#profile-permission");
  permission.replaceChildren(...[["read-only", t("profiles.permission.readOnly")], ["ask", t("profiles.permission.ask")], ["auto-edit", t("profiles.permission.autoEdit")], ["full-auto", t("profiles.permission.fullAuto")]].map(([value, label]) => { const option = element("option", "", label); option.value = value; return option; }));
  const disabled = !profile;
  for (const id of ["profile-name", "profile-role-title", "profile-instructions", "profile-summary", "profile-provider", "profile-model", "profile-effort", "profile-permission", "profile-duplicate", "profile-delete"]) $("#" + id).disabled = disabled;
  updateConfigSave();
  if (!profile) return;
  $("#profile-name").value = profile.name; $("#profile-role-title").value = profile.roleTitle;
  $("#profile-instructions").value = profile.instructions; $("#profile-summary").value = profile.summary;
  profileProviderOptions(); $("#profile-provider").value = profile.provider;
  refreshProfileModels(profile.model, profile.effort); $("#profile-permission").value = profile.permissionMode;
  profileEditor.original = structuredClone(profile); profileEditor.dirty = false; setProfileDirty();
}
async function saveSelectedProfile() {
  const profile = profileDraft();
  if (!profile || !profile.name || !profile.roleTitle || !profile.instructions.trim() || !profile.summary.trim()) { showError(t("profiles.validation")); return false; }
  try {
    const result = await profileRequest("save", { profile });
    profileEditor.profiles = result.profiles || []; profileEditor.selectedId = result.selectedId || profile.id;
    profileEditor.newIds.delete(profile.id);
    state.profiles = profileEditor.profiles; if (current) current.groupProfiles = state.profiles;
    renderProfileEditor(); return true;
  } catch (error) { showError(error.message); return false; }
}
async function unsavedChoice(dirty = profileEditor.dirty, titleKey = "profiles.unsavedTitle") {
  if (!dirty) return "discard";
  return new Promise((resolve) => {
    const dialog = $("#dialog"), confirm = $("#dialog-confirm"), form = dialog.querySelector("form");
    const stay = element("button", "", t("profiles.stay")); stay.type = "button"; form.querySelector(".actions").prepend(stay);
    stay.onclick = () => { stay.remove(); dialog.close("stay"); };
    $("#dialog-title").textContent = t(titleKey); $("#dialog-message").textContent = t("profiles.unsavedMessage"); $("#dialog-message").classList.remove("hidden"); $("#dialog-input").classList.add("hidden");
    const cancel = form.querySelector('button[value="cancel"]'); cancel.textContent = t("profiles.discard");
    confirm.textContent = t("save"); confirm.classList.add("primary"); dialog.returnValue = ""; dialog.showModal();
    dialog.addEventListener("close", () => { stay.remove(); cancel.textContent = t("cancel"); resolve(dialog.returnValue === "confirm" ? "save" : dialog.returnValue === "stay" ? "stay" : "discard"); }, { once: true });
  });
}
async function selectProfile(id) {
  const choice = await unsavedChoice(); if (choice === "stay") return;
  if (choice === "save" && !(await saveSelectedProfile())) return;
  if (choice === "discard" && profileEditor.newIds.has(profileEditor.selectedId)) {
    profileEditor.profiles = profileEditor.profiles.filter((profile) => profile.id !== profileEditor.selectedId);
    profileEditor.newIds.delete(profileEditor.selectedId);
  }
  profileEditor.selectedId = id; renderProfileEditor();
}
$("#profile-new").addEventListener("click", () => {
  void (async () => { const choice = await unsavedChoice(); if (choice === "stay" || choice === "save" && !(await saveSelectedProfile())) return;
    const profile = { id: crypto.randomUUID(), name: "", roleTitle: "", instructions: "", summary: "", provider: "claude", model: "opus", effort: "medium", permissionMode: "read-only" };
    profileEditor.profiles.push(profile); profileEditor.newIds.add(profile.id); profileEditor.selectedId = profile.id; renderProfileEditor(); $("#profile-name").focus();
  })();
});
$("#profile-duplicate").addEventListener("click", async () => { const choice = await unsavedChoice(); if (choice === "stay") return; if (choice === "save" && !(await saveSelectedProfile())) return; const result = await profileRequest("duplicate", { profileId: profileEditor.selectedId }); profileEditor.profiles = result.profiles; profileEditor.selectedId = result.selectedId; state.profiles = result.profiles; renderProfileEditor(); });
$("#profile-delete").addEventListener("click", async () => { const choice = await unsavedChoice(); if (choice === "stay") return; if (choice === "save" && !(await saveSelectedProfile())) return; if (await askDialog({ title: t("profiles.deleteTitle"), message: t("profiles.deleteConfirm"), confirmLabel: t("profiles.delete"), danger: true }) === null) return; const result = await profileRequest("delete", { profileId: profileEditor.selectedId }); profileEditor.profiles = result.profiles; state.profiles = result.profiles; profileEditor.selectedId = result.profiles[0]?.id || ""; renderProfileEditor(); });
$("#profile-reset").addEventListener("click", async () => { const choice = await unsavedChoice(); if (choice === "stay") return; if (choice === "save" && !(await saveSelectedProfile())) return; if (await askDialog({ title: t("profiles.resetTitle"), message: t("profiles.resetConfirm"), confirmLabel: t("profiles.reset"), danger: true }) === null) return; const result = await profileRequest("reset"); profileEditor.profiles = result.profiles; state.profiles = result.profiles; profileEditor.selectedId = result.profiles[0]?.id || ""; renderProfileEditor(); });
for (const id of ["profile-name", "profile-role-title", "profile-instructions", "profile-summary", "profile-permission"]) $("#" + id).addEventListener("input", setProfileDirty);
$("#profile-permission").addEventListener("change", setProfileDirty);
$("#profile-provider").addEventListener("change", () => { refreshProfileModels(); setProfileDirty(); });
$("#profile-model").addEventListener("change", () => { refreshProfileEfforts(); setProfileDirty(); });
// Enter would submit through the form's first button (Cancel); make it confirm instead.
$("#dialog-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); $("#dialog").close("confirm"); }
});
async function manageSession(item, action, title) {
  if (!capabilities(viewFor(item.id, item.provider) || current).sessionStore) return false;
  const { message } = await discovery({ type: "manage-session", ...(item.provider ? { provider: item.provider } : {}), action, sessionId: item.id, cwd: item.cwd, ...(title ? { title } : {}) });
  if (message?.type === "session-updated") return true;
  showError(message?.type === "error" ? `${message.code}: ${message.message}` : t("error"));
  return false;
}
async function renameSession(item) {
  const title = await askDialog({ title: t("renameSession"), value: item.title, confirmLabel: t("save") });
  if (!title || title === item.title) return;
  if (!(await manageSession(item, "rename", title))) return;
  item.title = title;
  const view = viewFor(item.id, item.provider);
  if (view) view.title = title;
  renderSessions();
}
async function deleteSession(item) {
  const answer = await askDialog({ title: t("deleteSession"), message: t("deleteConfirm", { title: item.title }), confirmLabel: t("delete"), danger: true });
  if (answer === null) return;
  await removeSession(item);
}
async function removeSession(item) {
  const view = viewFor(item.id, item.provider);
  if (view) { if (view === current) showNewSession(); dropView(view); }
  // The row goes at once: the service may first have to end a running session (up to ~2 s) or start
  // an engine's discovery server. If the delete fails, the row comes back and the error shows.
  const key = viewKey(item.id, item.provider);
  pendingDeletes.add(key);
  state.sessions = state.sessions.filter((row) => viewKey(row.id, row.provider) !== key);
  sessionsByKey.delete(key);
  renderSessions();
  if (await manageSession(item, "delete")) return;
  pendingDeletes.delete(key);
  state.sessions = [...state.sessions.filter((row) => viewKey(row.id, row.provider) !== key), item].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  sessionsByKey.set(key, item);
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
// Refreshes can overlap (watcher, Refresh, a description change); only the newest listing is applied, so an
// older answer that arrives late never replaces a newer one.
let sessionsRequest = 0;
async function refreshSessions() {
  if (!capabilities().sessionStore) { state.sessionsLoaded = true; renderSessions(); return; }
  const request = ++sessionsRequest;
  const [sessionsResult, indexResult] = await Promise.all([discovery({ type: "list-sessions", provider: null }), loadGroupIndex()]);
  const message = sessionsResult.message;
  if (request !== sessionsRequest) return;
  state.sessionsLoaded = true;
  if (message?.type === "sessions") {
    state.allSessions = message.sessions.filter((item) => !pendingDeletes.has(viewKey(item.id, item.provider)));
    const hiddenParticipants = participantSessionIds();
    state.sessions = state.allSessions.filter((item) => !hiddenParticipants.has(item.id))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    sessionsByKey.clear();
    for (const item of state.sessions) sessionsByKey.set(viewKey(item.id, item.provider), item);
    for (const item of state.sessions) { const view = viewFor(item.id, item.provider); if (view) { view.title = item.title; if (!isLive(view)) { view.model = item.model || view.model; view.effort = item.effort || view.effort; } } }
  } else if (message?.type === "error") showError(`${message.code}: ${message.message}`);
  if (indexResult) for (const group of state.groupIndex) if (!group.provider) group.provider = state.allSessions.find((item) => item.id === group.mainSessionId)?.provider || "";
  for (const view of views) renderParticipantBadges(view);
  renderSessions();
}
async function loadGroupIndex() {
  const groups = []; let offset = 0;
  for (let pages = 0; pages < 1000; pages++) {
    const { message } = await discovery({ type: "group-index", offset });
    if (message?.type !== "group-index") return false;
    groups.push(...message.groups || []);
    if (message.done) { state.groupIndex = groups; return true; }
    if (!Number.isSafeInteger(message.offset) || message.offset <= offset) return false;
    offset = message.offset;
  }
  return false;
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
      { id: "configure", type: "button", label: t("configure"), icon: { name: "settings" } },
    ]);
  }
  persephone.toolbar.setText(current?.cwd || "");
}
persephone.toolbar.onAction(({ id }) => {
  if (id === "new-session") showNewSession();
  else if (id === "refresh-sessions") void refreshSessions();
  else if (id === "interrupt" && current?.channel) void channelSend(current.channel, { type: "interrupt" });
  else if (id === "configure") void openConfig("instructions");
});
function updateControls() {
  $("#intro").classList.toggle("hidden", Boolean(current?.id || current?.channel));
  const slash = promptText().trim().startsWith("/");
  const connectOnly = canConnect(current) && !promptText().trim();
  $("#send").textContent = t(connectOnly ? "connect" : "send");
  $("#send").disabled = Boolean(current?.readOnlyParticipant || current?.busy && (slash || !current.groupMode));
  $("#readonly-hint").classList.toggle("hidden", !current?.readOnlyParticipant);
  $("#prompt").classList.toggle("hidden", Boolean(current?.readOnlyParticipant));
  $("#send").classList.toggle("hidden", Boolean(current?.readOnlyParticipant));
  $("#voice").classList.toggle("hidden", !voiceProviders.length || $("#prompt").classList.contains("hidden"));
  $("#voice-provider").classList.toggle("hidden", voiceProviders.length < 2 || $("#prompt").classList.contains("hidden"));
  updateToolbar(); renderChips();
}

// ── Instructions dialog: the provider instructions the service adds to every new or reopened session ──
// ── Configure dialog: Instructions and Agent profiles tabs ───────────────────
// Save acts on the visible tab and keeps the dialog open; Close asks about unsaved changes in either tab.
let configTab = "instructions";
const instructionsEditor = { provider: "", saved: "", defaultText: "" };
function instructionsDirty() { return $("#instructions-text").value !== instructionsEditor.saved; }
function updateConfigSave() { $("#config-save").disabled = configTab === "profiles" && !profileEditor.profiles.some((profile) => profile.id === profileEditor.selectedId); }
function setConfigTab(tab) {
  configTab = tab;
  for (const button of document.querySelectorAll("#config-dialog [role=tab]")) { const active = button.dataset.tab === tab; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); }
  $("#config-instructions").classList.toggle("hidden", tab !== "instructions");
  $("#config-profiles").classList.toggle("hidden", tab !== "profiles");
  $("#instructions-reset").classList.toggle("hidden", tab !== "instructions");
  updateConfigSave();
}
async function openConfig(tab) {
  showError("");
  const provider = current?.provider || state.defaultProvider;
  const { message } = await discovery({ type: "instructions", ...(provider ? { provider } : {}), action: "get" });
  if (message?.type !== "instructions") { showError(message?.type === "error" ? `${message.code}: ${message.message}` : t("error")); return; }
  Object.assign(instructionsEditor, { provider, saved: message.text, defaultText: message.defaultText });
  const text = $("#instructions-text"); text.value = message.text;
  await refreshProfileCatalog();
  profileEditor = { profiles: state.profiles, descriptions: state.catalog, selectedId: state.profiles[0]?.id || "", original: null, dirty: false, newIds: new Set() };
  renderProfileEditor(); setConfigTab(tab);
  $("#config-dialog").showModal();
  if (tab === "instructions") { text.focus(); text.setSelectionRange(0, 0); text.scrollTop = 0; }
}
async function saveInstructions() {
  const text = $("#instructions-text").value, { provider } = instructionsEditor;
  if (text === instructionsEditor.saved) return true;
  const reply = await discovery({ type: "instructions", ...(provider ? { provider } : {}), action: "set", text });
  if (reply.message?.type !== "instructions") { showError(reply.message?.type === "error" ? `${reply.message.code}: ${reply.message.message}` : t("error")); return false; }
  instructionsEditor.saved = text; return true;
}
async function closeConfig() {
  const profileChoice = await unsavedChoice(); if (profileChoice === "stay") return;
  if (profileChoice === "save" && !(await saveSelectedProfile())) return;
  const instructionsChoice = await unsavedChoice(instructionsDirty(), "instructionsUnsavedTitle"); if (instructionsChoice === "stay") return;
  if (instructionsChoice === "save" && !(await saveInstructions())) return;
  $("#config-dialog").close();
}
for (const button of document.querySelectorAll("#config-dialog [role=tab]")) button.addEventListener("click", () => setConfigTab(button.dataset.tab));
$("#config-dialog").addEventListener("cancel", (event) => { event.preventDefault(); void closeConfig(); });
$("#config-cancel").addEventListener("click", () => void closeConfig());
$("#config-save").addEventListener("click", () => void (configTab === "instructions" ? saveInstructions() : saveSelectedProfile()));
// Reset only fills the editor; nothing is stored until Save.
$("#instructions-reset").addEventListener("click", () => { $("#instructions-text").value = instructionsEditor.defaultText; $("#instructions-text").focus(); });
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
  if (voiceCapture.request?.view === view) voiceCapture.request.discard = true;
  stopAgentWatch(view);
  for (const child of view.agentViews.values()) { closeChannel(child.follow); child.messages.remove(); }
  view.agentViews.clear();
  stopFollow(view);
  const channel = view.channel;
  view.channel = null; view.historyToken++;
  endStream(view); endLive(view); closeChannel(channel);
  view.messages.remove();
  views.delete(view);
  viewsByKey.delete(viewKey(view.id, view.provider));
}
// Shows a view. The one it replaces keeps running if it is live; otherwise it is dropped.
function showView(view) {
  if (current === view) return;
  const previous = current;
  if (previous) {
    if (voiceCapture.request?.view === previous) void stopVoiceRecording();
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
  view.unread = false;
  view.messages.classList.remove("hidden");
  prompt.textContent = view.draft; hideCommandMenu();
  showError(view.error); setStatus(view.statusText, view.statusBusy); renderFooter(view);
  // The first view (the form shown at load) must not overwrite the session the page is about to restore.
  if (previous) rememberSession();
  updateControls(); renderSessions(); updateTyping();
  transcript.scrollTop = view.stick ? transcript.scrollHeight : view.scrollTop;
}

// ── Live view: while the board does not run the shown session, show turns that another process
// (a terminal Claude Code, another board) appends to its transcript. Connecting stops it; the board's own
// channel streams those turns instead.
function appendEntries(view, entries) {
  for (const entry of entries || []) {
    const suffix = entry.truncated ? ` ${t("truncated")}` : "";
    if (entry.role === "user" || entry.role === "agent") {
      for (const segment of parseAuthorHeader(entry.text || "")) {
        const parentId = view.readOnlyParticipant?.mainSessionId || view.id;
        const participant = state.groupIndex.find((group) => group.mainSessionId === parentId)?.participants.find((item) => item.name === segment.author?.name);
        if (segment.text.trim() === GROUP_PASS) continue;
        // Posts reach Master as user turns, so the header, not the transcript role, says who wrote it.
        const author = segment.author ? { ...segment.author, roleTitle: participant?.roleTitle || segment.author.role, provider: participant?.provider || (segment.author.name === "Master" ? view.provider : ""), kind: segment.author.name === "user" ? "user" : "agent" } : null;
        // A join/leave notice is stored as "Agent X (Role) joined" plus the role summary (and, on the first join, the rules reminder).
        const notice = author && /^Agent .+ \(.+\) (joined|left)$/.exec(segment.text.split("\n")[0]);
        if (notice) {
          author.kind = "notice";
          view.groupMessages.push({ author, text: segment.text });
          addGroupMessage(view, segment.text.split("\n")[0], author, { notice: true, summary: notice[1] === "joined" ? segment.text.split("\n").slice(1).join("\n").trim() : "" });
        }
        else if (author) { view.groupMessages.push({ author, text: segment.text }); addGroupMessage(view, segment.text + suffix, author); }
        else if (entry.role === "user") addUserMessage(view, segment.text + suffix, false);
        else addAgentMessage(view, segment.text + suffix);
        if (!author) view.groupMessages.push({ author: entry.role === "user" ? { name: "user", role: "", kind: "user" } : { name: "Master", role: "main", engine: view.provider, kind: "agent" }, text: segment.text });
      }
    }
    else if (entry.role === "tool") addToolCall(view, entry.name, entry.input, entry.callId);
    else if (entry.role === "command") addCommandMessage(view, entry.text, false);
    else if (entry.role === "command-output") addCommandOutput(view, entry.text + suffix);
    else if (entry.role === "compacted") addCompacted(view);
    else if (entry.role === "compact") addCompactSummary(view, entry.text + suffix);
    else if (entry.role === "task") addTaskNotice(view, entry.text, entry.detail);
    else if (entry.role === "file-change") addActivity(view, t("file"), entry.text || entry.path || "", "file");
    else if (entry.role === "reasoning") {
      const details = element("details", "reasoning-history");
      details.append(element("summary", "", t("thinking")), element("div", "", entry.text));
      appendMessage(view, details);
    }
  }
}
function stopFollow(view) {
  const channel = view.follow;
  view.follow = null;
  closeChannel(channel);
}
async function startFollow(view) {
  stopFollow(view);
  if (!capabilities(view).transcriptFollow || !view.id || view.channel || view !== current) return;
  const channel = await openViewChannel(view, { type: "follow-session", sessionId: view.id, cwd: view.cwd });
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
  if (!capabilities(view).subagents || !view.id || view !== current) return;
  void openViewChannel(view, { type: "watch-subagents", sessionId: view.id, cwd: view.cwd }).then((channel) => {
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
  hideCommandMenu(); renderSessions(); updateControls(); updateTyping();
  transcript.scrollTop = view.scrollTop;
}
async function showAgentTranscript(view, agentId) {
  if (!capabilities(view).subagents || !view || view !== current || !view.agents.some((agent) => agent.id === agentId)) return;
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
  hideCommandMenu(); renderSessions(); updateControls(); updateTyping(); closeChoiceMenu(); transcript.scrollTop = child.scrollTop ?? 0;
  const channel = await openViewChannel(view, { type: "subagent-history", sessionId: view.id, agentId, cwd: view.cwd });
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
$("#back-to-main").addEventListener("click", () => {
  if (current?.readOnlyParticipant) {
    const group = state.groupIndex.find((entry) => entry.mainSessionId === current.readOnlyParticipant.mainSessionId);
    const parentItem = state.sessions.find((item) => item.id === group?.mainSessionId);
    if (parentItem) void openStoredSession(parentItem);
  } else showMainTranscript(current);
});
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
  if (!capabilities().sessionStore || !capabilities().transcriptFollow) return;
  const provider = current?.provider || state.defaultProvider;
  const channel = await persephone.service.openChannel({ type: "watch-sessions", ...(provider ? { provider } : {}) });
  channel.onMessage((message) => { if (message.type === "sessions-changed") void refreshFromWatch(); });
}
// The shown session is restorable page state, so the page reopens it after a reload, a restart, or a move to another window.
const rememberSession = () => persephone.state.merge({ session: current ? { ...(current.id ? { id: current.id } : {}), provider: current.provider, cwd: current.cwd || $("#cwd").value.trim() } : null });
// Shows the New session form; a form already open (and not yet started) is reused.
// From a folder (its + button, /clear) the form only shows the folder; from the toolbar it asks for one.
function showNewSession(cwd = "", provider = state.defaultProvider) {
  // A new chat starts on the default engine (the service's first provider), whichever chat was shown before;
  // a blank view is reused, but it too returns to the default engine, model, effort and mode. /clear passes its engine.
  if (!current || current.id || current.channel) showView(createView({ provider }));
  else if (provider && current.provider !== provider) {
    current.provider = provider;
    current.description = state.descriptions.get(current.provider) || null;
    current.model = ""; current.effort = "";
  }
  current.mode = ""; renderChips();
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
  if (!capabilities(view).sessionStore) return false;
  const token = ++view.historyToken;
  setViewStatus(view, t("loadingHistory"), true);
  const channel = await openViewChannel(view, { type: "session-history", sessionId: view.id, cwd: view.cwd });
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
  let description = state.descriptions.get(item.provider || "");
  if (!description) {
    const { message } = await discovery({ type: "describe", ...(item.provider ? { provider: item.provider } : {}), ...(item.cwd ? { cwd: item.cwd } : {}) });
    if (message?.type === "description") { description = message; state.descriptions.set(message.provider || "", message); }
  }
  if (!description?.capabilities?.sessionStore) return;
  const existing = viewFor(item.id, item.provider);
  if (existing) {
    if (item.participant) existing.readOnlyParticipant = item.participant;
    if (existing === current) return;
    showView(existing);
    if (!existing.readOnlyParticipant) { startAgentWatch(existing); if (!existing.channel) await startFollow(existing); }
    return;
  }
  const view = createView(item);
  expandedFolders.add(folderKey(item.cwd));
  showView(view);
  if (!view.readOnlyParticipant) startAgentWatch(view);
  if (!(await loadHistory(view))) return;
  if (view.readOnlyParticipant) await startParticipantObserver(view, view.readOnlyParticipant);
  else await startFollow(view);
}
async function openParticipantSession(parent, participant, session) {
  if (!participant.sessionId || !session) { showError(t("group.participantHistoryUnavailable")); return; }
  const item = { ...session, participant: { ...participant, mainSessionId: parent.id, mainProvider: parent.provider } };
  if (!state.descriptions.has(item.provider)) { const { message } = await discovery({ type: "describe", provider: item.provider, cwd: item.cwd }); if (message?.type === "description") state.descriptions.set(item.provider, message); }
  await openStoredSession(item);
}
async function startParticipantObserver(view, participant) {
  const group = state.groupIndex.find((entry) => entry.mainSessionId === participant.mainSessionId);
  const parent = group && viewFor(group.mainSessionId, group.provider);
  if (!parent?.channel || !parent.groupMain) return;
  const channel = await persephone.service.openChannel({ type: "participant-observer", mainSessionId: participant.mainSessionId, sessionId: participant.sessionId });
  view.follow = channel;
  channel.onMessage((event) => { if (view.follow === channel && !["observer-ready", "observer-unavailable"].includes(event.type)) handleEvent(view, event); });
  channel.onClose(() => { if (view.follow === channel) view.follow = null; });
}
// A shown stored session that is not running can be resumed without sending anything.
function canConnect(view) { return Boolean(view?.id && !view.channel && !view.readOnlyParticipant && capabilities(view).sessionStore); }
// Resumes the session and asks for its context fill, so the chips show the session's actual agent and context.
async function connectSession(view) {
  try {
    if (!(await ensureLive(view))) { setViewStatus(view); return; }
    if (capabilities(view).contextUsage) await control(view, "context").catch(() => {});
  } finally { if (view === current) updateControls(); }
}
async function connectStoredSession(item) {
  let view = viewFor(item.id, item.provider);
  if (view !== current) { await openStoredSession(item); view = viewFor(item.id, item.provider); }
  if (view && view === current && canConnect(view)) await connectSession(view);
}
async function connect(view) {
  if (view.connectTask) return view.connectTask;
  const task = connectView(view);
  view.connectTask = task;
  try { return await task; }
  finally { if (view.connectTask === task) view.connectTask = null; }
}
async function connectView(view) {
  setViewError(view, "");
  const resume = view.id || undefined;
  const cwd = resume ? view.cwd : $("#cwd").value.trim();
  if (!cwd) { setViewError(view, t("cwdRequired")); return false; }
  if (capabilities(view).providerSetup && !providerDescription(view).setup?.ready) { $("#consent").classList.remove("hidden"); setViewError(view, t("consentRequired")); return false; }
  if (resume && !capabilities(view).sessionStore) return false;
  stopFollow(view);
  view.groupLoading = true;
  const title = resume ? "" : sessionTitle(view.pendingPrompt);
  if (!resume) view.title = title;
  const open = {
    type: "open", contractVersion: 1, ...(view.provider ? { provider: view.provider } : {}), model: view.model, cwd,
    groupChat: { position: "main" },
    // Required by the agent.session contract; the service runs local page sessions unrestricted and takes
    // Claude Code's own mode from `mode`.
    permissionMode: "full-auto", mode: viewMode(view),
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
    view.channel = null; view.busy = false; view.pendingPrompt = ""; view.groupLoading = false;
    // Resuming continues in the mode the session last ran in.
    if (MODES.includes(view.footer?.mode)) view.mode = view.footer.mode;
    endStream(view); endLive(view); expireApprovals(view); updateTyping();
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
      if (view.id) viewsByKey.delete(viewKey(view.id, view.provider));
      view.id = event.sessionId; view.provider = event.provider || view.provider || "";
      viewsByKey.set(viewKey(view.id, view.provider), view);
      if (!view.description) void refreshDefaults(view).catch(() => {});
      if (view === current) rememberSession();
      // Keep the open session visible in the tree.
      expandedFolders.add(folderKey(view.cwd));
      startAgentWatch(view);
      setViewStatus(view); updateControls(); renderSessions();
      view.live = true;
      view.groupMain = true;
      void channelSend(view.channel, { type: "group", action: "list" });
      for (const resolve of view.liveWaiters.splice(0)) resolve(true);
      void refreshCommands(view);
      if (view.pendingPrompt && !view.groupLoading) { const text = view.pendingPrompt; view.pendingPrompt = ""; void sendPrompt(view, text); }
      break;
    }
    case "control-result": {
      const pending = view.controls.get(event.id);
      if (!pending) break;
      view.controls.delete(event.id); clearTimeout(pending.timer);
      if (event.ok) pending.resolve(event); else pending.reject(new Error(event.message || t("error")));
      break;
    }
    case "approval-request": endStream(view); view.thinkingNode = null; addApproval(view, event); break;
    case "compacted": endStream(view); addCompacted(view, event); break;
    case "compact-summary": addCompactSummary(view, event.text); break;
    case "session-status": view.footer = event; if (view === current) { updateFooter(event, view); renderChips(); setViewStatus(view, event.compacting ? t("compacting") : "", Boolean(event.compacting)); } break;
    case "turn-started": view.busy = true; setViewStatus(view); updateTyping(); updateControls(); renderSessions(); break;
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
      endStream(view); expireApprovals(view);
      view.busy = false; view.lastText = ""; view.thinkingNode = null; view.commandTurn = false;
      updateTyping();
      // A session that finished while another one is shown is marked in the sidebar until you open it.
      if (view !== current) view.unread = true;
      setViewStatus(view); updateControls();
      if (event.usage) {
        if (capabilities(view).costUsage && Number.isFinite(event.usage.costUsd)) view.sessionCost += event.usage.costUsd;
        view.usage = event.usage;
        if (view === current) updateFooterUsage(view.usage, view.sessionCost, view);
      }
      if (event.reason && event.reason !== "completed") addDivider(view, event.reason);
      renderSessions();
      void refreshSessions(); void refreshDescription();
      break;
    }
    case "group-data":
      view.groupMain = true;
      view.groupLoading = false;
      view.groupProfiles = event.profiles || [];
      view.groupMode = Boolean(event.groupMode);
      view.groupParticipants = event.participants || [];
      renderParticipantBadges(view); updateControls(); renderSessions();
      for (const resolve of (view.groupDataWaiters || []).splice(0)) resolve();
      void refreshSessions();
      if (view.pendingPrompt) { const text = view.pendingPrompt; view.pendingPrompt = ""; void sendPrompt(view, text); }
      break;
    case "group-participant-added":
      view.groupMode = true;
      if (event.participant && !view.groupParticipants.some((item) => item.id === event.participant.id)) view.groupParticipants.push(event.participant);
      renderParticipantBadges(view); updateControls(); renderSessions(); void refreshSessions();
      break;
    case "group-visible-message": {
      const author = event.author || { name: "user", roleTitle: "", kind: "user" };
      if (event.noticeAction === "left") {
        view.groupParticipants = view.groupParticipants.filter((item) => item.name !== author.name);
        renderParticipantBadges(view); updateControls(); renderSessions();
      }
      const displayText = event.noticeAction ? t(`group.${event.noticeAction}`, { name: author.name, role: author.roleTitle || author.role }) : event.text || "";
      const item = { author, text: event.timelineText || event.text || "" };
      view.groupMessages.push(item);
      const notice = author.kind === "notice";
      const summary = event.noticeAction === "joined" ? (event.author?.summary || "") : "";
      addGroupMessage(view, displayText, author, { notice, summary, reminder: event.reminder });
      break;
    }
    case "group-participant-error":
      setViewError(view, t("group.error.resume"));
      break;
    case "group-error":
      view.groupLoading = false;
      // The service's reason is plain text (bounded, no secrets); it is what tells the user what to change.
      setViewError(view, event.message ? `${t("group.error.operation")} ${event.message}` : t("group.error.operation"));
      if (view.pendingPrompt) { const text = view.pendingPrompt; view.pendingPrompt = ""; void sendPrompt(view, text); }
      break;
    case "approval-resolved": {
      const actions = view.approvals.get(event.requestId);
      if (actions) { actions.replaceChildren(element("span", "approval-outcome", t(`approval.${event.outcome || "denied"}`))); view.approvals.delete(event.requestId); }
      updateTyping(); break;
    }
    case "error":
      setViewError(view, `${event.code}: ${event.message}`);
      if (event.fatal) setViewStatus(view, t("error"));
      if (event.code === "provider-setup-required") { $("#consent").classList.remove("hidden"); }
      break;
    case "notice":
      addActivity(view, `${t("notice")} · ${event.message.split("\n")[0]}`, event.detail || event.message); break;
  }
}
// ── Approvals: auto mode asks about what its classifier cannot decide, and plan mode ends with the plan to approve.
// The card stays in the chat with the answer given; one left unanswered when the turn ends no longer applies.
function addApproval(view, event) {
  const isPlan = event.kind === "plan" && Boolean(modeDescriptor(viewMode(view), view)?.planApproval);
  const node = element("div", `msg approval${isPlan ? " plan" : ""}`);
  if (event.participantApproval && event.author) addAuthorBadge(node, { ...event.author, kind: "agent" }, event.author.provider);
  node.append(element("div", "approval-title", isPlan ? t("plan.title") : t("approval.title", { tool: event.tool || t("tool") })));
  if (isPlan) {
    const body = element("div", "markdown-body");
    renderMarkdown(body, `${event.plan || ""}${event.truncated ? ` ${t("truncated")}` : ""}`);
    messageSources.set(node, event.plan || "");
    node.append(body);
  } else node.append(element("pre", "approval-detail", describeInput(event.detail || event.summary)));
  const actions = element("div", "approval-actions");
  const answer = (decision, extra, outcome) => {
    actions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    const response = event.participantApproval
      ? channelSend(view.channel, { type: "group", action: "approval-response", requestId: event.requestId, decision })
      : channelSend(view.channel, { type: "approval-response", requestId: event.requestId, decision, ...extra });
    response
      .then(() => { view.approvals.delete(event.requestId); actions.replaceChildren(element("span", "approval-outcome", outcome)); updateTyping(); })
      .catch((error) => { actions.querySelectorAll("button").forEach((button) => { button.disabled = false; }); setViewError(view, error.message); });
  };
  const button = (label, className, run) => { const node = element("button", className, label); node.type = "button"; node.addEventListener("click", run); return node; };
  if (isPlan) {
    const continuationModes = modeDescriptors(view).filter((mode) => !mode.planApproval).reverse();
    for (const mode of continuationModes) actions.append(button(
      t("plan.approveMode", { mode: t(mode.labelKey) }),
      mode === continuationModes[0] ? "primary" : "",
      () => answer("allow", { mode: mode.id }, t("plan.approved", { mode: t(mode.labelKey) })),
    ));
    actions.append(button(t("plan.keepPlanning"), "", () => answer("deny", {}, t("plan.rejected"))));
  }
  else actions.append(
    button(t("approval.allow"), "primary", () => answer("allow", {}, t("approval.allowed"))),
    button(t("approval.allowSession"), "", () => answer("allow-session", {}, t("approval.allowed"))),
    button(t("approval.deny"), "", () => answer("deny", {}, t("approval.denied"))),
  );
  node.append(actions);
  view.approvals.set(event.requestId, actions);
  appendMessage(view, node, true);
  updateTyping();
  if (view !== current) { view.unread = true; renderSessions(); }
}
function expireApprovals(view) {
  for (const actions of view.approvals.values()) actions.replaceChildren(element("span", "approval-outcome", t("approval.expired")));
  view.approvals.clear();
  updateTyping();
}

async function sendPrompt(view, text) {
  view.commandTurn = text.startsWith("/");
  if (view.commandTurn) addCommandMessage(view, text);
  else if (!view.groupMode) addUserMessage(view, text);
  try {
    if (!view.commandTurn && view.groupMode) await channelSend(view.channel, { type: "group", action: "user-message", text });
    else await channelSend(view.channel, { type: "send", id: crypto.randomUUID(), text });
  }
  catch (error) { setViewError(view, error.message); }
}

// ── Composer ───────────────────────────────────────────────────────────────
// The prompt is a plaintext-only contenteditable div; innerText carries a trailing "\n" the user never typed.
const prompt = $("#prompt");
const promptText = () => { const text = prompt.innerText; return text === "\n" ? "" : text.endsWith("\n") ? text.slice(0, -1) : text; };
const clearPrompt = () => { prompt.textContent = ""; };
function promptOffset() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !prompt.contains(selection.anchorNode)) return promptText().length;
  const range = document.createRange(); range.selectNodeContents(prompt); range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}
function setPromptCaret(offset) {
  const walker = document.createTreeWalker(prompt, NodeFilter.SHOW_TEXT);
  let node, remaining = Math.max(0, offset);
  while ((node = walker.nextNode())) {
    if (remaining <= node.length) {
      const range = document.createRange(); range.setStart(node, remaining); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); prompt.focus(); return;
    }
    remaining -= node.length;
  }
  const range = document.createRange(); range.selectNodeContents(prompt); range.collapse(false);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); prompt.focus();
}
function insertVoiceText(request, text) {
  text = text.trim();
  if (request.discard || !views.has(request.view) || !text) return;
  if (current !== request.view) {
    request.view.draft = `${request.view.draft}${request.view.draft && !/\s$/.test(request.view.draft) ? " " : ""}${text}`;
    return;
  }
  const value = promptText();
  const offset = value === request.promptSnapshot ? Math.min(request.caret, value.length) : document.activeElement === prompt ? promptOffset() : value.length;
  const before = value.slice(0, offset), after = value.slice(offset);
  const left = before && !/\s$/.test(before) && !/^\s/.test(text) ? " " : "";
  const right = after && !/\s$/.test(text) && !/^\s/.test(after) ? " " : "";
  const next = `${before}${left}${text}${right}${after}`;
  prompt.textContent = next; request.view.draft = next;
  setPromptCaret(before.length + left.length + text.length + right.length);
  prompt.dispatchEvent(new Event("input", { bubbles: true }));
}
function voiceTime(ms) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
// Chromium can leave a stray <br> after deleting everything, which would hide the :empty placeholder.
function renderVoice() {
  const request = voiceCapture.request, provider = voiceProviders.find((item) => item.provider === voiceCapture.selected);
  $("#voice").classList.toggle("recording", request?.phase === "recording");
  $("#voice-label").textContent = request?.phase === "recording" ? t("voice.recording", { time: voiceTime(Date.now() - request.startedAt) }) : request?.phase === "stopping" ? t("voice.transcribing") : "";
  $("#voice").title = t("voice.tooltip", { provider: provider?.title || "" });
  $("#voice").setAttribute("aria-label", $("#voice").title);
  $("#voice-provider").textContent = provider?.title || "";
  $("#voice-provider").classList.toggle("hidden", voiceProviders.length < 2 || $("#prompt").classList.contains("hidden"));
}
async function describeVoiceProvider(provider) {
  try {
    const channel = await persephone.services.connect("speech.transcribe", { provider: provider.provider, version: 1 }, { type: "describe" });
    channel.onMessage((message) => {
      if (message.type === "description" && Number.isFinite(message.maxAudioMs) && message.maxAudioMs > 0) {
        voiceCapture.descriptions.set(provider.provider, message.maxAudioMs);
        const request = voiceCapture.request;
        if (request?.provider.provider === provider.provider) {
          request.sampleLimit = Math.max(1, Math.floor((message.maxAudioMs - 1000) * 16));
          if (request.sampleCount >= request.sampleLimit && request.phase === "recording") { setViewError(request.view, t("voice.limit")); void stopVoiceRecording(); }
        }
      }
      try { channel.close(); } catch { /* already closed */ }
    });
    channel.onClose(() => {});
  } catch { /* Keep the five-minute fallback when description is unavailable. */ }
}
async function refreshVoiceProviders() {
  try {
    const list = await persephone.services.list("speech.transcribe");
    voiceProviders = Array.isArray(list) ? list.filter((item) => item?.provider && item.version === 1) : [];
    const saved = prefs.read("voice-provider", "");
    voiceCapture.selected = voiceProviders.some((item) => item.provider === saved) ? saved : voiceProviders[0]?.provider || "";
    prefs.write("voice-provider", voiceCapture.selected);
    for (const provider of voiceProviders) if (!voiceCapture.descriptions.has(provider.provider)) void describeVoiceProvider(provider);
  } catch { voiceProviders = []; voiceCapture.selected = ""; }
  renderVoice(); updateControls();
}
function openVoiceProviderMenu() {
  void refreshVoiceProviders().then(() => {
    const items = voiceProviders.map((provider) => ({ label: provider.title, current: provider.provider === voiceCapture.selected, run: () => {
      voiceCapture.selected = provider.provider; prefs.write("voice-provider", provider.provider); renderVoice();
    } }));
    if (items.length > 1) openChoiceMenu($("#voice-provider"), items);
  });
}
function voicePcm(samples) {
  const data = new ArrayBuffer(samples.length * 2), view = new DataView(data);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return data;
}
function queueVoiceSamples(request, samples) {
  if (!samples.length || !request.channel || request.closed) return;
  const data = voicePcm(samples);
  request.queued = request.queued.then(async () => {
    if (!request.channel || request.closed || request.cancelled) return;
    if (!request.channel.writable) await request.channel.whenWritable();
    if (!request.channel || request.closed || request.cancelled) return;
    request.channel.send({ type: "audio", data });
  });
  request.queued.catch((error) => failVoice(request, error));
}
function consumeVoiceSamples(request, samples) {
  if (request.ended || voiceCapture.request !== request) return;
  const rate = request.context.sampleRate / 16000, output = [];
  const merged = new Float32Array(request.sourceSamples.length + samples.length);
  merged.set(request.sourceSamples); merged.set(samples, request.sourceSamples.length); request.sourceSamples = merged;
  const end = request.sourceBase + merged.length;
  while (request.nextSource + 1 < end) {
    const left = Math.floor(request.nextSource), fraction = request.nextSource - left, offset = left - request.sourceBase;
    output.push(merged[offset] * (1 - fraction) + merged[offset + 1] * fraction); request.nextSource += rate;
  }
  const discard = Math.max(0, Math.floor(request.nextSource) - request.sourceBase);
  if (discard) { request.sourceSamples = merged.slice(discard); request.sourceBase += discard; }
  const accepted = output.slice(0, Math.max(0, request.sampleLimit - request.sampleCount));
  request.sampleCount += accepted.length; request.pending.push(...accepted);
  while (request.pending.length >= 1600) queueVoiceSamples(request, request.pending.splice(0, 1600));
  if (accepted.length < output.length || request.sampleCount >= request.sampleLimit) {
    setViewError(request.view, t("voice.limit")); void stopVoiceRecording();
  }
}
async function createVoiceContext() {
  let context;
  try { context = new AudioContext({ sampleRate: 16000 }); await context.audioWorklet.addModule("./audio-capture-worklet.js"); return context; }
  catch {
    context?.close().catch(() => {}); context = new AudioContext();
    try { await context.audioWorklet.addModule("./audio-capture-worklet.js"); return context; }
    catch (error) { context.close().catch(() => {}); throw error; }
  }
}
function releaseVoice(request) {
  clearInterval(request.timer);
  try { request.node?.port.close(); } catch { /* already closed */ }
  try { request.source?.disconnect(); } catch { /* already disconnected */ }
  try { request.node?.disconnect(); } catch { /* already disconnected */ }
  request.stream?.getTracks().forEach((track) => { try { track.stop(); } catch { /* already stopped */ } });
  request.context?.close().catch(() => {});
}
function finishVoice(request) {
  if (request.finished) return;
  request.finished = true; request.ended = true; releaseVoice(request);
  if (voiceCapture.request === request) voiceCapture.request = null;
  renderVoice(); updateControls();
}
function failVoice(request, error) {
  if (request.finished) return;
  if (!request.cancelled) setViewError(request.view, t("voice.providerError", { message: error?.message || t("error") }));
  finishVoice(request);
}
function watchVoiceChannel(request) {
  request.channel.onMessage((message) => {
    if (message.type === "status") { if (message.state === "transcribing") { request.phase = "stopping"; renderVoice(); } }
    else if (message.type === "result") { request.closed = true; if (views.has(request.view)) insertVoiceText(request, message.text || ""); finishVoice(request); }
    else if (message.type === "error") {
      request.closed = true;
      if (message.code === "not-ready") setViewError(request.view, t("voice.notReady", { message: message.message || "" }));
      else if (message.code !== "cancelled") setViewError(request.view, t("voice.providerError", { message: message.message || message.code || t("error") }));
      finishVoice(request);
    }
  });
  request.channel.onClose((reason) => {
    request.closed = true;
    if (!request.finished) { if (!request.cancelled) setViewError(request.view, reason?.message || t("voice.closeError")); finishVoice(request); }
  });
}
function startVoiceRecording() {
  if (voiceCapture.request) { if (voiceCapture.request.phase === "recording") void stopVoiceRecording(); return; }
  const view = current;
  if (!voiceProviders.length || !view || view.readOnlyParticipant) return;
  const provider = voiceProviders.find((item) => item.provider === voiceCapture.selected) || voiceProviders[0], value = promptText();
  const request = { view, provider, phase: "starting", promptSnapshot: value, caret: promptOffset(), channel: null, stream: null, context: null, node: null, source: null, ended: false, finished: false, cancelled: false, closed: false, queued: Promise.resolve(), pending: [], sourceSamples: new Float32Array(0), sourceBase: 0, nextSource: 0, sampleCount: 0, sampleLimit: Math.max(1, Math.floor(((voiceCapture.descriptions.get(provider.provider) || 300000) - 1000) * 16)), startedAt: Date.now() };
  voiceCapture.request = request; renderVoice(); updateControls();
  let microphone, providerList, channelOpen;
  try {
    microphone = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }).then((stream) => {
      request.stream = stream;
      if (request.finished || request.cancelled) stream.getTracks().forEach((track) => track.stop());
      return stream;
    });
    providerList = persephone.services.list("speech.transcribe");
    channelOpen = persephone.services.connect("speech.transcribe", { provider: provider.provider, version: 1 }, {
      type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 }, prompt: "Claude, Codex, Persephone",
    }).then((channel) => { request.channel = channel; watchVoiceChannel(request); return channel; });
  } catch (error) {
    setViewError(view, t("voice.captureError", { message: error.message || t("error") })); finishVoice(request); return;
  }
  void (async () => {
    try {
      const [stream, providers] = await Promise.all([microphone, providerList, channelOpen]);
      request.stream = stream;
      if (request.finished || request.cancelled) { stream.getTracks().forEach((track) => track.stop()); try { request.channel.send({ type: "cancel" }); } catch { /* closed */ } return; }
      if (!providers.some((item) => item.provider === provider.provider && item.version === 1)) throw new Error(t("voice.noProvider"));
      if (request.finished || request.cancelled) { try { request.channel.send({ type: "cancel" }); } catch { /* closed */ } finishVoice(request); return; }
      request.context = await createVoiceContext();
      if (request.finished || request.cancelled) { releaseVoice(request); return; }
      request.source = request.context.createMediaStreamSource(stream);
      request.node = new AudioWorkletNode(request.context, "agent-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = request.context.createGain(); mute.gain.value = 0;
      request.source.connect(request.node); request.node.connect(mute); mute.connect(request.context.destination);
      request.node.port.onmessage = ({ data }) => { if (data.type === "samples") consumeVoiceSamples(request, data.data); };
      request.phase = "recording"; request.startedAt = Date.now(); renderVoice();
      request.timer = setInterval(() => { if (voiceCapture.request === request && request.phase === "recording") renderVoice(); }, 250);
      if (request.stopRequested) void stopVoiceRecording();
    } catch (error) {
      request.stream?.getTracks().forEach((track) => track.stop());
      try { request.channel?.send({ type: "cancel" }); } catch { /* closed */ }
      if (request.cancelled) { finishVoice(request); return; }
      if (error?.name === "NotAllowedError" || error?.name === "NotFoundError" || error?.name === "SecurityError") setViewError(view, `${t("voice.permission")} ${error.message || ""}`);
      else setViewError(view, t("voice.captureError", { message: error.message || t("error") }));
      finishVoice(request);
    }
  })();
}
async function stopVoiceRecording() {
  const request = voiceCapture.request;
  if (!request) return;
  if (request.phase === "starting") { request.stopRequested = true; return; }
  if (request.phase !== "recording") return;
  request.phase = "stopping"; request.ended = true; clearInterval(request.timer);
  if (request.nextSource < request.sourceBase + request.sourceSamples.length && request.sampleCount < request.sampleLimit) { request.pending.push(request.sourceSamples[request.sourceSamples.length - 1] || 0); request.sampleCount++; }
  if (request.pending.length) queueVoiceSamples(request, request.pending.splice(0));
  releaseVoice(request); renderVoice();
  try {
    await request.queued;
    if (!request.closed && !request.finished) {
      if (!request.channel.writable) await request.channel.whenWritable();
      if (!request.closed && !request.finished) { request.channel.send({ type: "end" }); request.endSent = true; }
    }
  }
  catch (error) { failVoice(request, error); }
}
function cancelVoiceRecording(force = false) {
  const request = voiceCapture.request;
  if (!request || !force && request.phase !== "recording" && request.phase !== "starting") return false;
  request.cancelled = true; request.ended = true; clearInterval(request.timer);
  if (!request.endSent) { try { request.channel?.send({ type: "cancel" }); } catch { /* channel may have closed */ } }
  finishVoice(request); return true;
}
$("#voice").addEventListener("mousedown", (event) => event.preventDefault());
$("#voice").addEventListener("click", () => { if (voiceCapture.request?.phase === "recording") void stopVoiceRecording(); else startVoiceRecording(); });
$("#voice-provider").addEventListener("mousedown", (event) => event.preventDefault());
$("#voice-provider").addEventListener("click", openVoiceProviderMenu);
window.addEventListener("focus", () => { void refreshVoiceProviders(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) void stopVoiceRecording(); else void refreshVoiceProviders(); });
window.addEventListener("pagehide", () => cancelVoiceRecording(true));
window.addEventListener("beforeunload", () => cancelVoiceRecording(true));
persephone.page.onVisibilityChange((visible) => { if (!visible) void stopVoiceRecording(); else void refreshVoiceProviders(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && cancelVoiceRecording()) { event.preventDefault(); event.stopPropagation(); } });
void refreshVoiceProviders();
prompt.addEventListener("input", () => { if (!promptText()) clearPrompt(); updateCommandMenu(); updateControls(); });
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
  if (!text && canConnect(view) && !view.connectTask) { await connectSession(view); return; }
  if (!text || (view.busy && (!view.groupMode || text.startsWith("/"))) || view.pendingPrompt) return;
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
function boardCommandAvailable(name, view = current) {
  const caps = capabilities(view);
  return name === "mcp" ? caps.mcpPanel
    : name === "model" ? caps.modelSelection
      : name === "effort" ? caps.effortSelection
        : name === "context" ? caps.contextUsage
          : name === "clear" || name === "rename" ? caps.sessionStore : false;
}
state.commands = prefs.read("commands", []);
// The list is cached from the last live session so the menu also works before the board connects.
async function refreshCommands(view) {
  if (!capabilities(view).slashCommands) return;
  try {
    const { commands } = await control(view, "commands");
    state.commands = commands || [];
    prefs.write("commands", state.commands);
  } catch { /* keep the cached list */ }
}
function boardCommandFor(text) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const command = match && Object.hasOwn(BOARD_COMMANDS, match[1]) && boardCommandAvailable(match[1]) ? BOARD_COMMANDS[match[1]] : null;
  if (!command || (match[2]?.trim() && !command.anyArgs)) return null;
  return command.run;
}
function commandList() {
  const byName = new Map((capabilities().slashCommands ? state.commands : []).map((command) => [command.name, command]));
  for (const name of Object.keys(BOARD_COMMANDS)) if (boardCommandAvailable(name)) byName.set(name, { ...byName.get(name), name, description: t(`cmd.${name}`), board: true });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const commandMenu = $("#command-menu");
const menu = { items: [], index: 0 };
function updateCommandMenu() {
  if (!capabilities().slashCommands || current?.selectedAgentId) { hideCommandMenu(); return; }
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
  if (!capabilities().mcpPanel) return;
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
  if (!capabilities().contextUsage) return;
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

// /clear — the terminal starts a fresh conversation in place; here, a new session in the same folder, engine,
// model and effort. The chat it replaces is deleted (its process ended first), so the list does not keep it.
function clearSession() {
  const old = current;
  if (!old.id || old.readOnlyParticipant) { showNewSession(old.cwd); prompt.focus(); return; }
  // The picked alias ("haiku") over the full id a running session reports, which the chip cannot label.
  const model = old.model || viewModel(old), effort = old.effort || viewEffort(old);
  showNewSession(old.cwd, old.provider);
  current.model = model; current.effort = effort;
  renderChips();
  void removeSession(sessionFor(old.id, old.provider) || { id: old.id, provider: old.provider, cwd: old.cwd, title: old.title });
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
renderSessions();
void (async () => {
  const saved = (await persephone.state.get())?.session;
  await refreshDescription();
  if (saved?.provider) {
    const cached = state.descriptions.get(saved.provider);
    if (cached) { current.provider = saved.provider; applyDescription(cached, current); }
    else {
      const { message } = await discovery({ type: "describe", provider: saved.provider, ...(saved.cwd ? { cwd: saved.cwd } : {}) });
      if (message?.type === "description") { current.provider = saved.provider; applyDescription(message, current); }
    }
  } else if (current && !current.provider) { current.provider = state.defaultProvider; current.description = state.descriptions.get(current.provider) || null; }
  if (capabilities().sessionStore && capabilities().transcriptFollow && state.setup?.ready) void watchSessionList().catch(() => {});
  // A session missing from the list (older than the listing) still resumes by id.
  if (saved?.id && saved.cwd && !current.id && capabilities().sessionStore && state.setup?.ready) await openStoredSession(sessionFor(saved.id, saved.provider) || { id: saved.id, provider: saved.provider || "", cwd: saved.cwd, title: "" });
})().catch((error) => showError(error.message));
// The board's default model and effort settings change what a view that is not running would use.
state.settingsOff = persephone.settings.onChange(({ id }) => {
  if (["default-model", "default-effort", "codex-default-model", "codex-default-effort"].includes(id) && current && !isLive(current)) void refreshDefaults(current).catch(() => {});
});
