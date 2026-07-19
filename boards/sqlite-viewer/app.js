// SQLite Viewer — main-view frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH; we spawn ONE resident
// query server (scripts/db-server.mjs) on Persephone's bundled Node runtime via
// persephone.executeNode(), stream it requests as JSON lines over stdin, and render each
// reply in a Tabulator grid. Strictly read-only (the server opens the db readOnly).
//
// The table list lives in a SECONDARY VIEW ("Tables", tables.html) shown in Persephone's
// own sidebar; the two frames coordinate through persephone.state.*:
//   main  → merge({ db: { name, tables }, selected })   // schema for the panel to render
//   panel → merge({ run: { name, seq } })                // "run SELECT * for this table"
//
// See CLAUDE.md for board-specific notes; read_guide("boards") for the generic bridge API.

const P = window.persephone;

// DOM handles.
const nameEl = document.getElementById("name");
const sqlEl = document.getElementById("sql");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const stateEl = document.getElementById("state");
const openBtn = document.getElementById("open");
const reloadBtn = document.getElementById("reload");

// Session state.
let currentPath = ""; // absolute path of the opened database
let srv = null; // the resident db-server execute handle (streaming mode)
let nextId = 0; // request id counter
const pending = new Map(); // id → { resolve, reject }
let table = null; // live Tabulator instance
let queryRunning = false;
let lastRunSeq = 0; // last handled sidebar "run" command (guards replays)

// ---- state overlay / status ------------------------------------------------------------------

function showState(message, isError) {
    stateEl.textContent = message;
    stateEl.classList.toggle("error", !!isError);
    stateEl.classList.add("show");
}

function hideState() {
    stateEl.classList.remove("show", "error");
}

function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
}

function fileName(p) {
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
}

// ---- resident query server -------------------------------------------------------------------

function rejectAllPending(message) {
    for (const [, p] of pending) p.reject(new Error(message));
    pending.clear();
}

/** Kill the current server (if any). Pending requests reject. */
function stopServer(reason) {
    if (srv) {
        const h = srv;
        srv = null; // null FIRST so the exit handler knows this is expected
        try { h.kill(); } catch { /* already gone */ }
    }
    rejectAllPending(reason || "query server stopped");
}

/**
 * Spawn scripts/db-server.mjs for `path` on Persephone's bundled Node runtime.
 * Resolves with the server's ready message ({ ready: true, tables }); rejects if the
 * database fails to open. Replies are matched to requests by id via `pending`.
 */
function startServer(path) {
    stopServer("restarting query server");
    return new Promise((resolve, reject) => {
        const h = P.executeNode("scripts/db-server.mjs", [path], { name: "db" });
        srv = h;
        const decoder = new TextDecoder();
        let lineBuf = "";
        let settled = false;

        h.on("stdout", (chunk) => {
            lineBuf += decoder.decode(chunk, { stream: true });
            let nl;
            while ((nl = lineBuf.indexOf("\n")) >= 0) {
                const line = lineBuf.slice(0, nl).trim();
                lineBuf = lineBuf.slice(nl + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                if (!settled && "ready" in msg) {
                    settled = true;
                    if (msg.ready) resolve(msg);
                    else reject(new Error(msg.error || "failed to open the database"));
                    continue;
                }
                const p = pending.get(msg.id);
                if (p) {
                    pending.delete(msg.id);
                    if (msg.error) p.reject(new Error(msg.error));
                    else p.resolve(msg);
                }
            }
        });
        h.on("stderr", (chunk) => {
            console.warn("[db-server] " + new TextDecoder().decode(chunk));
        });
        h.on("exit", () => {
            if (srv !== h) return; // expected (we killed it)
            srv = null;
            if (!settled) { settled = true; reject(new Error("query server exited unexpectedly")); }
            rejectAllPending("query server exited unexpectedly");
        });
        h.on("error", (err) => {
            if (srv !== h) return;
            srv = null;
            const message = (err && err.message) || "failed to start the query server";
            if (!settled) { settled = true; reject(new Error(message)); }
            rejectAllPending(message);
        });
    });
}

/** Send one request to the server; resolves with its reply. */
function request(op, extra) {
    if (!srv) return Promise.reject(new Error("no database open"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        srv.write(JSON.stringify({ id, op, ...extra }) + "\n");
    });
}

// ---- grid ------------------------------------------------------------------------------------

// Natural-order sorter: numeric-aware string compare so numbers sort by value.
const naturalSorter = (a, b) =>
    String(a == null ? "" : a).localeCompare(String(b == null ? "" : b), undefined, {
        numeric: true,
        sensitivity: "base",
    });

// Safe cell formatter: NULL rendered as a muted marker (distinguishable from ""), other
// values as a text node — never innerHTML, so db content can't inject markup.
function cellFormatter(cell) {
    const v = cell.getValue();
    if (v === null || v === undefined) {
        cell.getElement().classList.add("sv-null");
        return "NULL";
    }
    return document.createTextNode(String(v));
}

// Serialize a Tabulator range to TSV, excluding the row-number gutter (`__row`).
function rangeToTsv(range) {
    const cols = range.getColumns().filter((c) => c.getField() !== "__row");
    return range
        .getRows()
        .map((row) =>
            cols
                .map((col) => {
                    const v = row.getCell(col).getValue();
                    return v == null ? "" : String(v);
                })
                .join("\t"),
        )
        .join("\n");
}

// Own copy path — Tabulator's clipboard module is dead in the board iframe (its
// execCommand("copy") event never fires here), so we build TSV + navigator.clipboard.
async function copySelection(fallbackCell) {
    if (!table) return;
    let ranges = table.getRanges();
    if (ranges.length === 0) {
        if (!fallbackCell) return;
        table.addRange(fallbackCell, fallbackCell);
        ranges = table.getRanges();
    }
    const tsv = ranges.map(rangeToTsv).join("\n");
    try {
        await navigator.clipboard.writeText(tsv);
    } catch (err) {
        P.notify("Copy failed: " + ((err && err.message) || err), "error");
    }
}

const CELL_MENU = [{ label: "Copy", action: (e, cell) => copySelection(cell) }];

const ROW_HEADER = {
    title: "",
    field: "__row",
    headerSort: false,
    resizable: false,
    width: 56,
    hozAlign: "right",
    cssClass: "sv-rownum",
    clipboard: false,
};

/** Render one query result ({ columns, rows }) into the grid. */
function renderResult(res) {
    if (table) {
        table.destroy();
        table = null;
    }
    hideState();

    const columns = res.columns.map((name, i) => ({
        title: name,
        field: "c" + i,
        headerSort: true,
        sorter: naturalSorter,
        headerFilter: "input",
        headerFilterPlaceholder: "filter…",
        resizable: true,
        maxWidth: 420,
        formatter: cellFormatter,
    }));

    const data = res.rows.map((arr, r) => {
        const row = { __row: r + 1 };
        for (let i = 0; i < arr.length; i++) row["c" + i] = arr[i];
        return row;
    });

    if (columns.length === 0) {
        showState("The statement returned no columns.");
        return;
    }

    table = new Tabulator("#grid", {
        data,
        columns,
        rowHeader: ROW_HEADER,
        columnDefaults: { contextMenu: CELL_MENU },
        height: "100%",
        layout: "fitData",
        movableColumns: true,
        selectableRange: true,
        selectableRangeColumns: false,
        selectableRangeRows: false,
        selectableRangeClearCells: false,
    });
}

// ---- query execution -------------------------------------------------------------------------

async function runQuery(sql) {
    const text = String(sql || "").trim();
    if (!text || queryRunning || !srv) return;
    queryRunning = true;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Running…");
    try {
        const res = await request("query", { sql: text });
        renderResult(res);
        const cap = res.truncated ? ` (showing first ${res.rowCount.toLocaleString()} — result truncated)` : "";
        setStatus(`${res.rowCount.toLocaleString()} row${res.rowCount === 1 ? "" : "s"} in ${res.ms} ms${cap}`);
    } catch (err) {
        // Query failed — show the SQLite error, keep the previous grid contents. Our own
        // cancellation reasons are not errors (cancelQuery owns the status then).
        const message = (err && err.message) || String(err);
        if (message !== "restarting query server" && message !== "query server stopped") {
            setStatus("Error: " + message, true);
        }
    } finally {
        queryRunning = false;
        runBtn.disabled = !srv;
        stopBtn.disabled = true;
    }
}

/** Stop a running query by restarting the server (SQLite has no cross-process cancel). */
async function cancelQuery() {
    if (!queryRunning || !currentPath) return;
    setStatus("Cancelling…");
    try {
        const ready = await startServer(currentPath);
        publishSchema(ready.tables);
        setStatus("Query cancelled.");
    } catch (err) {
        setStatus("Error: " + ((err && err.message) || err), true);
    }
}

function defaultQuery(tableName) {
    return `SELECT * FROM "${String(tableName).replace(/"/g, '""')}" LIMIT 1000`;
}

// ---- shared state (Tables sidebar panel) -----------------------------------------------------

/** Push the schema (and current db name) for the sidebar panel to render. */
function publishSchema(tables) {
    P.state.merge({ db: { name: fileName(currentPath), tables: tables || [] } });
}

function selectTable(tableName) {
    sqlEl.value = defaultQuery(tableName);
    P.state.merge({ selected: tableName });
    runQuery(sqlEl.value);
}

// ---- open a database -------------------------------------------------------------------------

async function loadDb(path, opts) {
    const autoQuery = !opts || opts.autoQuery !== false;
    try {
        showState("Opening database…");
        setStatus("");
        currentPath = path;
        nameEl.textContent = fileName(path);
        reloadBtn.disabled = false;
        runBtn.disabled = true;

        const ready = await startServer(path);
        publishSchema(ready.tables);
        runBtn.disabled = false;
        hideState();

        const tables = ready.tables || [];
        if (tables.length === 0) {
            showState("This database has no tables.");
            return;
        }
        if (autoQuery) {
            // Auto-show the first table so the board never opens onto a blank grid.
            const first = tables.find((t) => t.type === "table") || tables[0];
            selectTable(first.name);
        }
    } catch (err) {
        const message = (err && err.message) || String(err);
        if (table) { table.destroy(); table = null; }
        showState("Could not open this database.\n" + message, true);
        P.notify(message, "error");
    }
}

async function openDialog() {
    const paths = await P.openFileDialog({
        title: "Open SQLite database",
        filters: [
            { name: "SQLite databases", extensions: ["db", "sqlite", "sqlite3", "db3"] },
            { name: "All files", extensions: ["*"] },
        ],
    });
    if (paths && paths[0]) loadDb(paths[0]);
}

// ---- boot ------------------------------------------------------------------------------------

async function boot() {
    // Shared-state contract with the Tables panel. Nothing needs to survive a reload —
    // the schema is re-published on every open.
    P.state.init({ db: null, selected: null, run: null });

    // Ignore any stale sidebar command left in state from a previous board lifetime.
    const s0 = await P.state.get();
    lastRunSeq = (s0.run && s0.run.seq) || 0;

    P.state.onChange((s) => {
        const run = s.run;
        if (run && run.seq && run.seq !== lastRunSeq) {
            lastRunSeq = run.seq;
            if (srv && !queryRunning) selectTable(run.name);
        }
    });

    const path = await P.getFilePath();
    if (path) {
        loadDb(path);
    } else {
        nameEl.textContent = "SQLite Viewer";
        showState("No database open.\nOpen a .db / .sqlite file, or use the folder button above.");
    }
}

// ---- wire up ---------------------------------------------------------------------------------

runBtn.addEventListener("click", () => runQuery(sqlEl.value));
stopBtn.addEventListener("click", cancelQuery);
openBtn.addEventListener("click", openDialog);
reloadBtn.addEventListener("click", () => {
    // Re-open from disk (file may have changed); keep the user's SQL text.
    if (currentPath) loadDb(currentPath, { autoQuery: false });
});

// Ctrl/Cmd+Enter runs the query from anywhere (textarea included).
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runQuery(sqlEl.value);
    }
});

// Ctrl/Cmd+C copies the selected grid range as TSV (Tabulator's own copy is broken in the
// board iframe). Skip when an input/textarea is focused so normal text copy still works.
document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== "c" && e.key !== "C")) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    if (!table || table.getRanges().length === 0) return;
    e.preventDefault();
    copySelection();
});

boot();
