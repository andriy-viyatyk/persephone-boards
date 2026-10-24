import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, open as openFile, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appliedLimits, boundedString, clampMode, composeInstructions, hookDecision,
  MODE_NATIVE, normalizeModel, normalizeNativeMessage, parseTaskNotification, protocolError, serializeEvent, summarizeToolInput, validateOpen,
} from "./agent-session-protocol.mjs";
import { resolveClaudeExecutable } from "./claude-executable.mjs";
import { installSdk, loadSdk, sdkIsInstalled } from "./sdk-install.mjs";

const boardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessions = new Map();
// Teardowns still in progress, by session id, so a delete can wait for the CLI to release the transcript.
const closingSessions = new Map();
const MODEL_ALIASES = [
  { id: "", label: "Default", efforts: [] },
  { id: "sonnet", label: "Sonnet (CLI alias)", efforts: [] },
  { id: "opus", label: "Opus (CLI alias)", efforts: [] },
  { id: "haiku", label: "Haiku (CLI alias)", efforts: [] },
];
let cachedModels = null;
let settings = {};
const settingIds = ["claude-executable", "default-model", "default-effort", "cross-board-permission-ceiling"];

class AsyncQueue {
  values = [];
  waiters = [];
  ended = false;
  push(value) {
    if (this.ended) return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false }); else this.values.push(value);
    return true;
  }
  close() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
  next() {
    if (this.values.length) return Promise.resolve({ value: this.values.shift(), done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  [Symbol.asyncIterator]() { return this; }
}

async function refreshSettings() {
  const next = {};
  await Promise.all(settingIds.map(async (id) => { next[id] = await persephone.settings.get(id); }));
  settings = next;
  return settings;
}

function listenSettings() {
  persephone.settings.onChange(({ id, value }) => {
    if (settingIds.includes(id)) settings[id] = value;
  });
}

async function send(channel, event, session) {
  if (session?.closed) return;
  try {
    if (!channel.writable) await channel.whenWritable();
    if (session?.closed) return;
    const withId = session?.currentRequestId && event.id === undefined ? { ...event, id: session.currentRequestId } : event;
    channel.send(serializeEvent(withId));
  } catch (error) {
    if (!session?.closed) console.warn("Claude Agent channel send failed:", error?.code || error?.message || "unknown error");
  }
}

function echo(event, request) {
  return request?.id === undefined ? event : { ...event, id: request.id };
}

async function replyError(channel, request, code, message, fatal = false, session) {
  await send(channel, echo({ type: "error", code, message: boundedString(message, 32 * 1024).value, fatal }, request), session);
  if (fatal) {
    if (session) await closeSession(session, "fatal-error", true);
    else await closeChannel(channel, { code: "service-error", message: "Discovery request failed." });
  }
}

async function closeChannel(channel, reason) {
  try { channel.close(reason); } catch { /* already closed */ }
}

// Provider instructions (layer 2 of the contract's composition): the board's default until the user saves their own
// text from the page's Instructions dialog. Stored beside the SDK in the board's data folder, not in board settings,
// because a board page cannot write its settings.
const DEFAULT_INSTRUCTIONS = [
  "You are the user's assistant inside Persephone, a desktop workspace where they keep their work open in pages (tabs): files and notes, web pages in Persephone's browser (for example Teams, mail, tickets or documentation), screenshots and images they pasted, grids, diagrams and boards. Treat what is open in Persephone as the base context of every question.",
  "",
  "- When a question points at something without saying where it is (\"read the active chat\", \"check my screenshot\", \"what does this error mean\", \"summarize the discussion\"), assume it is open in Persephone and inspect Persephone before answering: list the open pages and read the one that matches.",
  "- This chat runs in Persephone's Claude Agent board. The user often keeps it pinned to the right of the window header and opens it as a popover over the page they are working on; the popover never becomes the active page. So when `pages.popoverPage` is this chat, the page the user means is almost always the active page (`page` / `pages.activePage`): read it first. When this chat is itself the active page, check the page grouped beside it first. Then look at the other open pages by title and type. Persephone can have several windows; look in the others when nothing in this one matches.",
  "- When a question is uncertain or could depend on what the user is looking at, check Persephone first. Ask the user only if the open pages do not settle it.",
  "- Read the content yourself instead of asking the user to paste it: the text or a screenshot of a browser page, the image on an image page, the content of a file or grid page.",
  "- Name the page you used (its title) so the user can correct you if it was the wrong one.",
  "- Inspecting is always fine; click, type, navigate or change pages only when the user asks you to act in Persephone.",
  "- Persephone's MCP tool is `mcp__persephone__call`; call it with no path for an overview of what it can reach. If Persephone MCP is not attached to this session, say so when a question needs it.",
  "- Questions about code or files in the working directory still use your normal tools.",
  "",
  "Write replies in GitHub-flavored Markdown: the chat renders headings, lists, tables, links and fenced code blocks. Keep replies concise and lead with the answer.",
].join("\n");
const INSTRUCTIONS_LIMIT = 64 * 1024;
function instructionsFile() {
  const base = process.env.LOCALAPPDATA;
  if (!base || !path.isAbsolute(base)) throw new Error("LOCALAPPDATA is not available; cannot store instructions.");
  return path.resolve(base, "Persephone", "board-data", "claude-agent", "instructions.md");
}
async function readInstructions() {
  try { return { text: await readFile(instructionsFile(), "utf8"), custom: true }; }
  catch (error) { if (error.code === "ENOENT") return { text: DEFAULT_INSTRUCTIONS, custom: false }; throw error; }
}

async function makePreamble(open, mcpAttached) {
  const { text } = await readInstructions().catch(() => ({ text: DEFAULT_INSTRUCTIONS }));
  return composeInstructions(open.cwd, mcpAttached, text.trim(), open.instructions);
}

// Local page only: read or replace the provider instructions. Saving the default text (or "reset") removes the file.
async function manageInstructions(channel, request, info) {
  if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "Instructions are editable only from the local board page." });
  try {
    if (request.action === "set" || request.action === "reset") {
      const text = request.action === "set" && typeof request.text === "string" ? request.text.replace(/\r\n/g, "\n") : DEFAULT_INSTRUCTIONS;
      if (Buffer.byteLength(text) > INSTRUCTIONS_LIMIT) return replyError(channel, request, "protocol-error", "Instructions are limited to 64 KiB.", true);
      const file = instructionsFile();
      if (text.trim() === DEFAULT_INSTRUCTIONS) await rm(file, { force: true });
      else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text, "utf8"); }
    } else if (request.action !== "get") return replyError(channel, request, "protocol-error", "action must be get, set, or reset.", true);
    const { text, custom } = await readInstructions();
    await send(channel, echo({ type: "instructions", text, custom, defaultText: DEFAULT_INSTRUCTIONS }, request));
    await closeChannel(channel);
  } catch (error) { await replyError(channel, request, "protocol-error", error.message || "Could not update the instructions.", true); }
}

async function describe(channel, request, info) {
  await refreshSettings();
  const installed = await sdkIsInstalled();
  await send(channel, echo({
    type: "description",
    contractVersion: 1,
    models: cachedModels || MODEL_ALIASES,
    permissionModes: ["read-only", "ask", "auto-edit", "full-auto"],
    permissionCeiling: settings["cross-board-permission-ceiling"] || "read-only",
    features: { resume: installed, thinkingStream: installed, usage: installed, cost: installed, maxAgentSteps: installed, maxBudgetUsd: installed },
    sdkInstalled: installed,
  }, request));
  await closeChannel(channel);
}

async function listSessions(channel, request) {
  await refreshSettings();
  let sdk;
  try { sdk = await loadSdk(); }
  catch (error) { await replyError(channel, request, error.code || "sdk-not-installed", error.message, true); return; }
  try {
    const options = { limit: 200, ...(request.cwd ? { dir: request.cwd } : {}) };
    const rows = await sdk.listSessions(options);
    const normalizePath = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    const filtered = request.cwd ? rows.filter((row) => row.cwd && normalizePath(row.cwd) === normalizePath(request.cwd)) : rows;
    const result = filtered.map((row) => ({
      id: row.sessionId,
      title: boundedString(row.customTitle || row.summary || row.firstPrompt || "Untitled session", 32 * 1024).value,
      updatedAt: new Date(row.lastModified).toISOString(),
      cwd: row.cwd || "",
    }));
    await send(channel, echo({ type: "sessions", sessions: result }, request));
    await closeChannel(channel);
  } catch (error) { await replyError(channel, request, "protocol-error", error.message || "Could not list sessions.", true); }
}

// CLI-generated user turns (caveats, reminders) are not things the user typed. Slash commands are stored as
// tagged user turns: the command line becomes a "command" entry and its printed output a "command-output" one.
const SYNTHETIC_USER_TEXT = /^\s*<(command-|local-command-|system-reminder)/;
const COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const COMMAND_OUTPUT = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/;
const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/;
const HISTORY_BATCH_BYTES = 600 * 1024;

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

// Sends history entries in batches that stay under the channel's message budget.
async function sendEntries(channel, request, entries, extra = {}) {
  let batch = [];
  let batchBytes = 0;
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (batch.length && batchBytes + size > HISTORY_BATCH_BYTES) {
      await send(channel, echo({ type: "history", entries: batch, ...extra }, request));
      batch = []; batchBytes = 0;
    }
    batch.push(entry); batchBytes += size;
  }
  return batch;
}

// ── Watching transcripts written by other processes (a terminal Claude Code, another board) ──
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLLOW_INTERVAL_MS = 1000;
const LIST_THROTTLE_MS = 3000;
const watchers = new Set();
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
  const entry = { stop };
  watchers.add(entry);
  channel.onClose(() => { watchers.delete(entry); stop(); });
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
      const boardRunning = [...sessions.values()].some((session) => session.id === request.sessionId && !session.closed);
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
  if (typeof request.sessionId !== "string" || !request.sessionId) return replyError(channel, request, "protocol-error", "sessionId is required.", true);
  let sdk;
  try { sdk = await loadSdk(); }
  catch (error) { await replyError(channel, request, error.code || "sdk-not-installed", error.message, true); return; }
  try {
    const messages = await sdk.getSessionMessages(request.sessionId, typeof request.cwd === "string" && request.cwd ? { dir: request.cwd } : undefined);
    const entries = messages.filter((message) => !message.parent_tool_use_id).flatMap(historyEntries);
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
  const live = [...sessions.values()].filter((session) => session.id === sessionId);
  if (action === "delete" && live.some((session) => session.crossBoard)) return replyError(channel, request, "session-busy", "Another board is using this session.", true);
  let sdk;
  try { sdk = await loadSdk(); }
  catch (error) { await replyError(channel, request, error.code || "sdk-not-installed", error.message, true); return; }
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

function sessionLimits(open) {
  return appliedLimits(open.limits || {});
}

async function getSdkModels(session) {
  try {
    const models = await session.query.supportedModels();
    cachedModels = models.map(normalizeModel).filter((model) => model.id);
  } catch (error) {
    await send(session.channel, { type: "notice", message: `Could not refresh available model metadata: ${error.message || "SDK query unavailable"}` }, session);
  }
}

function sessionOptions(session) {
  const open = session.open;
  const options = {
    cwd: open.cwd,
    ...(open.resume ? { resume: open.resume } : { sessionId: session.id }),
    ...(open.title ? { title: open.title } : {}),
    ...(open.model ? { model: open.model } : settings["default-model"] ? { model: settings["default-model"] } : {}),
    ...(open.effort ? { effort: open.effort } : settings["default-effort"] ? { effort: settings["default-effort"] } : {}),
    permissionMode: MODE_NATIVE[session.mode],
    allowDangerouslySkipPermissions: session.mode === "full-auto",
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code", append: session.composed },
    includePartialMessages: true,
    ...(open.limits?.maxAgentSteps ? { maxTurns: open.limits.maxAgentSteps } : {}),
    ...(open.limits?.maxBudgetUsd ? { maxBudgetUsd: open.limits.maxBudgetUsd } : {}),
    ...(session.endpoint ? { mcpServers: { persephone: { type: "http", url: session.endpoint.url, headers: session.endpoint.headers } } } : {}),
    ...(session.endpoint && session.mode === "full-auto" ? { allowedTools: ["mcp__persephone__*"] } : {}),
    canUseTool: (name, input, opts) => requestApproval(session, name, input, opts),
    hooks: {
      PreToolUse: [{ hooks: [async (input) => {
        const decision = hookDecision(session.mode, input.tool_name, input.tool_input, open.cwd);
        if (decision.permissionDecision === "ask" && session.allowedScopes.has(`${decision.kind}:${input.tool_name}`)) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Allowed for this session by user choice." } };
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.permissionDecision, permissionDecisionReason: decision.permissionDecision === "deny" ? `Denied by ${session.mode} contract policy.` : "Eligible for contract approval flow." } };
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
      session.children.add(child);
      return child;
    },
  };
  return options;
}

function approvalKind(name) {
  const { kind } = hookDecision("ask", name);
  return kind === "read" ? "other" : kind;
}

async function requestApproval(session, toolName, input, { signal } = {}) {
  const decision = hookDecision(session.mode, toolName, input, session.open.cwd);
  const scope = `${decision.kind}:${toolName}`;
  if (decision.permissionDecision === "deny") return { behavior: "deny", message: `Denied by ${session.mode} policy.` };
  if (decision.permissionDecision === "allow" || session.allowedScopes.has(scope)) return { behavior: "allow", updatedInput: input };
  if (session.mode === "read-only" || session.closed) return { behavior: "deny", message: "Session is no longer available." };
  const requestId = randomUUID();
  const summary = summarizeToolInput(toolName, input);
  const detail = boundedString(summary.summary, 32 * 1024);
  const answer = new Promise((resolve) => {
    const timer = setTimeout(() => settleApproval(session, requestId, { decision: "deny", message: "Approval timed out." }), 5 * 60 * 1000);
    const abort = () => settleApproval(session, requestId, { decision: "deny", message: "Turn was interrupted." });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    session.approvals.set(requestId, { resolve, cleanup, scope });
    signal?.addEventListener("abort", abort, { once: true });
  });
  await send(session.channel, { type: "approval-request", requestId, kind: approvalKind(toolName), summary: summary.summary, detail: detail.value, ...(summary.truncated || detail.truncated ? { truncated: true } : {}) }, session);
  const result = await answer;
  if (result.decision === "allow-session") session.allowedScopes.add(scope);
  if (result.decision === "allow" || result.decision === "allow-session") return { behavior: "allow", updatedInput: input };
  return { behavior: "deny", message: result.message || "Denied by the user." };
}

function settleApproval(session, id, result) {
  const pending = session.approvals.get(id);
  if (!pending) return;
  session.approvals.delete(id);
  pending.cleanup();
  pending.resolve(result);
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
    model: session.actualModel || session.open.model || settings["default-model"] || "",
    effort: session.open.effort || settings["default-effort"] || "",
    ...(Number.isFinite(status.contextTokens) ? { contextTokens: status.contextTokens } : {}),
    ...(status.contextWindow ? { contextWindow: status.contextWindow } : {}),
    ...(Number.isFinite(status.contextTokens) && status.contextWindow ? { contextPercent: percent(status.contextTokens / status.contextWindow) } : {}),
    ...(fiveHour || sevenDay ? { limits: { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) } } : {}),
  };
}

// Returns true when a native message changed the footer status.
function trackStatus(session, message) {
  const status = session.status;
  if (message.type === "rate_limit_event" && message.rate_limit_info?.unifiedWindows) {
    status.windows = message.rate_limit_info.unifiedWindows;
    return true;
  }
  if (message.type === "assistant" && !message.parent_tool_use_id && message.message?.usage) {
    const usage = message.message.usage;
    status.contextTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    if (message.message.model) session.actualModel = message.message.model;
    return true;
  }
  if (message.type === "system" && message.subtype === "compact_boundary" && Number.isFinite(message.compact_metadata?.post_tokens)) {
    status.contextTokens = message.compact_metadata.post_tokens;
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
    if (!session.modelNoticeSent && session.actualModel && session.actualModel !== (session.open.model || settings["default-model"] || "Default")) {
      session.modelNoticeSent = true;
      await send(session.channel, { type: "notice", message: `Claude selected model ${session.actualModel}.` }, session);
    }
    await getSdkModels(session);
    return;
  }
  let events = normalizeNativeMessage(message, session.nativeState);
  // An interrupted turn ends with an error_during_execution result; it ends the turn, not the session.
  if (session.interrupted && events.some((event) => event.type === "turn-ended")) events = events.filter((event) => event.type !== "error");
  let turnEnded = false;
  for (const event of events) {
    if (event.type === "turn-ended") {
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
  const open = validateOpen(openRequest);
  // A missing cwd makes the CLI spawn fail with a misleading "binary failed to launch" ENOENT.
  const cwdStat = await stat(open.cwd).catch(() => null);
  if (!cwdStat?.isDirectory()) throw Object.assign(new Error(`The working directory does not exist: ${open.cwd}`), { code: "protocol-error" });
  const sdk = await loadSdk();
  const executable = await resolveClaudeExecutable(settings["claude-executable"] || "");
  const selectedModel = open.model || settings["default-model"] || "";
  const selectedEffort = open.effort || settings["default-effort"] || "";
  if (selectedModel && cachedModels && !cachedModels.some((model) => model.id === selectedModel)) throw Object.assign(new Error("The selected model is not in the current SDK model listing."), { code: "model-unavailable" });
  if (selectedEffort && cachedModels && selectedModel) {
    const modelInfo = cachedModels.find((model) => model.id === selectedModel);
    if (modelInfo && !modelInfo.efforts.includes(selectedEffort)) throw Object.assign(new Error("The selected effort is not supported by this model."), { code: "protocol-error" });
  }
  const crossBoard = Boolean(info.interface && info.caller);
  // The board's own chat page has no permission modes: its sessions always run unrestricted.
  // Only cross-board consumers use the contract's modes, clamped to the configured ceiling.
  const mode = crossBoard ? clampMode(open.permissionMode, settings["cross-board-permission-ceiling"] || "read-only") : "full-auto";
  const wantsMcp = open.mcp?.persephone !== false && mode !== "read-only";
  const endpoint = wantsMcp ? await persephone.mcp.issueSessionEndpoint() : null;
  const id = open.resume || randomUUID();
  const session = {
    id, channel, open, sdk, executable, mode, crossBoard, endpoint, composed: await makePreamble(open, Boolean(endpoint)),
    inputQueue: new AsyncQueue(), children: new Set(), approvals: new Map(), allowedScopes: new Set(),
    closed: false, busy: false, completedTurns: 0, initSeen: false, query: null, queryTask: null,
    interrupted: false, pendingFirstTurn: true, started: false, nativeState: { pendingFiles: new Map() }, status: {},
    pendingTitle: !open.resume && typeof open.title === "string" ? boundedString(open.title.trim(), 1024).value : "",
  };
  sessions.set(channel, session);
  await send(channel, echo({ type: "session-started", contractVersion: 1, sessionId: id, model: open.model || settings["default-model"] || "Default", permissionMode: mode, limits: sessionLimits(open), instructions: { composed: session.composed }, mcp: { persephone: Boolean(endpoint) } }, open), session);
  await send(channel, sessionStatus(session), session);
  channel.onMessage((request) => void handleSessionMessage(session, request));
  channel.onClose((reason) => void closeSession(session, reason?.code || "channel-closed", false));
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
    if (!["allow", "allow-session", "deny"].includes(request.decision) || typeof request.requestId !== "string") return replyError(session.channel, request, "protocol-error", "Invalid approval response.", false, session);
    if (request.message !== undefined && typeof request.message !== "string") return replyError(session.channel, request, "protocol-error", "Approval message must be a string.", false, session);
    const pending = session.approvals.get(request.requestId);
    if (!pending) return;
    if ((request.decision === "allow" || request.decision === "allow-session") && hookDecision(session.mode, pending.scope.split(":").slice(1).join(":" )).permissionDecision === "deny") {
      return settleApproval(session, request.requestId, { decision: "deny", message: "Action exceeds the effective permission mode." });
    }
    settleApproval(session, request.requestId, { decision: request.decision, message: request.message ? boundedString(request.message, 32 * 1024).value : undefined });
    return;
  }
  if (request.type === "close") return closeSession(session, "client-close", true);
  if (request.type === "control") return handleControl(session, request);
  // Unknown v1 additive message types are ignored.
}

// "/model <name>" and "/effort <level>" typed as messages change the live session; keep the footer in step.
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
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
      current: session.open.model || settings["default-model"] || "default",
      effort: session.open.effort || settings["default-effort"] || "",
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
  if (!session.query) return reply({ ok: false, message: "The session is still starting." });
  try { await reply({ ok: true, ...(await CONTROL_ACTIONS[request.action](session, request)) }); }
  catch (error) { await reply({ ok: false, message: boundedString(error.message || "The control request failed.", 4096).value }); }
}

async function killChildren(session, force) {
  const children = [...session.children];
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (force && process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.unref();
    } else {
      if (child.killed) continue;
      try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* already exited */ }
    }
  }
}

function closeSession(session, reason, closeTransport) {
  if (!session) return Promise.resolve();
  if (!session.closeTask) {
    const task = teardownSession(session, reason, closeTransport).finally(() => { if (closingSessions.get(session.id) === task) closingSessions.delete(session.id); });
    session.closeTask = task;
    closingSessions.set(session.id, task);
  }
  return session.closeTask;
}

async function teardownSession(session, reason, closeTransport) {
  session.closed = true;
  sessions.delete(session.channel);
  for (const id of [...session.approvals.keys()]) settleApproval(session, id, { decision: "deny", message: "Session closed." });
  session.inputQueue.close();
  try { await session.query?.interrupt(); } catch { /* best effort */ }
  try { await session.query?.close?.(); } catch { /* best effort */ }
  await killChildren(session, true);
  try { session.endpoint?.revoke(); } catch { /* host also revokes on shutdown */ }
  if (closeTransport) await closeChannel(session.channel, { code: "channel-closed", message: `Claude session ended (${reason}).` });
}

async function installConsent(channel) {
  try {
    const result = await installSdk();
    await send(channel, { type: "sdk-installed", ...result });
  } catch (error) {
    await send(channel, { type: "sdk-install-error", message: boundedString(error.message || "SDK install failed.", 32 * 1024).value });
  }
  await closeChannel(channel);
}

async function onChannel(channel, openMessage, info) {
  if (openMessage?.type === "describe") {
    try { return await describe(channel, openMessage, info); }
    catch (error) { return replyError(channel, openMessage, error.code || "protocol-error", error.message || "Description failed.", true); }
  }
  if (openMessage?.type === "list-sessions") return listSessions(channel, openMessage);
  if (openMessage?.type === "session-history") return sessionHistory(channel, openMessage, info);
  if (openMessage?.type === "subagent-history") return subagentHistory(channel, openMessage, info);
  if (openMessage?.type === "manage-session") return manageSession(channel, openMessage, info);
  if (openMessage?.type === "instructions") return manageInstructions(channel, openMessage, info);
  if (openMessage?.type === "follow-session") return followSession(channel, openMessage, info);
  if (openMessage?.type === "watch-subagents") return watchSubagents(channel, openMessage, info);
  if (openMessage?.type === "watch-sessions") return watchSessions(channel, openMessage, info);
  if (openMessage?.type === "consent-sdk") {
    if (info.interface || info.caller) return closeChannel(channel, { code: "connection-refused", message: "SDK consent is available only from the local board page." });
    return installConsent(channel);
  }
  if (openMessage?.type !== "open") {
    await replyError(channel, openMessage, "protocol-error", "Unsupported agent.session opening request.", true);
    return;
  }
  try { await startSession(channel, openMessage, info); }
  catch (error) {
    await replyError(channel, openMessage, error.code || "protocol-error", error.message || "Could not start Claude session.", true);
    await closeChannel(channel, { code: "service-error", message: "Claude session could not start." });
  }
}

persephone.service.onChannel((channel, openMessage, info) => { void onChannel(channel, openMessage, info); });
persephone.service.onShutdown(async () => {
  const active = [...sessions.values()];
  for (const session of active) {
    for (const id of [...session.approvals.keys()]) settleApproval(session, id, { decision: "deny", message: "Service shutting down." });
    session.closed = true;
    session.inputQueue.close();
    try { void session.query?.interrupt().catch(() => {}); } catch { /* best effort */ }
    try { void session.query?.close?.().catch(() => {}); } catch { /* best effort */ }
    try { session.endpoint?.revoke(); } catch { /* best effort */ }
  }
  await Promise.all(active.map((session) => killChildren(session, true)));
  sessions.clear();
  for (const entry of [...watchers]) entry.stop();
  watchers.clear();
});

void refreshSettings().catch((error) => console.error("Could not load Claude Agent settings:", error));
listenSettings();
