// SQLite Viewer — main-view frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH; we spawn ONE resident
// query server (scripts/db-server.mjs) on Persephone's bundled Node runtime via
// persephone.executeNode(), stream it requests as JSON lines over stdin, and render each
// reply in an av-grid grid. Strictly read-only (the server opens the db readOnly).
//
// The table list lives in a SECONDARY VIEW ("Tables", tables.html) shown in Persephone's
// own sidebar; the two frames coordinate through persephone.state.*:
//   main  → merge({ db: { name, tables }, selected })   // schema for the panel to render
//   panel → merge({ run: { name, seq } })                // "run SELECT * for this table"
//
// See CLAUDE.md for board-specific notes; read_guide("boards") for the generic bridge API.

const P = window.persephone;

// av-grid's UMD build puts the whole module namespace on `window.AVGrid`; the class is
// `AVGrid.AVGrid` (the helpers — `inferColumns`, `detectColumnWidths`, … — hang off the same
// object). Keep the two names apart so it stays obvious which is which.
const AVGridClass = window.AVGrid.AVGrid;

// DOM handles.
const nameEl = document.getElementById("name");
const sqlEl = document.getElementById("sql");
const searchEl = document.getElementById("search");
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
let grid = null; // the live av-grid instance (destroyed + rebuilt per result)
let queryRunning = false;
let lastRunSeq = 0; // last handled sidebar "run" command (guards replays)
let schemaTables = []; // the server's schema reply — tables + views with counts and columns
let lastResult = null; // the reply behind the grid on screen: { sql, columns, rows, … }

// The AiVision agent surface. Everything it needs is handed over as accessors rather than values:
// the grid is DESTROYED and rebuilt on every result, and `srv` / `lastResult` / `schemaTables`
// change under it, so a captured reference would go stale on the first query.
const aiVisionModel = window.SQLiteAI && window.SQLiteAI.createAiVisionModel({
    getGrid: () => grid,
    getResult: () => lastResult,
    getSchemaTables: () => schemaTables,
    getFilePath: () => currentPath || undefined,
    getFileName: () => (currentPath ? fileName(currentPath) : undefined),
    isOpen: () => !!srv,
    isQueryRunning: () => queryRunning,
    // Ask the database WITHOUT touching the grid — the agent's read path. The db is open
    // readOnly, so this cannot change the file whatever SQL it is given.
    ask: (sql) => request("query", { sql: String(sql) }),
    // Run a query the way the user does: into the box, then onto the screen.
    run: (sql) => {
        sqlEl.value = String(sql);
        return runQuery(sqlEl.value);
    },
    getSql: () => sqlEl.value,
    // The status line, which is where runQuery puts a SQLite error — the agent cannot see it.
    getStatus: () => statusEl.textContent || "",
    setSql: (text) => { sqlEl.value = text == null ? "" : String(text); },
    openTable: (name) => selectTable(name),
    stop: () => cancelQuery(),
    // The toolbar search box, driven the same way the user drives it — the input's value is part
    // of what the user sees, so setting the grid's search string alone would desync the box.
    getSearchText: () => searchEl.value,
    setSearchText: (text) => {
        searchEl.value = text;
        if (grid) grid.setSearchString(text);
    },
    reload: () => loadDb(currentPath, { autoQuery: false }),
});

/** Tear the grid down. The result grid has a per-result lifecycle — see renderResult. */
function destroyGrid() {
    if (grid) {
        grid.destroy();
        grid = null;
    }
}

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

// The result row-number gutter, as an av-grid *status column*: a non-data column pinned to the
// left. It carries the 1-based position of the row IN THE RESULT SET, never sorts or filters, and
// keeps its number when the data columns are sorted — so it stays a stable handle on a row.
const ROW_COLUMN = {
    key: "__row",
    name: "",
    width: 64,
    align: "right",
    isStatusColumn: true,
    resizable: false,
    readonly: true,
    filterType: null,
    cellClass: "sv-rownum",
    headerClass: "sv-rownum",
};

/**
 * Turn one query reply ({ columns, rows }) into av-grid `{ columns, rows }`.
 *
 * Rows arrive from the server as ARRAYS, not objects — that is what preserves column order and
 * survives `SELECT a.x, b.x` returning two columns called `x`. So each column gets a synthetic
 * key ("c0", "c1", …) and the column's NAME is only a label; two columns may share one.
 *
 * The raw value goes in under the key, untouched. av-grid's hook-precedence table then splits the
 * three consumers that would otherwise disagree:
 *   • the screen / search / filters read `formatValue` — where NULL becomes the literal "NULL",
 *     the marker the user sees;
 *   • sorting reads `row[key]` — the raw value, compared by its runtime type, so a numeric column
 *     orders numerically and nulls land together at the ascending end;
 *   • copy reads `copyValue` — where NULL becomes "", so a pasted range has an empty cell rather
 *     than the word NULL.
 * That is also why there is no custom sorter here any more: the Tabulator build only ever had the
 * display string, so it needed `localeCompare(..., { numeric: true })` to fake numeric order.
 */
function buildGrid(res) {
    const names = res.columns || [];
    const columns = [Object.assign({}, ROW_COLUMN)]; // a fresh copy per result — the grid owns it

    const rows = (res.rows || []).map((arr, r) => {
        const row = { __row: r + 1 };
        for (let i = 0; i < arr.length; i++) row["c" + i] = arr[i];
        return row;
    });

    // Right-align a column only when every value it actually holds is a number — all-NULL and
    // empty columns stay left-aligned rather than being guessed at.
    const sawNumber = names.map(() => false);
    const sawOther = names.map(() => false);
    for (const row of rows) {
        for (let i = 0; i < names.length; i++) {
            const v = row["c" + i];
            if (v == null) continue;
            if (typeof v === "number") sawNumber[i] = true;
            else sawOther[i] = true;
        }
    }

    for (let i = 0; i < names.length; i++) {
        const key = "c" + i; // captured per column, so each hook is a single lookup
        columns.push({
            key,
            name: names[i],
            align: sawNumber[i] && !sawOther[i] ? "right" : undefined,
            formatValue: (_column, row) => {
                const v = row[key];
                return v == null ? "NULL" : String(v);
            },
            // What a copied cell holds. A NULL copies as empty — pasting the word "NULL" into a
            // spreadsheet would turn a missing value into a literal string.
            copyValue: (cell) => (cell.value == null ? "" : cell.value),
            // Muted italic NULL, so it stays distinguishable from the empty string on screen.
            cellClass: (cell) => (cell.value == null ? "sv-null" : undefined),
        });
    }

    return { columns, rows };
}

/** Render one query result ({ columns, rows }) into the grid. */
function renderResult(res) {
    destroyGrid();
    hideState();

    // A new result is a new dataset: drop whatever was being searched for.
    searchEl.value = "";

    if (!res.columns || res.columns.length === 0) {
        searchEl.disabled = true;
        showState("The statement returned no columns.");
        return;
    }

    const built = buildGrid(res);
    searchEl.disabled = built.rows.length === 0;

    grid = AVGridClass.create("#grid", {
        name: "sqlite-result",
        rows: built.rows,
        columns: built.columns,
        // The result row number is unique per row and survives sorting and filtering.
        getRowKey: (row) => String(row.__row),
        // Read-only: no `editable`, no `can*` — the grid offers no editing affordance and its
        // context menu is Copy / Copy as… only.
        // av-grid's stylesheet is linked in index.html (see the load-order note there), so it
        // must not inject a second copy after this page's own rules.
        injectStyles: false,
        // Removable chips for whatever the header funnels have filtered. Takes no vertical space
        // until something is actually filtered.
        filterBar: true,
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
        // The reply behind what is on screen. Kept whole (the grid reshapes it into rows keyed by
        // column, and drops nothing) so the agent surface can answer from the result itself.
        lastResult = { sql: text, columns: res.columns, rows: res.rows, rowCount: res.rowCount, truncated: !!res.truncated, ms: res.ms };
        renderResult(res);
        if (aiVisionModel) aiVisionModel.resultChanged();
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

/** Push the schema (and current db name) for the sidebar panel to render. Also the one place the
 *  schema is remembered, so the agent surface answers "what is in this database" without a round
 *  trip to the server. */
function publishSchema(tables) {
    schemaTables = tables || [];
    P.state.merge({ db: { name: fileName(currentPath), tables: schemaTables } });
    if (aiVisionModel) aiVisionModel.databaseChanged();
}

// Returns the runQuery promise: the sidebar click ignores it, but the agent surface awaits it —
// without it, openTable() resolves before the query has run and reports the PREVIOUS result.
function selectTable(tableName) {
    sqlEl.value = defaultQuery(tableName);
    P.state.merge({ selected: tableName });
    return runQuery(sqlEl.value);
}

// ---- open a database -------------------------------------------------------------------------

async function loadDb(path, opts) {
    const autoQuery = !opts || opts.autoQuery !== false;
    try {
        showState("Opening database…");
        setStatus("");
        // Opening a DIFFERENT database drops whatever result was on screen — it belonged to the
        // previous file. (A reload passes autoQuery: false and deliberately keeps it, so the user
        // gets their result back after re-opening the connection.)
        if (autoQuery) {
            destroyGrid();
            lastResult = null;
            searchEl.value = "";
            searchEl.disabled = true;
        }
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
        destroyGrid();
        lastResult = null;
        publishSchema([]); // nothing is open — say so, in the panel and to the agent
        searchEl.value = "";
        searchEl.disabled = true;
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

    // Publish the agent surface before the first open, so an agent that attaches while the
    // database is still opening sees the model (reporting isLoaded: false) rather than nothing.
    if (aiVisionModel) aiVisionModel.register();

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

// Free-text search across every column's displayed value. Every whitespace-separated word has to
// appear in some column, so "error 42" narrows to rows holding both, and the words are marked
// inside the cells.
searchEl.addEventListener("input", () => {
    if (grid) grid.setSearchString(searchEl.value);
});

// NOTE: the grid needs no help from this board for focus or for the clipboard. A press inside it
// takes DOM focus itself, and Ctrl+C / Ctrl+Shift+C copy through the browser's own copy event.
// The Tabulator build DID need its own copy path — that one went through
// document.execCommand("copy"), which never fires in a board iframe — which is why deleting the
// hand-rolled TSV builder looks riskier than it is. See the "Run & test" note in CLAUDE.md before
// concluding otherwise from an MCP-driven keypress: those arrive as isTrusted: false and cannot
// drive the clipboard on any browser.

boot();
