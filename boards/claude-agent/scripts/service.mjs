import { spawn } from "node:child_process";
import { appliedLimits, boundedString, clampMode, hookDecision, serializeEvent, validateOpen } from "./agent-session-protocol.mjs";
import { randomUUID } from "node:crypto";
import { createClaudeProvider } from "./providers/claude.mjs";

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
  if ((request.decision === "allow" || request.decision === "allow-session") && hookDecision(session.mode, toolName).permissionDecision === "deny") {
    return settleApproval(session, request.requestId, { decision: "deny", message: "Action exceeds the effective permission mode." });
  }
  if (request.mode !== undefined && !session.adapter.acceptsMode(request.mode)) return replyError(session.channel, request, "protocol-error", "Approval continuation mode is invalid.", false, session);
  settleApproval(session, request.requestId, { decision: request.decision, message: request.message ? boundedString(request.message, 32 * 1024).value : undefined, ...(request.mode ? { mode: request.mode } : {}) });
}
const policyDecision = (session, toolName, input = {}) => hookDecision(session.mode, toolName, input, session.open.cwd);
function approvalKind(toolName) { const kind = hookDecision("ask", toolName).kind; return kind === "read" ? "other" : kind; }
function selectPermissionMode({ requested, ceiling, crossBoard }) { return crossBoard ? clampMode(requested, ceiling) : "full-auto"; }
const sessionLimits = (open) => appliedLimits(open.limits || {});
const issueEndpoint = (enabled) => enabled ? persephone.mcp.issueSessionEndpoint() : null;
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
    try { session.endpoint?.revoke(); } catch { /* host also revokes at shutdown */ }
    if (closeTransport) closeChannel(session.channel, { code: "channel-closed", message: `Agent session ended (${reason}).` });
  })().finally(() => { if (closingSessions.get(session.id) === task) closingSessions.delete(session.id); });
  session.closeTask = task; closingSessions.set(session.id, task); return task;
}
async function dispatchSession(session, request) {
  const capability = session.adapter.sessionCapability?.(request);
  if (capability && session.adapter.capabilities?.[capability] !== true) return replyError(session.channel, request, "unsupported-operation", `This provider does not support ${request.action || request.type}.`, false, session);
  return session.adapter.dispatchSession(session, request);
}
function bindSession(session) {
  session.channel.onMessage((request) => void dispatchSession(session, request));
  session.channel.onClose((reason) => void closeSession(session, reason?.code || "channel-closed"));
}
const host = { AsyncQueue, sessions, closingSessions, watchers, send, echo, replyError, closeChannel, registerSession, activeSessions, registerProcess, killChildren, sendEntries, closeSession, askApproval, settleApproval, approve, policyDecision, approvalKind, selectPermissionMode, sessionLimits, issueEndpoint, bindSession };
const providers = new Map([["claude", createClaudeProvider(host)]]);

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
  if (!adapter) {
    await sendProviderError(channel, request, "provider-unavailable", `Provider is unavailable: ${requested}`);
    return;
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
