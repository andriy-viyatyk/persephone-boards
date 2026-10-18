import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appliedLimits, boundedString, clampMode, composeInstructions, hookDecision,
  MODE_NATIVE, normalizeModel, normalizeNativeMessage, protocolError, serializeEvent, summarizeToolInput, validateOpen,
} from "./agent-session-protocol.mjs";
import { resolveClaudeExecutable } from "./claude-executable.mjs";
import { installSdk, loadSdk, sdkIsInstalled } from "./sdk-install.mjs";

const boardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessions = new Map();
const MODEL_ALIASES = [
  { id: "", label: "Default", efforts: [] },
  { id: "sonnet", label: "Sonnet (CLI alias)", efforts: [] },
  { id: "opus", label: "Opus (CLI alias)", efforts: [] },
  { id: "haiku", label: "Haiku (CLI alias)", efforts: [] },
];
let cachedModels = null;
let settings = {};
const settingIds = ["main-instructions", "claude-executable", "default-model", "default-effort", "default-permission-mode", "cross-board-permission-ceiling"];

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

function makePreamble(open, mcpAttached) {
  return composeInstructions(open.cwd, mcpAttached, settings["main-instructions"], open.instructions);
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
    ...(session.endpoint && session.mode !== "full-auto" ? { mcpServers: { persephone: { type: "http", url: session.endpoint.url, headers: session.endpoint.headers } } } : {}),
    ...(session.endpoint && session.mode === "full-auto" ? { mcpServers: { persephone: { type: "http", url: session.endpoint.url, headers: session.endpoint.headers } }, allowedTools: ["mcp__persephone__*"] } : {}),
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

async function emitNative(session, message) {
  if (message.type === "system" && message.subtype === "init") {
    if (message.session_id) session.id = message.session_id;
    session.actualModel = message.model || session.actualModel;
    session.initSeen = true;
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
  const ceiling = crossBoard ? (settings["cross-board-permission-ceiling"] || "read-only") : "full-auto";
  const mode = clampMode(open.permissionMode, ceiling);
  const wantsMcp = open.mcp?.persephone !== false && mode !== "read-only";
  const endpoint = wantsMcp ? await persephone.mcp.issueSessionEndpoint() : null;
  const id = open.resume || randomUUID();
  const session = {
    id, channel, open, sdk, executable, mode, endpoint, composed: makePreamble(open, Boolean(endpoint)),
    inputQueue: new AsyncQueue(), children: new Set(), approvals: new Map(), allowedScopes: new Set(),
    closed: false, busy: false, completedTurns: 0, initSeen: false, query: null, queryTask: null,
    interrupted: false, pendingFirstTurn: true, started: false, nativeState: { pendingFiles: new Map() },
  };
  sessions.set(channel, session);
  await send(channel, echo({ type: "session-started", contractVersion: 1, sessionId: id, model: open.model || settings["default-model"] || "Default", permissionMode: mode, limits: sessionLimits(open), instructions: { composed: session.composed }, mcp: { persephone: Boolean(endpoint) } }, open), session);
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
  // Unknown v1 additive message types are ignored.
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

async function closeSession(session, reason, closeTransport) {
  if (!session || session.closed) return;
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
});

void refreshSettings().catch((error) => console.error("Could not load Claude Agent settings:", error));
listenSettings();
