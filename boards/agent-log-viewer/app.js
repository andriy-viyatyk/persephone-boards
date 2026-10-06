// Agent Log Viewer — frame logic.
//
// All file work happens in scripts/log-server.mjs (persephone.executeNode). This frame keeps only
// the session index (header + per-turn byte ranges) and the turns currently rendered, so a
// 400 MB log costs the frame a few hundred KB.
"use strict";

const P = window.persephone;
const $ = (id) => document.getElementById(id);
const WINDOW = 8; // turns fetched per request

// ---- pricing (estimate; off by default) ------------------------------------------------------
// USD per million tokens: [input, output, cache read, cache write]. Matched by model-name prefix.
// Subscription plans are not billed per token, so the board hides cost unless the setting is on.
const PRICES = [
    ["claude-opus", [5, 25, 0.5, 6.25]],
    ["claude-fable", [5, 25, 0.5, 6.25]],
    ["claude-sonnet", [3, 15, 0.3, 3.75]],
    ["claude-haiku", [1, 5, 0.1, 1.25]],
    ["gpt-5", [1.25, 10, 0.125, 0]],
];
let showCost = false;

function costOf(tokensByModel) {
    let usd = 0;
    let known = false;
    for (const [model, t] of Object.entries(tokensByModel || {})) {
        const price = PRICES.find(([prefix]) => model.startsWith(prefix));
        if (!price) continue;
        known = true;
        const [i, o, cr, cw] = price[1];
        usd += (t.input * i + t.output * o + t.cacheRead * cr + t.cacheWrite * cw) / 1e6;
    }
    return known ? usd : null;
}

// ---- formatting ------------------------------------------------------------------------------
const nf = new Intl.NumberFormat();
function fmtTokens(n) {
    if (!n) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
}
function fmtBytes(n) {
    if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + " GB";
    if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + " MB";
    if (n >= 1 << 10) return Math.round(n / (1 << 10)) + " KB";
    return n + " B";
}
function fmtDuration(ms) {
    if (!ms || ms < 0) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    return h < 48 ? h + "h " + (m % 60) + "m" : Math.round(h / 24) + "d";
}
function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) + " "
        + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtTime(iso) {
    return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}
/** Local calendar day as YYYY-MM-DD (groups and chart follow the viewer's time zone). */
function localDay(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const plural = (n, word) => nf.format(n) + " " + word + (n === 1 ? "" : "s");
const totalOf = (t) => t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0;
const baseName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
const agentLabel = (f) => f === "claude" ? "Claude Code" : f === "codex" ? "Codex" : "?";

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function markdown(text) {
    const div = el("div", "md");
    try {
        div.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text || "", { gfm: true, breaks: false }));
    } catch {
        div.textContent = text;
    }
    return div;
}

// ---- server ----------------------------------------------------------------------------------
let srv = null;
let nextId = 0;
const pending = new Map();
const eventHandlers = new Set();

function startServer() {
    return new Promise((resolve, reject) => {
        const h = P.executeNode("scripts/log-server.mjs", [], { name: "agent-log" });
        srv = h;
        const decoder = new TextDecoder();
        let buf = "";
        let ready = false;
        h.on("stdout", (chunk) => {
            buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                if (!line.trim()) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                if (msg.ready) { ready = true; resolve(); continue; }
                if (msg.ev) { for (const fn of eventHandlers) fn(msg); continue; }
                const p = pending.get(msg.id);
                if (p) {
                    pending.delete(msg.id);
                    if (msg.error) p.reject(new Error(msg.error));
                    else p.resolve(msg);
                }
            }
        });
        h.on("stderr", (chunk) => console.warn("[log-server] " + (typeof chunk === "string" ? chunk : decoder.decode(chunk))));
        const fail = (message) => {
            if (srv === h) srv = null;
            for (const p of pending.values()) p.reject(new Error(message));
            pending.clear();
            if (!ready) reject(new Error(message));
            else showError("The log server stopped: " + message);
        };
        h.on("exit", () => fail("exited"));
        h.on("error", (e) => fail((e && e.message) || "failed to start"));
    });
}

function request(op, args) {
    if (!srv) return Promise.reject(new Error("log server is not running"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, id });
        srv.write(JSON.stringify({ id, op, ...args }) + "\n");
    });
}

// ---- state overlay and status bar ------------------------------------------------------------
function showState(html, isError) {
    const s = $("state");
    s.className = "show" + (isError ? " error" : "");
    s.innerHTML = "";
    if (typeof html === "string") s.textContent = html;
    else s.append(html);
}
function hideState() { $("state").className = ""; }
function showError(message) { showState(message, true); setStatus(message, "error"); }

function showProgress(label, done, total) {
    const box = el("div");
    box.append(el("div", "big", label));
    const bar = el("progress");
    bar.max = total || 1;
    bar.value = done || 0;
    box.append(bar);
    if (total) box.append(el("div", "", total > 1e5 ? fmtBytes(done) + " of " + fmtBytes(total) : done + " of " + total));
    showState(box);
}

function setStatus(text, tone) {
    try { P.statusBar.update("status", { text, tone: tone || "normal" }); } catch { /* older host */ }
}

function emptyState() {
    const box = el("div");
    box.append(el("div", "big", "Open Claude Code or Codex session logs"));
    box.append(el("div", "", "A single log opens as a conversation; several files or a folder open as a session list."));
    const row = el("div", "row");
    for (const [id, label] of [["openFiles", "Files…"], ["openFolder", "Folder…"], ["presetClaude", "Claude Code sessions"], ["presetCodex", "Codex sessions"]]) {
        const b = el("button", "p-btn" + (id.startsWith("preset") ? " primary" : ""), label);
        b.onclick = () => $(id).click();
        if (id === "presetClaude") b.disabled = !(presets.claude && presets.claude.exists);
        if (id === "presetCodex") b.disabled = !(presets.codex && presets.codex.exists);
        row.append(b);
    }
    box.append(row);
    showState(box);
}

// ---- sources ---------------------------------------------------------------------------------
let presets = {};
let recent = [];
let source = null; // { paths: [...], kind: "file" | "files" | "folder", label }

function describe(paths, kind) {
    if (kind === "file") return paths[0];
    if (kind === "folder") return paths[0];
    return paths.length + " files";
}

async function openSource(src, opts = {}) {
    source = src;
    $("source").textContent = src.label || describe(src.paths, src.kind);
    $("source").title = src.paths.join("\n");
    $("reload").disabled = false;
    if (!opts.noRecent) {
        try { recent = (await request("addRecent", { source: src })).recent; renderRecent(); } catch { /* ignore */ }
    }
    if (src.kind === "file") {
        list = null;
        $("back").hidden = true;
        await openSession(src.paths[0]);
    } else {
        await openList(src.paths);
    }
}

function renderRecent() {
    const sel = $("recent");
    sel.length = 1;
    recent.forEach((r, i) => {
        const o = el("option", "", (r.label || describe(r.paths, r.kind)));
        o.value = String(i);
        sel.append(o);
    });
}

// ---- list view -------------------------------------------------------------------------------
let list = null; // { rows: [summary], sort: {key, asc}, filtered }
let searchHits = null; // Map(file -> {count, snippet}) from a content search

const COLUMNS = [
    { key: "agent", name: "Agent", get: (h) => h.format },
    { key: "date", name: "Started", get: (h) => h.start || "" },
    { key: "project", name: "Project", get: (h) => baseName(h.cwd).toLowerCase() },
    { key: "title", name: "Title", get: (h) => (h.title || "").toLowerCase() },
    { key: "duration", name: "Duration", num: true, get: (h) => h.durationMs || 0 },
    { key: "turns", name: "Turns", num: true, get: (h) => h.turns || 0 },
    { key: "tools", name: "Tools", num: true, get: (h) => h.toolCalls || 0 },
    { key: "errors", name: "Errors", num: true, get: (h) => h.errors || 0 },
    { key: "tokens", name: "Tokens", num: true, get: (h) => totalOf(h.tokens) },
    { key: "output", name: "Output", num: true, get: (h) => (h.tokens && h.tokens.output) || 0 },
    { key: "cost", name: "Est. cost", num: true, cost: true, get: (h) => costOf(h.tokensByModel) || 0 },
    { key: "size", name: "Size", num: true, get: (h) => h.size || 0 },
];

async function openList(paths) {
    $("sessionView").hidden = true;
    $("listView").hidden = false;
    $("back").hidden = true;
    closeSession();
    list = { rows: [], sort: list ? list.sort : { key: "date", asc: false } };
    searchHits = null;
    $("contentSearch").value = "";
    const byFile = new Map();
    showProgress("Reading sessions…", 0, 0);
    const id = nextId + 1;
    const onEv = (m) => {
        if (m.id !== id) return;
        if (m.ev === "scanBatch") {
            for (const s of m.summaries) byFile.set(s.header.file, s.header);
            list.rows = [...byFile.values()];
            showProgress("Reading sessions…", m.done, m.total);
            setStatus("Reading " + m.done + " of " + m.total + " sessions…", "muted");
        } else if (m.ev === "progress") {
            showProgress("Reading sessions…", m.done, m.total);
        }
    };
    eventHandlers.add(onEv);
    try {
        const res = await request("scan", { sources: paths });
        if (res.cancelled) return;
        list.rows = [...byFile.values()];
        hideState();
        renderList();
        if (!list.rows.length) showState("No .jsonl session logs found in\n" + paths.join("\n"));
    } catch (e) {
        showError(e.message);
    } finally {
        eventHandlers.delete(onEv);
    }
}

function visibleRows() {
    const q = $("filter").value.trim().toLowerCase();
    const agent = $("agentFilter").value;
    const showSub = $("showSub").checked;
    let rows = list.rows.filter((h) => !h.error || true);
    rows = rows.filter((h) => (showSub || !h.isSubagent) && (!agent || h.format === agent)
        && (!q || (h.title || "").toLowerCase().includes(q) || (h.cwd || "").toLowerCase().includes(q) || (h.file || "").toLowerCase().includes(q)));
    if (searchHits) rows = rows.filter((h) => searchHits.has(h.file));
    const col = COLUMNS.find((c) => c.key === list.sort.key) || COLUMNS[1];
    const dir = list.sort.asc ? 1 : -1;
    // Grouped rows sort by the group first (newest day first) so each group appears once.
    const group = $("groupBy").value;
    const groupKey = group === "project" ? (h) => (h.cwd || "").toLowerCase() : group === "day" ? (h) => localDay(h.start) : null;
    rows.sort((a, b) => {
        if (groupKey) {
            const ga = groupKey(a), gb = groupKey(b);
            if (ga !== gb) return group === "day" ? (ga < gb ? 1 : -1) : (ga < gb ? -1 : 1);
        }
        const x = col.get(a), y = col.get(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    return rows;
}

function renderList() {
    if (!list) return;
    const rows = visibleRows();
    const cols = COLUMNS.filter((c) => !c.cost || showCost);
    const thead = $("table").tHead;
    thead.innerHTML = "";
    const htr = el("tr");
    for (const c of cols) {
        const th = el("th", (c.num ? "num " : "") + (list.sort.key === c.key ? "sorted" + (list.sort.asc ? " asc" : "") : ""), c.name);
        th.onclick = () => {
            list.sort = list.sort.key === c.key ? { key: c.key, asc: !list.sort.asc } : { key: c.key, asc: !c.num && c.key !== "date" };
            renderList();
        };
        htr.append(th);
    }
    thead.append(htr);

    const tbody = $("table").tBodies[0];
    tbody.innerHTML = "";
    const group = $("groupBy").value;
    let lastGroup = null;
    const frag = document.createDocumentFragment();
    for (const h of rows) {
        if (group) {
            const g = group === "project" ? (h.cwd || "(no project)") : (h.start ? new Date(h.start).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }) : "(no date)");
            if (g !== lastGroup) {
                lastGroup = g;
                const gtr = el("tr", "group");
                const td = el("td", "", g);
                td.colSpan = cols.length;
                gtr.append(td);
                frag.append(gtr);
            }
        }
        const tr = el("tr");
        tr.title = h.file;
        for (const c of cols) {
            const td = el("td", c.num ? "num" : c.key);
            switch (c.key) {
                case "agent": {
                    const b = el("span", "agent " + h.format + (h.isSubagent ? " sub" : ""), agentLabel(h.format) + (h.isSubagent ? " · sub" : ""));
                    td.append(b);
                    break;
                }
                case "date": td.textContent = fmtDate(h.start); break;
                case "project": td.textContent = baseName(h.cwd); td.title = h.cwd || ""; break;
                case "title": {
                    if (h.error) { td.textContent = h.error; td.className += " err"; break; }
                    td.textContent = h.title || h.agentName || "(no prompt)";
                    const hit = searchHits && searchHits.get(h.file);
                    if (hit) {
                        td.append(el("span", "snippet", "  — " + hit.count + "× “" + hit.snippet + "”"));
                    }
                    td.title = (h.title || "") + "\n" + h.file;
                    break;
                }
                case "duration": td.textContent = fmtDuration(h.durationMs); break;
                case "turns": td.textContent = h.turns || ""; break;
                case "tools": td.textContent = h.toolCalls || ""; break;
                case "errors": td.textContent = h.errors || ""; if (h.errors) td.className += " err"; break;
                case "tokens": td.textContent = fmtTokens(totalOf(h.tokens)); td.title = tokenTitle(h.tokens); break;
                case "output": td.textContent = fmtTokens(h.tokens && h.tokens.output); break;
                case "cost": { const c2 = costOf(h.tokensByModel); td.textContent = c2 == null ? "" : "$" + c2.toFixed(2); break; }
                case "size": td.textContent = fmtBytes(h.size || 0); break;
            }
            tr.append(td);
        }
        tr.onclick = () => openFromList(h.file);
        frag.append(tr);
    }
    tbody.append(frag);
    renderTotals(rows);
    renderChart(rows);
}

function tokenTitle(t) {
    if (!t) return "";
    return "Input " + nf.format(t.input) + "\nOutput " + nf.format(t.output) + "\nCache read " + nf.format(t.cacheRead) + "\nCache write " + nf.format(t.cacheWrite);
}

function renderTotals(rows) {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const byModel = {};
    let turns = 0, tools = 0, errors = 0;
    for (const h of rows) {
        if (!h.tokens) continue;
        for (const k in t) t[k] += h.tokens[k] || 0;
        turns += h.turns || 0;
        tools += h.toolCalls || 0;
        errors += h.errors || 0;
        for (const [m, mt] of Object.entries(h.tokensByModel || {})) {
            const acc = byModel[m] || (byModel[m] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
            for (const k in acc) acc[k] += mt[k] || 0;
        }
    }
    const pairs = [
        ["Sessions", nf.format(rows.length) + (rows.length !== list.rows.length ? " of " + nf.format(list.rows.length) : "")],
        ["Turns · tools", nf.format(turns) + " · " + nf.format(tools)],
        ["Errors", nf.format(errors)],
        ["Input · output", fmtTokens(t.input) + " · " + fmtTokens(t.output)],
        ["Cache read · write", fmtTokens(t.cacheRead) + " · " + fmtTokens(t.cacheWrite)],
    ];
    if (showCost) {
        const c = costOf(byModel);
        pairs.push(["Est. cost (API)", c == null ? "—" : "$" + c.toFixed(2)]);
    }
    const box = $("totals");
    box.innerHTML = "";
    for (const [k, v] of pairs) { box.append(el("span", "k", k)); box.append(el("span", "v", v)); }
    setStatus(nf.format(rows.length) + " sessions · " + fmtTokens(totalOf(t)) + " tokens");
}

/** Daily total tokens for the last 60 days with activity, stacked Claude / Codex. */
function renderChart(rows) {
    const svg = $("chart");
    svg.innerHTML = "";
    const days = new Map();
    for (const h of rows) {
        if (!h.start || !h.tokens) continue;
        const d = localDay(h.start);
        const v = days.get(d) || { claude: 0, codex: 0 };
        v[h.format === "codex" ? "codex" : "claude"] += totalOf(h.tokens);
        days.set(d, v);
    }
    const keys = [...days.keys()].sort().slice(-60);
    if (!keys.length) return;
    const W = svg.clientWidth || 600, H = 72, top = 12, bottom = 12;
    const max = Math.max(...keys.map((k) => days.get(k).claude + days.get(k).codex)) || 1;
    const bw = Math.min(W / keys.length, 28);
    const x0 = W - bw * keys.length; // bars align right: the latest day is at the right edge
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const ns = "http://www.w3.org/2000/svg";
    keys.forEach((k, i) => {
        const v = days.get(k);
        let y = H - bottom;
        for (const part of ["claude", "codex"]) {
            const h = (v[part] / max) * (H - top - bottom);
            if (!h) continue;
            const r = document.createElementNS(ns, "rect");
            r.setAttribute("x", String(x0 + i * bw + 1));
            r.setAttribute("width", String(Math.max(1, bw - 2)));
            r.setAttribute("y", String(y - h));
            r.setAttribute("height", String(h));
            r.setAttribute("class", "bar-" + part);
            const t = document.createElementNS(ns, "title");
            t.textContent = k + " · " + agentLabel(part) + " " + fmtTokens(v[part]) + " tokens";
            r.append(t);
            svg.append(r);
            y -= h;
        }
    });
    const label = (x, text, anchor) => {
        const t = document.createElementNS(ns, "text");
        t.setAttribute("x", String(x));
        t.setAttribute("y", String(H - 1));
        t.setAttribute("text-anchor", anchor);
        t.textContent = text;
        svg.append(t);
    };
    if (keys.length > 1) label(x0, keys[0], "start");
    label(W, keys[keys.length - 1], "end");
    const peak = document.createElementNS(ns, "text");
    peak.setAttribute("x", "0");
    peak.setAttribute("y", "9");
    peak.textContent = "Tokens per day · peak " + fmtTokens(max);
    svg.append(peak);
}

async function runContentSearch() {
    const q = $("contentSearch").value.trim();
    if (!q) { searchHits = null; renderList(); return; }
    const files = list.rows.filter((h) => !h.error).map((h) => h.file);
    const id = nextId + 1;
    const onEv = (m) => { if (m.id === id && m.ev === "progress") setStatus("Searching " + m.done + " of " + m.total + " files…", "muted"); };
    eventHandlers.add(onEv);
    setStatus("Searching…", "muted");
    try {
        const res = await request("search", { files, query: q });
        if (res.cancelled) return;
        searchHits = new Map(res.results.map((r) => [r.file, r]));
        renderList();
        setStatus(res.results.length + " sessions mention “" + q + "”");
    } catch (e) {
        setStatus(e.message, "error");
    } finally {
        eventHandlers.delete(onEv);
    }
}

async function openFromList(file) {
    await openSession(file);
    $("back").hidden = false;
}

function backToList() {
    if (!list) return;
    closeSession();
    $("sessionView").hidden = true;
    $("listView").hidden = false;
    $("back").hidden = true;
    hideState();
    renderList();
}

// ---- session view ----------------------------------------------------------------------------
let sess = null; // { file, header, turns, lo, hi, hits, hitPos, stack }
let loading = false;

function closeSession() {
    if (sess) request("close", { file: sess.file }).catch(() => {});
    sess = null;
    $("transcript").innerHTML = "";
    $("outline").innerHTML = "";
}

async function openSession(file, opts = {}) {
    const stack = opts.parentStack || [];
    closeSession();
    $("listView").hidden = true;
    $("sessionView").hidden = false;
    showProgress("Indexing " + baseName(file) + "…", 0, 0);
    const id = nextId + 1;
    const onEv = (m) => { if (m.id === id && m.ev === "progress") showProgress("Indexing " + baseName(file) + "…", m.done, m.total); };
    eventHandlers.add(onEv);
    let res;
    try {
        res = await request("open", { file });
    } catch (e) {
        showError("Cannot open " + file + "\n\n" + e.message);
        return;
    } finally {
        eventHandlers.delete(onEv);
    }
    hideState();
    sess = { file, header: res.header, turns: res.turns, lo: 0, hi: 0, hits: [], hitPos: -1, stack };
    numberTurns();
    renderHeader();
    renderOutline();
    applyFilters();
    // Start at the last turn for a live session? No: start at the beginning, like a document.
    await showTurnsFrom(0);
    request("watch", { file }).catch(() => {});
}

function renderHeader() {
    const h = sess.header;
    $("sessTitle").textContent = (sess.stack.length ? "↳ " : "") + (h.title || h.agentName || baseName(sess.file));
    $("sessTitle").title = h.title || "";
    const meta = $("sessMeta");
    meta.innerHTML = "";
    const add = (label, value, title) => {
        if (value === "" || value == null) return;
        const s = el("span", "", label ? label + " " : "");
        s.append(el("b", "", String(value)));
        if (title) s.title = title;
        meta.append(s);
    };
    const agent = el("span", "agent " + h.format, agentLabel(h.format) + (h.isSubagent ? " · subagent" : ""));
    meta.append(agent);
    add("", baseName(h.cwd), h.cwd);
    add("branch", h.gitBranch);
    add("", h.models.join(", "));
    add("v", h.version);
    add("", fmtDate(h.start));
    add("", fmtDuration(h.durationMs));
    add("turns", nf.format(h.turns));
    add("tools", nf.format(h.toolCalls));
    if (h.errors) add("errors", nf.format(h.errors));
    if (h.compactions) add("compactions", h.compactions);
    if (h.subagents) add("subagents", h.subagents);
    add("tokens", fmtTokens(totalOf(h.tokens)), tokenTitle(h.tokens));
    add("output", fmtTokens(h.tokens.output));
    if (showCost) { const c = costOf(h.tokensByModel); if (c != null) add("est.", "$" + c.toFixed(2), "Estimated API cost"); }
    add("", fmtBytes(h.size || 0), sess.file);
    if (sess.live) meta.append(el("span", "live", "● live"));
    setStatus(agentLabel(h.format) + " · " + nf.format(h.turns) + " turns · " + fmtTokens(totalOf(h.tokens)) + " tokens");
}

/** Display numbers: prompted turns count from 1; a turn without a prompt has none. */
function numberTurns() {
    let n = 0;
    for (const t of sess.turns) t.no = t.prompt ? ++n : 0;
}

function renderOutline() {
    const nav = $("outline");
    nav.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const t of sess.turns) {
        const row = el("div", "ot");
        row.dataset.i = String(t.i);
        row.append(el("span", "n", t.no ? String(t.no) : ""));
        row.append(el("span", "p", t.prompt || "(session start)"));
        if (t.errors) row.append(el("span", "e", "✕" + t.errors));
        if (t.compacted) row.append(el("span", "c", "⇣"));
        row.title = (t.prompt || "") + "\n" + fmtDate(t.ts) + " · " + plural(t.tools, "tool call") + " · " + fmtTokens(totalOf(t.tokens)) + " tokens";
        row.onclick = () => jumpTo(t.i);
        frag.append(row);
    }
    nav.append(frag);
}

function markOutline(i) {
    for (const r of $("outline").querySelectorAll(".ot.current")) r.classList.remove("current");
    const row = $("outline").querySelector(`.ot[data-i="${i}"]`);
    if (row) {
        row.classList.add("current");
        const nav = $("outline");
        if (row.offsetTop < nav.scrollTop || row.offsetTop > nav.scrollTop + nav.clientHeight - 20) nav.scrollTop = row.offsetTop - nav.clientHeight / 3;
    }
}

async function fetchTurns(from, to) {
    const res = await request("turns", { file: sess.file, from, to });
    return res.turns;
}

/** Replace the transcript with turns starting at `i`. */
async function showTurnsFrom(i) {
    const t = $("transcript");
    t.innerHTML = "";
    sess.lo = sess.hi = Math.max(0, i);
    await loadMore("down");
    t.scrollTop = 0;
    if (sess.lo > 0) t.prepend(loadMoreRow("up"));
}

function loadMoreRow(dir) {
    const r = el("div", "loadmore", dir === "up" ? "↑ earlier turns — scroll up" : "↓ more turns");
    r.dataset.dir = dir;
    return r;
}

async function loadMore(dir) {
    if (!sess || loading) return;
    const s = sess;
    const t = $("transcript");
    if (dir === "down" && s.hi >= s.turns.length) return;
    if (dir === "up" && s.lo <= 0) return;
    loading = true;
    try {
        const from = dir === "down" ? s.hi : Math.max(0, s.lo - WINDOW);
        const to = dir === "down" ? Math.min(s.turns.length, s.hi + WINDOW) : s.lo;
        const turns = await fetchTurns(from, to);
        if (sess !== s) return;
        const frag = document.createDocumentFragment();
        for (const turn of turns) frag.append(renderTurn(turn));
        for (const old of t.querySelectorAll(`.loadmore[data-dir="${dir}"]`)) old.remove();
        if (dir === "down") {
            t.append(frag);
            s.hi = to;
            if (s.hi < s.turns.length) t.append(loadMoreRow("down"));
        } else {
            const before = t.scrollHeight;
            t.prepend(frag);
            s.lo = from;
            if (s.lo > 0) t.prepend(loadMoreRow("up"));
            t.scrollTop += t.scrollHeight - before;
        }
        highlightFind();
    } catch (e) {
        setStatus(e.message, "error");
    } finally {
        loading = false;
    }
}

function renderTurn(turn) {
    const meta = sess.turns[turn.i] || {};
    const box = el("div", "turn");
    box.dataset.i = String(turn.i);
    if (meta.errors) box.classList.add("has-error");
    const head = el("div", "turn-head");
    head.append(el("span", "tn", meta.no ? "Turn " + meta.no : turn.i === 0 ? "Session start" : "Continued"));
    head.append(el("span", "", fmtDate(meta.ts)));
    const dur = meta.ts && meta.endTs ? Date.parse(meta.endTs) - Date.parse(meta.ts) : 0;
    if (dur > 0) head.append(el("span", "", fmtDuration(dur)));
    if (meta.tools) head.append(el("span", "", plural(meta.tools, "tool call")));
    if (totalOf(meta.tokens)) {
        const tk = el("span", "", fmtTokens(totalOf(meta.tokens)) + " tokens · " + fmtTokens(meta.tokens.output) + " out");
        tk.title = tokenTitle(meta.tokens);
        head.append(tk);
    }
    if (meta.errors) head.append(el("span", "err", plural(meta.errors, "error")));
    box.append(head);
    for (const item of turn.items) box.append(renderItem(item));
    return box;
}

function rawButton(wrap, item) {
    if (!item.refs || !item.refs.length) return;
    const b = el("button", "raw-btn", "{ }");
    b.title = "Show the raw log record(s)";
    b.onclick = async (e) => {
        e.stopPropagation();
        const shown = wrap.querySelector(":scope > .raw");
        if (shown) { shown.remove(); return; }
        try {
            const res = await request("raw", { file: sess.file, refs: item.refs });
            const pre = el("pre", "raw mono", res.raw.map((r) => r.text + (r.truncated ? "\n… (record is " + fmtBytes(r.truncated) + "; first 2 MB shown)" : "")).join("\n\n"));
            wrap.append(pre);
        } catch (err) {
            setStatus(err.message, "error");
        }
    };
    wrap.append(b);
}

function truncNote(item) {
    return item.truncated ? el("div", "truncated", "Showing the first " + nf.format(item.text.length) + " of " + nf.format(item.truncated) + " characters — { } shows the full record") : null;
}

function renderItem(item) {
    const wrap = el("div", "item k-" + item.k);
    if (item.error || (item.result && item.result.error)) wrap.classList.add("has-error");
    switch (item.k) {
        case "user": {
            const box = el("div", "user");
            box.append(el("div", "who", item.label || "Prompt"));
            box.append(markdown(item.text));
            const n = truncNote(item);
            if (n) box.append(n);
            wrap.append(box);
            break;
        }
        case "assistant": {
            const box = el("div", "assistant");
            box.append(markdown(item.text));
            const n = truncNote(item);
            if (n) box.append(n);
            wrap.append(box);
            break;
        }
        case "thinking": {
            const d = el("details", "fold thinking");
            const s = el("summary", "", "Thinking — " + (item.text || "").replace(/[*`#_]+/g, "").replace(/\s+/g, " ").slice(0, 140));
            d.append(s);
            const body = el("div", "body");
            d.addEventListener("toggle", () => { if (d.open && !body.childNodes.length) body.append(markdown(item.text)); }, { once: false });
            d.append(body);
            wrap.append(d);
            break;
        }
        case "tool": wrap.append(renderTool(item)); break;
        case "toolResult": {
            const d = el("details", "fold tool" + (item.error ? " error" : ""));
            const s = el("summary");
            s.append(el("span", "st" + (item.error ? " err" : "")));
            s.append(el("span", "name", "Tool result"));
            s.append(el("span", "sum", (item.text || "").replace(/\s+/g, " ").slice(0, 140)));
            d.append(s);
            const body = el("div", "body");
            body.append(el("pre", "out mono" + (item.error ? " err" : ""), item.text));
            d.append(body);
            wrap.append(d);
            break;
        }
        case "divider": {
            const div = el("div", "divider " + (item.kind || ""));
            if (item.text && item.text !== "Context compacted" && item.kind === "compact" || (item.kind === "compact" && item.text && item.text.length > 20)) {
                const d = el("details");
                d.append(el("summary", "", item.kind === "compact" ? "Context compacted — summary" : item.text));
                const body = el("div", "body");
                d.addEventListener("toggle", () => { if (d.open && !body.childNodes.length) body.append(markdown(item.text)); });
                d.append(body);
                div.append(d);
            } else {
                div.append(el("span", "", item.kind === "model" ? "Model: " + item.text : item.text || "Context compacted"));
            }
            wrap.append(div);
            break;
        }
        default: {
            const m = el("div", "meta");
            m.append(el("span", "ml", item.label || "meta"));
            if (item.text) {
                if (item.text.length < 160 && !item.text.includes("\n")) m.append(document.createTextNode(" " + item.text));
                else m.append(el("pre", "mono", item.text));
            }
            wrap.append(m);
        }
    }
    rawButton(wrap, item);
    return wrap;
}

function renderTool(item) {
    const r = item.result;
    const d = el("details", "fold tool" + (r && r.error ? " error" : ""));
    const s = el("summary");
    s.append(el("span", "st" + (!r ? " none" : r.error ? " err" : "")));
    s.append(el("span", "name", item.name || "tool"));
    s.append(el("span", "sum", item.summary || ""));
    if (r && r.ts && item.ts) {
        const ms = Date.parse(r.ts) - Date.parse(item.ts);
        if (ms >= 1000) s.append(el("span", "dur", fmtDuration(ms)));
    }
    d.append(s);
    const body = el("div", "body");
    d.append(body);
    d.addEventListener("toggle", () => {
        if (!d.open || body.childNodes.length) return;
        if (item.diff) body.append(renderDiff(item.diff));
        // A patch given as plain text is already shown as the diff above.
        if (!(item.diff && typeof item.input === "string")) {
            body.append(el("div", "lbl", "Input"));
            const input = typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2);
            body.append(el("pre", "out mono", input && input.length > 20000 ? input.slice(0, 20000) + "\n…" : input));
        }
        if (r) {
            body.append(el("div", "lbl", r.error ? "Result — error" : "Result"));
            body.append(el("pre", "out mono" + (r.error ? " err" : ""), r.text || "(empty)"));
            const n = truncNote(r);
            if (n) body.append(n);
        } else {
            body.append(el("div", "lbl", "No result in this window"));
        }
        const agentFile = (r && r.agentFile) || item.agentFile;
        if (agentFile) {
            const b = el("button", "p-btn sm subagent-btn", "Open subagent log");
            b.title = agentFile;
            b.onclick = () => openSubagent(agentFile);
            body.append(b);
        }
        highlightFind(body);
    });
    return d;
}

function renderDiff(diff) {
    const box = el("div", "diff");
    if (diff.file) box.append(el("div", "file", diff.file));
    const lines = diff.lines.slice(0, 3000);
    for (const l of lines) {
        const cls = l.t === "+" ? "add" : l.t === "-" ? "del" : l.t === "h" ? "hdr" : "ctx";
        box.append(el("div", "l " + cls, l.s));
    }
    if (diff.lines.length > lines.length) box.append(el("div", "file", "… " + (diff.lines.length - lines.length) + " more lines"));
    return box;
}

async function openSubagent(file) {
    const parent = { file: sess.file, header: sess.header };
    const stack = sess.stack.concat([parent]);
    await openSession(file, { parentStack: stack });
    $("back").hidden = false;
}

function goBack() {
    if (sess && sess.stack.length) {
        const parent = sess.stack[sess.stack.length - 1];
        const rest = sess.stack.slice(0, -1);
        openSession(parent.file, { parentStack: rest }).then(() => { $("back").hidden = !(rest.length || list); });
    } else {
        backToList();
    }
}

async function jumpTo(i) {
    if (!sess) return;
    markOutline(i);
    let node = $("transcript").querySelector(`.turn[data-i="${i}"]`);
    if (!node) {
        await showTurnsFrom(Math.max(0, i));
        node = $("transcript").querySelector(`.turn[data-i="${i}"]`);
    }
    if (node) node.scrollIntoView({ block: "start" });
}

function currentTurn() {
    const t = $("transcript");
    const top = t.getBoundingClientRect().top;
    let cur = sess ? sess.lo : 0;
    for (const node of t.querySelectorAll(".turn")) {
        if (node.getBoundingClientRect().top - top <= 40) cur = Number(node.dataset.i);
        else break;
    }
    return cur;
}

// ---- filters ---------------------------------------------------------------------------------
function applyFilters() {
    const t = $("transcript");
    for (const cb of document.querySelectorAll("#sessTools input[data-filter]")) {
        t.classList.toggle("hide-" + cb.dataset.filter, !cb.checked);
    }
    t.classList.toggle("errors-only", $("errorsOnly").checked);
}

// ---- find in session -------------------------------------------------------------------------
async function runFind() {
    const q = $("find").value.trim();
    if (!sess) return;
    sess.query = q;
    for (const r of $("outline").querySelectorAll(".ot.hit")) r.classList.remove("hit");
    if (!q) { sess.hits = []; $("findInfo").textContent = ""; clearMarks(); return; }
    $("findInfo").textContent = "…";
    const res = await request("find", { file: sess.file, query: q });
    sess.hits = res.hits;
    sess.hitPos = -1;
    for (const i of sess.hits) {
        const row = $("outline").querySelector(`.ot[data-i="${i}"]`);
        if (row) row.classList.add("hit");
    }
    $("findInfo").textContent = sess.hits.length ? sess.hits.length + " turns" : "no match";
    if (sess.hits.length) stepFind(1);
}

async function stepFind(dir) {
    if (!sess || !sess.hits.length) return;
    sess.hitPos = (sess.hitPos + dir + sess.hits.length) % sess.hits.length;
    const i = sess.hits[sess.hitPos];
    $("findInfo").textContent = (sess.hitPos + 1) + " / " + sess.hits.length;
    await jumpTo(i);
    const node = $("transcript").querySelector(`.turn[data-i="${i}"]`);
    if (node) {
        // Open folded parts that contain the text so the match is visible.
        const q = sess.query.toLowerCase();
        for (const d of node.querySelectorAll("details")) {
            if (!d.open && (d.textContent.toLowerCase().includes(q) || JSON.stringify(d.dataset).includes(q))) d.open = true;
        }
        highlightFind(node);
        const first = node.querySelector("mark");
        if (first) { first.classList.add("current"); first.scrollIntoView({ block: "center" }); }
    }
}

function clearMarks(root) {
    for (const m of (root || $("transcript")).querySelectorAll("mark")) m.replaceWith(document.createTextNode(m.textContent));
}

function highlightFind(root) {
    if (!sess || !sess.query) return;
    root = root || $("transcript");
    const q = sess.query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.parentElement && n.parentElement.closest("mark, summary.none")) continue;
        if (n.nodeValue.toLowerCase().includes(q)) nodes.push(n);
    }
    for (const n of nodes) {
        const text = n.nodeValue;
        const lower = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let at = 0, k;
        while ((k = lower.indexOf(q, at)) >= 0) {
            frag.append(text.slice(at, k));
            frag.append(el("mark", "", text.slice(k, k + q.length)));
            at = k + q.length;
        }
        frag.append(text.slice(at));
        n.replaceWith(frag);
    }
}

// ---- live tail -------------------------------------------------------------------------------
eventHandlers.add((m) => {
    if (m.ev !== "append" || !sess || m.file !== sess.file) return;
    const wasAtEnd = sess.hi >= sess.turns.length;
    sess.header = m.header;
    sess.turns = sess.turns.slice(0, m.from).concat(m.turns);
    numberTurns();
    sess.live = true;
    renderHeader();
    renderOutline();
    if (wasAtEnd) {
        // Re-render the last (possibly grown) turn and append new ones.
        const t = $("transcript");
        const atBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 40;
        for (const node of t.querySelectorAll(`.turn`)) if (Number(node.dataset.i) >= m.from) node.remove();
        for (const old of t.querySelectorAll('.loadmore[data-dir="down"]')) old.remove();
        sess.hi = Math.min(sess.hi, m.from);
        loadMore("down").then(() => { if (atBottom) t.scrollTop = t.scrollHeight; });
    }
});

// ---- wiring ----------------------------------------------------------------------------------
function wire() {
    $("openFiles").onclick = async () => {
        const res = await P.openFileDialog({ title: "Open session logs", multiSelections: true, filters: [{ name: "Session logs", extensions: ["jsonl"] }, { name: "All files", extensions: ["*"] }] });
        const paths = Array.isArray(res) ? res : res ? (res.filePaths || [res]) : [];
        if (!paths.length) return;
        openSource({ paths, kind: paths.length === 1 ? "file" : "files" });
    };
    $("openFolder").onclick = async () => {
        const res = await P.openFolderDialog({ title: "Open a folder of session logs" });
        const p = Array.isArray(res) ? res[0] : res && res.filePaths ? res.filePaths[0] : res;
        if (p) openSource({ paths: [p], kind: "folder" });
    };
    $("presetClaude").onclick = () => presets.claude && openSource({ paths: [presets.claude.path], kind: "folder", label: "Claude Code sessions — " + presets.claude.path });
    $("presetCodex").onclick = () => presets.codex && openSource({ paths: [presets.codex.path], kind: "folder", label: "Codex sessions — " + presets.codex.path });
    $("recent").onchange = () => {
        const r = recent[Number($("recent").value)];
        $("recent").value = "";
        if (r) openSource(r);
    };
    $("reload").onclick = () => {
        if (sess && (!list || !$("sessionView").hidden)) openSession(sess.file, { parentStack: sess.stack });
        else if (source) openSource(source, { noRecent: true });
    };
    $("back").onclick = goBack;
    for (const id of ["filter", "agentFilter", "groupBy", "showSub"]) $(id).addEventListener(id === "filter" ? "input" : "change", () => renderList());
    $("contentSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") runContentSearch(); });
    $("contentSearch").addEventListener("search", () => { if (!$("contentSearch").value) { searchHits = null; renderList(); } });
    for (const cb of document.querySelectorAll("#sessTools input[type=checkbox]")) cb.addEventListener("change", applyFilters);
    $("expandAll").onclick = () => { for (const d of $("transcript").querySelectorAll("details.tool, details.thinking")) d.open = true; };
    $("collapseAll").onclick = () => { for (const d of $("transcript").querySelectorAll("details")) d.open = false; };
    $("find").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.shiftKey ? stepFind(-1) : (sess && sess.query === $("find").value.trim() && sess.hits.length ? stepFind(1) : runFind()); } });
    $("find").addEventListener("search", () => { if (!$("find").value) runFind(); });
    $("findNext").onclick = () => stepFind(1);
    $("findPrev").onclick = () => stepFind(-1);

    let resizeTimer = 0;
    new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (list && !$("listView").hidden) renderChart(visibleRows()); }, 150);
    }).observe($("chart"));

    const t = $("transcript");
    t.addEventListener("scroll", () => {
        if (!sess) return;
        if (t.scrollTop + t.clientHeight >= t.scrollHeight - 600) loadMore("down");
        else if (t.scrollTop < 200 && sess.lo > 0) loadMore("up");
        markOutline(currentTurn());
    });

    document.addEventListener("keydown", (e) => {
        if (e.target.closest("input, select, textarea") || e.ctrlKey || e.altKey || e.metaKey) return;
        if (!sess || $("sessionView").hidden) {
            return;
        }
        const cur = currentTurn();
        if (e.key === "j") jumpTo(Math.min(sess.turns.length - 1, cur + 1));
        else if (e.key === "k") jumpTo(Math.max(0, cur - 1));
        else if (e.key === "n") stepFind(1);
        else if (e.key === "p") stepFind(-1);
        else if (e.key === "e" || e.key === "E") {
            const order = e.key === "e" ? sess.turns.filter((x) => x.i > cur) : sess.turns.filter((x) => x.i < cur).reverse();
            const next = order.find((x) => x.errors);
            if (next) jumpTo(next.i);
        } else if (e.key === "Backspace" && !$("back").hidden) goBack();
        else return;
        e.preventDefault();
    });
}

// ---- boot ------------------------------------------------------------------------------------
async function boot() {
    wire();
    try {
        P.statusBar.set([{ id: "status", type: "text", text: "Starting…", tone: "muted" }]);
    } catch { /* older host */ }
    try {
        showCost = !!(await P.settings.get("showCost"));
        P.settings.onChange(({ id, value }) => {
            if (id !== "showCost") return;
            showCost = !!value;
            if (sess && !$("sessionView").hidden) renderHeader();
            renderList();
        });
    } catch { /* settings unavailable */ }
    showState("Starting the log reader…");
    try {
        await startServer();
        const hello = await request("hello", {});
        presets = hello.presets;
        recent = hello.recent || [];
        renderRecent();
        $("presetClaude").disabled = !presets.claude.exists;
        $("presetClaude").title = presets.claude.path;
        $("presetCodex").disabled = !presets.codex.exists;
        $("presetCodex").title = presets.codex.path;
    } catch (e) {
        showError("Could not start the log reader: " + e.message);
        return;
    }
    const file = await P.getFilePath();
    if (file) openSource({ paths: [file], kind: "file" }, { noRecent: true });
    else emptyState();
}

boot();
