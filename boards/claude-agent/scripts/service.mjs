import { spawn } from "node:child_process";
import { appliedLimits, boundedString, clampMode, hookDecision, serializeEvent, validateOpen } from "./agent-session-protocol.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClaudeProvider } from "./providers/claude.mjs";
import { createCodexProvider } from "./providers/codex.mjs";
import { composeInstructions } from "./agent-session-protocol.mjs";

// The resident service is the provider registry and channel entry point. Adapters own
// their operation implementations and receive every opening and live-session request
// through this boundary.
class AsyncQueue {
  values = []; waiters = []; ended = false;
  push(value) { if (this.ended) return false; const waiter = this.waiters.shift(); if (waiter) waiter({ value, done: false }); else this.values.push(value); return true; }
  close() { this.ended = true; for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true }); }
  next() { if (this.values.length) return Promise.resolve({ value: this.values.shift(), done: false }); if (this.ended) return Promise.resolve({ value: undefined, done: true }); return new Promise((resolve) => this.waiters.push(resolve)); }
  [Symbol.asyncIterator]() { return this; }
}
const sessions = new Map();
const closingSessions = new Map();
const watchers = new Set();
function registerSession(session) { sessions.set(session.channel, { providerId: session.providerId, adapter: session.adapter, providerSession: session }); }
const activeSessions = () => [...sessions.values()].map((record) => record.providerSession);
const HISTORY_BATCH_BYTES = 600 * 1024;
const INSTRUCTIONS_LIMIT = 64 * 1024;
const CLAUDE_DEFAULT_INSTRUCTIONS = [
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
const CODEX_DEFAULT_INSTRUCTIONS = "You are the user's assistant inside Persephone, a desktop workspace where they keep their work open in pages. Treat open Persephone pages as context when relevant. Inspect the active or grouped page before asking the user to paste visible content. Do not act in Persephone unless asked. Questions about files in the working directory use your normal tools. Write concise replies in GitHub-flavored Markdown.";
const instructionDefaults = new Map([["claude", CLAUDE_DEFAULT_INSTRUCTIONS], ["codex", CODEX_DEFAULT_INSTRUCTIONS]]);
function instructionsFile(providerId) {
  const base = process.env.LOCALAPPDATA;
  if (!base || !path.isAbsolute(base)) throw new Error("LOCALAPPDATA is not available; cannot store instructions.");
  return path.resolve(base, "Persephone", "board-data", "claude-agent", providerId === "codex" ? "instructions-codex.md" : "instructions.md");
}
async function readInstructions(providerId) {
  const defaultText = instructionDefaults.get(providerId) || CLAUDE_DEFAULT_INSTRUCTIONS;
  try { return { text: await readFile(instructionsFile(providerId), "utf8"), custom: true, defaultText }; }
  catch (error) { if (error.code === "ENOENT") return { text: defaultText, custom: false, defaultText }; throw error; }
}
async function composeProviderInstructions(providerId, environment, caller) {
  const stored = await readInstructions(providerId).catch(() => ({ text: instructionDefaults.get(providerId) || CLAUDE_DEFAULT_INSTRUCTIONS }));
  return composeInstructions(environment, stored.text.trim(), caller);
}
async function manageInstructions(channel, request, info) {
  if (info?.interface || info?.caller) return closeChannel(channel, { code: "connection-refused", message: "Instructions are editable only from the local board page." });
  const providerId = request.provider || "claude";
  const defaultText = instructionDefaults.get(providerId);
  if (!defaultText) return replyError(channel, request, "provider-unavailable", "The selected provider is unavailable.", true);
  try {
    if (request.action === "set" || request.action === "reset") {
      const text = request.action === "set" && typeof request.text === "string" ? request.text.replace(/\r\n/g, "\n") : defaultText;
      if (Buffer.byteLength(text) > INSTRUCTIONS_LIMIT) return replyError(channel, request, "protocol-error", "Instructions are limited to 64 KiB.", true);
      const file = instructionsFile(providerId);
      if (text.trim() === defaultText) await rm(file, { force: true });
      else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text, "utf8"); }
    } else if (request.action !== "get") return replyError(channel, request, "protocol-error", "action must be get, set, or reset.", true);
    const stored = await readInstructions(providerId);
    await send(channel, echo({ type: "instructions", ...stored }, request));
    closeChannel(channel);
  } catch (error) { await replyError(channel, request, "protocol-error", error.message || "Could not update the instructions.", true); }
}
const OPEN_CAPABILITIES = {
  "list-sessions": "sessionStore", "session-history": "sessionStore", "manage-session": "sessionStore",
  "follow-session": "transcriptFollow", "watch-sessions": "transcriptFollow",
  "watch-subagents": "subagents", "subagent-history": "subagents", "provider-setup": "providerSetup",
};
const LOCAL_PAGE_ONLY = new Set(["session-history", "follow-session", "manage-session", "instructions", "watch-sessions", "watch-subagents", "subagent-history", "provider-setup"]);
async function send(channel, event, session) {
  if (session?.closed) return;
  try {
    if (!channel.writable) await channel.whenWritable();
    if (session?.closed) return;
    const withId = session?.currentRequestId && event.id === undefined ? { ...event, id: session.currentRequestId } : event;
    channel.send(serializeEvent(withId));
  } catch (error) { if (!session?.closed) console.warn("Agent channel send failed:", error?.code || error?.message || "unknown error"); }
}
const echo = (event, request) => request?.id === undefined ? event : { ...event, id: request.id };
function closeChannel(channel, reason) { try { channel.close(reason); } catch { /* already closed */ } }
async function replyError(channel, request, code, message, fatal = false, session) {
  await send(channel, echo({ type: "error", code, message: boundedString(message, 32 * 1024).value, fatal }, request), session);
  if (!fatal) return;
  if (session) await session.adapter.close(session, { reason: "fatal-error", force: true });
  else closeChannel(channel, { code: "service-error", message: "Discovery request failed." });
}
function registerProcess(session, child) { session.children.add(child); return child; }
async function killChildren(session, force) {
  for (const child of [...session.children]) {
    if (child.exitCode !== null) continue;
    if (force && process.platform === "win32" && child.pid) spawnTaskkill(child.pid);
    else if (!child.killed) { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* already exited */ } }
  }
}
function spawnTaskkill(pid) {
  const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); child.unref();
}
async function sendEntries(channel, request, entries, extra = {}) {
  let batch = [], bytes = 0;
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (batch.length && bytes + size > HISTORY_BATCH_BYTES) { await send(channel, echo({ type: "history", entries: batch, ...extra }, request)); batch = []; bytes = 0; }
    batch.push(entry); bytes += size;
  }
  return batch;
}
async function askApproval(session, scope, event, signal, timeoutMs) {
  const requestId = randomUUID();
  const answer = new Promise((resolve) => {
    const timer = timeoutMs ? setTimeout(() => settleApproval(session, requestId, { decision: "deny", message: "Approval timed out." }), timeoutMs) : null;
    const abort = () => settleApproval(session, requestId, { decision: "deny", message: "Turn was interrupted." });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    session.approvals.set(requestId, { resolve, cleanup, scope });
    signal?.addEventListener("abort", abort, { once: true });
  });
  await send(session.channel, { type: "approval-request", requestId, ...event }, session);
  return answer;
}
function settleApproval(session, id, result) {
  const pending = session.approvals.get(id);
  if (!pending) return;
  session.approvals.delete(id); pending.cleanup(); pending.resolve(result);
}
function approve(session, request) {
  if (!request || !["allow", "allow-session", "deny"].includes(request.decision) || typeof request.requestId !== "string") return replyError(session.channel, request, "protocol-error", "Invalid approval response.", false, session);
  if (request.message !== undefined && typeof request.message !== "string") return replyError(session.channel, request, "protocol-error", "Approval message must be a string.", false, session);
  const pending = session.approvals.get(request.requestId);
  if (!pending) return;
  const toolName = pending.scope.split(":").slice(1).join(":");
  if ((request.decision === "allow" || request.decision === "allow-session") && hookDecision(session.policyMode || session.mode, toolName).permissionDecision === "deny") {
    return settleApproval(session, request.requestId, { decision: "deny", message: "Action exceeds the effective permission mode." });
  }
  if (request.mode !== undefined && !session.adapter.acceptsMode(request.mode)) return replyError(session.channel, request, "protocol-error", "Approval continuation mode is invalid.", false, session);
  settleApproval(session, request.requestId, { decision: request.decision, message: request.message ? boundedString(request.message, 32 * 1024).value : undefined, ...(request.mode ? { mode: request.mode } : {}) });
}
const policyDecision = (session, toolName, input = {}) => hookDecision(session.policyMode || session.mode, toolName, input, session.open.cwd);
function approvalKind(toolName) { const kind = hookDecision("ask", toolName).kind; return kind === "read" ? "other" : kind; }
function selectPermissionMode({ requested, ceiling, crossBoard }) { return crossBoard ? clampMode(requested, ceiling) : "full-auto"; }
const sessionLimits = (open) => appliedLimits(open.limits || {});
const issueEndpoint = (enabled) => enabled ? persephone.mcp.issueSessionEndpoint() : null;
function revokeEndpoint(session) {
  if (!session?.endpoint || session.endpointRevoked) return;
  session.endpointRevoked = true;
  try { session.endpoint.revoke(); } catch { /* already revoked */ }
}
async function prepareOpen(request, info) {
  const open = validateOpen(request);
  const crossBoard = Boolean(info?.interface && info?.caller);
  const ceiling = (await persephone.settings.get("cross-board-permission-ceiling")) || "read-only";
  const mode = selectPermissionMode({ requested: open.permissionMode, ceiling, crossBoard });
  return { open, crossBoard, mode };
}
const issueOpenEndpoint = (prepared) => issueEndpoint(prepared.open.mcp?.persephone !== false && prepared.mode !== "read-only");
async function closeSession(session, reason, force = false, closeTransport = false) {
  if (!session) return;
  if (session.closeTask) return session.closeTask;
  const task = (async () => {
    if (session.status?.compacting) { session.status.compacting = false; await send(session.channel, session.adapter.sessionStatus(session), session); }
    session.closed = true;
    sessions.delete(session.channel);
    for (const [id, approval] of session.approvals) { approval.cleanup?.(); approval.resolve({ decision: "deny", message: "Session closed." }); session.approvals.delete(id); }
    session.inputQueue?.close();
    await session.adapter.closeProviderSession(session, { reason, force });
    await killChildren(session, true);
    revokeEndpoint(session);
    if (closeTransport) closeChannel(session.channel, { code: "channel-closed", message: `Agent session ended (${reason}).` });
  })().finally(() => { if (closingSessions.get(session.id) === task) closingSessions.delete(session.id); });
  session.closeTask = task; closingSessions.set(session.id, task); return task;
}
async function dispatchSession(session, request) {
  const capability = session.adapter.sessionCapability?.(request);
  if (capability && session.adapter.capabilities?.[capability] !== true) return replyError(session.channel, request, "unsupported-operation", `This provider does not support ${request.action || request.type}.`, false, session);
  try { return await session.adapter.dispatchSession(session, request); }
  catch (error) {
    if (request?.type === "send") { session.busy = false; await send(session.channel, { type: "turn-ended", reason: "error", usage: {} }, session); }
    return replyError(session.channel, request, error.code || "protocol-error", error.message || "The session operation failed.", false, session);
  }
}
function bindSession(session) {
  session.channel.onMessage((request) => void dispatchSession(session, request));
  session.channel.onClose((reason) => void closeSession(session, reason?.code || "channel-closed"));
}
function watchFor(channel, stop) {
  const entry = { stop };
  watchers.add(entry);
  channel.onClose(() => { watchers.delete(entry); stop(); });
}
const host = { AsyncQueue, sessions, closingSessions, watchers, send, echo, replyError, closeChannel, registerSession, activeSessions, registerProcess, killChildren, sendEntries, closeSession, askApproval, settleApproval, approve, policyDecision, approvalKind, selectPermissionMode, sessionLimits, issueEndpoint, issueOpenEndpoint, revokeEndpoint, prepareOpen, bindSession, watchFor, composeInstructions: composeProviderInstructions };
const providers = new Map([["claude", createClaudeProvider(host)], ["codex", createCodexProvider(host)]]);

async function sendProviderError(channel, request, code, message) {
  const event = { type: "error", code, message, fatal: true, ...(request?.id === undefined ? {} : { id: request.id }) };
  await send(channel, event);
  try { channel.close({ code, message }); } catch { /* already closed */ }
}

const OPEN_OPERATIONS = {
  describe: "describeRequest", "list-sessions": "listSessions", "session-history": "history",
  "follow-session": "follow", "watch-sessions": "watchSessions", "manage-session": "manageSession",
  "watch-subagents": "watchSubagents", "subagent-history": "subagentHistory",
  "provider-setup": "setupRequest", instructions: "instructions", open: "open",
};

persephone.service.onChannel(async (channel, request, info) => {
  if (request?.type === "open") {
    try { validateOpen(request); }
    catch (error) { await sendProviderError(channel, request, error.code || "protocol-error", error.message); return; }
  }
  const requested = request?.provider || "claude";
  const sessionId = request?.sessionId || request?.resume;
  const ownerRecord = sessionId && [...sessions.values()].find((record) => record.providerSession.id === sessionId);
  const owner = ownerRecord?.providerSession;
  if (owner && request?.provider && request.provider !== ownerRecord.providerId) {
    await sendProviderError(channel, request, "provider-unavailable", "The requested provider does not own this live session.");
    return;
  }
  const adapter = ownerRecord?.adapter || providers.get(requested);
  if (request?.type === "instructions") { await manageInstructions(channel, request, info); return; }
  if (request?.type === "describe" && !request.provider) {
    try {
      const catalog = [];
      for (const [id, entry] of providers) {
        if (typeof entry.describe !== "function") continue;
        const detail = await entry.describe({ cwd: request.cwd || "" });
        catalog.push(detail);
      }
      const defaultEntry = catalog.find((entry) => entry.available !== false) || catalog[0];
      if (defaultEntry) await send(channel, echo({ type: "description", contractVersion: 1, catalog, ...defaultEntry }, request));
      closeChannel(channel);
    } catch (error) { await sendProviderError(channel, request, error.code || "provider-unavailable", error.message); }
    return;
  }
  if (!adapter) {
    await sendProviderError(channel, request, "provider-unavailable", `Provider is unavailable: ${requested}`);
    return;
  }
  if (request?.type === "list-sessions" && !request.provider) {
    const rows = [];
    for (const [providerId, candidate] of providers) {
      if (candidate.capabilities?.sessionStore !== true || typeof candidate.collectSessions !== "function") continue;
      try { rows.push(...await candidate.collectSessions(request)); } catch { /* unavailable provider rows are omitted */ }
    }
    await send(channel, echo({ type: "sessions", sessions: rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) }, request));
    closeChannel(channel); return;
  }
  const method = OPEN_OPERATIONS[request?.type];
  if (!method || typeof adapter[method] !== "function") {
    await sendProviderError(channel, request, method ? "unsupported-operation" : "protocol-error", method ? `This provider does not support ${request.type}.` : "Unsupported agent.session opening request.");
    return;
  }
  if (LOCAL_PAGE_ONLY.has(request.type) && (info?.interface || info?.caller)) {
    closeChannel(channel, { code: "connection-refused", message: "This operation is available only from the local board page." });
    return;
  }
  const requiredCapability = OPEN_CAPABILITIES[request.type];
  if (requiredCapability && adapter.capabilities?.[requiredCapability] !== true) {
    await sendProviderError(channel, request, "unsupported-operation", `This provider does not support ${request.type}.`);
    return;
  }
  try { await adapter[method](channel, request, info); }
  catch (error) { await sendProviderError(channel, request, error.code || "protocol-error", error.message || "The provider request failed."); }
});

persephone.service.onShutdown(async () => {
  await Promise.all([...providers.values()].map((adapter) => adapter.shutdownSessions()));
  for (const watcher of [...watchers]) watcher.stop();
  watchers.clear();
});
