// Excel Viewer — frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH (not content), we read the
// bytes ourselves, parse them with SheetJS, and render each worksheet in an av-grid grid.
// Read-only — there is no write path. See CLAUDE.md for the board-specific notes and
// read_guide("boards") for the generic persephone.* bridge reference.

const P = window.persephone;

// av-grid's UMD build puts the whole module namespace on `window.AVGrid`; the class is
// `AVGrid.AVGrid`. Keep both names apart so it stays obvious which is which.
const AVG = window.AVGrid;
const AVGridClass = AVG.AVGrid;

// DOM handles.
const nameEl = document.getElementById("name");
const tabsEl = document.getElementById("tabs");
const stateEl = document.getElementById("state");
const reloadBtn = document.getElementById("reload");
const searchEl = document.getElementById("search");
const gridHost = document.getElementById("grid");

// Loaded-workbook state.
let workbook = null; // the SheetJS workbook
let activeSheet = null; // name of the sheet currently shown
let grid = null; // the live av-grid instance (destroyed + rebuilt per sheet)
let currentPath = ""; // the file path (for the name label / reload)

// Column-width detection bounds, and how many rows are measured to pick a width.
const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 420;
const WIDTH_SAMPLE_ROWS = 200;

// ---- state overlay -------------------------------------------------------------------------

function showState(message, isError) {
    stateEl.textContent = message;
    stateEl.classList.toggle("error", !!isError);
    stateEl.classList.add("show");
}

function hideState() {
    stateEl.classList.remove("show", "error");
}

// ---- grid construction ---------------------------------------------------------------------

// The Excel-style row-number gutter, as an av-grid *status column*: a non-data column pinned to
// the left. It carries the sheet's real 1-based row number, never sorts or filters, and keeps its
// number when the data columns are sorted.
const ROW_COLUMN = {
    key: "__row",
    name: "",
    width: 64,
    align: "right",
    isStatusColumn: true,
    resizable: false,
    readonly: true,
    filterType: null,
    cellClass: "xl-rownum",
    headerClass: "xl-rownum",
};

// Turn one worksheet into { columns, rows } for av-grid. Renders Excel-style: column-letter
// headers (A, B, C…) + a row-number gutter, one grid column per spreadsheet column across the
// sheet's used range (ws['!ref']). Row 1 is NOT treated as a header — arbitrary sheets may have
// no header row.
//
// Each cell contributes TWO row properties: the RAW value under the column's own key ("c3") and
// Excel's FORMATTED text under a parallel key ("d3"). The column's `formatValue` returns the
// formatted text, so the grid *shows*, searches, filters and copies exactly what Excel shows,
// while `sort` — which reads `row[key]` and dispatches on the runtime type — sorts numbers
// numerically and dates by instant. (The old Tabulator build only had the display string, so it
// needed a natural-order sorter and still sorted dates lexically.)
function buildGrid(ws) {
    const columns = [];
    const rows = [];

    const ref = ws && ws["!ref"];
    if (!ref) {
        return { columns, rows }; // empty sheet — no columns, no rows
    }

    const range = XLSX.utils.decode_range(ref);

    columns.push(Object.assign({}, ROW_COLUMN)); // a fresh copy per sheet — the grid owns it

    // Track, per column, whether every value present is a number — those get right-aligned, the
    // way a spreadsheet does.
    const numericOnly = [];

    for (let c = range.s.c; c <= range.e.c; c++) {
        const displayKey = "d" + c; // captured per column, so formatValue is a single lookup
        numericOnly.push(true);
        columns.push({
            key: "c" + c,
            name: XLSX.utils.encode_col(c), // A, B, C, …
            formatValue: (_column, row) => {
                const text = row[displayKey];
                return text == null ? "" : text;
            },
        });
    }

    for (let r = range.s.r; r <= range.e.r; r++) {
        const row = { __row: r + 1 }; // 1-based Excel row number
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell == null || cell.v == null) continue; // leave the cell empty
            row["c" + c] = cell.v;
            row["d" + c] = cell.w != null ? cell.w : String(cell.v);
            if (typeof cell.v !== "number") numericOnly[c - range.s.c] = false;
        }
        rows.push(row);
    }

    for (let i = 0; i < numericOnly.length; i++) {
        if (numericOnly[i]) columns[i + 1].align = "right"; // +1 — column 0 is the row gutter
    }

    detectWidths(columns, rows);

    return { columns, rows };
}

// Give every data column a width sized to its content, the way a spreadsheet does.
//
// av-grid only detects widths from the data when it INFERS the columns; a host that supplies its
// own `columns` (as this board must, to get letter headers and a row gutter) gets a flat
// `defaultGridColumnWidth` of 140px for all of them. So we run the grid's own `inferColumns()`
// over a probe — the first rows projected to the DISPLAYED text under the same keys, which is
// what the user actually sees — and copy the widths it detects onto our columns, bounded so that
// neither a one-letter column nor one runaway note cell decides the layout.
function detectWidths(columns, rows) {
    if (rows.length === 0) return;

    const dataColumns = columns.filter((c) => !c.isStatusColumn);
    const probe = rows.slice(0, WIDTH_SAMPLE_ROWS).map((row) => {
        const sample = {};
        for (const column of dataColumns) sample[column.key] = row["d" + column.key.slice(1)] || "";
        return sample;
    });

    const detected = new Map(AVG.inferColumns(probe).map((c) => [c.key, c.width]));

    for (const column of dataColumns) {
        const width = detected.get(column.key);
        if (typeof width !== "number") continue;
        column.width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
    }
}

// ---- sheet tab bar -------------------------------------------------------------------------

function renderTabs() {
    tabsEl.textContent = "";
    const names = (workbook && workbook.SheetNames) || [];
    // Only show the tab bar when there's more than one sheet (a single sheet needs no chrome).
    tabsEl.classList.toggle("show", names.length > 1);
    if (names.length <= 1) return;

    for (const name of names) {
        const tab = document.createElement("button");
        tab.className = "tab" + (name === activeSheet ? " active" : "");
        tab.textContent = name;
        tab.title = name;
        tab.addEventListener("click", () => {
            if (name !== activeSheet) renderSheet(name);
        });
        tabsEl.appendChild(tab);
    }
}

// ---- render one sheet ----------------------------------------------------------------------

function destroyGrid() {
    if (grid) {
        grid.destroy();
        grid = null;
    }
}

function renderSheet(name) {
    activeSheet = name;
    renderTabs();

    const ws = workbook.Sheets[name];
    const { columns, rows } = buildGrid(ws);

    // Rebuild the grid from scratch on each sheet switch — a clean lifecycle beats juggling
    // setColumns/setRows ordering (and drops the previous sheet's sort, filters and selection,
    // which belonged to that sheet). Switches are infrequent.
    destroyGrid();

    // A new sheet is a new dataset: drop whatever was being searched for.
    searchEl.value = "";
    searchEl.disabled = rows.length === 0;

    if (rows.length === 0) {
        showState("This sheet is empty.");
        return;
    }
    hideState();

    grid = AVGridClass.create("#grid", {
        name: "excel-sheet",
        rows,
        columns,
        // The Excel row number is unique per row and survives sorting and filtering.
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

// ---- load the file -------------------------------------------------------------------------

async function load() {
    try {
        showState("Loading…");
        reloadBtn.disabled = true;
        searchEl.disabled = true;

        const path = await P.getFilePath();
        currentPath = path || "";

        if (!currentPath) {
            // Opened plainly (not as an editor for a file) — clean empty state, no crash.
            workbook = null;
            activeSheet = null;
            destroyGrid();
            nameEl.textContent = "Excel Viewer";
            renderTabs();
            showState("No file open.\nOpen a .xlsx or .xls file to view it here.");
            return;
        }

        nameEl.textContent = fileName(currentPath);
        reloadBtn.disabled = false;

        const b64 = await P.readFile(currentPath, { encoding: "base64" });
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

        // cellDates so dates arrive as real Date values (which sort by instant) with formatted
        // .w text alongside.
        workbook = XLSX.read(bytes, { type: "array", cellDates: true });

        const names = workbook.SheetNames || [];
        if (names.length === 0) {
            showState("This workbook has no sheets.");
            renderTabs();
            return;
        }

        renderSheet(names[0]);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        destroyGrid();
        showState("Could not open this file.\n" + message, true);
        P.notify(message, "error");
    }
}

function fileName(p) {
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
}

// ---- wire up -------------------------------------------------------------------------------

// Reload re-reads the file from disk (the file may have changed outside the app). This is a
// simple board with no content host, so there's no onContentChange — the toolbar Reload (and
// the board_refresh MCP tool, which re-runs this script) are the only re-render triggers.
reloadBtn.addEventListener("click", load);

// Free-text search across every column's displayed value. Every whitespace-separated word has to
// appear in some column, so "ada 98" narrows to rows holding both.
searchEl.addEventListener("input", () => {
    if (grid) grid.setSearchString(searchEl.value);
});

// Clicking a cell does not give the grid DOM focus by itself (document.activeElement stays on
// <body>), so the arrow keys would do nothing until something else focused it. Focus the grid's
// root on the way down — CAPTURE phase, before the grid handles the same gesture, and
// `grid.element.focus()` rather than `grid.focus()`: the latter also re-homes the *cell* focus to
// A1, which would undo the very click that triggered it.
gridHost.addEventListener(
    "mousedown",
    () => {
        if (grid) grid.element.focus({ preventScroll: true });
    },
    true,
);

// Ctrl/Cmd+C (and Ctrl+Shift+C, which prepends the column letters) copy the selected range.
//
// The board owns this because av-grid's own Ctrl+C rides the browser's native `copy` event —
// and that event NEVER FIRES inside a Persephone board iframe, so the built-in binding silently
// copies nothing here (verified: the keydown reaches the grid, no `copy` event follows). The
// right-click Copy items are unaffected: those go through `copySelection()`, which writes with
// navigator.clipboard — the same call we make below. preventDefault keeps the two paths from
// both running in an environment where the native event does work.
document.addEventListener("keydown", (e) => {
    if (!grid) return;
    if (!(e.ctrlKey || e.metaKey) || (e.key !== "c" && e.key !== "C")) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return; // let text copy work
    e.preventDefault();
    grid.copySelection(e.shiftKey ? "copyWithHeaders" : "copy");
});

load();
