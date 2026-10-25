import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { boundedString, summarizeToolInput } from "../agent-session-protocol.mjs";

const VERSION = "0.163.0";
const STARTUP_TIMEOUT_MS = 15000;
const RPC_TIMEOUT_MS = 60000;
const MODEL_CACHE_MS = 5 * 60 * 1000;
const DISCOVERY_IDLE_MS = 60000;
const MODE_IDS = Object.freeze({ auto: "mode-1", full: "mode-2", read: "mode-3" });
const MODE_OPTIONS = Object.freeze({
  auto: { approvalPolicy: "on-request" },
  full: { approvalPolicy: "never" },
  read: { approvalPolicy: "on-request" },
});
const CAPABILITIES = Object.freeze({ providerSetup: false, sessionStore: true, transcriptFollow: false, permissionModes: true, modelSelection: true, effortSelection: true, slashCommands: false, mcpPanel: false, subagents: false, tokenUsage: true, costUsage: false, contextUsage: true, rateLimits: false });
const label = (id, fallback) => ({ id, label: fallback, efforts: [] });
let host;
let adapter;
let settings = {};
let discovery = null;
let discoveryTask = null;
let discoveryTimer = null;
let modelCache = { at: 0, models: [] };
let availabilityCache = { at: 0, value: null };
const settingIds = ["codex-executable", "codex-default-model", "codex-default-effort"];

function providerError(message, code = "provider-unavailable") { return Object.assign(new Error(message), { code }); }
async function refreshSettings() {
  const next = {};
  await Promise.all(settingIds.map(async (id) => { next[id] = await persephone.settings.get(id); }));
  settings = next;
  return settings;
}
function listenSettings() { persephone.settings.onChange(({ id, value }) => { if (settingIds.includes(id)) { settings[id] = value; availabilityCache = { at: 0, value: null }; modelCache = { at: 0, models: [] }; clearTimeout(discoveryTimer); const prior = discovery; discovery = null; void prior?.close(true); } }); }
async function resolveExecutable(configured = "") {
  const candidate = configured || "codex";
  if (path.isAbsolute(candidate)) {
    await access(candidate, constants.X_OK).catch((error) => { throw providerError(`Codex executable is not available at the configured path: ${candidate}`, "provider-unavailable"); });
    return candidate;
  }
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [candidate, `${candidate}.exe`, `${candidate}.cmd`, `${candidate}.bat`] : [candidate];
  for (const dir of dirs) for (const name of names) {
    const file = path.join(dir, name);
    try { await access(file, constants.X_OK); return file; } catch { /* next PATH entry */ }
  }
  throw providerError("Codex CLI was not found. Install codex or set the Codex executable path in board settings.");
}
function runVersion(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value; });
    const timer = setTimeout(() => { child.kill(); reject(providerError("Timed out checking the installed Codex version.")); }, 8000);
    child.once("error", (error) => { clearTimeout(timer); reject(providerError(`Could not launch Codex: ${error.message}`)); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(providerError(`Codex version check failed: ${stderr.trim() || `exit ${code}`}`));
      const match = /codex-cli\s+(\S+)/i.exec(stdout.trim());
      if (!match) return reject(providerError("Codex returned an unrecognized version string."));
      if (match[1] !== VERSION) return reject(providerError(`Codex ${VERSION} is required for the generated app-server protocol; installed version is ${match[1]}.`, "provider-version-unsupported"));
      resolve(match[1]);
    });
  });
}

class JsonRpcProcess {
  constructor(executable, { cwd, endpoint, envToken, groupEndpoint, onServerRequest, onNotification } = {}) {
    this.executable = executable; this.cwd = cwd; this.endpoint = endpoint; this.envToken = envToken;
    this.groupEndpoint = groupEndpoint;
    this.onServerRequest = onServerRequest; this.onNotification = onNotification;
    this.nextId = 1; this.pending = new Map(); this.buffer = ""; this.closed = false; this.started = false;
  }
  async start() {
    const args = ["app-server", "--stdio"];
    if (this.endpoint) args.push("-c", `mcp_servers.persephone.url=${JSON.stringify(this.endpoint.url)}`, "-c", "mcp_servers.persephone.bearer_token_env_var=PERSEPHONE_MCP_TOKEN");
    const env = { ...process.env };
    delete env.PERSEPHONE_MCP_TOKEN;
    if (this.endpoint && this.envToken) env.PERSEPHONE_MCP_TOKEN = this.envToken;
    delete env.AGENT_CHAT_MCP_TOKEN;
    if (this.groupEndpoint?.token) env.AGENT_CHAT_MCP_TOKEN = this.groupEndpoint.token;
    this.child = spawn(this.executable, args, { cwd: this.cwd || os.homedir(), env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    if (this.session) host?.registerProcess(this.session, this.child);
    this.child.stdout.setEncoding("utf8").on("data", (chunk) => this.read(chunk));
    this.child.stderr.setEncoding("utf8").on("data", (chunk) => { if (chunk.trim()) this.stderr = boundedString((this.stderr || "") + chunk, 8192).value; });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("close", (code) => this.fail(providerError(`Codex app-server exited (${code ?? "unknown"})${this.stderr ? `: ${this.stderr}` : ""}`, "provider-process-exited")));
    await Promise.race([
      this.request("initialize", { clientInfo: { name: "persephone-claude-agent", title: "Persephone Agent Chat", version: "1.1.0" }, capabilities: null }, STARTUP_TIMEOUT_MS),
      new Promise((_, reject) => setTimeout(() => reject(providerError("Codex app-server initialization timed out.")), STARTUP_TIMEOUT_MS)),
    ]);
    this.notify("initialized");
    this.started = true;
    return this;
  }
  read(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) return this.fail(providerError("Codex app-server sent an oversized JSON-RPC message."));
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.fail(providerError("Codex app-server sent invalid JSON-RPC data.")); return; }
      this.dispatch(message);
    }
  }
  dispatch(message) {
    if (message.id !== undefined && message.method) {
      Promise.resolve(this.onServerRequest?.(message)).then((result) => this.respond(message.id, result ?? {})).catch((error) => this.respondError(message.id, -32000, error.message || "Request denied."));
      return;
    }
    if (message.method) { Promise.resolve(this.onNotification?.(message.method, message.params || {})).catch((error) => this.fail(error)); return; }
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(String(message.id));
    if (message.error) pending.reject(providerError(message.error.message || "Codex JSON-RPC request failed.", "protocol-error")); else pending.resolve(message.result);
  }
  write(message) {
    if (this.closed || !this.child?.stdin.writable) throw providerError("Codex app-server is closed.", "provider-process-exited");
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw providerError("Codex JSON-RPC request exceeded 2 MiB.", "protocol-error");
    this.child.stdin.write(line);
  }
  request(method, params = {}, timeout = RPC_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(String(id)); reject(providerError(`Codex ${method} request timed out.`, "provider-timeout")); }, timeout);
      this.pending.set(String(id), { resolve, reject, timer });
      try { this.write({ jsonrpc: "2.0", id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(String(id)); reject(error); }
    });
  }
  notify(method, params) { this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }); }
  respond(id, result) { if (!this.closed) this.write({ jsonrpc: "2.0", id, result }); }
  respondError(id, code, message) { if (!this.closed) this.write({ jsonrpc: "2.0", id, error: { code, message } }); }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.onFatal?.(error);
  }
  async close(force = true) {
    if (this.closed && (!this.child || this.child.exitCode !== null)) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(providerError("Codex app-server closed.")); }
    this.pending.clear();
    if (this.child && this.child.exitCode === null) {
      if (force && process.platform === "win32" && this.child.pid) {
        await new Promise((resolve) => {
          const killer = spawn("taskkill", ["/PID", String(this.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          const timer = setTimeout(() => { killer.kill(); resolve(); }, 1500);
          killer.once("close", () => { clearTimeout(timer); resolve(); });
        });
      } else { try { this.child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* exited */ } }
    }
  }
}

function scheduleDiscoveryClose() {
  clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(() => { const prior = discovery; discovery = null; void prior?.close(true); }, DISCOVERY_IDLE_MS);
}
async function sharedServer() {
  if (discovery && !discovery.closed) { scheduleDiscoveryClose(); return discovery; }
  if (discoveryTask) return discoveryTask;
  discoveryTask = (async () => {
    const executable = await resolveExecutable(settings["codex-executable"] || "");
    await runVersion(executable);
    discovery = await new JsonRpcProcess(executable).start();
    scheduleDiscoveryClose();
    return discovery;
  })();
  try { return await discoveryTask; }
  finally { discoveryTask = null; }
}
async function getModels(refresh = false) {
  if (!refresh && modelCache.models.length && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.models;
  const server = await sharedServer();
  const rows = [];
  let cursor;
  do {
    const response = await server.request("model/list", { limit: 200, ...(cursor ? { cursor } : {}) }, 15000);
    rows.push(...(Array.isArray(response?.data) ? response.data : Array.isArray(response?.models) ? response.models : []));
    cursor = response?.nextCursor || null;
  } while (cursor && rows.length < 1000);
  modelCache = { at: Date.now(), models: rows.map((row) => ({ id: String(row.id || ""), label: String(row.displayName || row.id || "Codex model"), description: String(row.description || ""), efforts: Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts.map((effort) => typeof effort === "string" ? effort : effort.reasoningEffort).filter(Boolean) : [], defaultEffort: row.defaultReasoningEffort || "", isDefault: row.isDefault === true })).filter((row) => row.id) };
  scheduleDiscoveryClose();
  return modelCache.models;
}
async function availability() {
  if (availabilityCache.value && Date.now() - availabilityCache.at < 30000) return availabilityCache.value;
  try {
    const executable = await resolveExecutable(settings["codex-executable"] || "");
    const version = await runVersion(executable);
    availabilityCache = { at: Date.now(), value: { ready: true, version, executable } };
  } catch (error) { availabilityCache = { at: Date.now(), value: { ready: false, reason: error.message, reasonKey: error.code === "provider-version-unsupported" ? "codex.versionUnsupported" : "codex.notFound", code: error.code || "provider-unavailable" } }; }
  return availabilityCache.value;
}

function approvalDescriptor(request) {
  const params = request.params || {};
  const method = request.method;
  let tool = "Codex action", input = params;
  if (method.includes("commandExecution") || method === "execCommandApproval") { tool = "Shell"; input = { command: params.command || params.commandLine || params.reason || "Command execution" }; }
  else if (method.includes("fileChange") || method === "applyPatchApproval") { tool = "Edit"; input = { path: params.filePath || params.path || "File change", description: params.reason || "Codex requests a file change" }; }
  else if (method.includes("permissions")) { tool = "Codex permissions"; }
  else if (method.includes("UserInput")) { tool = "Codex input"; }
  else if (method.includes("elicitation")) { tool = "Codex MCP request"; }
  const summary = summarizeToolInput(tool, input);
  return { tool, summary: summary.summary };
}
function serverApprovalResponse(method, decision) {
  const allow = decision.decision === "allow" || decision.decision === "allow-session";
  if (method.includes("commandExecution")) return { decision: allow ? (decision.decision === "allow-session" ? "acceptForSession" : "accept") : "decline" };
  if (method.includes("fileChange")) return { decision: allow ? (decision.decision === "allow-session" ? "acceptForSession" : "accept") : "decline" };
  if (method.includes("permissions")) return { permissions: allow ? (decision.permissions || {}) : {}, scope: "turn" };
  if (method.includes("UserInput")) return { answers: {} };
  if (method.includes("elicitation")) return { action: allow ? "accept" : "decline", content: allow ? {} : null, _meta: null };
  if (method === "execCommandApproval" || method === "applyPatchApproval") return { decision: allow ? (decision.decision === "allow-session" ? "approved_for_session" : "approved") : { denied: { rejection: decision.message || "Denied by the user." } } };
  return {};
}
function eventText(session, type, value) {
  if (typeof value !== "string" || !value) return;
  const text = boundedString(value, 32 * 1024);
  void host.send(session.channel, { type, text: text.value, ...(text.truncated ? { truncated: true } : {}) }, session);
}
// The context fill is the latest request's tokens (`last`); `total` adds up every turn of the thread.
function contextTokens(session) { return session.tokenUsage?.last?.totalTokens; }
function sessionStatus(session) {
  const modelId = session.model || "";
  const tokens = contextTokens(session);
  const contextWindow = session.tokenUsage?.modelContextWindow;
  return { type: "session-status", model: modelId, modelLabel: session.models.find((model) => model.id === modelId)?.label || modelId, effort: session.effort || "", mode: MODE_IDS[session.permissionMode] || MODE_IDS.auto, ...(Number.isFinite(tokens) ? { contextTokens: tokens } : {}), ...(Number.isFinite(contextWindow) ? { contextWindow } : {}), ...(Number.isFinite(tokens) && Number.isFinite(contextWindow) && contextWindow ? { contextPercent: Math.round(tokens / contextWindow * 1000) / 10 } : {}) };
}
function statusEvent(session) { void host.send(session.channel, sessionStatus(session), session); }
function sandboxPolicy(session) {
  if (session.permissionMode === "full") return { type: "dangerFullAccess" };
  if (session.permissionMode === "read") return { type: "readOnly", networkAccess: false };
  return { type: "workspaceWrite", writableRoots: [session.open.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}
async function onNotification(session, method, params) {
    if (method === "thread/started") { session.id = params.thread?.id || params.threadId || session.id; return; }
  if (method === "turn/started") { session.busy = true; void host.send(session.channel, { type: "turn-started" }, session); return; }
  if (method === "item/agentMessage/delta") { eventText(session, "text-delta", params.delta); return; }
  if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") { eventText(session, "thinking-delta", params.delta); return; }
  if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
    const summary = boundedString(params.delta, 32 * 1024);
    void host.send(session.channel, { type: "tool-result", callId: params.itemId, ok: true, summary: summary.value, ...(summary.truncated ? { truncated: true } : {}) }, session);
    return;
  }
  if (method === "item/started") {
    const item = params.item || {};
    const name = item.command ? "Shell" : item.type || "Codex action";
    const summary = summarizeToolInput(name, { command: Array.isArray(item.command) ? item.command.join(" ") : item.command || item.title || item.path || item.type });
    session.items.set(item.id, { name, summary: summary.summary });
    if (item.type === "fileChange") for (const change of item.changes || []) void host.send(session.channel, { type: "file-change", path: change.path || "", kind: "modified" }, session);
    if (item.type === "commandExecution" || item.type === "mcpToolCall") void host.send(session.channel, { type: "tool-call", callId: item.id || randomUUID(), name, input: { summary: summary.summary } }, session);
    return;
  }
  if (method === "item/completed") {
    const item = params.item || {};
    const prior = session.items.get(item.id);
    if (prior) void host.send(session.channel, { type: "tool-result", callId: item.id, ok: item.status !== "failed", summary: boundedString(`${item.exitCode === undefined ? prior.summary : `Exit code ${item.exitCode}`}${item.aggregatedOutput ? `\n${item.aggregatedOutput}` : ""}`, 32 * 1024).value }, session);
    if (item.type === "agentMessage" && item.text) eventText(session, "text", item.text);
    if (item.type === "fileChange") for (const change of item.changes || []) void host.send(session.channel, { type: "file-change", path: change.path || "", kind: "modified" }, session);
    return;
  }
  if (method === "thread/tokenUsage/updated") { session.tokenUsage = params.tokenUsage || null; statusEvent(session); return; }
  if (method === "turn/completed") {
    session.busy = false; session.completedTurns++;
    const status = params.turn?.status;
    if (status === "failed" && params.turn?.error?.message) await host.send(session.channel, { type: "error", code: "codex-turn-error", message: boundedString(params.turn.error.message, 32 * 1024).value, fatal: false }, session);
    await host.send(session.channel, { type: "turn-ended", reason: status === "interrupted" ? "interrupted" : status === "failed" ? "error" : "completed", usage: {} }, session);
    if (session.open.limits?.maxAgentSteps && session.completedTurns >= session.open.limits.maxAgentSteps) await host.closeSession(session, "limit", true, true);
    session.currentRequestId = null;
  }
}
async function callTurn(session, text) {
  const policy = MODE_OPTIONS[session.permissionMode] || MODE_OPTIONS.auto;
  await session.rpc.request("turn/start", { threadId: session.id, input: [{ type: "text", text, text_elements: [] }], cwd: session.open.cwd, model: session.model || undefined, effort: session.effort || undefined, approvalPolicy: policy.approvalPolicy, sandboxPolicy: sandboxPolicy(session) });
}

async function startSession(channel, request, info) {
  await refreshSettings();
  const available = await availability();
  if (!available.ready) throw providerError(available.reason, available.code);
  const open = request;
  const cwdStat = await stat(open.cwd).catch(() => null);
  if (!cwdStat?.isDirectory()) throw providerError(`The working directory does not exist: ${open.cwd}`, "protocol-error");
  const models = await getModels();
  const model = open.model || settings["codex-default-model"] || models.find((item) => item.isDefault)?.id || "";
  const effort = open.effort || settings["codex-default-effort"] || models.find((item) => item.id === model)?.defaultEffort || "";
  if (model && !models.some((item) => item.id === model)) throw providerError("The selected Codex model is not in the current model listing.", "model-unavailable");
  const selected = models.find((item) => item.id === model);
  if (effort && selected && !selected.efforts.includes(effort)) throw providerError("The selected effort is not supported by this Codex model.", "protocol-error");
  const prepared = await host.prepareOpen(open, info);
  const { crossBoard, mode } = prepared;
  const endpoint = await host.issueOpenEndpoint(prepared);
  const groupEndpoint = request.groupChat?.position === "joined" ? await host.issueGroupEndpoint(request.groupChat.participantId) : null;
  const localMode = request.groupChat?.position === "joined"
    ? (request.groupChat.permissionMode === "full-auto" ? "full" : request.groupChat.permissionMode === "read-only" ? "read" : "auto")
    : crossBoard ? (mode === "read-only" ? "read" : "auto") : (open.mode === MODE_IDS.full ? "full" : open.mode === MODE_IDS.read ? "read" : "auto");
  const executable = available.executable;
  const endpointToken = endpoint?.token || endpoint?.bearerToken || endpoint?.headers?.Authorization?.replace(/^Bearer\s+/i, "") || endpoint?.headers?.authorization?.replace(/^Bearer\s+/i, "");
  if (endpoint && (!endpoint.url || !endpointToken)) {
    try { endpoint.revoke?.(); } catch { /* endpoint could not be configured */ }
    throw providerError("The private Persephone MCP endpoint did not provide a usable URL and bearer token.", "provider-setup-required");
  }
  const id = open.resume || "";
  const policyMode = crossBoard ? mode : localMode === "read" ? "read-only" : localMode === "auto" ? "ask" : "full-auto";
  const session = { id, channel, open, providerId: "codex", adapter, children: new Set(), approvals: new Map(), allowedScopes: new Set(), closed: false, busy: false, completedTurns: 0, crossBoard, mode, policyMode: request.groupChat?.position === "joined" ? request.groupChat.permissionMode : policyMode, permissionMode: localMode, model, effort, models, endpoint, groupEndpoint, groupMain: request.groupChat?.position === "main", tokenUsage: null, items: new Map(), currentRequestId: open.id, status: {}, title: open.title || "" };
  session.rpc = new JsonRpcProcess(executable, { cwd: open.cwd, endpoint, envToken: endpointToken, groupEndpoint, onServerRequest: async (native) => {
    const { tool, summary } = approvalDescriptor(native);
    const classification = host.approvalKind(tool);
    const decision = host.policyDecision(session, tool, native.params || {});
    const scope = `${decision.kind}:${tool}`;
    if (decision.permissionDecision === "deny") return serverApprovalResponse(native.method, { decision: "deny", message: decision.message || "Denied by the effective permission mode." });
    if (crossBoard && decision.permissionDecision === "allow") return serverApprovalResponse(native.method, { decision: "allow" });
    if (!crossBoard && localMode === "full") return serverApprovalResponse(native.method, { decision: "allow" });
    if (native.method.includes("permissions") && crossBoard && mode !== "full-auto") return serverApprovalResponse(native.method, { decision: "deny", message: "Additional permissions exceed the effective cross-board policy." });
    const result = await host.askApproval(session, scope, { kind: classification, tool, summary, detail: summary }, null, 5 * 60 * 1000);
    if ((result.decision === "allow" || result.decision === "allow-session") && host.policyDecision(session, tool, native.params || {}).permissionDecision !== "deny") return serverApprovalResponse(native.method, result);
    return serverApprovalResponse(native.method, { decision: "deny" });
  }, onNotification: (method, params) => onNotification(session, method, params) });
  session.rpc.session = session;
  session.rpc.onFatal = (error) => { if (!session.closed) void host.replyError(channel, session.currentRequestId ? { id: session.currentRequestId } : open, error.code || "provider-process-exited", error.message, true, session); };
  let result;
  try {
    await session.rpc.start();
    const policy = MODE_OPTIONS[localMode] || MODE_OPTIONS.auto;
    const identity = request.groupChat || { name: "Master", position: "main" };
    const environment = `You are running inside the Agent Chat board. Working directory: ${open.cwd}. Persephone MCP is ${endpoint ? "attached for this session" : "not attached"}. Your output is shown in a chat UI.\n\n${host.groupCore(identity.name || "Master", identity.position || "main")}`;
    const params = {
      cwd: open.cwd, model: model || undefined, approvalPolicy: policy.approvalPolicy,
      sandbox: localMode === "full" ? "danger-full-access" : localMode === "read" ? "read-only" : "workspace-write",
      developerInstructions: await host.composeInstructions("codex", environment, open.instructions),
      ...(groupEndpoint ? { config: { mcp_servers: { agent_chat: { url: groupEndpoint.url, bearer_token_env_var: "AGENT_CHAT_MCP_TOKEN", default_tools_approval_mode: "approve" } } } } : {}),
    };
    result = open.resume ? await session.rpc.request("thread/resume", { threadId: open.resume, ...params, excludeTurns: true }) : await session.rpc.request("thread/start", params);
  } catch (error) {
    if (session.closeTask) await session.closeTask;
    else await session.rpc.close(true);
    host.revokeEndpoint(session);
    host.revokeGroupEndpoint(session);
    throw error;
  }
  session.id = result?.thread?.id || result?.threadId || session.id;
  if (!session.id) { await session.rpc.close(true); host.revokeEndpoint(session); host.revokeGroupEndpoint(session); throw providerError("Codex did not return a thread id.", "protocol-error"); }
  host.registerSession(session);
  host.bindSession(session);
  const limits = host.sessionLimits(open);
  limits.maxAgentSteps = { ...limits.maxAgentSteps, enforcement: "service-counts-completed-turns", sdkOption: null };
  await host.send(channel, { type: "session-started", contractVersion: 1, provider: "codex", sessionId: session.id, model: model || "Default", permissionMode: mode, limits, instructions: { composed: true }, mcp: { persephone: Boolean(endpoint) } }, session);
  statusEvent(session);
  return session;
}

async function listThreads(request = {}) {
  const server = await sharedServer();
  const threads = [];
  let cursor;
  do {
    const response = await server.request("thread/list", { limit: 100, ...(request.cwd ? { cwd: request.cwd } : {}), ...(cursor ? { cursor } : {}) });
    const data = response?.data || response?.threads || [];
    threads.push(...data);
    cursor = response?.nextCursor || response?.next_cursor || null;
  } while (cursor && threads.length < 500);
  scheduleDiscoveryClose();
  return threads;
}
function normalizedItems(items) {
  const entries = [];
  for (const item of items || []) {
    if (item.type === "userMessage") entries.push({ role: "user", text: (item.content || []).map((part) => part.text || "").join("") });
    else if (item.type === "agentMessage") entries.push({ role: "agent", text: item.text || item.message || "" });
    else if (item.type === "reasoning") entries.push({ role: "reasoning", text: [...(item.summary || []), ...(item.content || [])].join("\n") });
    else if (item.type === "commandExecution") entries.push({ role: "tool", name: "Shell", callId: item.id, input: { summary: boundedString(item.command || "Codex command", 8192).value } }, { role: "command-output", text: item.output || "" });
    else if (item.type === "fileChange") for (const change of item.changes || []) entries.push({ role: "file-change", text: change.path || "" });
    else if (item.type === "contextCompaction") entries.push({ role: "compacted" });
  }
  return entries.filter((entry) => entry.text || entry.role === "compacted" || entry.role === "tool");
}

function createCodexProvider(serviceHost) {
  host = serviceHost;
  adapter = {
    id: "codex", capabilities: CAPABILITIES,
    async describe() {
      await refreshSettings();
      const setup = await availability();
      if (!setup.ready) return { provider: "codex", providerLabelKey: "provider.codex", providerLabel: "Codex", icon: "codex", iconColor: "#4a63ff", available: false, unavailableReason: setup.reason, unavailableReasonKey: setup.reasonKey, setup: { required: false, ready: false, reason: setup.reason }, models: [], defaults: { model: settings["codex-default-model"] || "", effort: settings["codex-default-effort"] || "", mode: "auto" }, capabilities: CAPABILITIES, chatOptions: { permissionModes: [] } };
      let models = [];
      try { models = await getModels(); } catch (error) { return { provider: "codex", providerLabelKey: "provider.codex", providerLabel: "Codex", icon: "codex", iconColor: "#4a63ff", available: false, unavailableReason: error.message, setup: { required: false, ready: false, reason: error.message }, models: [], defaults: {}, capabilities: CAPABILITIES, chatOptions: { permissionModes: [] } }; }
      const modes = [{ id: MODE_IDS.auto, labelKey: "codex.mode.auto", descriptionKey: "codex.mode.auto.desc" }, { id: MODE_IDS.full, labelKey: "codex.mode.full", descriptionKey: "codex.mode.full.desc" }, { id: MODE_IDS.read, labelKey: "codex.mode.read", descriptionKey: "codex.mode.read.desc" }];
      const defaultModel = settings["codex-default-model"] || models.find((model) => model.isDefault)?.id || "";
      return { provider: "codex", providerLabelKey: "provider.codex", providerLabel: "Codex", icon: "codex", iconColor: "#4a63ff", available: true, version: setup.version, setup: { required: false, ready: true }, models: [label("", "Default"), ...models], defaults: { model: defaultModel, effort: settings["codex-default-effort"] || models.find((model) => model.id === defaultModel)?.defaultEffort || "", mode: MODE_IDS.auto }, capabilities: CAPABILITIES, chatOptions: { permissionModes: modes } };
    },
    async describeRequest(channel, request) { await this.sendDescription(channel, request); },
    async sendDescription(channel, request) { const detail = await this.describe({ cwd: request.cwd }); await host.send(channel, host.echo({ type: "description", contractVersion: 1, ...detail, permissionModes: ["read-only", "ask", "auto-edit", "full-auto"], permissionCeiling: (await persephone.settings.get("cross-board-permission-ceiling")) || "read-only", features: { resume: detail.available, usage: detail.available, maxAgentSteps: detail.available } }, request)); host.closeChannel(channel); },
    async open(channel, request, info) { return startSession(channel, request, info); },
    async collectSessions(request) { const threads = await listThreads(request); return threads.map((thread) => ({ id: thread.id, title: thread.name || thread.preview || "Untitled session", cwd: thread.cwd || "", updatedAt: new Date((thread.updatedAt || thread.createdAt || Date.now() / 1000) * 1000).toISOString(), model: thread.model || "", effort: thread.reasoningEffort || "", provider: "codex" })); },
    async listSessions(channel, request) { try { const rows = await this.collectSessions(request); await host.send(channel, host.echo({ type: "sessions", sessions: rows }, request)); host.closeChannel(channel); } catch (error) { await host.replyError(channel, request, error.code || "provider-unavailable", error.message, true); } },
    async history(channel, request) {
      try {
        const server = await sharedServer();
        const groupHistory = await host.hasGroupParticipants(request.sessionId).catch(() => false);
        let cursor, entries = [];
        do {
          const page = await server.request("thread/turns/list", { threadId: request.sessionId, limit: 100, sortDirection: "asc", ...(cursor ? { cursor } : {}) });
          for (const turn of page.data || []) {
            let itemCursor, turnEntries = [];
            do {
              const itemPage = await server.request("thread/items/list", { threadId: request.sessionId, turnId: turn.id, limit: 100, sortDirection: "asc", ...(itemCursor ? { cursor: itemCursor } : {}) });
              turnEntries.push(...normalizedItems((itemPage.data || []).map((entry) => entry.item || entry)));
              itemCursor = itemPage.nextCursor || null;
            } while (itemCursor);
            if (groupHistory) {
              for (let i = turnEntries.length - 1; i >= 0; i--) if (turnEntries[i].role === "agent") { turnEntries[i] = { ...turnEntries[i], text: `[[from: Master | role: main]]\n${turnEntries[i].text}` }; break; }
            }
            entries.push(...turnEntries);
          }
          cursor = page.nextCursor || null;
        } while (cursor);
        const batch = await host.sendEntries(channel, request, entries);
        await host.send(channel, host.echo({ type: "history", entries: batch, done: true }, request)); host.closeChannel(channel);
      } catch (error) { await host.replyError(channel, request, error.code || "protocol-error", error.message || "Could not read Codex history.", true); }
    },
    async manageSession(channel, request) { try { const server = await sharedServer(); if (request.action === "rename") await server.request("thread/name/set", { threadId: request.sessionId, name: boundedString(request.title, 1024).value }); else if (request.action === "delete") await server.request("thread/delete", { threadId: request.sessionId }); else throw providerError("action must be rename or delete.", "protocol-error"); await host.send(channel, host.echo({ type: "session-updated", action: request.action, sessionId: request.sessionId }, request)); host.closeChannel(channel); } catch (error) { await host.replyError(channel, request, error.code || "protocol-error", error.message, true); } },
    sessionCapability(request) { if (["models", "set-model"].includes(request.action)) return "modelSelection"; if (request.action === "set-effort") return "effortSelection"; if (request.action === "set-mode") return "permissionModes"; return null; },
    acceptsMode(mode) { return Object.values(MODE_IDS).includes(mode); },
    sessionStatus,
    async dispatchSession(session, request) {
      if (request.type === "interrupt") { for (const id of [...session.approvals.keys()]) host.settleApproval(session, id, { decision: "deny", message: "Turn was interrupted." }); await session.rpc.request("turn/interrupt", { threadId: session.id }).catch(() => {}); return; }
      if (request.type === "approve" || request.type === "approval-response") { host.approve(session, request); return; }
      if (request.type === "close") { await host.closeSession(session, "closed", true, true); return; }
      if (request.type === "send") { const text = typeof request.text === "string" ? request.text : ""; session.currentRequestId = request.id; session.busy = true; await callTurn(session, text); return; }
      if (request.type === "control") {
        const result = await (async () => {
          if (request.action === "models") return { models: session.models, current: session.model || "default" };
          if (request.action === "set-model") { if (request.model !== "default" && !session.models.some((model) => model.id === request.model)) throw providerError("The selected model is not available.", "model-unavailable"); session.model = request.model === "default" ? "" : request.model; return { model: session.model }; }
          if (request.action === "set-effort") { const model = session.models.find((entry) => entry.id === session.model); if (!model?.efforts.includes(request.effort)) throw providerError("The selected effort is not available for this model.", "protocol-error"); session.effort = request.effort; return { effort: session.effort }; }
          if (request.action === "set-mode") { if (!this.acceptsMode(request.mode)) throw providerError("The selected permission mode is not available.", "protocol-error"); session.permissionMode = request.mode === MODE_IDS.full ? "full" : request.mode === MODE_IDS.read ? "read" : "auto"; session.policyMode = session.crossBoard ? session.mode : session.permissionMode === "read" ? "read-only" : session.permissionMode === "auto" ? "ask" : "full-auto"; statusEvent(session); return { mode: request.mode }; }
          if (request.action === "context") return { usage: { model: session.model, totalTokens: contextTokens(session) || 0, maxTokens: session.tokenUsage?.modelContextWindow || 0, percentage: session.tokenUsage?.modelContextWindow ? Math.round((contextTokens(session) || 0) / session.tokenUsage.modelContextWindow * 100) : 0, categories: [], autoCompact: false, mcpTools: [], memoryFiles: [] } };
          throw providerError(`Unsupported Codex control: ${request.action}`, "unsupported-operation");
        })();
        await host.send(session.channel, { type: "control-result", id: request.id, ok: true, ...result }, session); return;
      }
      await host.replyError(session.channel, request, "unsupported-operation", `Unsupported Codex session action: ${request.type}`, false, session);
    },
    async closeProviderSession(session) { await session.rpc?.close(true); },
    async close(session, options = {}) { return host.closeSession(session, options.reason || "provider-close", Boolean(options.force), true); },
    async shutdownSessions() { for (const session of host.activeSessions().filter((item) => item.providerId === "codex")) await host.closeSession(session, "shutdown", true); clearTimeout(discoveryTimer); const prior = discovery; discovery = null; await prior?.close(true); },
  };
  listenSettings();
  return adapter;
}

export { createCodexProvider, VERSION as CODEX_PROTOCOL_VERSION };
