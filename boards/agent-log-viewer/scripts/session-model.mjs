// The shared session model both parsers produce.
//
// A log is indexed in one streaming pass into a SessionIndex: header stats plus one entry per
// turn holding only the byte range of its lines and small counters. Turn CONTENT is normalized on
// demand, a window at a time, from those byte ranges (see log-server.mjs `turns`), so the frame
// never receives a whole log.
//
// Token convention (both agents): `input` is UNCACHED input, `cacheRead` / `cacheWrite` are the
// cached parts, `output` includes reasoning; `reasoning` is informational only.

export const TEXT_CAP = 20000; // characters of one tool output / message sent to the frame

export function newTokens() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

export function addTokens(target, add) {
    target.input += add.input || 0;
    target.output += add.output || 0;
    target.cacheRead += add.cacheRead || 0;
    target.cacheWrite += add.cacheWrite || 0;
    target.reasoning += add.reasoning || 0;
}

export function tokenTotal(t) {
    return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function cap(text, limit = TEXT_CAP) {
    if (typeof text !== "string") text = text == null ? "" : JSON.stringify(text, null, 2);
    return text.length > limit
        ? { text: text.slice(0, limit), truncated: text.length }
        : { text };
}

/** First line of a prompt, trimmed for list and outline labels. */
export function preview(text, limit = 160) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    return s.length > limit ? s.slice(0, limit - 1) + "…" : s;
}

export class SessionIndex {
    constructor(format) {
        this.header = {
            format,
            sessionId: "",
            title: "",
            firstPrompt: "",
            cwd: "",
            gitBranch: "",
            version: "",
            models: [],
            start: "",
            end: "",
            turns: 0,
            toolCalls: 0,
            errors: 0,
            compactions: 0,
            subagents: 0,
            records: 0,
            tokens: newTokens(),
            tokensByModel: {},
            isSubagent: false,
        };
        this.turns = [];
        this.cur = null;
        this.unknown = 0;
    }

    /** Called for every record with its timestamp, before format-specific handling. */
    touch(ts) {
        if (!ts) return;
        if (!this.header.start || ts < this.header.start) this.header.start = ts;
        if (!this.header.end || ts > this.header.end) this.header.end = ts;
        if (this.cur) this.cur.endTs = ts;
    }

    /** Open a new turn at byte `offset`; a preamble turn has no prompt. */
    startTurn(offset, ts, prompt) {
        this.cur = {
            i: this.turns.length,
            start: offset,
            end: offset,
            ts: ts || "",
            endTs: ts || "",
            prompt: preview(prompt),
            tools: 0,
            errors: 0,
            compacted: false,
            tokens: newTokens(),
        };
        this.turns.push(this.cur);
        if (prompt) {
            this.header.turns++;
            if (!this.header.firstPrompt) this.header.firstPrompt = preview(prompt, 200);
        }
    }

    /** Ensure there is a turn to attribute a record to (lines before the first prompt). */
    ensureTurn(offset, ts) {
        if (!this.cur) this.startTurn(offset, ts, "");
    }

    /** Extend the current turn to cover the line ending at `end`. */
    extend(end) {
        if (this.cur) this.cur.end = end;
    }

    tool() {
        this.header.toolCalls++;
        if (this.cur) this.cur.tools++;
    }

    error() {
        this.header.errors++;
        if (this.cur) this.cur.errors++;
    }

    usage(model, tokens) {
        addTokens(this.header.tokens, tokens);
        if (this.cur) addTokens(this.cur.tokens, tokens);
        const key = model || "unknown";
        if (!this.header.tokensByModel[key]) this.header.tokensByModel[key] = newTokens();
        addTokens(this.header.tokensByModel[key], tokens);
    }

    model(name) {
        if (name && !this.header.models.includes(name) && name !== "<synthetic>") this.header.models.push(name);
    }

    finish() {
        const h = this.header;
        if (!h.title) h.title = h.firstPrompt;
        h.durationMs = h.start && h.end ? Date.parse(h.end) - Date.parse(h.start) : 0;
        return { header: h, turns: this.turns };
    }
}

/** Pair tool results with their calls inside one window of normalized items. Items that are
 *  `toolResult` with a known call id are folded into the call's `result`; the rest stay. */
export function pairResults(items) {
    const calls = new Map();
    const out = [];
    for (const item of items) {
        if (item.k === "tool") {
            calls.set(item.id, item);
            out.push(item);
        } else if (item.k === "toolResult" && calls.has(item.id)) {
            const call = calls.get(item.id);
            call.result = item;
            call.refs = call.refs.concat(item.refs);
            if (item.diff && !call.diff) call.diff = item.diff;
            if (item.agentId) call.agentId = item.agentId;
        } else {
            out.push(item);
        }
    }
    return out;
}

/** Turn a unified patch text ("*** Begin Patch" / git diff) into display lines. */
export function patchLines(text) {
    const lines = [];
    for (const line of String(text).split(/\r?\n/)) {
        if (line.startsWith("*** ") || line.startsWith("diff --git") || line.startsWith("@@")
            || line.startsWith("--- ") || line.startsWith("+++ ")) lines.push({ t: "h", s: line });
        else if (line.startsWith("+")) lines.push({ t: "+", s: line.slice(1) });
        else if (line.startsWith("-")) lines.push({ t: "-", s: line.slice(1) });
        else lines.push({ t: " ", s: line.startsWith(" ") ? line.slice(1) : line });
    }
    return lines;
}
