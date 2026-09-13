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
let fileBytes = null; // the raw file, kept so a second sheet can be parsed on demand

// The AiVision agent surface. Everything it needs is handed over as accessors rather than values:
// the grid is DESTROYED and rebuilt on every sheet switch, and `workbook` / `activeSheet` change
// under it, so a captured reference would go stale the first time the user clicks a tab.
const aiVisionModel = window.XLSXAI && window.XLSXAI.createAiVisionModel({
    getGrid: () => grid,
    getWorkbook: () => workbook,
    getActiveSheet: () => activeSheet,
    getFilePath: () => currentPath || undefined,
    getFileName: () => (currentPath ? fileName(currentPath) : undefined),
    // A sheet the user has never opened is unparsed on a big workbook — the agent may read it
    // anyway, which parses it exactly as clicking the tab would.
    ensureSheetParsed: (name) => ensureSheetParsed(name),
    showSheet: (name) => renderSheet(name),
    // The toolbar search box, driven the same way the user drives it — the input's value is part
    // of what the user sees, so setting the grid's search string alone would desync the box.
    getSearchText: () => searchEl.value,
    setSearchText: (text) => {
        searchEl.value = text;
        if (grid) grid.setSearchString(text);
    },
    reload: () => load(),
});

// SheetJS options, shared by the initial load and every on-demand sheet parse.
// Measured on a 20.5 MB / 124k-row / 27-column workbook (see CLAUDE.md):
//   • `dense`         — cells land in ws["!data"][r][c] instead of ws["A1"]-style address
//                       keys. Parses ~1.6 s faster AND lets buildGrid index straight into
//                       an array (321 ms) instead of building 3.35 M address strings (1.56 s).
//   • `cellFormula`   — off. This viewer never reads `cell.f`; parsing formulae cost ~0.75 s.
//   • `cellDates`     — ON, and load-bearing: dates arrive as real Date values, which is what
//                       makes the date columns sort by instant rather than by text.
//   • `cellText`      — left ON (the default). It produces `cell.w`, Excel's formatted text,
//                       which IS the thing this board displays. Turning it off is another
//                       ~0.7 s but there would be nothing to show.
const READ_OPTIONS = { type: "array", cellDates: true, cellFormula: false, dense: true };

// Above this file size, parse one sheet at a time instead of the whole workbook (see
// ensureSheetParsed). Every parse re-pays a fixed unzip + shared-string cost that scales with the
// FILE, not with the sheet — ~1.0 s on the 20.5 MB workbook, ~10 ms on a small one. So deferring
// is a clear win on a big file (you rarely open every sheet) and a clear loss on a small one,
// where it would add a visible hitch to a switch that is otherwise free. 4 MB sits well clear of
// both: a workbook that size parses in a few hundred ms whole.
const LAZY_PARSE_MIN_BYTES = 4 * 1024 * 1024;

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
    // Dense sheets (READ_OPTIONS.dense) expose a row-major array; the address keys are absent.
    // `data` is null only if something handed us a sparse sheet, which the slow path below reads.
    const data = ws["!data"] || null;

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
        const src = data ? data[r] : null; // the dense row, or null on the sparse fallback
        if (data && !src) {
            rows.push(row); // a row with no cells at all
            continue;
        }
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = src ? src[c] : ws[XLSX.utils.encode_cell({ r, c })];
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

// Parse one sheet on demand. The initial load only parses the sheet it is about to show
// (`sheets: <index>`), because the per-sheet cost dominates: on the 20.5 MB test workbook the
// fixed cost — unzip + the shared-string table — is ~1.0 s, while the 124k-row sheet itself is
// ~4.4 s. A workbook with five big sheets would otherwise pay for all five to show one.
// The parsed sheet is kept on `workbook.Sheets`, so switching back to it costs nothing.
function ensureSheetParsed(name) {
    if (workbook.Sheets[name] || !fileBytes) return;
    const index = workbook.SheetNames.indexOf(name);
    if (index < 0) return;
    const parsed = XLSX.read(fileBytes, Object.assign({}, READ_OPTIONS, { sheets: index }));
    workbook.Sheets[name] = parsed.Sheets[name];
}

function renderSheet(name) {
    activeSheet = name;
    renderTabs();

    ensureSheetParsed(name);
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
        // Still a view change worth announcing: the active sheet is now this one, and the agent
        // surface reports there is no grid rather than describing the previous sheet's.
        if (aiVisionModel) aiVisionModel.sheetChanged();
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

    if (aiVisionModel) aiVisionModel.sheetChanged();
}

// ---- load the file -------------------------------------------------------------------------

async function load() {
    try {
        showState("Loading…");
        // Every cache in the agent surface belongs to the workbook being replaced.
        if (aiVisionModel) aiVisionModel.workbookChanged();
        reloadBtn.disabled = true;
        searchEl.disabled = true;

        const path = await P.getFilePath();
        currentPath = path || "";

        if (!currentPath) {
            // Opened plainly (not as an editor for a file) — clean empty state, no crash.
            workbook = null;
            fileBytes = null;
            activeSheet = null;
            destroyGrid();
            nameEl.textContent = "Excel Viewer";
            renderTabs();
            showState("No file open.\nOpen a .xlsx or .xls file to view it here.");
            return;
        }

        nameEl.textContent = fileName(currentPath);
        reloadBtn.disabled = false;

        // Bytes straight from the bridge — no base64 anywhere. `board-manifest.json` declares
        // minAppVersion 4.0.21, so the encoding is always available and needs no probing.
        // (The old base64 route cost an encode in main, a 33% bigger payload over the port, and
        // an atob + per-byte decode here: 65 ms of pure conversion on this file, and ~3x the
        // transient memory. It also capped a board at ~400 MB, V8's max string length.)
        const bytes = await P.readFile(currentPath, { encoding: "binary" });
        fileBytes = bytes; // kept for on-demand parsing of the other sheets

        // A big workbook gets the FIRST sheet only, and the rest on demand (ensureSheetParsed);
        // a small one is parsed whole, so switching sheets never stalls. `SheetNames` lists every
        // sheet either way, so the tab bar is complete from the start.
        const lazy = bytes.length >= LAZY_PARSE_MIN_BYTES;
        workbook = XLSX.read(bytes, lazy ? Object.assign({}, READ_OPTIONS, { sheets: 0 }) : READ_OPTIONS);
        if (!lazy) fileBytes = null; // nothing left to parse — release the 20 MB-class buffer

        const names = workbook.SheetNames || [];
        if (names.length === 0) {
            showState("This workbook has no sheets.");
            renderTabs();
            return;
        }

        renderSheet(names[0]);
        // Announced AFTER the first sheet renders, so the shape the agent sees is the loaded one.
        if (aiVisionModel) aiVisionModel.workbookChanged();
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        fileBytes = null;
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

// Publish the agent surface before the first load, so an agent that attaches while the workbook
// is still parsing sees the model (reporting isLoaded: false) rather than nothing at all.
if (aiVisionModel) aiVisionModel.register();

load();
