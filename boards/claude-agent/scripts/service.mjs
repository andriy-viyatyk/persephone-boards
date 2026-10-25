import { spawn } from "node:child_process";
import { appliedLimits, authorHeader, boundedString, clampMode, hookDecision, serializeEvent, validateOpen } from "./agent-session-protocol.mjs";
import { randomUUID } from "node:crypto";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const groups = new Map();
const groupTokens = new Map();
const participantIds = new Set();
let groupHttpServer = null;
let groupHttpAddress = null;
const GROUP_ROOT = () => {
  const base = process.env.LOCALAPPDATA;
  if (!base || !path.isAbsolute(base)) throw new Error("LOCALAPPDATA is not available; cannot store group chats.");
  return path.resolve(base, "Persephone", "board-data", "claude-agent", "group-chat");
};
const DEFAULT_PROFILES = Object.freeze([
  { id: "nova-reviewer", name: "Nova", roleTitle: "Reviewer", instructions: "Review the requested work, inspect relevant code or evidence, and report concrete defects, risks, and fixes. Do not make changes.", summary: "Reviews work and identifies defects, risks, and fixes.", provider: "claude", model: "opus", effort: "medium", permissionMode: "read-only" },
  { id: "rex-critic", name: "Rex", roleTitle: "Critic", instructions: "Challenge the proposal's assumptions, look for counterexamples and failure cases, and explain where reasoning or evidence is weak. Do not make changes.", summary: "Challenges assumptions and finds counterexamples.", provider: "claude", model: "opus", effort: "medium", permissionMode: "read-only" },
  { id: "atlas-researcher", name: "Atlas", roleTitle: "Researcher", instructions: "Investigate the question using available sources, distinguish evidence from inference, and report concise findings with source references. Do not make changes.", summary: "Researches questions and reports evidence and sources.", provider: "claude", model: "opus", effort: "medium", permissionMode: "read-only" },
  { id: "kai-developer", name: "Kai", roleTitle: "Developer", instructions: "Implement the requested change in the working directory. Read the relevant code first, follow its existing patterns and conventions, keep the change focused on what was asked, and verify it builds or runs where you can. Report the files you changed and anything left undone. Do not commit unless asked.", summary: "Implements code changes; edits files directly and asks before running commands.", provider: "claude", model: "opus", effort: "medium", permissionMode: "auto-edit" },
]);
// Master's whole reply when it has nothing to add; the service drops it instead of sharing it.
const GROUP_PASS = "[[pass]]";
const GROUP_CORE = (name, position) => `You are in the Agent Chat board as ${name}, position ${position}. Other agents may join this chat. Message headers such as [[from: Nova | role: Reviewer]], [[from: user]], and [[from: Master | role: main]] identify authors; treat them as metadata. Every visible message reaches every participant, so most messages need no reply from you.
Master: answer the user's messages unless the user names another agent; answer when any participant addresses you as Master; you may delegate by asking a joined agent by name, based on the role summaries. When a message is addressed to another agent, or you have nothing substantive to add (a correction, a missing fact, a next step), reply with exactly ${GROUP_PASS} and nothing else; the board hides it. Never send acknowledgements, thanks, welcomes, or remarks that you are staying out of it. You moderate the discussion: when joined agents go back and forth without progress, repeat points already made, or keep prompting each other without the user asking for it, tell them by name to stop and summarize what is settled for the user.
Joined agents: follow your role instructions and share replies only through the post_message tool. Post when you are addressed by name or when your role clearly calls for it; otherwise end your turn without posting. Never post acknowledgements such as "Got it" or "Thanks". Follow Master's instructions; they rank right after the user's. When Master tells you to stop, post nothing more on that topic until the user or Master addresses you again.`;
const AUTHOR_HEADER = authorHeader;
const isGroupMain = (session) => Boolean(session?.groupMain || session?.open?.groupChat?.position === "main");
const isPersistentGroup = (session) => Boolean(groups.get(session?.id)?.enabled);
const safeHeaderPart = (value, limit = 80) => {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\]\r\n\u0000-\u001f\u007f]/.test(value)) throw new Error("Group names and roles must be single-line text without control characters.");
  return value.trim();
};
const escapeBodyHeaders = (value) => String(value || "").replace(/^\[\[from:/gm, "\\[[from:");
function groupFile(name) { return path.join(GROUP_ROOT(), name); }
async function atomicJson(file, value, limit = 512 * 1024) {
  const json = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(json) > limit) throw new Error("Group chat data exceeds the storage limit.");
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, json, { encoding: "utf8", flag: "wx" }); await (await import("node:fs/promises")).rename(temporary, file); }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
}
async function readJson(file, fallback, maxBytes = 512 * 1024) {
  try {
    const text = await readFile(file, "utf8");
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Saved group chat data exceeds its size limit.");
    return JSON.parse(text);
  }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
const profilesFile = () => groupFile("profiles.json");
const participantsFile = (id) => groupFile(`participants-${encodeURIComponent(id)}.json`);
async function readProfiles() {
  const stored = await readJson(profilesFile(), null, 256 * 1024);
  if (stored !== null) {
    if (!Array.isArray(stored) || stored.length > 64) throw new Error("Saved profile list is invalid.");
    for (const profile of stored) await validateProfile(profile, { catalog: false });
    return stored;
  }
  await atomicJson(profilesFile(), DEFAULT_PROFILES, 256 * 1024);
  return DEFAULT_PROFILES;
}
const PROFILE_MODES = ["read-only", "ask", "auto-edit", "full-auto"];
const PROFILE_FIELDS = ["id", "name", "roleTitle", "instructions", "summary", "provider", "model", "effort", "permissionMode"];
function nextProfileName(name, profiles) {
  for (let suffix = 2; suffix < 100000; suffix++) {
    const tail = ` ${suffix}`, candidate = `${name.slice(0, 60 - tail.length)}${tail}`;
    if (!profiles.some((profile) => profile.name.toLowerCase() === candidate.toLowerCase())) return candidate;
  }
  throw new Error("No available duplicate profile name could be generated.");
}
async function validateProfile(profile, { catalog = true } = {}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || Object.keys(profile).some((key) => !PROFILE_FIELDS.includes(key)) || PROFILE_FIELDS.some((key) => !Object.hasOwn(profile, key))) throw new Error("Profile data is invalid.");
  if (typeof profile.id !== "string" || !/^[a-z0-9-]{1,48}$/.test(profile.id)) throw new Error("Profile id is invalid.");
  safeHeaderPart(profile.name, 60); safeHeaderPart(profile.roleTitle, 60);
  if (typeof profile.instructions !== "string" || Buffer.byteLength(profile.instructions) > 16 * 1024 || typeof profile.summary !== "string" || Buffer.byteLength(profile.summary) > 2048) throw new Error("Profile instructions or summary exceed the size limit.");
  if (!providers.has(profile.provider)) throw new Error("The selected provider is unavailable.");
  if (typeof profile.model !== "string" || !profile.model || profile.model.length > 200 || typeof profile.effort !== "string" || profile.effort.length > 40) throw new Error("Profile model or effort is invalid.");
  if (!PROFILE_MODES.includes(profile.permissionMode)) throw new Error("The permission preset is unsupported.");
  const normalized = Object.fromEntries(PROFILE_FIELDS.map((key) => [key, key === "instructions" || key === "summary" ? profile[key] : String(profile[key]).trim()]));
  if (!catalog) return normalized;
  const description = await providers.get(profile.provider).describe({ cwd: "" });
  if (description.available === false) throw new Error("The selected provider is unavailable.");
  const aliases = profile.provider === "claude" ? ["opus", "sonnet", "haiku"] : [];
  const model = description.models?.find((entry) => entry.id === profile.model);
  if (!model && !aliases.includes(profile.model)) throw new Error("The selected model is unavailable.");
  const efforts = model?.efforts || (aliases.includes(profile.model) ? ["low", "medium", "high", "xhigh", "max"] : []);
  if (profile.effort && !efforts.includes(profile.effort)) throw new Error("The selected effort is unavailable.");
  return normalized;
}
async function readParticipants(id) {
  const rows = await readJson(participantsFile(id), [], 512 * 1024);
  if (!Array.isArray(rows) || rows.length > 32) throw new Error("Saved participant list is invalid.");
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("Saved participant metadata is invalid.");
    row.profileId ||= row.roleId;
    row.roleTitle ||= row.role;
    row.provider ||= row.engine;
    if (Object.hasOwn(row, "token") || !/^[0-9a-f-]{36}$/i.test(row.id || "") || !/^[0-9a-f-]{36}$/i.test(row.mainSessionId || "") || row.mainSessionId !== id) throw new Error("Saved participant metadata is invalid.");
    safeHeaderPart(row.name, 60); safeHeaderPart(row.roleTitle, 60);
    if (typeof row.profileId !== "string" || !/^[a-z0-9-]{1,48}$/.test(row.profileId) || !["claude", "codex"].includes(row.provider) || !["read-only", "ask", "auto-edit", "full-auto"].includes(row.permissionMode)) throw new Error("Saved participant metadata is invalid.");
    if (typeof row.instructions !== "string" || Buffer.byteLength(row.instructions) > 16 * 1024 || typeof row.summary !== "string" || Buffer.byteLength(row.summary) > 2048 || typeof row.model !== "string" || row.model.length > 200 || typeof row.effort !== "string" || row.effort.length > 40 || typeof row.cwd !== "string" || row.cwd.length > 32768 || !path.isAbsolute(row.cwd)) throw new Error("Saved participant metadata is invalid.");
    if (row.sessionId !== "" && (typeof row.sessionId !== "string" || !row.sessionId || row.sessionId.length > 512 || /[\u0000-\u001f\u007f]/.test(row.sessionId))) throw new Error("Saved participant session id is invalid.");
    if (row.sessionId) participantIds.add(row.sessionId);
  }
  return rows;
}
async function loadParticipantIds() {
  for (const file of await readdir(GROUP_ROOT()).catch(() => [])) {
    if (!/^participants-.+\.json$/.test(file)) continue;
    const rows = await readJson(groupFile(file), [], 512 * 1024).catch(() => []);
    if (Array.isArray(rows)) for (const row of rows) if (typeof row?.sessionId === "string") participantIds.add(row.sessionId);
  }
}
async function hasGroupParticipants(id) { return readFile(participantsFile(id)).then(() => true).catch((error) => { if (error.code === "ENOENT") return false; throw error; }); }
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
const LOCAL_PAGE_ONLY = new Set(["session-history", "follow-session", "manage-session", "instructions", "watch-sessions", "watch-subagents", "subagent-history", "provider-setup", "manage-profiles", "group-index", "participant-observer"]);
async function send(channel, event, session) {
  if (session?.closed) return;
  if (session?.groupParticipant) {
    const group = session.group;
    if (group) for (const observer of group.observers || []) if (observer.participantId === session.groupParticipant.id && !observer.closed) {
      try { if (!observer.channel.writable) await observer.channel.whenWritable(); observer.channel.send(serializeEvent(event)); } catch { /* observer closed */ }
    }
    return;
  }
  if (isGroupMain(session) && event?.type === "turn-started") session.groupTurnShared = isPersistentGroup(session);
  if (isGroupMain(session) && session.groupTurnShared && event?.type === "text-delta") { session.groupTurnText = (session.groupTurnText || "") + (event.text || ""); return; }
  if (isGroupMain(session) && session.groupTurnShared && event?.type === "text") { session.groupTurnText = event.text || session.groupTurnText || ""; return; }
  if (isGroupMain(session) && session.groupTurnShared && event?.type === "turn-ended") {
    const finalText = (session.groupTurnText || "").trim();
    session.groupTurnText = "";
    if (finalText && finalText !== GROUP_PASS && !session.groupCommandTurn) await publishGroupMessage(getGroup(session.id, session), `${AUTHOR_HEADER("Master", "main")}\n${escapeBodyHeaders(finalText)}`, { name: "Master", role: "main", engine: session.providerId, kind: "agent" });
    session.groupCommandTurn = false;
    session.groupTurnShared = false;
    await flushGroupQueue(getGroup(session.id, session), session);
  }
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
  if (session.groupParticipant && session.groupParticipant.permissionMode !== "read-only") {
    const group = session.group;
    await send(group.mainSession.channel, { type: "approval-request", requestId, participantApproval: true, author: { name: session.groupParticipant.name, roleTitle: session.groupParticipant.roleTitle, provider: session.providerId }, ...event }, group.mainSession);
  } else await send(session.channel, { type: "approval-request", requestId, ...event }, session);
  return answer;
}
function settleApproval(session, id, result) {
  const pending = session.approvals.get(id);
  if (!pending) return;
  session.approvals.delete(id); pending.cleanup(); pending.resolve(result);
  if (session.groupParticipant && !session.suppressApprovalResolved) {
    const group = session.group;
    void send(group.mainSession.channel, { type: "approval-resolved", requestId: id, outcome: result.decision === "deny" ? (String(result.message || "").includes("timed out") ? "expired" : "denied") : "allowed" }, group.mainSession);
  }
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
const policyDecision = (session, toolName, input = {}) => {
  if (session?.groupParticipant && /^(?:mcp__)?agent_chat(?:__|\.)post_message$/.test(toolName)) return { permissionDecision: "allow", kind: "mcp" };
  const decision = hookDecision(session.policyMode || session.mode, toolName, input, session.open.cwd);
  if (session?.groupParticipant && session.groupParticipant.permissionMode === "read-only" && decision.permissionDecision === "ask") return { ...decision, permissionDecision: "deny", message: "This action is outside the joined agent's permission preset." };
  return decision;
};
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
  if (crossBoard) delete open.groupChat;
  else if (open.groupChat?.internal === true && open.groupChat.position === "joined") {
    open.groupChat.name = safeHeaderPart(open.groupChat.name, 60);
    if (!/^[0-9a-f-]{36}$/i.test(open.groupChat.participantId || "") || !["read-only", "ask", "auto-edit", "full-auto"].includes(open.groupChat.permissionMode)) throw new Error("Group participant metadata is invalid.");
  } else if (open.groupChat?.position === "main") open.groupChat = { name: "Master", position: "main" };
  else delete open.groupChat;
  const ceiling = (await persephone.settings.get("cross-board-permission-ceiling")) || "read-only";
  const mode = open.groupChat?.position === "joined" ? open.groupChat.permissionMode : selectPermissionMode({ requested: open.permissionMode, ceiling, crossBoard });
  return { open, crossBoard, mode };
}
const issueOpenEndpoint = (prepared) => issueEndpoint(prepared.open.mcp?.persephone !== false && prepared.mode !== "read-only");
function getGroup(mainSessionId, mainSession) {
  let group = groups.get(mainSessionId);
  if (!group) {
    group = { mainSessionId, mainSession, participants: [], live: new Map(), queues: new Map(), channelClosed: false };
    groups.set(mainSessionId, group);
  }
  if (mainSession) { group.mainSession = mainSession; group.channelClosed = false; }
  return group;
}
async function saveParticipants(group) {
  await atomicJson(participantsFile(group.mainSessionId), group.participants.map(({ token, ...row }) => row));
  for (const row of group.participants) if (row.sessionId) participantIds.add(row.sessionId);
}
function internalParticipantChannel(group, participantId) {
  const listeners = { message: null, close: null };
  let closed = false;
  return {
    get writable() { return !closed; },
    async whenWritable() {},
    send(event) {
      if (closed) return;
      const participant = group.participants.find((row) => row.id === participantId);
      if (event.type === "session-started" && participant) participant.sessionId = event.sessionId;
      if (event.type === "error" && event.fatal) void send(group.mainSession.channel, { type: "group-participant-error", participantId, message: event.message || "Participant session failed." }, group.mainSession);
      if (event.type === "turn-started" || event.type === "turn-ended") {
        const live = group.live.get(participantId);
        if (live) live.busy = event.type === "turn-started";
        if (event.type === "turn-ended") void flushGroupQueue(group, live);
      }
    },
    onMessage(callback) { listeners.message = callback; },
    onClose(callback) { listeners.close = callback; },
    close(reason) { if (closed) return; closed = true; listeners.close?.(reason); },
  };
}
async function startGroupHttpServer() {
  if (groupHttpServer?.listening) return groupHttpAddress;
  groupHttpServer = createServer(async (req, res) => {
    if (req.url !== "/mcp") { res.writeHead(404).end(); return; }
    const hostHeader = String(req.headers.host || "").toLowerCase();
    const origin = req.headers.origin;
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; }
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(hostHeader) || (origin && origin !== `http://${hostHeader}`)) { res.writeHead(403).end(); return; }
    const auth = /^Bearer ([a-f0-9]{64})$/.exec(String(req.headers.authorization || ""));
    if (!auth) { res.writeHead(401).end(); return; }
    const tokenBytes = Buffer.from(auth[1], "hex");
    const matchedToken = [...groupTokens.keys()].find((candidate) => timingSafeEqual(Buffer.from(candidate, "hex"), tokenBytes));
    const record = matchedToken ? groupTokens.get(matchedToken) : null;
    if (!record || !record.group.participants.includes(record.participant)) { res.writeHead(401).end(); return; }
    let body = "";
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 64 * 1024) { res.writeHead(413).end(); return; } }
    let message;
    try { message = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const reply = (payload) => { res.writeHead(200, { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-03-26" }).end(JSON.stringify(payload)); };
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") { res.writeHead(400).end(); return; }
    if (message.method === "notifications/initialized" && message.id === undefined) { res.writeHead(202).end(); return; }
    if (message.method === "initialize") return reply({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "agent-chat", version: "1" } } });
    if (message.method === "tools/list") return reply({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "post_message", description: "Post a message to the group chat", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }] } });
    if (message.method === "tools/call") {
      const params = message.params || {};
      if (params.name !== "post_message") return reply({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown tool." } });
      const input = params.arguments || {};
      if (Object.keys(input).some((key) => key !== "text") || typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.text) > 16 * 1024) return reply({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "The message must be non-empty text of at most 16 KiB." }], isError: true } });
      // Joined agents read the Master rules too and sometimes post the pass marker; it is never shared.
      if (input.text.trim() === GROUP_PASS) return reply({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "Nothing was posted. When you have nothing to add, end your turn without calling post_message." }], isError: false } });
      const author = record.participant;
      const stamped = `${AUTHOR_HEADER(author.name, author.roleTitle)}\n${escapeBodyHeaders(input.text.trim())}`;
      await publishGroupMessage(record.group, stamped, { name: author.name, roleTitle: author.roleTitle, profileId: author.profileId, provider: author.provider, kind: "participant" }, author.id);
      return reply({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "Posted to group chat." }], isError: false } });
    }
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    return reply({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method." } });
  });
  await new Promise((resolve, reject) => { groupHttpServer.once("error", reject); groupHttpServer.listen(0, "127.0.0.1", resolve); });
  groupHttpAddress = `http://127.0.0.1:${groupHttpServer.address().port}/mcp`;
  return groupHttpAddress;
}
async function issueGroupEndpoint(participantId) {
  const participant = [...groups.values()].flatMap((group) => group.participants.map((row) => ({ row, group }))).find(({ row }) => row.id === participantId);
  if (!participant) throw new Error("The joined participant is unavailable.");
  const token = randomBytes(32).toString("hex");
  const url = await startGroupHttpServer();
  participant.row.token = token;
  groupTokens.set(token, { participant: participant.row, group: participant.group });
  return { url, token, revoke: () => { groupTokens.delete(token); participant.row.token = undefined; } };
}
function revokeGroupEndpoint(session) { try { session?.groupEndpoint?.revoke?.(); } catch { /* expired token */ } }
async function publishGroupMessage(group, stamped, author, sourceParticipantId = "") {
  const timelineText = stamped.replace(/^\[\[from: [^\n]+\]\]\n/, "");
  const notice = author.kind === "notice";
  const event = {
    type: "group-visible-message",
    text: notice ? `Agent ${author.name} (${author.roleTitle}) ${author.action}` : timelineText,
    timelineText,
    author,
    ...(notice ? { noticeAction: author.action, summary: author.summary, reminder: author.reminder || "" } : {}),
  };
  await send(group.mainSession.channel, event, group.mainSession);
  if (sourceParticipantId || author.kind === "notice") queueGroupText(group, group.mainSession, stamped);
  for (const participant of group.participants.filter((row) => !row.removed)) {
    const live = group.live.get(participant.id);
    if (!live) continue;
    // The source receives the shared timeline on its next turn too; agents are instructed to answer only when named.
    queueGroupText(group, live, stamped);
  }
}
function queueGroupText(group, session, text) {
  if (!session) return;
  const queue = group.queues.get(session.id) || [];
  queue.push(text);
  group.queues.set(session.id, queue);
  if (!session.busy) void flushGroupQueue(group, session);
}
async function flushGroupQueue(group, session) {
  if (!session || session.busy || session.groupDispatch || session.closed) return;
  const queue = group.queues.get(session.id);
  if (!queue?.length) return;
  group.queues.delete(session.id);
  session.groupDispatch = true;
  try { await session.adapter.dispatchSession(session, { type: "send", id: randomUUID(), text: queue.join("\n\n") }); }
  catch { /* send failure is reported by the provider; the queue is consumed for v1 */ }
  finally { session.groupDispatch = false; }
}
async function addGroupParticipant(group, request) {
  const profile = (await readProfiles()).find((item) => item.id === request.profileId);
  if (!profile) throw new Error("Choose an available profile.");
  await validateProfile(profile);
  const providerDescription = await providers.get(profile.provider).describe({ cwd: group.mainSession.open.cwd });
  if (providerDescription.available === false || profile.provider === "claude" && providerDescription.setup?.ready !== true) throw new Error("The selected provider is not ready.");
  if (group.participants.filter((row) => !row.removed).length >= 32) throw new Error("A group can have at most 32 participants.");
  const name = safeHeaderPart(profile.name, 60);
  if (name.toLowerCase() === "master" || group.participants.some((row) => !row.removed && (row.profileId === profile.id || row.name.toLowerCase() === name.toLowerCase()))) throw new Error("That profile or name is already in this chat.");
  const providerId = profile.provider;
  const adapter = providers.get(providerId);
  if (!adapter) throw new Error("The selected provider is unavailable.");
  const hadParticipantFile = await readFile(participantsFile(group.mainSessionId)).then(() => true).catch(() => false);
  const id = randomUUID();
  const participant = { id, profileId: profile.id, name, roleTitle: profile.roleTitle, instructions: profile.instructions, summary: profile.summary, provider: profile.provider, model: profile.model, effort: profile.effort, permissionMode: profile.permissionMode, sessionId: "", mainSessionId: group.mainSessionId, mainProvider: group.mainSession.providerId, cwd: group.mainSession.open.cwd };
  group.participants.push(participant);
  group.enabled = true;
  await saveParticipants(group);
  const channel = internalParticipantChannel(group, id);
  const open = { type: "open", contractVersion: 1, id: randomUUID(), provider: providerId, model: participant.model, effort: participant.effort, cwd: participant.cwd, permissionMode: participant.permissionMode, instructions: profile.instructions, groupChat: { internal: true, name, position: "joined", participantId: id, permissionMode: profile.permissionMode } };
  try {
    const live = await adapter.open(channel, open, {});
    live.group = group; live.groupParticipant = participant; group.live.set(id, live);
    const roster = group.participants.filter((item) => !item.removed).map((item) => `${item.name} (${item.roleTitle})`).join(", ");
    const history = request.historyText || "";
    const firstTurn = `You are ${name}, a joined agent with role ${profile.roleTitle}. ${profile.summary}\nCurrent participants: Master (main), ${roster}.\nVisible timeline so far:\n${boundedString(history, 64 * 1024).value || "No earlier visible messages."}`;
    await adapter.dispatchSession(live, { type: "send", id: randomUUID(), text: firstTurn });
    const reminder = hadParticipantFile ? "" : GROUP_CORE("Master", "main");
    const notice = `${AUTHOR_HEADER(name, profile.roleTitle)}\nAgent ${name} (${profile.roleTitle}) joined\n\n${escapeBodyHeaders(profile.summary)}${reminder ? `\n\n${reminder}` : ""}`;
    await publishGroupMessage(group, notice, { name, roleTitle: profile.roleTitle, profileId: profile.id, provider: providerId, summary: profile.summary, reminder, action: "joined", kind: "notice" });
    await saveParticipants(group);
    return participant;
  } catch (error) {
    group.participants = group.participants.filter((row) => row.id !== id);
    groupTokens.forEach((record, token) => { if (record.participant.id === id) groupTokens.delete(token); });
    await saveParticipants(group).catch(() => {});
    throw error;
  }
}
async function removeGroupParticipant(group, id) {
  const participant = group.participants.find((row) => row.id === id && !row.removed);
  if (!participant) return;
  const live = group.live.get(id);
  if (live) await denyParticipantApprovals(group, live, "denied");
  for (const observer of group.observers || []) if (observer.participantId === id) closeChannel(observer.channel, { code: "participant-removed", message: "The participant left the group." });
  if (live) { revokeGroupEndpoint(live); await closeSession(live, "participant-removed", true, true); group.live.delete(id); }
  groupTokens.forEach((record, token) => { if (record.participant.id === id) groupTokens.delete(token); });
  participant.removed = true;
  await saveParticipants(group);
  await publishGroupMessage(group, `${AUTHOR_HEADER(participant.name, participant.roleTitle)}\nAgent ${participant.name} (${participant.roleTitle}) left`, { name: participant.name, roleTitle: participant.roleTitle, profileId: participant.profileId, provider: participant.provider, action: "left", kind: "notice" });
}
async function resumeGroupParticipants(group) {
  for (const participant of group.participants) {
    if (participant.removed) continue;
    if (group.live.has(participant.id)) continue;
    if (!participant.sessionId) {
      await send(group.mainSession.channel, { type: "group-participant-error", participantId: participant.id, message: "The saved participant session id is unavailable." }, group.mainSession);
      continue;
    }
    const provider = providers.get(participant.provider);
    if (!provider) continue;
    try {
      const open = { type: "open", contractVersion: 1, id: randomUUID(), provider: participant.provider, model: participant.model, effort: participant.effort, cwd: participant.cwd || group.mainSession.open.cwd, resume: participant.sessionId, permissionMode: participant.permissionMode, instructions: participant.instructions, groupChat: { internal: true, name: participant.name, position: "joined", participantId: participant.id, permissionMode: participant.permissionMode } };
      const internal = internalParticipantChannel(group, participant.id);
      const live = await provider.open(internal, open, {});
      live.group = group; live.groupParticipant = participant; group.live.set(participant.id, live);
    } catch (error) { await send(group.mainSession.channel, { type: "group-participant-error", participantId: participant.id, message: boundedString(error.message || "Participant resume failed.", 4096).value }, group.mainSession); }
  }
}
async function groupOperation(session, request) {
  const group = getGroup(session.id, session);
  if (request.action === "list") {
    group.participants = await readParticipants(session.id);
    group.enabled = await hasGroupParticipants(session.id);
    await resumeGroupParticipants(group);
    return send(session.channel, { type: "group-data", groupMode: group.enabled, profiles: await readProfiles(), participants: group.participants.filter((row) => !row.removed) }, session);
  }
  if (request.action === "invite") {
    const participant = await addGroupParticipant(group, request);
    return send(session.channel, { type: "group-participant-added", participant }, session);
  }
  if (request.action === "remove") return removeGroupParticipant(group, request.participantId);
  if (request.action === "approval-response") {
    const owner = [...group.live.values()].find((participant) => participant.approvals?.has(request.requestId));
    if (owner) await owner.adapter.approve(owner, { type: "approval-response", requestId: request.requestId, decision: request.decision });
    return;
  }
  if (request.action === "save-profile") {
    const next = await validateProfile(request.profile);
    const rows = await readProfiles(), index = rows.findIndex((item) => item.id === next.id);
    if (index < 0 && rows.length >= 64) throw new Error("A maximum of 64 profiles is supported.");
    if (index < 0) rows.push(next); else rows[index] = next;
    await atomicJson(profilesFile(), rows, 256 * 1024);
    return send(session.channel, { type: "profile-data", profiles: rows }, session);
  }
  if (request.action === "delete-profile") {
    const rows = (await readProfiles()).filter((profile) => profile.id !== request.profileId);
    await atomicJson(profilesFile(), rows, 256 * 1024);
    return send(session.channel, { type: "profile-data", profiles: rows }, session);
  }
  if (request.action === "duplicate-profile") {
    const rows = await readProfiles(), source = rows.find((profile) => profile.id === request.profileId);
    if (!source) throw new Error("The selected profile is unavailable.");
    if (rows.length >= 64) throw new Error("A maximum of 64 profiles is supported.");
    const name = nextProfileName(source.name, rows);
    const copy = { ...source, id: randomUUID(), name };
    rows.push(copy); await atomicJson(profilesFile(), rows, 256 * 1024);
    return send(session.channel, { type: "profile-data", profiles: rows, selectedId: copy.id }, session);
  }
  if (request.action === "reset-profiles") {
    await atomicJson(profilesFile(), DEFAULT_PROFILES, 256 * 1024);
    return send(session.channel, { type: "profile-data", profiles: DEFAULT_PROFILES }, session);
  }
  if (request.action === "user-message") {
    const text = boundedString(request.text, 16 * 1024).value.trim();
    if (!text) return;
    const stamped = `${AUTHOR_HEADER("user", "")}\n${escapeBodyHeaders(text)}`;
    session.groupCommandTurn = false;
    await send(session.channel, { type: "group-visible-message", text, timelineText: escapeBodyHeaders(text), author: { name: "user", role: "", kind: "user" } }, session);
    for (const participant of group.participants.filter((row) => !row.removed)) queueGroupText(group, group.live.get(participant.id), stamped);
    if (session.busy) queueGroupText(group, session, stamped);
    else await session.adapter.dispatchSession(session, { type: "send", id: randomUUID(), text: stamped });
  }
  if (request.action === "stop-all") {
    group.queues.clear();
    await Promise.all([...group.live.values()].map((live) => denyParticipantApprovals(group, live, "stopped")));
    await session.adapter.dispatchSession(session, { type: "interrupt" });
    await Promise.all([...group.live.values()].map((live) => live.adapter.dispatchSession(live, { type: "interrupt" }).catch(() => {})));
  }
  if (!["list", "invite", "remove", "approval-response", "save-profile", "delete-profile", "duplicate-profile", "reset-profiles", "user-message", "stop-all"].includes(request.action)) throw new Error("The group operation is unavailable.");
}
async function denyParticipantApprovals(group, participant, outcome) {
  participant.suppressApprovalResolved = true;
  for (const requestId of [...(participant.approvals?.keys() || [])]) {
    try { await participant.adapter.approve(participant, { type: "approval-response", requestId, decision: "deny" }); } catch { /* participant is closing */ }
    await send(group.mainSession.channel, { type: "approval-resolved", requestId, outcome }, group.mainSession);
  }
  participant.suppressApprovalResolved = false;
}
async function closeSession(session, reason, force = false, closeTransport = false) {
  if (!session) return;
  if (session.closeTask) return session.closeTask;
  const task = (async () => {
    if (session.status?.compacting) { session.status.compacting = false; await send(session.channel, session.adapter.sessionStatus(session), session); }
    if (session.groupParticipant) {
      revokeGroupEndpoint(session);
      const group = session.groupParticipant.mainSessionId && groups.get(session.groupParticipant.mainSessionId);
      if (group) { await denyParticipantApprovals(group, session, "stopped"); group.live.delete(session.groupParticipant.id); }
    }
    if (isGroupMain(session)) {
      const group = groups.get(session.id);
      if (group) {
        group.channelClosed = true;
        await Promise.all([...group.live.values()].map((participant) => denyParticipantApprovals(group, participant, "closed")));
        for (const observer of group.observers || []) closeChannel(observer.channel, { code: "parent-closed", message: "The parent group session ended." });
        await Promise.all([...group.live.values()].map((participant) => closeSession(participant, "parent-closed", true, true)));
        group.live.clear();
        group.queues.clear();
        groups.delete(session.id);
      }
    }
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
  if (isGroupMain(session) && request?.type === "group") {
    try { return await groupOperation(session, request); }
    catch (error) { return send(session.channel, { type: "group-error", message: boundedString(error.message || "The group operation failed.", 4096).value }, session); }
  }
  if (isGroupMain(session) && request?.type === "send") session.groupCommandTurn = isPersistentGroup(session) && typeof request.text === "string" && request.text.trimStart().startsWith("/");
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
const host = { AsyncQueue, sessions, closingSessions, watchers, send, echo, replyError, closeChannel, registerSession, activeSessions, registerProcess, killChildren, sendEntries, closeSession, askApproval, settleApproval, approve, policyDecision, approvalKind, selectPermissionMode, sessionLimits, issueEndpoint, issueOpenEndpoint, issueGroupEndpoint, revokeEndpoint, revokeGroupEndpoint, prepareOpen, bindSession, watchFor, composeInstructions: composeProviderInstructions, groupCore: GROUP_CORE, hasGroupParticipants };
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

async function manageProfiles(channel, request) {
  try {
    let profiles = await readProfiles(), selectedId;
    if (request.action === "save") {
      const next = await validateProfile(request.profile), index = profiles.findIndex((item) => item.id === next.id);
      if (index < 0 && profiles.length >= 64) throw new Error("A maximum of 64 profiles is supported.");
      if (index < 0) profiles.push(next); else profiles[index] = next;
      await atomicJson(profilesFile(), profiles, 256 * 1024); selectedId = next.id;
    } else if (request.action === "delete") {
      profiles = profiles.filter((profile) => profile.id !== request.profileId);
    } else if (request.action === "duplicate") {
      const source = profiles.find((profile) => profile.id === request.profileId);
      if (!source) throw new Error("The selected profile is unavailable.");
      if (profiles.length >= 64) throw new Error("A maximum of 64 profiles is supported.");
      const name = nextProfileName(source.name, profiles);
      const copy = { ...source, id: randomUUID(), name }; profiles.push(copy); selectedId = copy.id;
      await atomicJson(profilesFile(), profiles, 256 * 1024);
    } else if (request.action === "reset") {
      profiles = DEFAULT_PROFILES; await atomicJson(profilesFile(), profiles, 256 * 1024);
    } else if (request.action !== "get") throw new Error("The profile operation is unavailable.");
    await send(channel, { type: "profile-data", profiles, selectedId, descriptions: await Promise.all([...providers.values()].map((provider) => provider.describe({ cwd: "" }))) });
    closeChannel(channel);
  } catch (error) { await send(channel, { type: "profile-error", message: boundedString(error.message || "The profile operation failed.", 4096).value }); closeChannel(channel); }
}

async function sendGroupIndex(channel, request) {
  const groupsIndex = [];
  for (const file of await readdir(GROUP_ROOT()).catch(() => [])) {
    const match = /^participants-(.+)\.json$/.exec(file);
    if (!match) continue;
    let participants;
    try { participants = await readParticipants(decodeURIComponent(match[1])); } catch { continue; }
    if (!participants.length) continue;
    groupsIndex.push({ mainSessionId: participants[0].mainSessionId, provider: participants[0].mainProvider || "", participants: participants.map(({ profileId, name, roleTitle, provider, sessionId, removed }) => ({ profileId, name, roleTitle, provider, sessionId, removed: Boolean(removed) })) });
  }
  const start = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
  let page = [], bytes = 0, offset = start;
  while (offset < groupsIndex.length) {
    const row = groupsIndex[offset], size = Buffer.byteLength(JSON.stringify(row));
    if (page.length && bytes + size > 480 * 1024) break;
    if (size > 480 * 1024) throw new Error("A group index entry exceeds the response size limit.");
    page.push(row); bytes += size; offset++;
  }
  await send(channel, { type: "group-index", groups: page, offset, done: offset >= groupsIndex.length, total: groupsIndex.length, ...(request.id === undefined ? {} : { id: request.id }) });
  closeChannel(channel);
}

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
  if (request?.type === "group-participant-open") {
    if (info?.interface || info?.caller || !request.mainSessionId) return closeChannel(channel, { code: "connection-refused", message: "Group participants can be invited only from the local board page." });
    const main = [...sessions.values()].map((record) => record.providerSession).find((item) => item.id === request.mainSessionId && isGroupMain(item));
    if (!main) return sendProviderError(channel, request, "session-unavailable", "The group chat is not live.");
    const group = getGroup(main.id, main);
    const participant = group.participants.find((row) => row.id === request.participantId);
    const provider = participant && providers.get(participant.provider);
    if (!participant || !provider) return sendProviderError(channel, request, "session-unavailable", "The participant is unavailable.");
    const resume = { ...participant, provider, adapter: provider };
    try {
      const open = { type: "open", contractVersion: 1, id: randomUUID(), provider: participant.provider, model: participant.model, effort: participant.effort, cwd: participant.cwd || main.open.cwd, resume: participant.sessionId, permissionMode: participant.permissionMode, instructions: participant.instructions, groupChat: { internal: true, name: participant.name, position: "joined", participantId: participant.id, permissionMode: participant.permissionMode } };
      const internal = internalParticipantChannel(group, participant.id);
      const live = await provider.open(internal, open, {});
      live.group = group; live.groupParticipant = participant; group.live.set(participant.id, live);
    } catch (error) { await send(main.channel, { type: "group-participant-error", participantId: participant.id, message: boundedString(error.message || "Participant resume failed.", 4096).value }, main); }
    closeChannel(channel);
    return;
  }
  if (request?.type === "instructions") { await manageInstructions(channel, request, info); return; }
  if (request?.type === "manage-profiles") {
    if (info?.interface || info?.caller) return closeChannel(channel, { code: "connection-refused", message: "Profiles are editable only from the local board page." });
    await manageProfiles(channel, request); return;
  }
  if (request?.type === "group-index") {
    if (info?.interface || info?.caller) return closeChannel(channel, { code: "connection-refused", message: "The group index is available only from the local board page." });
    try { await sendGroupIndex(channel, request); } catch (error) { await sendProviderError(channel, request, "protocol-error", error.message); }
    return;
  }
  if (request?.type === "participant-observer") {
    if (info?.interface || info?.caller) return closeChannel(channel, { code: "connection-refused", message: "Participant observation is available only from the local board page." });
    const main = [...sessions.values()].map((record) => record.providerSession).find((item) => item.id === request.mainSessionId && isGroupMain(item) && !item.closed);
    const group = main && groups.get(main.id), participant = group?.participants.find((row) => row.sessionId === request.sessionId && !row.removed), live = participant && group.live.get(participant.id);
    if (!group || !live || !participant) { await send(channel, { type: "observer-unavailable" }); closeChannel(channel); return; }
    group.observers ||= new Set();
    const observer = { channel, participantId: participant.id, closed: false };
    group.observers.add(observer);
    channel.onClose(() => { observer.closed = true; group.observers.delete(observer); });
    await send(channel, { type: "observer-ready", participant: { profileId: participant.profileId, name: participant.name, roleTitle: participant.roleTitle, provider: participant.provider } });
    return;
  }
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
  if (request?.type === "list-sessions") {
    const rows = [];
    for (const [providerId, candidate] of providers) {
      if (request.provider && request.provider !== providerId) continue;
      if (candidate.capabilities?.sessionStore !== true || typeof candidate.collectSessions !== "function") continue;
      try { rows.push(...await candidate.collectSessions(request)); } catch { /* unavailable provider rows are omitted */ }
    }
    await loadParticipantIds();
    for (const group of groups.values()) for (const participant of group.participants) if (participant.sessionId) participantIds.add(participant.sessionId);
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
  for (const token of groupTokens.keys()) groupTokens.delete(token);
  if (groupHttpServer?.listening) await new Promise((resolve) => groupHttpServer.close(resolve));
  await Promise.all([...providers.values()].map((adapter) => adapter.shutdownSessions()));
  for (const watcher of [...watchers]) watcher.stop();
  watchers.clear();
});
