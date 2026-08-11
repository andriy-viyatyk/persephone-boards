// Excel Viewer — frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH (not content), we read the
// bytes ourselves, parse them with SheetJS, and render each worksheet in an av-grid grid.
// Read-only — there is no write path. See CLAUDE.md for the board-specific notes and
// read_guide("boards") for the generic persephone.* bridge reference.

const P = window.persephone;

// av-grid's UMD build puts the whole module namespace on `window.AVGrid`; the class is
// `AVGrid.AVGrid` (the helpers — `inferColumns`, `detectColumnWidths`, … — hang off the same
// object). Keep the two names apart so it stays obvious which is which.
const AVGridClass = window.AVGrid.AVGrid;

// DOM handles.
const nameEl = document.getElementById("name");
const tabsEl = document.getElementById("tabs");
const stateEl = document.getElementById("state");
const reloadBtn = document.getElementById("reload");
const searchEl = document.getElementById("search");

// Loaded-workbook state.
let workbook = null; // the SheetJS workbook
let activeSheet = null; // name of the sheet currently shown
let grid = null; // the live av-grid instance (destroyed + rebuilt per sheet)
let currentPath = ""; // the file path (for the name label / reload)

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

    // No widths are set on the data columns: av-grid detects each one from the header label and
    // the first 50 rows, measured as the cell will DISPLAY them — so our `formatValue` (Excel's
    // formatted text) is what gets measured, not the raw value behind it. Bounded to 60–300px.
    return { columns, rows };
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
        // `highlightSearch` is left at its default (colour only): it marks the searched words
        // inside the cells with no setup. "both" — which the av-grid docs suggest for dark
        // themes — was tried and reads WORSE here, because Persephone's accent is saturated
        // enough that the tint becomes a solid block behind text of nearly the same colour.
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

// NOTE: the grid needs no help from this board for focus or for the clipboard. A press inside it
// takes DOM focus itself, and Ctrl+C / Ctrl+Shift+C copy through the browser's own copy event.
// If either ever looks broken while you are driving the board from an agent, the harness is the
// suspect, not the grid — see the "Run & test" note in CLAUDE.md.

load();
