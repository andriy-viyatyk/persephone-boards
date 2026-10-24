import path from "node:path";

export const CONTRACT_VERSION = 1;
export const MODES = ["read-only", "ask", "auto-edit", "full-auto"];
export const MODE_NATIVE = Object.freeze({
  "read-only": "default",
  ask: "default",
  "auto-edit": "acceptEdits",
  "full-auto": "bypassPermissions",
});

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
  if (open.effort !== undefined && (typeof open.effort !== "string" || open.effort.length > 40)) throw protocolError("Effort must be a string.");
  if (typeof open.cwd !== "string" || !open.cwd.trim() || open.cwd.length > 32768 || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(open.cwd)) throw protocolError("An absolute working directory is required.");
  if (open.resume !== undefined && (typeof open.resume !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(open.resume))) throw protocolError("Resume id must be a session UUID.");
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
  return open;
}

export function protocolError(message) {
  return Object.assign(new Error(message), { code: "protocol-error" });
}

export function composeInstructions(cwd, mcpAttached, provider, caller) {
  const layers = [
    `You are running inside Persephone's Claude Agent board. Working directory: ${cwd}. Persephone MCP is ${mcpAttached ? "attached for this session" : "not attached"}. Your output is shown in a chat UI.`,
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
  for (const key of allowed) {
    const value = input?.[key];
    if (typeof value === "string") summary[key] = boundedString(value, 4096).value;
    else if (typeof value === "number" || typeof value === "boolean") summary[key] = value;
  }
  if (!Object.keys(summary).length) summary.kind = name;
  return boundedObject(summary, 16 * 1024);
}

export function utf8Size(value) { return new TextEncoder().encode(value).byteLength; }

export function normalizeModel(info) {
  return {
    id: String(info.value ?? info.resolvedModel ?? ""),
    label: String(info.displayName ?? info.value ?? "Claude model"),
    efforts: Array.isArray(info.supportedEffortLevels) ? info.supportedEffortLevels.filter((x) => typeof x === "string") : [],
  };
}

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
  } else if (message.type === "system" && message.subtype === "status" && message.status === "compacting") {
    events.push({ type: "notice", message: "Claude is compacting the conversation." });
  } else if (message.type === "system" && message.subtype === "compact_boundary") {
    const meta = message.compact_metadata || {};
    state.preserved = new Set(meta.preserved_messages?.all_uuids || meta.preserved_messages?.uuids || []);
    events.push({ type: "compacted", trigger: meta.trigger || "", ...(Number.isFinite(meta.pre_tokens) ? { preTokens: meta.pre_tokens } : {}), ...(Number.isFinite(meta.post_tokens) ? { postTokens: meta.post_tokens } : {}) });
  }
  return events;
}

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
