// Claude Code session logs: ~/.claude/projects/<project>/<sessionId>.jsonl, one record per line.
// Subagents live in <sessionId>/subagents/agent-<agentId>.jsonl next to the session file.
import path from "node:path";
import { cap, pairResults, preview } from "../session-model.mjs";

export const format = "claude";

/** A Claude record has no `payload` envelope and carries session bookkeeping fields. */
export function detect(r) {
    return !!r && typeof r === "object" && !("payload" in r)
        && ("sessionId" in r || "parentUuid" in r || "leafUuid" in r || r.type === "file-history-snapshot");
}

function blocks(r) {
    const c = r.message && r.message.content;
    if (typeof c === "string") return [{ type: "text", text: c }];
    return Array.isArray(c) ? c : [];
}

function textOf(r) {
    return blocks(r).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

/** Slash-command wrappers become "/name args"; command output and reminders are meta. */
function promptText(r) {
    if (r.type !== "user" || r.isMeta || r.isCompactSummary) return null;
    const bl = blocks(r);
    if (!bl.length || bl.some((b) => b.type === "tool_result")) return null;
    const text = textOf(r);
    if (!text.trim()) return bl.some((b) => b.type === "image") ? "[image]" : null;
    const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text);
    if (cmd) {
        const args = /<command-args>([^<]*)<\/command-args>/.exec(text);
        return (cmd[1].startsWith("/") ? cmd[1] : "/" + cmd[1]) + (args && args[1] ? " " + args[1] : "");
    }
    if (/^\s*<(local-command|system-reminder|bash-|task-notification)/.test(text)) return null;
    return text;
}

function usageOf(u) {
    return {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
    };
}

function resultText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content, null, 2);
    return content.map((b) => b.type === "text" ? b.text : b.type === "image" ? "[image]"
        : b.type === "tool_reference" ? "[tool: " + (b.tool_name || b.name || "?") + "]" : "[" + b.type + "]").join("\n");
}

/** One streaming-pass step: update the index from a record spanning bytes [start, end). */
export function index(idx, r, start, end) {
    const h = idx.header;
    if (!idx.seen) idx.seen = new Set();
    if (r.sessionId && !h.sessionId) h.sessionId = r.sessionId;
    if (r.cwd && !h.cwd) h.cwd = r.cwd;
    if (r.gitBranch && !h.gitBranch) h.gitBranch = r.gitBranch;
    if (r.version) h.version = r.version;
    if (r.isSidechain && r.agentId) h.isSubagent = true;
    if (r.type === "ai-title" && r.aiTitle) h.title = preview(r.aiTitle, 200);
    if (r.type === "custom-title" && r.customTitle) h.title = preview(r.customTitle, 200);
    idx.touch(r.timestamp);

    const prompt = promptText(r);
    if (prompt != null) idx.startTurn(start, r.timestamp, prompt);
    else idx.ensureTurn(start, r.timestamp);
    idx.extend(end);

    if (r.type === "assistant" && r.message) {
        idx.model(r.message.model);
        for (const b of blocks(r)) if (b.type === "tool_use") idx.tool();
        // Streamed blocks of one API response repeat the same usage: count each message id once.
        const id = r.message.id || r.requestId;
        if (r.message.usage && (!id || !idx.seen.has(id))) {
            if (id) idx.seen.add(id);
            idx.usage(r.message.model, usageOf(r.message.usage));
        }
    } else if (r.type === "user") {
        for (const b of blocks(r)) if (b.type === "tool_result" && b.is_error) idx.error();
        if (r.toolUseResult && typeof r.toolUseResult === "object" && r.toolUseResult.agentId) h.subagents++;
    } else if (r.type === "system" && r.subtype === "compact_boundary") {
        h.compactions++;
        if (idx.cur) idx.cur.compacted = true;
    }
}

/** Normalize the records of a turn window into display items. `ctx.file` is the log path. */
export function normalize(records, ctx) {
    const items = [];
    const dir = path.join(path.dirname(ctx.file), path.basename(ctx.file, ".jsonl"), "subagents");
    for (const { r, o, n } of records) {
        const refs = [[o, n]];
        const ts = r.timestamp || "";
        if (r.type === "user") {
            const prompt = promptText(r);
            if (r.isCompactSummary) {
                items.push({ k: "divider", kind: "compact", text: "Context compacted — summary", ...cap(textOf(r)), refs, ts });
                continue;
            }
            if (prompt != null) {
                items.push({ k: "user", ...cap(prompt), refs, ts });
                continue;
            }
            for (const b of blocks(r)) {
                if (b.type === "tool_result") {
                    const tur = r.toolUseResult && typeof r.toolUseResult === "object" ? r.toolUseResult : null;
                    const item = { k: "toolResult", id: b.tool_use_id, error: !!b.is_error, ...cap(resultText(b.content)), refs, ts };
                    if (tur && Array.isArray(tur.structuredPatch) && tur.structuredPatch.length) {
                        item.diff = { file: tur.filePath || "", lines: hunkLines(tur.structuredPatch) };
                    } else if (tur && tur.type === "create" && typeof tur.content === "string") {
                        item.diff = { file: tur.filePath || "", lines: tur.content.split(/\r?\n/).slice(0, 2000).map((s) => ({ t: "+", s })) };
                    }
                    if (tur && tur.agentId) {
                        item.agentId = tur.agentId;
                        item.agentFile = path.join(dir, "agent-" + tur.agentId + ".jsonl");
                    }
                    items.push(item);
                }
            }
            const text = textOf(r);
            if (text.trim() && !blocks(r).some((b) => b.type === "tool_result")) {
                items.push({ k: "meta", label: r.isMeta ? "meta" : "context", ...cap(text), refs, ts });
            }
        } else if (r.type === "assistant") {
            for (const b of blocks(r)) {
                if (b.type === "text" && b.text.trim()) items.push({ k: "assistant", ...cap(b.text), refs, ts, model: r.message.model });
                else if (b.type === "thinking" && (b.thinking || "").trim()) items.push({ k: "thinking", ...cap(b.thinking), refs, ts });
                else if (b.type === "tool_use") items.push({ k: "tool", id: b.id, name: b.name, input: b.input, summary: toolSummary(b.name, b.input), refs, ts });
            }
        } else if (r.type === "system") {
            if (r.subtype === "compact_boundary") items.push({ k: "divider", kind: "compact", text: "Context compacted", refs, ts });
            else items.push({ k: "meta", label: "system/" + (r.subtype || ""), ...cap(typeof r.content === "string" ? r.content : r.subtype === "turn_duration" ? "Turn took " + Math.round((r.durationMs || 0) / 1000) + " s" : ""), refs, ts });
        } else if (r.type === "attachment" || r.type === "progress") {
            items.push({ k: "meta", label: r.type + (r.attachment && r.attachment.type ? "/" + r.attachment.type : ""), text: "", refs, ts });
        }
        // Other bookkeeping (titles, modes, snapshots, queue operations) stays in the raw log only.
    }
    return pairResults(items);
}

function hunkLines(hunks) {
    const lines = [];
    for (const hk of hunks) {
        lines.push({ t: "h", s: `@@ -${hk.oldStart},${hk.oldLines} +${hk.newStart},${hk.newLines} @@` });
        for (const l of hk.lines || []) lines.push({ t: l[0] === "+" || l[0] === "-" ? l[0] : " ", s: l.slice(1) });
    }
    return lines;
}

/** One-line description of a tool call for its collapsed header. */
export function toolSummary(name, input) {
    if (!input || typeof input !== "object") return "";
    const pick = input.command || input.file_path || input.path || input.pattern || input.query
        || input.url || input.description || input.prompt || input.skill || input.code || "";
    return preview(typeof pick === "string" ? pick : JSON.stringify(pick), 140);
}
