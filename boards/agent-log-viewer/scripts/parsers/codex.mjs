// Codex CLI session logs: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Every line is an envelope { timestamp, type, payload }.
import { cap, pairResults, patchLines, preview } from "../session-model.mjs";

export const format = "codex";

export function detect(r) {
    return !!r && typeof r === "object" && "payload" in r && typeof r.type === "string";
}

function contentText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((c) => c.text || (c.type === "input_image" ? "[image]" : "")).filter(Boolean).join("\n");
}

/** Injected context (environment, AGENTS.md, permissions) arrives as user messages. */
function isInjected(text) {
    return /^\s*<[a-z_]+[\s>]/i.test(text) || /^# AGENTS\.md/.test(text);
}

function promptOf(p) {
    if (p.type === "message" && p.role === "user") {
        const text = contentText(p.content);
        return text.trim() && !isInjected(text) ? text : null;
    }
    if (p.type === "agent_message") {
        const text = contentText(p.content);
        return text.trim() ? text : null;
    }
    return null;
}

function usageOf(u) {
    const cached = u.cached_input_tokens || 0;
    return {
        input: Math.max(0, (u.input_tokens || 0) - cached), // OpenAI input includes the cached part
        output: u.output_tokens || 0,
        cacheRead: cached,
        cacheWrite: u.cache_write_input_tokens || 0,
        reasoning: u.reasoning_output_tokens || 0,
    };
}

function diffUsage(now, prev) {
    const d = {};
    for (const k of ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens"]) {
        d[k] = (now[k] || 0) - (prev ? prev[k] || 0 : 0);
        if (d[k] < 0) return null; // counter reset (new window / fork): fall back to last usage
    }
    return d;
}

function outputText(output) {
    if (typeof output === "string") {
        if (output.startsWith("{")) {
            try {
                const j = JSON.parse(output);
                if (typeof j.output === "string") return { text: j.output, exit: j.metadata && j.metadata.exit_code };
            } catch { /* plain text */ }
        }
        return { text: output };
    }
    return { text: contentText(output) };
}

function isFailure(text, exit) {
    if (typeof exit === "number") return exit !== 0;
    return /^(Script failed|Error:|error:)/.test(text) || /\bexit code:?\s*[1-9]\d*/i.test(text.slice(0, 400));
}

export function index(idx, r, start, end) {
    const h = idx.header;
    const p = r.payload || {};
    idx.touch(r.timestamp);
    if (r.type === "session_meta") {
        h.sessionId = h.sessionId || p.id || p.session_id || "";
        h.cwd = h.cwd || p.cwd || "";
        h.version = p.cli_version || h.version;
        if (p.git && p.git.branch) h.gitBranch = p.git.branch;
        if (p.source && typeof p.source === "object" && p.source.subagent) h.isSubagent = true;
        if (p.agent_nickname && !h.title) h.agentName = p.agent_nickname;
    }
    const prompt = promptOf(p);
    // A new task starts a turn; a second prompt inside one task starts another.
    if (prompt != null && (!idx.cur || idx.cur.prompt)) idx.startTurn(start, r.timestamp, prompt);
    else if (prompt != null) { idx.cur.prompt = preview(prompt); h.turns++; if (!h.firstPrompt) h.firstPrompt = preview(prompt, 200); }
    else if (r.type === "event_msg" && p.type === "task_started" && (!idx.cur || idx.cur.busy)) idx.startTurn(start, r.timestamp, "");
    else idx.ensureTurn(start, r.timestamp);
    idx.extend(end);

    if (r.type === "turn_context" && p.model) { idx.lastModel = p.model; idx.model(p.model); }
    if (r.type === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) idx.tool();
    if (r.type === "response_item" && idx.cur && (p.type === "function_call" || p.type === "custom_tool_call"
        || (p.type === "message" && p.role === "assistant"))) idx.cur.busy = true;
    if (r.type === "response_item" && (p.type === "function_call_output" || p.type === "custom_tool_call_output")) {
        const o = outputText(p.output);
        if (isFailure(o.text, o.exit)) idx.error();
    }
    if (r.type === "compacted") { h.compactions++; if (idx.cur) idx.cur.compacted = true; }
    if (r.type === "response_item" && p.type === "function_call" && p.name === "spawn_agent") h.subagents++;
    // Usage: deltas of the cumulative token_count (what ccusage does); a duplicate event adds 0.
    if (r.type === "event_msg" && p.type === "token_count" && p.info) {
        idx.sawTokenCount = true;
        const total = p.info.total_token_usage;
        const d = total ? diffUsage(total, idx.prevTotal) : null;
        const u = d || p.info.last_token_usage;
        if (total) idx.prevTotal = total;
        if (u) idx.usage(idx.lastModel, usageOf(u));
    }
}

// Bookkeeping records with nothing to read: kept out of the transcript (the raw log has them).
const SILENT = new Set(["event_msg/item_completed", "event_msg/token_count", "token_usage_record/", "world_state/",
    "inter_agent_communication_metadata/", "event_msg/thread_settings_applied", "event_msg/task_started",
    "event_msg/user_message", "event_msg/agent_message", "event_msg/agent_reasoning"]);

export function normalize(records) {
    const items = [];
    let model = "";
    for (const { r, o, n } of records) {
        const refs = [[o, n]];
        const ts = r.timestamp || "";
        const p = r.payload || {};
        if (SILENT.has(r.type + "/" + (p.type || ""))) continue;
        if (r.type === "response_item") {
            if (p.type === "message") {
                const text = contentText(p.content);
                if (p.role === "assistant") items.push({ k: "assistant", ...cap(text), refs, ts });
                else if (p.role === "user" && !isInjected(text)) items.push({ k: "user", ...cap(text), refs, ts });
                else items.push({ k: "meta", label: p.role + " context", ...cap(text), refs, ts });
            } else if (p.type === "agent_message") {
                items.push({ k: "user", label: "from " + (p.author || "agent"), ...cap(contentText(p.content)), refs, ts });
            } else if (p.type === "reasoning") {
                const text = (p.summary || []).map((s) => s.text).filter(Boolean).join("\n\n");
                items.push({ k: "thinking", ...cap(text || "(encrypted reasoning)"), refs, ts });
            } else if (p.type === "function_call" || p.type === "custom_tool_call") {
                let input = p.type === "function_call" ? p.arguments : p.input;
                if (typeof input === "string" && input.startsWith("{")) { try { input = JSON.parse(input); } catch { /* keep text */ } }
                const item = { k: "tool", id: p.call_id, name: p.name || p.type, input, summary: summary(input), refs, ts };
                const patchText = typeof input === "string" ? input : input && (input.patch || input.input);
                if (typeof patchText === "string" && patchText.includes("*** Begin Patch")) {
                    item.diff = { file: "", lines: patchLines(patchText.slice(patchText.indexOf("*** Begin Patch"), patchText.indexOf("*** End Patch") + 13)) };
                }
                items.push(item);
            } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
                const out = outputText(p.output);
                items.push({ k: "toolResult", id: p.call_id, error: isFailure(out.text, out.exit), ...cap(out.text), refs, ts });
            } else {
                items.push({ k: "meta", label: p.type || "response_item", text: "", refs, ts });
            }
        } else if (r.type === "compacted") {
            items.push({ k: "divider", kind: "compact", text: "Context compacted", ...cap(typeof p.message === "string" ? p.message : "", 4000), refs, ts });
        } else if (r.type === "turn_context") {
            const label = [p.model, p.effort && "effort " + p.effort, p.sandbox_policy && p.sandbox_policy.type].filter(Boolean).join(" · ");
            if (p.model && p.model !== model) items.push({ k: "divider", kind: "model", text: label, refs, ts });
            else items.push({ k: "meta", label: "turn_context", text: label, refs, ts });
            model = p.model || model;
        } else if (r.type === "event_msg" && p.type === "task_complete") {
            items.push({ k: "meta", label: "task complete", text: p.duration_ms ? "Took " + Math.round(p.duration_ms / 1000) + " s" : "", refs, ts });
        } else {
            items.push({ k: "meta", label: r.type + (p.type ? "/" + p.type : ""), text: "", refs, ts });
        }
    }
    return pairResults(items);
}

function summary(input) {
    if (input == null) return "";
    if (typeof input === "string") return preview(input, 140);
    const pick = input.cmd || input.command || input.path || input.message || input.task_name || input.query || "";
    return preview(Array.isArray(pick) ? pick.join(" ") : typeof pick === "string" ? pick : JSON.stringify(pick), 140);
}
