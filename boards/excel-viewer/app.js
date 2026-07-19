// Excel Viewer — frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH (not content), we read the
// bytes ourselves, parse them with SheetJS, and render each worksheet in a Tabulator grid.
// Read-only — there is no write path. See CLAUDE.md for the board-specific notes and
// read_guide("boards") for the generic persephone.* bridge reference.

const P = window.persephone;

// DOM handles.
const nameEl = document.getElementById("name");
const tabsEl = document.getElementById("tabs");
const stateEl = document.getElementById("state");
const reloadBtn = document.getElementById("reload");

// Loaded-workbook state.
let workbook = null; // the SheetJS workbook
let activeSheet = null; // name of the sheet currently shown
let table = null; // the live Tabulator instance (destroyed + rebuilt per sheet)
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

// Natural-order sorter for the letter columns. Cells are formatted display strings, so a plain
// string sort orders "10" before "3" and "item-10" before "item-2". localeCompare with
// numeric:true sorts embedded numbers by value — numeric columns and "item-N" labels both come
// out right. (Dates, shown as formatted text, still sort lexically — a documented v1 limit.)
const naturalSorter = (a, b) =>
    String(a == null ? "" : a).localeCompare(String(b == null ? "" : b), undefined, {
        numeric: true,
        sensitivity: "base",
    });

// Serialize a Tabulator range to tab-separated text (Excel's clipboard format), excluding the
// row-number gutter column (`__row`). Rows top-to-bottom, columns left-to-right.
function rangeToTsv(range) {
    const cols = range.getColumns().filter((c) => c.getField() !== "__row");
    const rows = range.getRows();
    return rows
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

// Copy the current selection to the clipboard as TSV. We do this OURSELVES (build the text +
// navigator.clipboard.writeText) rather than via Tabulator's clipboard module: that module copies
// through the legacy `document.execCommand("copy")` path, whose `copy` event never fires in the
// board's Electron iframe, so both its Ctrl+C and `copyToClipboard()` silently do nothing here.
// `fallbackCell` (from the context menu) seeds a 1×1 range when nothing is selected yet.
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
        P.notify("Copy failed: " + (err && err.message ? err.message : err), "error");
    }
}

// Right-click "Copy" for cells. Copies the active range; if nothing is selected, the right-clicked
// cell is copied.
const CELL_MENU = [{ label: "Copy", action: (e, cell) => copySelection(cell) }];

// The Excel-style row-number gutter. Defined as Tabulator's dedicated `rowHeader` (not a plain
// frozen column) so it's the range module's designated range-header — a frozen column that ISN'T
// the range header warns about "unpredictable behavior" with selectableRange. Shows the actual
// Excel row number from each row's __row field, and is excluded from clipboard copy so a copied
// range holds only cell values.
const ROW_HEADER = {
    title: "",
    field: "__row",
    headerSort: false,
    resizable: false,
    width: 64,
    hozAlign: "right",
    cssClass: "xl-rownum",
    clipboard: false,
};

// Turn one worksheet into { columns, data } for Tabulator. Renders Excel-style: column-letter
// headers (A, B, C…) + a row-number gutter, one grid column per spreadsheet column across the
// sheet's used range (ws['!ref']). We show each cell's FORMATTED text (cell.w — dates, number
// formats, etc.) and fall back to the raw value; a viewer should look like Excel, not expose
// internals. Row 1 is NOT treated as a header — arbitrary sheets may have no header row.
function buildGrid(ws) {
    const columns = [];
    const data = [];

    const ref = ws && ws["!ref"];
    if (!ref) {
        return { columns, data }; // empty sheet — gutter only, no rows
    }

    const range = XLSX.utils.decode_range(ref);

    for (let c = range.s.c; c <= range.e.c; c++) {
        columns.push({
            title: XLSX.utils.encode_col(c), // A, B, C, …
            field: "c" + c,
            headerSort: true,
            sorter: naturalSorter,
            headerFilter: "input",
            headerFilterPlaceholder: "filter…",
            resizable: true,
            maxWidth: 420, // cap a runaway-wide column so the grid stays usable
        });
    }

    for (let r = range.s.r; r <= range.e.r; r++) {
        const row = { __row: r + 1 }; // 1-based Excel row number
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            row["c" + c] = cell == null ? "" : cell.w != null ? cell.w : String(cell.v);
        }
        data.push(row);
    }

    return { columns, data };
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

function renderSheet(name) {
    activeSheet = name;
    renderTabs();

    const ws = workbook.Sheets[name];
    const { columns, data } = buildGrid(ws);

    // Rebuild the grid from scratch on each sheet switch — a clean lifecycle beats juggling
    // setColumns/replaceData ordering, and sheet switches are infrequent.
    if (table) {
        table.destroy();
        table = null;
    }

    if (data.length === 0) {
        showState("This sheet is empty.");
        return;
    }
    hideState();

    table = new Tabulator("#grid", {
        data,
        columns,
        rowHeader: ROW_HEADER, // the range module's designated row-number gutter
        columnDefaults: { contextMenu: CELL_MENU }, // right-click → Copy on every cell
        height: "100%",
        layout: "fitData", // size columns to content, Excel-like; horizontal scroll when wide
        movableColumns: true,
        // Spreadsheet-style range selection (drag to select a block; header clicks stay free for
        // sort/filter). Read-only, so cells never clear. Copy is handled by copySelection() — via
        // the right-click menu and the Ctrl+C handler below — not Tabulator's (broken here) clipboard.
        selectableRange: true,
        selectableRangeColumns: false,
        selectableRangeRows: false,
        selectableRangeClearCells: false,
    });
}

// ---- load the file -------------------------------------------------------------------------

async function load() {
    try {
        showState("Loading…");
        reloadBtn.disabled = true;

        const path = await P.getFilePath();
        currentPath = path || "";

        if (!currentPath) {
            // Opened plainly (not as an editor for a file) — clean empty state, no crash.
            workbook = null;
            activeSheet = null;
            if (table) { table.destroy(); table = null; }
            nameEl.textContent = "Excel Viewer";
            renderTabs();
            showState("No file open.\nOpen a .xlsx or .xls file to view it here.");
            return;
        }

        nameEl.textContent = fileName(currentPath);
        reloadBtn.disabled = false;

        const b64 = await P.readFile(currentPath, { encoding: "base64" });
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

        // cellDates so dates arrive as real Date values with formatted .w text.
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
        if (table) { table.destroy(); table = null; }
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

// Ctrl/Cmd+C copies the selected range as TSV. Tabulator's own keyboard copy doesn't work in the
// board iframe (see copySelection), so we handle it. Skip when a header-filter input is focused so
// normal text-copy still works there.
document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== "c" && e.key !== "C")) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    if (!table || table.getRanges().length === 0) return;
    e.preventDefault();
    copySelection();
});

load();
