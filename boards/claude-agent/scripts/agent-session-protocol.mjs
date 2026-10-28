import path from "node:path";

export const CONTRACT_VERSION = 1;
export const MODES = ["read-only", "ask", "auto-edit", "full-auto"];
const MODE_RANK = new Map(MODES.map((mode, index) => [mode, index]));

export function clampMode(requested, ceiling) {
  const wanted = MODE_RANK.get(requested);
  const cap = MODE_RANK.get(ceiling);
  if (wanted === undefined || cap === undefined) throw new Error("Unknown permission mode.");
  return MODES[Math.min(wanted, cap)];
}

export function validateOpen(open) {
  if (!open || open.type !== "open" || open.contractVersion !== CONTRACT_VERSION) throw protocolError("Open requires contractVersion 1.");
  if (typeof open.model !== "string" || open.model.length > 200) throw protocolError("Model must be a string.");
  if (open.provider !== undefined && (typeof open.provider !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(open.provider))) throw protocolError("Provider must be a bounded identifier.");
  if (open.provider === undefined) open.provider = "claude";
  if (open.effort !== undefined && (typeof open.effort !== "string" || open.effort.length > 40)) throw protocolError("Effort must be a string.");
  if (typeof open.cwd !== "string" || !open.cwd.trim() || open.cwd.length > 32768 || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(open.cwd)) throw protocolError("An absolute working directory is required.");
  if (open.resume !== undefined && (typeof open.resume !== "string" || !open.resume.length || open.resume.length > 512 || /[\u0000-\u001f\u007f]/.test(open.resume))) throw protocolError("Resume id must be a bounded opaque string.");
  if (!MODE_RANK.has(open.permissionMode)) throw protocolError("Permission mode is invalid.");
  if (open.instructions !== undefined && (typeof open.instructions !== "string" || utf8Size(open.instructions) > 32 * 1024)) throw protocolError("Caller instructions exceed 32 KiB.");
  if (open.title !== undefined && (typeof open.title !== "string" || utf8Size(open.title) > 32 * 1024)) throw protocolError("Title exceeds 32 KiB.");
  if (open.limits !== undefined) {
    if (!open.limits || typeof open.limits !== "object" || Array.isArray(open.limits)) throw protocolError("Limits must be an object.");
    for (const key of ["maxUserTurns", "maxAgentSteps"]) {
      const value = open.limits[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 10000)) throw protocolError(`${key} must be an integer from 1 to 10000.`);
    }
    if (open.limits.maxBudgetUsd !== undefined && (typeof open.limits.maxBudgetUsd !== "number" || !Number.isFinite(open.limits.maxBudgetUsd) || open.limits.maxBudgetUsd <= 0 || open.limits.maxBudgetUsd > 100000)) throw protocolError("maxBudgetUsd must be a positive finite number.");
  }
  if (open.mcp !== undefined && (!open.mcp || typeof open.mcp !== "object" || (open.mcp.persephone !== undefined && typeof open.mcp.persephone !== "boolean"))) throw protocolError("MCP options are invalid.");
  if (open.groupChat !== undefined) validateGroupIdentity(open.groupChat);
  return open;
}

export function validateGroupIdentity(value) {
  const modes = ["read-only", "ask", "auto-edit", "full-auto"];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError("Group identity must be an object.");
  if (value.position === "main") {
    if (Object.keys(value).some((key) => key !== "position" && key !== "name")) throw protocolError("Main group identity contains unsupported fields.");
    if (value.name !== undefined && value.name !== "Master") throw protocolError("The main group identity is Master.");
    return value;
  }
  if (value.position !== "joined" || value.internal !== true || typeof value.name !== "string" || !value.name.trim() || value.name.length > 40 || /[\]\r\n\u0000-\u001f\u007f]/.test(value.name)) throw protocolError("Joined group identity is invalid.");
  if (typeof value.participantId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.participantId) || !modes.includes(value.permissionMode)) throw protocolError("Joined participant metadata is invalid.");
  return value;
}

export function authorHeader(name, role = "") {
  const valid = (value) => typeof value === "string" && value.length > 0 && value.length <= 80 && !/[\]\r\n\u0000-\u001f\u007f]/.test(value);
  if (!valid(name) || (role && !valid(role))) throw protocolError("Author identity must be bounded single-line text.");
  return role ? `[[from: ${name} | role: ${role}]]` : `[[from: ${name}]]`;
}

export function protocolError(message) {
  return Object.assign(new Error(message), { code: "protocol-error" });
}

export function composeInstructions(environment, provider, caller) {
  const layers = [
    environment || "",
    provider || "",
    caller || "",
  ].filter(Boolean);
  return layers.join("\n\n");
}

export function classifyTool(name) {
  if (name.startsWith("mcp__")) return "mcp";
  if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(name)) return "file-write";
  if (["Bash", "PowerShell", "Shell", "Terminal"].includes(name)) return "command";
  if (["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "ToolSearch"].includes(name)) return "read";
  return "other";
}

export function hookDecision(mode, toolName, input = {}, cwd = "") {
  const kind = classifyTool(toolName);
  if (kind === "read") return { permissionDecision: "allow", kind };
  if (mode === "full-auto") return { permissionDecision: "allow", kind };
  if (mode === "auto-edit" && kind === "file-write") {
    const target = input.file_path || input.notebook_path || input.path;
    if (typeof target === "string" && target && cwd) {
      const root = path.resolve(cwd).toLowerCase();
      const resolved = path.resolve(cwd, target).toLowerCase();
      if (resolved === root || resolved.startsWith(`${root}${path.sep.toLowerCase()}`)) return { permissionDecision: "allow", kind };
    }
  }
  if (mode === "read-only") return { permissionDecision: "deny", kind };
  return { permissionDecision: "ask", kind };
}

export function boundedString(value, bytes, marker = "…") {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (utf8Size(text) <= bytes) return { value: text, truncated: false };
  let result = "";
  for (const char of text) {
    if (utf8Size(result + char + marker) > bytes) break;
    result += char;
  }
  return { value: result + marker, truncated: true };
}

export function boundedObject(value, maxBytes = 16 * 1024) {
  let json;
  try { json = JSON.stringify(value ?? {}); } catch { json = "[unavailable]"; }
  const bounded = boundedString(json, maxBytes);
  return { summary: bounded.value, truncated: bounded.truncated };
}

export function summarizeToolInput(name, input) {
  const allowed = name === "Bash" || name === "PowerShell" || name === "Shell" || name === "Terminal"
    ? ["command", "description", "timeout"]
    : ["file_path", "path", "notebook_path", "pattern", "glob", "query", "url", "description", "command"];
  const summary = {};
  // AskUserQuestion carries only a questions array; list one "header — question" line per question.
  if (name === "AskUserQuestion" && Array.isArray(input?.questions)) {
    const lines = input.questions.map((item) => [item?.header, item?.question].filter((part) => typeof part === "string" && part).join(" — ")).filter(Boolean);
    if (lines.length) summary.questions = boundedString(lines.join("\n"), 4096).value;
  }
  for (const key of allowed) {
    const value = input?.[key];
    if (typeof value === "string") summary[key] = boundedString(value, 4096).value;
    else if (typeof value === "number" || typeof value === "boolean") summary[key] = value;
  }
  if (!Object.keys(summary).length) summary.kind = name;
  return boundedObject(summary, 16 * 1024);
}

export function utf8Size(value) { return new TextEncoder().encode(value).byteLength; }

export function appliedLimits(requested = {}) {
  return {
    maxUserTurns: { requested: requested.maxUserTurns ?? null, applied: requested.maxUserTurns !== undefined, enforcement: "provider-counts-completed-send-turns" },
    maxAgentSteps: { requested: requested.maxAgentSteps ?? null, applied: requested.maxAgentSteps !== undefined, sdkOption: "maxTurns" },
    maxBudgetUsd: { requested: requested.maxBudgetUsd ?? null, applied: requested.maxBudgetUsd !== undefined, sdkOption: "maxBudgetUsd" },
  };
}

export function serializeEvent(event) {
  let json = JSON.stringify(event);
  if (utf8Size(json) <= 900 * 1024) return event;
  const bounded = boundedString(json, 900 * 1024 - 128);
  return { type: "notice", message: "An oversized provider event was truncated.", detail: bounded.value, truncated: true };
}
