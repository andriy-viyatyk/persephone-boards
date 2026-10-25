import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { open as openFile, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  boundedString, summarizeToolInput,
} from "../agent-session-protocol.mjs";
import { resolveClaudeExecutable } from "../claude-executable.mjs";
import { installSdk, loadSdk, sdkIsInstalled } from "../sdk-install.mjs";

const MODE_NATIVE = Object.freeze({ "read-only": "default", ask: "default", "auto-edit": "acceptEdits", "full-auto": "bypassPermissions" });
function normalizeModel(info) { return { id: String(info.value ?? info.resolvedModel ?? ""), label: String(info.displayName ?? info.value ?? "Claude model"), efforts: Array.isArray(info.supportedEffortLevels) ? info.supportedEffortLevels.filter((x) => typeof x === "string") : [] }; }
function resultReason(message) {
  if (message.subtype === "error_max_turns" || message.subtype === "error_max_budget_usd") return "limit";
  const detail = `${message.errors?.join(" ") || ""} ${message.result || ""}`.toLowerCase();
  if (detail.includes("not logged") || detail.includes("login")) return "not-logged-in";
  if (detail.includes("model") && (detail.includes("unavailable") || detail.includes("not found"))) return "model-unavailable";
  if (detail.includes("resume") && detail.includes("not found")) return "resume-not-found";
  return message.subtype === "success" ? "completed" : "error";
}

function resultUsage(message) {
  const usage = message.usage || {};
  const out = {};
  if (Number.isFinite(usage.input_tokens)) out.inputTokens = usage.input_tokens;
  if (Number.isFinite(usage.output_tokens)) out.outputTokens = usage.output_tokens;
  if (Number.isFinite(usage.cache_read_input_tokens)) out.cachedTokens = usage.cache_read_input_tokens;
  if (Number.isFinite(message.total_cost_usd)) out.costUsd = message.total_cost_usd;
  return out;
}

const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/;

// A finished background task (shell command, subagent) is fed back as a <task-notification> user turn.
// Like the terminal, show its one-line summary; the block itself is the expandable detail.
const TASK_NOTIFICATION = /^\s*<task-notification>/;
export function parseTaskNotification(message, text) {
  if (typeof text !== "string" || (message?.origin?.kind !== "task-notification" && !TASK_NOTIFICATION.test(text))) return null;
  const status = /<status>\s*([^<]*?)\s*<\/status>/.exec(text)?.[1] || "finished";
  const summary = boundedString(/<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1].trim() || `Background task ${status}`, 32 * 1024);
  const detail = boundedString(text.trim(), 32 * 1024);
  return { summary: summary.value, detail: detail.value, ...(summary.truncated || detail.truncated ? { truncated: true } : {}) };
}

export function normalizeNativeMessage(message, state = { pendingFiles: new Map() }) {
  const events = [];
  const addText = (type, value, extra = {}) => {
    const text = boundedString(value, 32 * 1024);
    events.push({ type, text: text.value, ...(text.truncated ? { truncated: true } : {}), ...extra });
  };
  if (message.type === "stream_event") {
    const event = message.event || {};
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") addText("text-delta", event.delta.text);
    else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") addText("thinking-delta", event.delta.thinking);
    return events;
  }
  // Compaction re-sends the messages it preserved verbatim; they are already on screen.
  if ((message.type === "assistant" || message.type === "user") && state.preserved?.has(message.uuid)) return events;
  if (message.type === "assistant") {
    // Local slash commands (/usage, /context, ...) answer with a synthetic assistant message instead of a model turn.
    const synthetic = message.message?.model === "<synthetic>" ? { synthetic: true } : {};
    for (const block of message.message?.content || []) {
      if (block.type === "text" && block.text) addText("text", block.text, synthetic);
      else if (block.type === "thinking" && block.thinking?.trim()) addText("thinking-delta", block.thinking);
      else if (block.type === "tool_use") {
        const input = summarizeToolInput(block.name, block.input);
        events.push({ type: "tool-call", callId: block.id, name: block.name, input: { summary: input.summary, ...(input.truncated ? { truncated: true } : {}) } });
        if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(block.name)) {
          const fileName = block.input?.file_path || block.input?.notebook_path || "";
          if (fileName) state.pendingFiles.set(block.id, { fileName, kind: block.name === "Write" ? "created-or-updated" : "modified" });
        }
      }
    }
    return events;
  }
  if (message.type === "user") {
    // After /compact (or auto-compaction) the CLI feeds the summary back as a synthetic user message.
    const content = message.message?.content;
    if (typeof content === "string" && (message.isCompactSummary || (message.isSynthetic && COMPACT_SUMMARY.test(content)))) {
      addText("compact-summary", content);
      return events;
    }
    const task = parseTaskNotification(message, typeof content === "string" ? content : content?.find?.((block) => block?.type === "text")?.text);
    if (task) {
      events.push({ type: "task", ...task });
      return events;
    }
    for (const block of Array.isArray(message.message?.content) ? message.message.content : []) if (block?.type === "tool_result") {
      events.push({ type: "tool-result", callId: block.tool_use_id, ok: !block.is_error, summary: "Tool result received; output content omitted." });
      const pendingFile = state.pendingFiles.get(block.tool_use_id);
      state.pendingFiles.delete(block.tool_use_id);
      if (pendingFile && !block.is_error) {
        const filePath = boundedString(path.normalize(pendingFile.fileName), 32 * 1024);
        events.push({ type: "file-change", path: filePath.value, kind: pendingFile.kind, ...(filePath.truncated ? { truncated: true } : {}) });
      }
    }
    return events;
  }
  if (message.type === "tool_use_summary") {
    const summary = boundedString(message.summary, 32 * 1024);
    for (const id of message.preceding_tool_use_ids || []) events.push({ type: "tool-result", callId: id, ok: true, summary: summary.value, ...(summary.truncated ? { truncated: true } : {}) });
    return events;
  }
  if (message.type === "system" && message.subtype === "files_persisted") {
    for (const file of message.files || []) {
      if (typeof file.filename !== "string") continue;
      const filePath = boundedString(path.normalize(file.filename), 32 * 1024);
      events.push({ type: "file-change", path: filePath.value, kind: "persisted", ...(filePath.truncated ? { truncated: true } : {}) });
    }
    return events;
  }
  if (message.type === "tool_progress") {
    const summary = boundedString(`${message.tool_name} running (${message.elapsed_time_seconds}s)`, 32 * 1024);
    events.push({ type: "tool-result", callId: message.tool_use_id, ok: true, summary: summary.value, ...(summary.truncated ? { truncated: true } : {}) });
    return events;
  }
  if (message.type === "result") {
    const code = resultReason(message);
    const reason = code === "completed" ? "completed" : code === "limit" ? "limit" : "error";
    events.push({ type: "turn-ended", reason, usage: resultUsage(message) });
    if (reason === "error") {
      const errorText = boundedString((message.errors || []).join("; ") || message.result || "Claude turn failed.", 32 * 1024);
      events.push({ type: "error", code, message: errorText.value, fatal: Boolean(message.is_error), ...(errorText.truncated ? { truncated: true } : {}) });
    }
    return events;
  }
  if (message.type === "rate_limit_event" && message.rate_limit_info?.status && message.rate_limit_info.status !== "allowed") {
    const info = message.rate_limit_info;
    const resets = Number.isFinite(info.resetsAt) ? ` Resets at ${new Date(info.resetsAt * 1000).toISOString()}.` : "";
    events.push({ type: "notice", message: info.status === "rejected" ? `Claude usage limit reached.${resets}` : `Claude usage is close to its limit.${resets}` });
  } else if (message.type === "system" && message.subtype === "compact_boundary") {
    const meta = message.compact_metadata || {};
    state.preserved = new Set(meta.preserved_messages?.all_uuids || meta.preserved_messages?.uuids || []);
    events.push({ type: "compacted", trigger: meta.trigger || "", ...(Number.isFinite(meta.pre_tokens) ? { preTokens: meta.pre_tokens } : {}), ...(Number.isFinite(meta.post_tokens) ? { postTokens: meta.post_tokens } : {}) });
  }
  return events;
}

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const MODEL_ALIASES = [
  { id: "", label: "Default", efforts: [] },
  { id: "sonnet", label: "Sonnet (CLI alias)", efforts: EFFORT_LEVELS },
  { id: "opus", label: "Opus (CLI alias)", efforts: EFFORT_LEVELS },
  { id: "haiku", label: "Haiku (CLI alias)", efforts: EFFORT_LEVELS },
];
const CAPABILITIES = Object.freeze({ providerSetup: true, sessionStore: true, transcriptFollow: true, permissionModes: true, modelSelection: true, effortSelection: true, slashCommands: true, mcpPanel: true, subagents: true, tokenUsage: true, costUsage: true, contextUsage: true, rateLimits: true });
let cachedModels = null;
let settings = {};
const settingIds = ["claude-executable", "default-model", "default-effort", "cross-board-permission-ceiling"];
let adapter;
const providerFor = (id = "claude") => id === "claude" ? adapter : null;
let host;
let { AsyncQueue, activeSessions, closingSessions, send, echo, replyError, closeChannel, registerSession, registerProcess, killChildren, sendEntries, askApproval, approve: approveShared, policyDecision, approvalKind, sessionLimits, prepareOpen, issueOpenEndpoint } = {};
const closeSession = (session, reason, closeTransport = false) => host.closeSession(session, reason, false, closeTransport);

async function refreshSettings() {
  const next = {};
  await Promise.all(settingIds.map(async (id) => { next[id] = await persephone.settings.get(id); }));
  settings = next;
  return settings;
}

// The model and effort a session starts with when the page picks none: the board settings, then the Claude Code
// settings the CLI reads (user, then the folder's project and local files; later wins), then Opus at medium effort.
const FALLBACK_MODEL = "opus";
const FALLBACK_EFFORT = "medium";
async function claudeSettingsDefaults(cwd) {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const files = [path.join(configDir, "settings.json")];
  if (cwd) files.push(path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json"));
  const found = {};
  for (const file of files) {
    const json = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
    if (typeof json?.model === "string" && json.model) found.model = json.model;
    if (typeof json?.effortLevel === "string" && json.effortLevel) found.effort = json.effortLevel;
  }
  return found;
}
// `model`/`effort` are what the session runs with; `pass*` is what the board must send the SDK (empty when the CLI applies its own settings).
async function sessionDefaults(cwd) {
  const claude = await claudeSettingsDefaults(cwd);
  const passModel = settings["default-model"] || (claude.model ? "" : FALLBACK_MODEL);
  const passEffort = settings["default-effort"] || (claude.effort ? "" : FALLBACK_EFFORT);
  return { model: passModel || claude.model, effort: passEffort || claude.effort, passModel, passEffort };
}

function listenSettings() {
  persephone.settings.onChange(({ id, value }) => {
    if (settingIds.includes(id)) settings[id] = value;
  });
}

async function makePreamble(open, mcpAttached) {
  const identity = open.groupChat || { name: "Master", position: "main" };
  const environment = `You are running inside the Agent Chat board. Working directory: ${open.cwd}. Persephone MCP is ${mcpAttached ? "attached for this session" : "not attached"}. Your output is shown in a chat UI.\n\n${host.groupCore(identity.name || "Master", identity.position || "main")}`;
  return host.composeInstructions("claude", environment, open.instructions);
}

async function describe(channel, request, info) {
  await refreshSettings();
  const provider = providerFor(request.provider || "claude");
  if (!provider) throw Object.assign(new Error(`Provider is unavailable: ${request.provider}`), { code: "provider-unavailable" });
  const defaults = await sessionDefaults(typeof request.cwd === "string" && request.cwd.length <= 4096 ? request.cwd : "");
  const detail = await provider.describe({ cwd: request.cwd || "", settings, defaults });
  await send(channel, echo({
    type: "description",
    contractVersion: 1,
    ...detail,
    permissionModes: ["read-only", "ask", "auto-edit", "full-auto"],
    permissionCeiling: settings["cross-board-permission-ceiling"] || "read-only",
    features: { resume: detail.setup.ready, thinkingStream: detail.setup.ready, usage: detail.setup.ready, cost: detail.setup.ready, maxAgentSteps: detail.setup.ready, maxBudgetUsd: detail.setup.ready },
  }, request));
  await closeChannel(channel);
}

async function listSessions(channel, request) {
  await refreshSettings();
  let sdk;
  try { sdk = await providerFor(request.provider || "claude").loadSdk(); }
  catch (error) { await replyError(channel, request, error.code || "provider-setup-required", error.message, true); return; }
  try {
    const result = await collectClaudeSessions(request, sdk);
    await send(channel, echo({ type: "sessions", sessions: result }, request));
    await closeChannel(channel);
  } catch (error) { await replyError(channel, request, "protocol-error", error.message || "Could not list sessions.", true); }
}
async function collectClaudeSessions(request = {}, sdk = null) {
  sdk ||= await providerFor("claude").loadSdk();
  const rows = await sdk.listSessions({ limit: 200, ...(request.cwd ? { dir: request.cwd } : {}) });
  const normalizePath = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const filtered = request.cwd ? rows.filter((row) => row.cwd && normalizePath(row.cwd) === normalizePath(request.cwd)) : rows;
  return filtered.map((row) => ({ id: row.sessionId, title: boundedString(row.customTitle || row.summary || row.firstPrompt || "Untitled session", 32 * 1024).value, updatedAt: new Date(row.lastModified).toISOString(), cwd: row.cwd || "", provider: "claude" }));
}

// CLI-generated user turns (caveats, reminders) are not things the user typed. Slash commands are stored as
// tagged user turns: the command line becomes a "command" entry and its printed output a "command-output" one.
const SYNTHETIC_USER_TEXT = /^\s*<(command-|local-command-|system-reminder)/;
const COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const COMMAND_OUTPUT = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/;
const textEntry = (role, value) => {
  const text = boundedString(value, 32 * 1024);
  return { role, text: text.value, ...(text.truncated ? { truncated: true } : {}) };
};
function commandOutputEntries(text) {
  const output = COMMAND_OUTPUT.exec(text || "")?.[1].trim();
  return output ? [textEntry("command-output", output)] : [];
}
function userTextEntry(message, text) {
  const task = parseTaskNotification(message, text);
  if (task) return { role: "task", text: task.summary, detail: task.detail, ...(task.truncated ? { truncated: true } : {}) };
  if (message.isCompactSummary || COMPACT_SUMMARY.test(text)) return textEntry("compact", text);
  const command = COMMAND_NAME.exec(text);
  if (command) {
    const name = command[1].startsWith("/") ? command[1] : `/${command[1]}`;
    const args = COMMAND_ARGS.exec(text)?.[1].trim();
    return textEntry("command", args ? `${name} ${args}` : name);
  }
  if (COMMAND_OUTPUT.test(text)) return commandOutputEntries(text)[0] || null;
  return SYNTHETIC_USER_TEXT.test(text) ? null : textEntry("user", text);
}

function historyEntries(message) {
  const content = message.message?.content;
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const entries = [];
  for (const block of blocks) {
    if (block?.type === "text" && block.text?.trim()) {
      const entry = message.type === "user" ? userTextEntry(message, block.text) : textEntry("agent", block.text);
      if (entry) entries.push(entry);
    } else if (block?.type === "tool_use" && message.type === "assistant") {
      entries.push({ role: "tool", name: block.name, input: summarizeToolInput(block.name, block.input).summary, ...(typeof block.id === "string" ? { callId: block.id } : {}) });
    }
  }
  return entries;
}

// ── Watching transcripts written by other processes (a terminal Claude Code, another board) ──
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLLOW_INTERVAL_MS = 1000;
const LIST_THROTTLE_MS = 3000;
const claudeProjectsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
async function findTranscript(sessionId) {
  const root = claudeProjectsDir();
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, `${sessionId}.jsonl`);
    try { await stat(file); return file; } catch { /* not in this project */ }
  }
  return null;
}
function watchFor(channel, stop) {
  host.watchFor(channel, stop);
}

// One raw transcript line: user/assistant turns, plus the compaction marker and local command output,
// which the transcript stores as system entries.
function transcriptLineEntries(message, { allowSidechain = false } = {}) {
  if (message.isSidechain && !allowSidechain) return [];
  if (message.type === "system") {
    if (message.subtype === "compact_boundary") return [{ role: "compacted" }];
    if (message.subtype === "local_command") return commandOutputEntries(message.content);
    return [];
  }
  if ((message.type !== "user" && message.type !== "assistant") || (message.isMeta && !message.isCompactSummary)) return [];
  return historyEntries(message);
}

// Local page only: streams turns appended to a stored transcript after the page loaded its history.
async function followTranscript(channel, request, file, { allowSidechain = false, agentId = null, startOffset } = {}) {
  let offset = Number.isFinite(startOffset) ? startOffset : (await stat(file)).size;
  let pending = Buffer.alloc(0);
  let reading = false;
  let stopped = false;
  const poll = async () => {
    if (reading || stopped) return;
    reading = true;
    try {
      const { size } = await stat(file);
      if (size < offset) { offset = size; pending = Buffer.alloc(0); }
      if (size === offset) return;
      const chunk = Buffer.alloc(size - offset);
      const handle = await openFile(file, "r");
      try { await handle.read(chunk, 0, chunk.length, offset); } finally { await handle.close(); }
      offset = size;
      // Decode only complete lines; a line still being written stays pending until its newline arrives.
      pending = Buffer.concat([pending, chunk]);
      const end = pending.lastIndexOf(0x0a);
      if (end < 0) return;
      const lines = pending.subarray(0, end).toString("utf8").split("\n");
      pending = pending.subarray(end + 1);
      const entries = [];
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        entries.push(...transcriptLineEntries(message, { allowSidechain }));
      }
      if (!entries.length) return;
      const rest = await sendEntries(channel, request, entries, { live: true, ...(agentId ? { agentId } : {}) });
      if (rest.length) await send(channel, echo({ type: "history", entries: rest, live: true, ...(agentId ? { agentId } : {}) }, request));
    } catch (error) {
      if (error.code === "ENOENT") { stopped = true; await closeChannel(channel, { code: "session-deleted", message: "The session transcript was removed." }); }
    } finally { reading = false; }
  };
  const timer = setInterval(() => void poll(), FOLLOW_INTERVAL_MS);
  watchFor(channel, () => { stopped = true; clearInterval(timer); });
}

// Local page only: follow the selected main session's appended transcript.
async function followSession(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Following a session is available only from the local board page." });
  if (typeof request.sessionId !== "string" || !SESSION_ID.test(request.sessionId)) return replyError(channel, request, "protocol-error", "A valid sessionId is required.", true);
  const file = await findTranscript(request.sessionId);
  if (!file) return closeChannel(channel, { code: "not-found", message: "The session transcript was not found." });
  await followTranscript(channel, request, file);
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
// A session's subagents live beside its transcript: <project>/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json).
async function subagentsDir(sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) throw Object.assign(new Error("A valid sessionId is required."), { code: "protocol-error" });
  const main = await findTranscript(sessionId);
  if (!main) throw Object.assign(new Error("The session transcript was not found."), { code: "not-found" });
  return path.join(path.dirname(main), sessionId, "subagents");
}
function subagentFiles(dir, agentId) {
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) throw Object.assign(new Error("A valid agentId is required."), { code: "protocol-error" });
  const prefix = path.join(dir, `agent-${agentId}`);
  return { transcript: `${prefix}.jsonl`, metadata: `${prefix}.meta.json` };
}

async function subagentHistory(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Subagent history is available only from the local board page." });
  try {
    const files = subagentFiles(await subagentsDir(request.sessionId), request.agentId);
    // Replay up to the last complete line and follow from exactly there, so a running agent loses no line.
    const buffer = await readFile(files.transcript);
    const end = buffer.lastIndexOf(0x0a) + 1;
    const entries = [];
    for (const line of buffer.subarray(0, end).toString("utf8").split("\n")) {
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      entries.push(...transcriptLineEntries(message, { allowSidechain: true }));
    }
    const batch = await sendEntries(channel, request, entries, { agentId: request.agentId });
    await send(channel, echo({ type: "history", entries: batch, done: true, agentId: request.agentId }, request));
    await followTranscript(channel, request, files.transcript, { allowSidechain: true, agentId: request.agentId, startOffset: end });
  } catch (error) { await replyError(channel, request, error.code || "protocol-error", error.message || "Could not read subagent history.", true); }
}

// Local page only: polls the session's subagents folder (it appears only when the first subagent starts)
// and sends the list whenever an agent appears or its running state changes.
async function watchSubagents(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Subagents are available only from the local board page." });
  let dir;
  try { dir = await subagentsDir(request.sessionId); }
  catch (error) { return error.code === "not-found" ? closeChannel(channel, { code: "not-found", message: error.message }) : replyError(channel, request, error.code, error.message, true); }
  let stopped = false, polling = false, previous = "";
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const names = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => entry.name);
      const ids = names.map((name) => /^agent-(.+)\.jsonl$/.exec(name)?.[1]).filter((id) => id && AGENT_ID.test(id));
      const boardRunning = activeSessions().some((session) => session.id === request.sessionId && !session.closed);
      const agents = [];
      for (const id of ids) {
        const files = subagentFiles(dir, id);
        let meta = {}, mtime = 0, started = 0;
        try { meta = JSON.parse(await readFile(files.metadata, "utf8")); } catch { /* metadata may not be written yet */ }
        try { ({ mtimeMs: mtime, birthtimeMs: started } = await stat(files.transcript)); } catch { /* transcript removed during this poll */ }
        // The CLI writes finished: true on completion; an agent whose process died never gets it,
        // so a missing key counts as running only while the session runs here or the transcript is fresh.
        const unfinished = !Object.hasOwn(meta, "finished");
        const running = unfinished && (boardRunning || Date.now() - mtime <= 120000);
        agents.push({ id, description: String(meta.description || meta.agentType || id), agentType: String(meta.agentType || "agent"), toolUseId: typeof meta.toolUseId === "string" ? meta.toolUseId : "", finished: meta.finished === true, unfinished, mtime, started, running });
      }
      agents.sort((a, b) => a.started - b.started || a.id.localeCompare(b.id));
      const signature = JSON.stringify(agents.map(({ id, finished, unfinished, running }) => [id, finished, unfinished, running]));
      if (signature !== previous) { previous = signature; await send(channel, { type: "subagents", agents }); }
    } catch { /* a failed poll is retried on the next tick */ }
    finally { polling = false; }
  };
  await poll();
  const timer = setInterval(() => void poll(), FOLLOW_INTERVAL_MS);
  watchFor(channel, () => { stopped = true; clearInterval(timer); });
}

// Local page only: tells the page when any stored transcript changed, at most once per LIST_THROTTLE_MS.
async function watchSessions(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Watching sessions is available only from the local board page." });
  let timer = null;
  let last = 0;
  const notify = () => { timer = null; last = Date.now(); void send(channel, { type: "sessions-changed" }).catch(() => {}); };
  let watcher;
  try {
    watcher = watch(claudeProjectsDir(), { recursive: true }, () => {
      if (!timer) timer = setTimeout(notify, Math.max(500, LIST_THROTTLE_MS - (Date.now() - last)));
    });
  } catch (error) { return replyError(channel, request, "protocol-error", `Cannot watch Claude sessions: ${error.message}`, true); }
  watcher.on("error", () => {});
  watchFor(channel, () => { clearTimeout(timer); watcher.close(); });
}

// Local page only: replays a stored transcript so a resumed session shows its earlier turns.
async function sessionHistory(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Session history is available only from the local board page." });
  if (typeof request.sessionId !== "string" || !SESSION_ID.test(request.sessionId)) return replyError(channel, request, "protocol-error", "A valid sessionId is required.", true);
  let sdk;
  try { sdk = await providerFor(request.provider || "claude").loadSdk(); }
  catch (error) { await replyError(channel, request, error.code || "provider-setup-required", error.message, true); return; }
  try {
    const messages = await sdk.getSessionMessages(request.sessionId, typeof request.cwd === "string" && request.cwd ? { dir: request.cwd } : undefined);
    const visible = messages.filter((message) => !message.parent_tool_use_id);
    const groupHistory = await host.hasGroupParticipants(request.sessionId).catch(() => false);
    const entries = visible.flatMap((message) => {
      const rows = historyEntries(message);
      if (groupHistory && message.type === "assistant" && !message.message?.content?.some?.((block) => block?.type === "tool_use")) {
        const last = rows.findLastIndex?.((entry) => entry.role === "agent") ?? rows.length - 1;
        if (last >= 0 && rows[last]?.role === "agent") rows[last] = { ...rows[last], text: `[[from: Master | role: main]]\n${rows[last].text}` };
      }
      return rows;
    });
    const batch = await sendEntries(channel, request, entries);
    await send(channel, echo({ type: "history", entries: batch, done: true }, request));
    await closeChannel(channel);
  } catch (error) { await replyError(channel, request, "protocol-error", error.message || "Could not read session history.", true); }
}

// Local page only: rename a stored session (an appended custom title) or delete its transcript from disk.
async function manageSession(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Session management is available only from the local board page." });
  const { action, sessionId } = request;
  if (!["rename", "delete"].includes(action) || typeof sessionId !== "string" || !sessionId) return replyError(channel, request, "protocol-error", "action (rename or delete) and sessionId are required.", true);
  const title = typeof request.title === "string" ? request.title.trim() : "";
  if (action === "rename" && !title) return replyError(channel, request, "protocol-error", "A session name is required.", true);
  const live = activeSessions().filter((session) => session.id === sessionId);
  if (action === "delete" && live.some((session) => session.crossBoard)) return replyError(channel, request, "session-busy", "Another board is using this session.", true);
  let sdk;
  try { sdk = await providerFor(request.provider || "claude").loadSdk(); }
  catch (error) { await replyError(channel, request, error.code || "provider-setup-required", error.message, true); return; }
  try {
    const options = typeof request.cwd === "string" && request.cwd ? { dir: request.cwd } : undefined;
    if (action === "rename") await sdk.renameSession(sessionId, boundedString(title, 1024).value, options);
    else {
      // The page closes its own channel first; wait for that teardown (or close a session still open) so the CLI has released the transcript.
      await Promise.all([...live.map((session) => closeSession(session, "session-deleted", true)), closingSessions.get(sessionId)]);
      await sdk.deleteSession(sessionId, options);
    }
    await send(channel, echo({ type: "session-updated", action, sessionId }, request));
    await closeChannel(channel);
  } catch (error) { await replyError(channel, request, "protocol-error", error.message || "Could not update the session.", true); }
}

// A new session's requested title becomes its stored custom title once the first turn has written the transcript.
async function applyPendingTitle(session) {
  const title = session.pendingTitle;
  session.pendingTitle = "";
  try { await session.sdk.renameSession(session.id, title, { dir: session.open.cwd }); }
  catch (error) { await send(session.channel, { type: "notice", message: `Could not save the session name: ${error.message || "rename failed"}` }, session); }
}

async function getSdkModels(session) {
  try {
    const models = await session.query.supportedModels();
    cachedModels = models.map(normalizeModel).filter((model) => model.id);
  } catch (error) {
    await send(session.channel, { type: "notice", message: `Could not refresh available model metadata: ${error.message || "SDK query unavailable"}` }, session);
  }
}

// Permission modes the board's own chat page can pick, as the terminal names them. Cross-board sessions use the
// contract's modes instead. Auto is the default; auto and plan let Claude Code decide, asking the page when it must.
const PAGE_MODES = ["bypassPermissions", "auto", "plan"];

function sessionOptions(session) {
  const open = session.open;
  const options = {
    cwd: open.cwd,
    ...(open.resume ? { resume: open.resume } : { sessionId: session.id }),
    ...(open.title ? { title: open.title } : {}),
    ...(open.model || session.defaults.passModel ? { model: open.model || session.defaults.passModel } : {}),
    ...(open.effort || session.defaults.passEffort ? { effort: open.effort || session.defaults.passEffort } : {}),
    permissionMode: session.nativeMode,
    allowDangerouslySkipPermissions: session.mode === "full-auto",
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code", append: session.composed },
    includePartialMessages: true,
    ...(open.limits?.maxAgentSteps ? { maxTurns: open.limits.maxAgentSteps } : {}),
    ...(open.limits?.maxBudgetUsd ? { maxBudgetUsd: open.limits.maxBudgetUsd } : {}),
    ...((session.endpoint || session.groupEndpoint) ? { mcpServers: {
      ...(session.endpoint ? { persephone: { type: "http", url: session.endpoint.url, headers: session.endpoint.headers } } : {}),
      ...(session.groupEndpoint ? { agent_chat: { type: "http", url: session.groupEndpoint.url, headers: { Authorization: `Bearer ${session.groupEndpoint.token}` } } } : {}),
    } } : {}),
    ...(session.endpoint && session.crossBoard && session.mode === "full-auto" ? { allowedTools: ["mcp__persephone__*"] } : {}),
    canUseTool: (name, input, opts) => requestApproval(session, name, input, opts),
    hooks: {
      PreToolUse: [{ hooks: [async (input) => {
        // Page sessions leave the decision to Claude Code's own mode; an allow here would let plan mode edit files.
        if (!session.crossBoard && !session.groupParticipant) return {};
        const decision = policyDecision(session, input.tool_name, input.tool_input);
        if (decision.permissionDecision === "ask" && session.allowedScopes.has(`${decision.kind}:${input.tool_name}`)) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Allowed for this session by user choice." } };
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.permissionDecision, permissionDecisionReason: decision.permissionDecision === "deny" ? (decision.message || `Denied by ${session.mode} contract policy.`) : "Eligible for contract approval flow." } };
      }] }],
    },
    pathToClaudeCodeExecutable: session.executable,
    spawnClaudeCodeProcess: (spawnOptions) => {
      const childEnv = { ...spawnOptions.env };
      delete childEnv.ANTHROPIC_API_KEY;
      delete childEnv.ANTHROPIC_AUTH_TOKEN;
      const child = spawn(session.executable, spawnOptions.args, {
        cwd: spawnOptions.cwd || open.cwd,
        env: childEnv,
        stdio: "pipe",
        windowsHide: true,
        signal: spawnOptions.signal,
      });
      registerProcess(session, child);
      return child;
    },
  };
  return options;
}

async function requestApproval(session, toolName, input, { signal } = {}) {
  if (session.groupParticipant) {
    const decision = policyDecision(session, toolName, input);
    if (decision.permissionDecision === "allow") return { behavior: "allow", updatedInput: input };
    return { behavior: "deny", message: decision.message || "This action is outside the joined agent's permission preset." };
  }
  if (!session.crossBoard) return pageApproval(session, toolName, input, signal);
  const decision = policyDecision(session, toolName, input);
  const scope = `${decision.kind}:${toolName}`;
  if (decision.permissionDecision === "deny") return { behavior: "deny", message: `Denied by ${session.mode} policy.` };
  if (decision.permissionDecision === "allow" || session.allowedScopes.has(scope)) return { behavior: "allow", updatedInput: input };
  if (session.mode === "read-only" || session.closed) return { behavior: "deny", message: "Session is no longer available." };
  const summary = summarizeToolInput(toolName, input);
  const detail = boundedString(summary.summary, 32 * 1024);
  const result = await askApproval(session, scope, { kind: approvalKind(toolName), summary: summary.summary, detail: detail.value, ...(summary.truncated || detail.truncated ? { truncated: true } : {}) }, signal, 5 * 60 * 1000);
  if (result.decision === "allow-session") session.allowedScopes.add(scope);
  if (result.decision === "allow" || result.decision === "allow-session") return { behavior: "allow", updatedInput: input };
  return { behavior: "deny", message: result.message || "Denied by the user." };
}

// The board's chat page, like the terminal: bypass allows everything; auto and plan ask only when Claude Code cannot
// decide. Approving a plan (ExitPlanMode) also picks the mode the work continues in.
async function pageApproval(session, toolName, input, signal) {
  if (session.closed) return { behavior: "deny", message: "Session is no longer available." };
  if (toolName === "ExitPlanMode") {
    const plan = boundedString(typeof input?.plan === "string" ? input.plan : "", 64 * 1024);
    const result = await askApproval(session, "plan:ExitPlanMode", { kind: "plan", summary: "Approve the plan?", plan: plan.value, ...(plan.truncated ? { truncated: true } : {}) }, signal, 0);
    if (result.decision !== "allow") return { behavior: "deny", message: result.message || "The user wants to keep planning. Ask what to change, then revise the plan." };
    const mode = PAGE_MODES.includes(result.mode) && result.mode !== "plan" ? result.mode : "auto";
    session.nativeMode = mode;
    await send(session.channel, sessionStatus(session), session);
    return { behavior: "allow", updatedInput: input, updatedPermissions: [{ type: "setMode", mode, destination: "session" }] };
  }
  const scope = `${policyDecision(session, toolName, input).kind}:${toolName}`;
  if (session.nativeMode === "bypassPermissions" || session.allowedScopes.has(scope)) return { behavior: "allow", updatedInput: input };
  const summary = summarizeToolInput(toolName, input);
  const detail = boundedString(summary.summary, 32 * 1024);
  const result = await askApproval(session, scope, { kind: approvalKind(toolName), tool: toolName, summary: summary.summary, detail: detail.value, ...(summary.truncated || detail.truncated ? { truncated: true } : {}) }, signal, 0);
  if (result.decision === "allow-session") session.allowedScopes.add(scope);
  if (result.decision === "allow" || result.decision === "allow-session") return { behavior: "allow", updatedInput: input };
  return { behavior: "deny", message: result.message || "Denied by the user." };
}

function userMessage(text) {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

// Provider-specific additive event (consumers ignore unknown types): model, effort, context fill,
// and plan rate-limit windows for the chat page's footer. Unknown values are omitted.
function sessionStatus(session) {
  const status = session.status;
  const percent = (value) => Number.isFinite(value) ? Math.round(value * 1000) / 10 : undefined;
  const window = (info) => info && Number.isFinite(info.utilization) ? { percent: percent(info.utilization), ...(info.resetsAt ? { resetsAt: new Date(info.resetsAt * 1000).toISOString() } : {}) } : undefined;
  const fiveHour = window(status.windows?.five_hour);
  const sevenDay = window(status.windows?.seven_day);
  return {
    type: "session-status",
    model: session.actualModel || session.open.model || session.defaults.model || "",
    modelLabel: session.adapter.modelLabel(session.actualModel || session.open.model || session.defaults.model || ""),
    compacting: Boolean(status.compacting),
    effort: session.open.effort || session.defaults.effort || "",
    ...(session.crossBoard ? {} : { mode: session.nativeMode }),
    ...(Number.isFinite(status.contextTokens) ? { contextTokens: status.contextTokens } : {}),
    ...(status.contextWindow ? { contextWindow: status.contextWindow } : {}),
    ...(Number.isFinite(status.contextTokens) && status.contextWindow ? { contextPercent: percent(status.contextTokens / status.contextWindow) } : {}),
    ...(fiveHour || sevenDay ? { limits: { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) } } : {}),
  };
}

// Returns true when a native message changed the footer status.
function trackStatus(session, message) {
  const status = session.status;
  // Claude Code reports its mode on init and on every change, such as leaving plan mode.
  if (message.type === "system" && (message.subtype === "status" || message.subtype === "init") && !session.crossBoard && message.permissionMode && message.permissionMode !== session.nativeMode) {
    session.nativeMode = message.permissionMode;
    return true;
  }
  if (message.type === "rate_limit_event" && message.rate_limit_info?.unifiedWindows) {
    status.windows = message.rate_limit_info.unifiedWindows;
    return true;
  }
  if (message.type === "system" && message.subtype === "status" && message.status === "compacting") { status.compacting = true; return true; }
  // Local command replies (/effort, /model) come back as "<synthetic>" assistant messages with zero usage; they say nothing about the model or context.
  if (message.type === "assistant" && !message.parent_tool_use_id && message.message?.usage && message.message.model !== "<synthetic>") {
    const usage = message.message.usage;
    status.contextTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    if (message.message.model) session.actualModel = message.message.model;
    return true;
  }
  if (message.type === "system" && message.subtype === "compact_boundary") {
    if (Number.isFinite(message.compact_metadata?.post_tokens)) status.contextTokens = message.compact_metadata.post_tokens;
    status.compacting = false;
    return true;
  }
  if (message.type === "result" && message.modelUsage) {
    const entries = Object.entries(message.modelUsage);
    const main = entries.find(([id]) => id === session.actualModel) || entries.sort((a, b) => (b[1].outputTokens || 0) - (a[1].outputTokens || 0))[0];
    if (main?.[1]?.contextWindow) status.contextWindow = main[1].contextWindow;
    return true;
  }
  return false;
}

async function emitNative(session, message) {
  if (message?.parent_tool_use_id != null) return;
  if (trackStatus(session, message)) await send(session.channel, sessionStatus(session), session);
  if (message.type === "system" && message.subtype === "init") {
    if (message.session_id) session.id = message.session_id;
    session.actualModel = message.model || session.actualModel;
    session.initSeen = true;
    await send(session.channel, sessionStatus(session), session);
    await getSdkModels(session);
    return;
  }
  let events = normalizeNativeMessage(message, session.nativeState);
  // An interrupted turn ends with an error_during_execution result; it ends the turn, not the session.
  if (session.interrupted && events.some((event) => event.type === "turn-ended")) events = events.filter((event) => event.type !== "error");
  let turnEnded = false;
  for (const event of events) {
    if (event.type === "turn-ended") {
      if (session.status.compacting) { session.status.compacting = false; await send(session.channel, sessionStatus(session), session); }
      if (session.interrupted) event.reason = "interrupted";
      if (session.pendingTitle) await applyPendingTitle(session);
      turnEnded = true;
      if (session.busy) {
        session.busy = false;
        session.completedTurns++;
        session.turnResolve?.();
        session.turnResolve = null;
      }
    }
    await send(session.channel, event, session);
    if (event.type === "error" && event.fatal) await closeSession(session, "fatal-result", true);
  }
  if (turnEnded) session.currentRequestId = null;
}

async function runQuery(session) {
  try {
    const prompt = session.inputQueue;
    session.query = session.sdk.query({ prompt, options: sessionOptions(session) });
    session.queryTask = (async () => {
      for await (const message of session.query) await emitNative(session, message);
    })();
    await session.queryTask;
  } catch (error) {
    if (!session.closed) await replyError(session.channel, session.currentRequestId ? { id: session.currentRequestId } : session.open, error.code || "protocol-error", error.message || "Claude session failed.", true, session);
  } finally {
    if (!session.closed && session.busy) {
      session.busy = false;
      await send(session.channel, { type: "turn-ended", reason: session.interrupted ? "interrupted" : "error", usage: {} }, session);
    }
  }
}

async function startSession(channel, openRequest, info) {
  await refreshSettings();
  const prepared = await prepareOpen(openRequest, info);
  const { open, crossBoard, mode } = prepared;
  if (open.resume && !SESSION_ID.test(open.resume)) throw Object.assign(new Error("Claude resume id must be a session UUID."), { code: "protocol-error" });
  // A missing cwd makes the CLI spawn fail with a misleading "binary failed to launch" ENOENT.
  const cwdStat = await stat(open.cwd).catch(() => null);
  if (!cwdStat?.isDirectory()) throw Object.assign(new Error(`The working directory does not exist: ${open.cwd}`), { code: "protocol-error" });
  const provider = providerFor(open.provider);
  if (!provider) throw Object.assign(new Error(`Provider is unavailable: ${open.provider}`), { code: "provider-unavailable" });
  const sdk = await provider.loadSdk();
  const executable = await provider.resolveExecutable(settings["claude-executable"] || "");
  const defaults = await sessionDefaults(open.cwd);
  const selectedModel = open.model || settings["default-model"] || "";
  const selectedEffort = open.effort || settings["default-effort"] || "";
  if (selectedModel && cachedModels && !cachedModels.some((model) => model.id === selectedModel)) throw Object.assign(new Error("The selected model is not in the current SDK model listing."), { code: "model-unavailable" });
  if (selectedEffort && cachedModels && selectedModel) {
    const modelInfo = cachedModels.find((model) => model.id === selectedModel);
    if (modelInfo && !modelInfo.efforts.includes(selectedEffort)) throw Object.assign(new Error("The selected effort is not supported by this model."), { code: "protocol-error" });
  }
  const endpoint = await issueOpenEndpoint(prepared);
  // The board's own chat page is unrestricted by contract and picks Claude Code's mode itself (PAGE_MODES).
  // Cross-board consumers use the contract's modes, clamped to the configured ceiling.
  const groupJoined = open.groupChat?.position === "joined";
  const groupEndpoint = groupJoined ? await host.issueGroupEndpoint(open.groupChat.participantId) : null;
  const nativeMode = groupJoined ? (mode === "read-only" ? "plan" : mode === "auto-edit" ? "acceptEdits" : mode === "full-auto" ? "bypassPermissions" : "default") : crossBoard ? MODE_NATIVE[mode] : PAGE_MODES.includes(open.mode) ? open.mode : "auto";
  const id = open.resume || randomUUID();
  const session = {
    id, channel, open, providerId: open.provider, adapter: provider, defaults, sdk, executable, mode, nativeMode, crossBoard, endpoint, groupEndpoint, groupMain: open.groupChat?.position === "main", policyMode: groupJoined ? mode : mode, composed: await makePreamble(open, Boolean(endpoint)),
    inputQueue: new AsyncQueue(), children: new Set(), approvals: new Map(), allowedScopes: new Set(),
    closed: false, busy: false, completedTurns: 0, initSeen: false, query: null, queryTask: null,
    interrupted: false, pendingFirstTurn: true, started: false, nativeState: { pendingFiles: new Map() }, status: {},
    pendingTitle: !open.resume && typeof open.title === "string" ? boundedString(open.title.trim(), 1024).value : "",
  };
  registerSession(session);
  await send(channel, echo({ type: "session-started", contractVersion: 1, provider: open.provider, sessionId: id, model: open.model || defaults.model || "Default", permissionMode: mode, limits: sessionLimits(open), instructions: { composed: session.composed }, mcp: { persephone: Boolean(endpoint) } }, open), session);
  await send(channel, sessionStatus(session), session);
  host.bindSession(session);
  session.runTask = runQuery(session);
  session.runTask.catch((error) => console.error("Claude session pump failed:", error));
}

async function handleSessionMessage(session, request) {
  if (session.closed || !request || typeof request.type !== "string") return;
  if (request.type === "send") {
    if (typeof request.text !== "string" || !request.text.trim()) return replyError(session.channel, request, "protocol-error", "send.text must be a non-empty string.", false, session);
    if (request.id !== undefined && (typeof request.id !== "string" || request.id.length > 256)) return replyError(session.channel, request, "protocol-error", "Request id must be a short string.", false, session);
    if (session.busy) return replyError(session.channel, request, "busy", "A turn is already running.", false, session);
    if (session.open.limits?.maxUserTurns && session.completedTurns >= session.open.limits.maxUserTurns) return replyError(session.channel, request, "limit-reached", "The session reached maxUserTurns.", false, session);
    if (request.attachments?.length) return replyError(session.channel, request, "protocol-error", "Attachments are not supported by this provider.", false, session);
    session.busy = true;
    session.interrupted = false;
    session.currentRequestId = request.id;
    await send(session.channel, echo({ type: "turn-started", turnId: randomUUID() }, request), session);
    trackTypedCommand(session, request.text);
    session.inputQueue.push(userMessage(request.text));
    return;
  }
  if (request.type === "interrupt") {
    if (session.busy && session.query) {
      session.interrupted = true;
      if (session.status.compacting) { session.status.compacting = false; await send(session.channel, sessionStatus(session), session); }
      try { await session.query.interrupt(); } catch { /* query may already have stopped */ }
      const query = session.query;
      setTimeout(async () => {
        if (!session.closed && session.busy) {
          try { await query.close?.(); } catch { /* best effort escalation */ }
          await killChildren(session, true);
        }
      }, 5000).unref?.();
    }
    return;
  }
  if (request.type === "approval-response") {
    return session.adapter.approve(session, request);
  }
  if (request.type === "close") return closeSession(session, "client-close", true);
  if (request.type === "control") return handleControl(session, request);
  // Unknown v1 additive message types are ignored.
}

// "/model <name>" and "/effort <level>" typed as messages change the live session; keep the footer in step.
function trackTypedCommand(session, text) {
  const command = /^\/(model|effort)\s+(\S+)\s*$/.exec(text.trim());
  if (command?.[1] === "model") { session.open.model = command[2] === "default" ? "" : command[2]; session.actualModel = ""; }
  if (command?.[1] === "effort" && (command[2] === "auto" || EFFORT_LEVELS.includes(command[2]))) session.open.effort = command[2] === "auto" ? "" : command[2];
}

// ── Session controls behind the board page's slash-command panels (/mcp, /model, /context) and its
// command menu. The SDK has no terminal UI, so the page draws its own from these. Local page only.
const validName = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
async function mcpStatus(session) {
  const servers = await session.query.mcpServerStatus();
  return (servers || []).map((server) => ({
    name: String(server.name),
    status: String(server.status || "pending"),
    ...(server.error ? { error: boundedString(String(server.error), 4096).value } : {}),
    scope: server.scope || "",
    transport: server.transport || server.config?.type || "",
    ...(server.urlHost ? { host: server.urlHost } : {}),
    ...(server.serverInfo ? { info: [server.serverInfo.title || server.serverInfo.name, server.serverInfo.version].filter(Boolean).join(" ") } : {}),
    tools: (server.tools || []).map((tool) => tool?.name).filter((name) => typeof name === "string"),
  }));
}
// The authenticate response is not documented; take the first web URL it carries for the user to open.
function findUrl(value, depth = 0) {
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : "";
  if (!value || typeof value !== "object" || depth > 3) return "";
  for (const item of Object.values(value)) { const url = findUrl(item, depth + 1); if (url) return url; }
  return "";
}
const CONTROL_ACTIONS = {
  async commands(session) {
    const commands = await session.query.supportedCommands();
    return {
      commands: (commands || []).filter((command) => validName(command?.name) && !command.name.startsWith("__")).map((command) => ({
        name: command.name,
        description: boundedString(command.description || "", 1024).value,
        ...(command.argumentHint ? { argumentHint: boundedString(command.argumentHint, 512).value } : {}),
      })),
    };
  },
  async "mcp-status"(session) { return { servers: await mcpStatus(session) }; },
  async "mcp-reconnect"(session, request) {
    await session.query.reconnectMcpServer(request.server);
    return { servers: await mcpStatus(session) };
  },
  async "mcp-toggle"(session, request) {
    await session.query.toggleMcpServer(request.server, request.enabled === true);
    return { servers: await mcpStatus(session) };
  },
  async "mcp-authenticate"(session, request) {
    const response = await session.query.mcpAuthenticate(request.server);
    const url = findUrl(response);
    return { ...(url ? { url } : {}), servers: await mcpStatus(session) };
  },
  async models(session) {
    const models = await session.query.supportedModels();
    return {
      current: session.open.model || session.defaults.model || "default",
      effort: session.open.effort || session.defaults.effort || "",
      models: (models || []).map((model) => ({
        id: String(model.value ?? ""),
        label: String(model.displayName ?? model.value ?? ""),
        description: String(model.description ?? ""),
        efforts: Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels.filter((effort) => typeof effort === "string") : [],
      })).filter((model) => model.id),
    };
  },
  async "set-model"(session, request) {
    const model = request.model === "default" ? "" : request.model;
    const known = (await session.query.supportedModels()).find((entry) => entry.value === request.model);
    await session.query.setModel(model || undefined);
    session.open.model = model;
    session.actualModel = known?.resolvedModel || model;
    await send(session.channel, sessionStatus(session), session);
    return {};
  },
  async "set-mode"(session, request) {
    await session.query.setPermissionMode(request.mode);
    session.nativeMode = request.mode;
    await send(session.channel, sessionStatus(session), session);
    return {};
  },
  async context(session) {
    const usage = await session.query.getContextUsage() || {};
    if (Number.isFinite(usage.totalTokens)) {
      session.status.contextTokens = usage.totalTokens;
      if (usage.maxTokens) session.status.contextWindow = usage.maxTokens;
      await send(session.channel, sessionStatus(session), session);
    }
    const tokens = (value) => Number.isFinite(value) ? value : 0;
    return {
      usage: {
        model: usage.model || "",
        totalTokens: tokens(usage.totalTokens),
        maxTokens: tokens(usage.maxTokens),
        percentage: tokens(usage.percentage),
        autoCompact: usage.isAutoCompactEnabled === true,
        ...(Number.isFinite(usage.autoCompactThreshold) ? { autoCompactThreshold: usage.autoCompactThreshold } : {}),
        categories: (usage.categories || []).map((category) => ({ id: String(category.id || category.name), name: String(category.name || category.id), tokens: tokens(category.tokens), kind: category.kind || "used" })),
        memoryFiles: (usage.memoryFiles || []).map((file) => ({ path: String(file.path || ""), tokens: tokens(file.tokens) })),
        mcpTools: (usage.mcpTools || []).map((tool) => ({ name: String(tool.name || ""), server: String(tool.serverName || tool.server || ""), tokens: tokens(tool.tokens) })),
        ...(usage.skills ? { skills: { count: tokens(usage.skills.includedSkills), tokens: tokens(usage.skills.tokens) } } : {}),
        ...(Array.isArray(usage.agents) ? { agents: { count: usage.agents.length, tokens: usage.agents.reduce((sum, agent) => sum + tokens(agent.tokens), 0) } } : {}),
      },
    };
  },
};
async function handleControl(session, request) {
  if (typeof request.id !== "string" || request.id.length > 256 || !Object.hasOwn(CONTROL_ACTIONS, request.action)) return replyError(session.channel, request, "protocol-error", "Invalid control request.", false, session);
  const reply = (body) => send(session.channel, { type: "control-result", id: request.id, action: request.action, ...body }, session);
  if (session.crossBoard) return reply({ ok: false, message: "Session controls are available only from the local board page." });
  if (request.action.startsWith("mcp-") && request.action !== "mcp-status" && !validName(request.server)) return reply({ ok: false, message: "A server name is required." });
  if (request.action === "set-model" && !validName(request.model)) return reply({ ok: false, message: "A model is required." });
  if (request.action === "set-mode" && !PAGE_MODES.includes(request.mode)) return reply({ ok: false, message: "Unknown permission mode." });
  if (!session.query) return reply({ ok: false, message: "The session is still starting." });
  try { await reply({ ok: true, ...(await CONTROL_ACTIONS[request.action](session, request)) }); }
  catch (error) { await reply({ ok: false, message: boundedString(error.message || "The control request failed.", 4096).value }); }
}

async function installConsent(channel) {
  try {
    const result = await providerFor("claude").setup({ action: "install" });
    await send(channel, { type: "provider-setup", ...result });
  } catch (error) {
    await send(channel, { type: "provider-setup", ready: false, error: boundedString(error.message || "Provider setup failed.", 32 * 1024).value });
  }
  await closeChannel(channel);
}

async function shutdown() {
  const active = activeSessions();
  await Promise.all(active.map((session) => closeSession(session, "service-shutdown", true)));
}

function createClaudeProvider(serviceHost) {
  host = serviceHost;
  ({ AsyncQueue, activeSessions, closingSessions, send, echo, replyError, closeChannel, registerSession, registerProcess, killChildren, sendEntries, askApproval, approve: approveShared, policyDecision, approvalKind, sessionLimits, prepareOpen, issueOpenEndpoint } = host);
  adapter = {
    id: "claude",
    capabilities: CAPABILITIES,
    async describe({ cwd }) {
      await refreshSettings();
      const ready = await sdkIsInstalled();
      return {
        provider: "claude", providerLabelKey: "provider.claude", icon: "claude", iconColor: "#d97757", models: cachedModels || MODEL_ALIASES, defaults: { ...(await sessionDefaults(cwd)), mode: "auto" },
        capabilities: CAPABILITIES,
        setup: { required: true, ready },
        chatOptions: { permissionModes: [
          { id: "bypassPermissions", labelKey: "mode.bypassPermissions", descriptionKey: "mode.bypassPermissions.desc" },
          { id: "auto", labelKey: "mode.auto", descriptionKey: "mode.auto.desc" },
          { id: "plan", labelKey: "mode.plan", descriptionKey: "mode.plan.desc", planApproval: true },
        ] },
      };
    },
    async collectSessions(request) { return collectClaudeSessions(request); },
    async setup({ action }) { return action === "install" ? installSdk() : { ready: await sdkIsInstalled() }; },
    async loadSdk() {
      try { return await loadSdk(); }
      catch (error) { if (error.code === "sdk-not-installed") error.code = "provider-setup-required"; throw error; }
    },
    async resolveExecutable(override) { return resolveClaudeExecutable(override); },
    modelLabel(id) {
      const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id || "");
      return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}${match[3] ? `.${match[3]}` : ""}${match[4] ? " 1M" : ""}` : id;
    },
    async describeRequest(channel, request, info) { return describe(channel, request, info); },
    listSessions(channel, request) { return listSessions(channel, request); },
    history(channel, request, info) { return sessionHistory(channel, request, info); },
    follow(channel, request, info) { return followSession(channel, request, info); },
    watchSessions(channel, request, info) { return watchSessions(channel, request, info); },
    manageSession(channel, request, info) { return manageSession(channel, request, info); },
    watchSubagents(channel, request, info) { return watchSubagents(channel, request, info); },
    subagentHistory(channel, request, info) { return subagentHistory(channel, request, info); },
    setupRequest(channel, request, info) {
      if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Provider setup is available only from the local board page." });
      return installConsent(channel);
    },
    dispatchSession(session, request) {
      if (request?.type === "send") return adapter.send(session, request);
      if (request?.type === "interrupt") return adapter.interrupt(session);
      if (request?.type === "control") return adapter.control(session, request);
      if (request?.type === "approval-response") return adapter.approve(session, request);
      if (request?.type === "close") return adapter.close(session, { reason: "client-close", force: true });
    },
    sessionCapability(request) {
      if (request?.type !== "control") return "";
      if (request.action === "commands") return "slashCommands";
      if (request.action === "models" || request.action === "set-model") return "modelSelection";
      if (request.action === "set-mode") return "permissionModes";
      if (request.action?.startsWith("mcp-")) return "mcpPanel";
      if (request.action === "context") return "contextUsage";
      return "";
    },
    close(session, options = {}) { return host.closeSession(session, options.reason || "provider-close", Boolean(options.force), true); },
    async closeProviderSession(session) {
      try { await session.query?.interrupt?.(); } catch { /* best effort */ }
      try { await session.query?.close?.(); } catch { /* best effort */ }
    },
    sessionStatus,
    // Named adapter operations keep all provider-specific storage and controls behind the same dispatch surface.
    async open(channel, request, info) { return startSession(channel, request, info); },
    send(session, request) { return handleSessionMessage(session, request); },
    interrupt(session) { return handleSessionMessage(session, { type: "interrupt" }); },
    approve(session, request) { return approveShared(session, request); },
    acceptsMode(mode) { return PAGE_MODES.includes(mode); },
    control(session, request) { return handleControl(session, request); },
    shutdownSessions: shutdown,
  };
  void refreshSettings().catch((error) => console.error("Claude Agent settings load failed:", error));
  listenSettings();
  return adapter;
}

export { createClaudeProvider };
