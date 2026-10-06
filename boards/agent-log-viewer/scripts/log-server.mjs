// Resident log server for the Agent Log Viewer board, run with persephone.executeNode().
//
// Protocol: one JSON request per stdin line { id, op, ...args }; one JSON reply per stdout line
// { id, ...result } or { id, error }. Unsolicited events are { ev, ... } (progress, append,
// scan batches). stdout carries protocol messages only; diagnostics go to stderr (ui.log).
//
// Logs are never read whole: every operation streams the file with its own line splitter, which
// keeps the byte offset of each line so turns can be re-read later by range.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { SessionIndex } from "./session-model.mjs";
import * as claude from "./parsers/claude-code.mjs";
import * as codex from "./parsers/codex.mjs";

const PARSERS = [codex, claude];
const BOARD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = path.join(BOARD_ROOT, "cache", "summaries.json");
const CACHE_VERSION = 2;
const RAW_CAP = 2 * 1024 * 1024;

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

// ---- streaming line reader -------------------------------------------------------------------

/** Yield { text, o, n, partial } for every line of `file` in [start, end). `n` includes the
 *  newline. A trailing line without a newline is yielded with `partial: true`. */
async function* lines(file, start = 0, end = undefined) {
    if (end !== undefined && end <= start) return;
    const stream = fs.createReadStream(file, { start, end: end === undefined ? undefined : end - 1, highWaterMark: 1 << 20 });
    let pending = [];
    let pendingLen = 0;
    let pos = start;
    for await (const chunk of stream) {
        let s = 0;
        let nl;
        while ((nl = chunk.indexOf(10, s)) !== -1) {
            const piece = chunk.subarray(s, nl);
            const buf = pendingLen ? Buffer.concat([...pending, piece]) : piece;
            yield { text: buf.toString("utf8"), o: pos, n: buf.length + 1 };
            pos += buf.length + 1;
            pending = [];
            pendingLen = 0;
            s = nl + 1;
        }
        if (s < chunk.length) {
            pending.push(chunk.subarray(s));
            pendingLen += chunk.length - s;
        }
    }
    if (pendingLen) yield { text: Buffer.concat(pending).toString("utf8"), o: pos, n: pendingLen, partial: true };
}

function parse(text) {
    const t = text.trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return undefined; }
}

// ---- indexing --------------------------------------------------------------------------------

/** Session state kept per open file, so windows, raw reads and tails reuse the index. */
const sessions = new Map();

async function indexFile(file, onProgress) {
    const stat = await fs.promises.stat(file);
    const state = { file, size: stat.size, mtimeMs: stat.mtimeMs, parser: null, idx: null, offset: 0, bad: 0 };
    await indexFrom(state, onProgress);
    return state;
}

/** Continue indexing `state` from `state.offset` to the current end (used for the tail too). */
async function indexFrom(state, onProgress) {
    let lastReport = Date.now();
    let probe = 0;
    for await (const line of lines(state.file, state.offset)) {
        if (line.partial) {
            // A line still being written: try it, but only commit it once its newline arrives.
            const r = parse(line.text);
            if (r === undefined) break;
        }
        const r = parse(line.text);
        if (r === undefined) state.bad++;
        if (r) {
            if (!state.parser) {
                state.parser = PARSERS.find((p) => p.detect(r)) || null;
                if (state.parser) state.idx = new SessionIndex(state.parser.format);
                else if (++probe > 50) throw new Error("Not a Claude Code or Codex session log");
            }
            if (state.parser) {
                state.idx.header.records++;
                try { state.parser.index(state.idx, r, line.o, line.o + line.n); } catch (e) { state.idx.unknown++; }
            }
        }
        state.offset = line.o + line.n;
        if (onProgress && Date.now() - lastReport > 400) {
            lastReport = Date.now();
            onProgress(state.offset, state.size);
            await new Promise((res) => setImmediate(res)); // let other requests through
        }
    }
    if (!state.parser) throw new Error("Not a Claude Code or Codex session log");
}

function summaryOf(state) {
    const { header, turns } = state.idx.finish();
    return { header: { ...header, file: state.file, size: state.size, mtimeMs: state.mtimeMs, badLines: state.bad }, turnCount: turns.length };
}

async function openSession(file, id) {
    file = path.resolve(file);
    const state = await indexFile(file, (done, total) => send({ ev: "progress", id, file, done, total }));
    const old = sessions.get(file);
    if (old && old.watcher) state.watcher = old.watcher;
    sessions.set(file, state);
    const { header, turns } = state.idx.finish();
    rememberSummary(state);
    return { header: { ...header, file, size: state.size, badLines: state.bad }, turns };
}

function requireSession(file) {
    const state = sessions.get(path.resolve(file));
    if (!state) throw new Error("Session is not open: " + file);
    return state;
}

/** Normalize turns [from, to) of an open session. */
async function readTurns(file, from, to) {
    const state = requireSession(file);
    const turns = state.idx.turns;
    from = Math.max(0, from);
    to = Math.min(turns.length, to);
    if (from >= to) return [];
    const buckets = [];
    for (let i = from; i < to; i++) buckets.push({ i, turn: turns[i], records: [] });
    let b = 0;
    for await (const line of lines(state.file, turns[from].start, turns[to - 1].end)) {
        while (b < buckets.length - 1 && line.o >= buckets[b + 1].turn.start) b++;
        const r = parse(line.text);
        if (r) buckets[b].records.push({ r, o: line.o, n: line.n });
    }
    return buckets.map(({ i, records }) => {
        let items;
        try { items = state.parser.normalize(records, { file: state.file }); }
        catch (e) { items = [{ k: "meta", label: "parse error", text: String(e && e.message), refs: [] }]; }
        return { i, items };
    });
}

async function readRaw(file, refs) {
    const fd = await fs.promises.open(path.resolve(file), "r");
    try {
        const out = [];
        for (const [o, n] of refs.slice(0, 20)) {
            const len = Math.min(n, RAW_CAP);
            const buf = Buffer.alloc(len);
            await fd.read(buf, 0, len, o);
            let text = buf.toString("utf8").trimEnd();
            const r = parse(text);
            if (r) text = JSON.stringify(r, null, 2);
            out.push({ text, truncated: n > RAW_CAP ? n : 0 });
        }
        return out;
    } finally {
        await fd.close();
    }
}

// ---- live tail -------------------------------------------------------------------------------

function watchSession(file) {
    const state = requireSession(file);
    if (state.watcher) return;
    let busy = false;
    const onChange = async () => {
        if (busy) return;
        busy = true;
        try {
            const stat = await fs.promises.stat(state.file);
            if (stat.size < state.offset) { send({ ev: "truncated", file: state.file }); return; }
            if (stat.size === state.offset) return;
            const firstChanged = Math.max(0, state.idx.turns.length - 1);
            state.size = stat.size;
            await indexFrom(state);
            const { header, turns } = state.idx.finish();
            send({ ev: "append", file: state.file, header: { ...header, file: state.file, size: state.size }, from: firstChanged, turns: turns.slice(firstChanged) });
        } catch (e) {
            log("tail failed:", e && e.message);
        } finally {
            busy = false;
        }
    };
    fs.watchFile(state.file, { interval: 1000 }, onChange);
    state.watcher = () => fs.unwatchFile(state.file, onChange);
}

function unwatchAll() {
    for (const s of sessions.values()) if (s.watcher) { s.watcher(); s.watcher = null; }
}

// ---- summary cache, folders and scan ---------------------------------------------------------

let cache = null;
let cacheDirty = false;

function loadCache() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        if (cache.version !== CACHE_VERSION) throw new Error("old cache");
    } catch {
        cache = { version: CACHE_VERSION, files: {}, recent: cache && cache.recent || [] };
    }
    return cache;
}

function rememberSummary(state) {
    const c = loadCache();
    c.files[state.file] = { size: state.size, mtimeMs: state.mtimeMs, summary: summaryOf(state) };
    cacheDirty = true;
}

async function saveCache() {
    if (!cacheDirty) return;
    cacheDirty = false;
    await fs.promises.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = CACHE_FILE + ".tmp";
    await fs.promises.writeFile(tmp, JSON.stringify(cache));
    await fs.promises.rename(tmp, CACHE_FILE);
}
setInterval(() => saveCache().catch((e) => log("cache save failed:", e.message)), 5000).unref();

async function discover(sources) {
    const files = [];
    const walk = async (dir) => {
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== "subagents") await walk(p); }
            else if (e.isFile() && e.name.toLowerCase().endsWith(".jsonl")) files.push(p);
        }
    };
    for (const src of sources) {
        const p = path.resolve(src);
        let st;
        try { st = await fs.promises.stat(p); } catch { continue; }
        if (st.isDirectory()) await walk(p);
        else files.push(p);
    }
    return [...new Set(files)];
}

let scanToken = 0;

async function scan(id, sources) {
    const token = ++scanToken;
    const files = await discover(sources);
    const c = loadCache();
    const summaries = [];
    const todo = [];
    for (const f of files) {
        let st;
        try { st = await fs.promises.stat(f); } catch { continue; }
        const hit = c.files[f];
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) summaries.push(hit.summary);
        else todo.push({ f, size: st.size });
    }
    send({ ev: "scanBatch", id, summaries, done: summaries.length, total: files.length });
    const totalBytes = todo.reduce((a, t) => a + t.size, 0);
    let doneBytes = 0;
    let batch = [];
    let last = Date.now();
    for (const { f, size } of todo) {
        if (token !== scanToken) return { cancelled: true };
        try {
            const state = await indexFile(f, (done) => {
                if (Date.now() - last > 500) {
                    last = Date.now();
                    send({ ev: "progress", id, file: f, done: doneBytes + done, total: totalBytes });
                }
            });
            rememberSummary(state);
            batch.push(c.files[f].summary);
        } catch (e) {
            batch.push({ header: { file: f, size, error: e.message, format: "?", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } });
        }
        doneBytes += size;
        if (batch.length >= 25 || Date.now() - last > 500) {
            last = Date.now();
            send({ ev: "scanBatch", id, summaries: batch, done: summaries.length + batch.length, total: files.length, bytes: doneBytes, totalBytes });
            summaries.push(...batch);
            batch = [];
        }
    }
    if (batch.length) send({ ev: "scanBatch", id, summaries: batch, done: files.length, total: files.length });
    await saveCache();
    return { files: files.length, scanned: todo.length };
}

// ---- search ----------------------------------------------------------------------------------

/** Turns of an open session whose lines contain `query` (case-insensitive, raw line text). */
async function findInSession(file, query) {
    const state = requireSession(file);
    const q = query.toLowerCase();
    const turns = state.idx.turns;
    const hits = [];
    let t = 0;
    for await (const line of lines(state.file, 0, state.offset)) {
        if (!line.text.toLowerCase().includes(q)) continue;
        while (t < turns.length - 1 && line.o >= turns[t + 1].start) t++;
        if (hits[hits.length - 1] !== t) hits.push(t);
    }
    return hits;
}

/** Cross-session search over prompts and answers (not tool output). */
async function searchSessions(id, files, query) {
    const token = ++scanToken;
    const q = query.toLowerCase();
    const results = [];
    let n = 0;
    for (const f of files) {
        if (token !== scanToken) return { cancelled: true };
        let count = 0;
        let snippet = "";
        try {
            for await (const line of lines(f)) {
                const lower = line.text.toLowerCase();
                if (!lower.includes(q)) continue;
                const r = parse(line.text);
                if (!r) continue;
                const text = conversationText(r);
                const at = text.toLowerCase().indexOf(q);
                if (at < 0) continue;
                count++;
                if (!snippet) snippet = text.slice(Math.max(0, at - 60), at + q.length + 80).replace(/\s+/g, " ");
            }
        } catch { /* unreadable file: skip */ }
        if (count) results.push({ file: f, count, snippet });
        if (++n % 20 === 0) send({ ev: "progress", id, done: n, total: files.length, unit: "files" });
    }
    return { results };
}

function conversationText(r) {
    if (r.payload) {
        const p = r.payload;
        if (p.type === "message" && (p.role === "user" || p.role === "assistant") && Array.isArray(p.content)) return p.content.map((c) => c.text || "").join("\n");
        return "";
    }
    if ((r.type === "user" || r.type === "assistant") && r.message) {
        const c = r.message.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
    return "";
}

// ---- requests --------------------------------------------------------------------------------

function presets() {
    const home = os.homedir();
    const claudeDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects");
    const codexDir = path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "sessions");
    return { claude: { path: claudeDir, exists: fs.existsSync(claudeDir) }, codex: { path: codexDir, exists: fs.existsSync(codexDir) } };
}

const handlers = {
    hello: () => ({ presets: presets(), recent: loadCache().recent }),
    open: (m) => openSession(m.file, m.id),
    turns: (m) => readTurns(m.file, m.from, m.to).then((turns) => ({ turns })),
    raw: (m) => readRaw(m.file, m.refs).then((raw) => ({ raw })),
    watch: (m) => { watchSession(m.file); return {}; },
    unwatch: () => { unwatchAll(); return {}; },
    close: (m) => { const s = sessions.get(path.resolve(m.file)); if (s && s.watcher) s.watcher(); sessions.delete(path.resolve(m.file)); return {}; },
    scan: (m) => scan(m.id, m.sources),
    cancel: () => { scanToken++; return {}; },
    find: (m) => findInSession(m.file, m.query).then((hits) => ({ hits })),
    search: (m) => searchSessions(m.id, m.files, m.query),
    addRecent: (m) => {
        const c = loadCache();
        const key = JSON.stringify(m.source.paths);
        c.recent = [m.source, ...c.recent.filter((r) => JSON.stringify(r.paths) !== key)].slice(0, 12);
        cacheDirty = true;
        return { recent: c.recent };
    },
};

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const h = handlers[m.op];
    if (!h) { send({ id: m.id, error: "unknown op " + m.op }); return; }
    try {
        send({ id: m.id, ...(await h(m)) });
    } catch (e) {
        send({ id: m.id, error: (e && e.message) || String(e) });
    }
});
rl.on("close", async () => {
    unwatchAll();
    await saveCache().catch(() => {});
    process.exit(0);
});
send({ ready: true });
