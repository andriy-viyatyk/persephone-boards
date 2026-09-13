// Excel Viewer board — the AiVision agent surface.
//
// Why this exists: an agent asked to "read this spreadsheet" used to shell out to an external
// converter, because the workbook on screen was opaque to it. It never needed to. This board
// already holds the parsed workbook (SheetJS) AND a live av-grid showing one sheet of it, both in
// THIS BOARD'S OWN DOCUMENT. This file publishes them at `pages[pageId].editor.app`.
//
// This surface is deliberately larger than the PDF / Word / PowerPoint ones, because this board is
// not a renderer wrapped around someone else's viewer — it is our app on our own grid, so the
// agent can reach everything the USER can reach: the sheet tabs, the search box, the sort, the
// column filters, the selected range and the column order. Four things shaped the design:
//
//   1. **Two different sources of truth, and they answer different questions.** The WORKBOOK
//      (SheetJS) holds every sheet, every row, in sheet order, whether or not it is on screen.
//      The GRID holds one sheet as the user is currently looking at it — sorted, filtered,
//      searched, with a selection and a column order. Data reads go to the workbook (so they work
//      on any sheet, at any range, with no regard for filters, and even on a sheet the user has
//      never opened); view state and every action go to the grid. `{ view: true }` on a read is
//      the explicit bridge: "what is on screen", not "what is in the file".
//   2. **Addressing is spreadsheet-native: A1 notation, everywhere.** Column letters and 1-based
//      Excel row numbers are the language the file, the user and the screen all already speak.
//      The grid's own vocabulary — column keys like `c3`, display row indices that move when you
//      sort — is internal and never crosses this boundary.
//   3. **Filter values are the DISPLAYED text, not the underlying value.** Measured, not assumed:
//      filtering column D by `19.5` matches nothing and by `"$19.50"` matches the row. av-grid
//      sorts on `row[key]` and filters on `formatValue`, and this board deliberately feeds those
//      two different things (see "Raw + formatted" in CLAUDE.md), so on every formatted column the
//      two disagree. `getColumnValues()` exists to hand an agent the values that will actually
//      work, and the filter result says so out loud when nothing matched.
//   4. **There is no text highlight.** av-grid's `highlightString` — which would mark words in
//      place without filtering — is in the library's docs but NOT in the vendored 2.1.0 build:
//      `setOptions({ highlightString })` is accepted silently and marks nothing. So pointing the
//      user at something uses the grid's OWN idiom instead: select the range and scroll it into
//      view, which is exactly what a user does, and is virtualization-safe in a way wrapping
//      pooled cell DOM would not be.
//
// Everything here is READ-ONLY with respect to the file. The grid is not `editable`, there is no
// write path to the workbook, and the save* methods write NEW files at a path the agent names.
(() => {
    const XA = (window.XLSXAI = window.XLSXAI || {});

    // Bound on the cells one call may return. A 20,000-row sheet is ordinary here, and returning
    // it whole would blow any result budget; the read truncates and says so rather than failing,
    // and points at saveCsv() for the whole thing.
    const MAX_CELLS = 20000;

    const HELP = `This is an Excel workbook (.xlsx / .xls) open in the Excel Viewer board. It is
already parsed and rendered, so reading it here needs no conversion step and no external tool. You
can also DRIVE it: everything the user can do to this grid, you can do.

Start with getStats(). It reports every sheet, its dimensions, and the state of the grid on screen
(sort, filters, search, selection), which is what you need to decide how to read the workbook.

READING THE DATA. getCells(range, options) is the main read; range is A1 notation - "B2:D50",
"B:D" for whole columns, "2:50" for whole rows, or omitted for the sheet's whole used range. It
reads the WORKBOOK, so it is unaffected by any filter or sort on screen and works on any sheet via
{ sheet: "Name" } - including one the user has never opened. Pass { view: true } instead to read
what is actually ON SCREEN, in display order, after the current sort and filters. getMarkdown() and
getCsv() give the same data as a table or CSV. A call result is bounded, so for a big sheet use
saveCsv() and read the file.

Values come back as the text the cell DISPLAYS - "$19.50", "1/15/26" - which is what the user sees.
Pass { raw: true } for the underlying value (19.5, an ISO date) when you need to compute with it.

DRIVING THE GRID. getView() reports everything about the current view in one call. Then:
goToSheet(name) switches tab; setSearch(text) drives the toolbar search box; setSort(column,
direction) sorts; setFilter(column, values) filters; selectRange(range) selects cells and
scrollTo(range) brings them into view; setColumnOrder / moveColumn reorder the columns.

FILTER VALUES ARE THE DISPLAYED TEXT, NOT THE UNDERLYING VALUE. Filtering a currency column by
19.5 matches NOTHING; "$19.50" matches. This is not a quirk you can reason around - call
getColumnValues(column) to get the exact strings that will work, and pass those.

SHOWING THE USER. selectRange(range) followed by scrollTo(range) - or showCells(range), which does
both - points the user at what you are talking about, the same way they would point at it
themselves. There is no way to highlight text in place; the selection IS the pointer.

Paths passed to saveCsv and saveMarkdown must be ABSOLUTE. Row numbers are 1-based Excel row
numbers and columns are spreadsheet letters everywhere, matching what the user sees on screen.`;

    const MEMBERS = [
        { name: "fileName", kind: "property", summary: "Name of the open workbook file." },
        { name: "filePath", kind: "property", summary: "Absolute path of the open .xlsx / .xls file on disk." },
        { name: "sheetNames", kind: "property", summary: "Every worksheet name in the workbook, in tab order." },
        { name: "activeSheet", kind: "property", summary: "Name of the worksheet currently shown. Assigning switches the tab the user is looking at.", writable: true },
        { name: "isLoaded", kind: "property", summary: "Whether a workbook is open and parsed." },

        { name: "getStats", kind: "method", signature: "getStats()", summary: "What this workbook is: every sheet with its dimensions, plus the state of the grid on screen. Read this first." },
        { name: "getSheets", kind: "method", signature: "getSheets()", summary: "The worksheets with their used range, row and column counts, and which one is active. A large workbook parses sheets on demand, so a sheet not yet opened reports parsed: false." },
        { name: "getView", kind: "method", signature: "getView()", summary: "Everything about the view the user is looking at, in one call: active sheet, sort, filters, search text, column order, selected range, and how many rows the filters are hiding." },

        { name: "getCells", kind: "method", signature: "getCells(range?, options?)", summary: "Cell values for an A1 range ('B2:D50', 'B:D', '2:50', or omitted for the whole used range). Options: { sheet, view, raw }. Reads the file by default; { view: true } reads what is on screen after the current sort and filters." },
        { name: "getMarkdown", kind: "method", signature: "getMarkdown(range?, options?)", summary: "The same range as a Markdown table with column letters as headers. Good for reading a block of a sheet in one go." },
        { name: "getCsv", kind: "method", signature: "getCsv(range?, options?)", summary: "The same range as CSV. Use when you want to parse the values yourself." },
        { name: "getColumnValues", kind: "method", signature: "getColumnValues(column, options?)", summary: "The distinct DISPLAYED values of one column, with a count of each. THESE ARE THE STRINGS setFilter WANTS - call this before filtering." },
        { name: "search", kind: "method", signature: "search(query, options?)", summary: "Find cells whose displayed text matches; returns A1 addresses with their values. Options: { sheet, allSheets, caseSensitive, regex, wholeCell, maxHits }." },
        { name: "getSelectionText", kind: "method", signature: "getSelectionText(mode?)", summary: "The selected range as text, without touching the clipboard. Mode: 'copy' (TSV, default), 'copyWithHeaders', 'copyAsJson', 'copyAsHtmlTable'." },

        { name: "saveCsv", kind: "method", signature: "saveCsv(path, range?, options?)", summary: "Write a range to a CSV file at an absolute path you name. Use this instead of getCsv for a sheet too large to receive in one call.", caution: "writes a new file to disk" },
        { name: "saveMarkdown", kind: "method", signature: "saveMarkdown(path, range?, options?)", summary: "Write a range to a Markdown table file at an absolute path you name.", caution: "writes a new file to disk" },

        { name: "goToSheet", kind: "method", signature: "goToSheet(name)", summary: "Switch to a worksheet tab - the same thing the user does by clicking it. Resets that view's sort, filters and selection, as a tab switch always does.", caution: "changes what the user is looking at" },
        { name: "setSearch", kind: "method", signature: "setSearch(text)", summary: "Type into the board's toolbar search box. Every whitespace-separated word must appear somewhere in a row, and the words are highlighted inside the cells. Pass '' to clear.", caution: "changes what the user is looking at" },
        { name: "setSort", kind: "method", signature: "setSort(column, direction = 'asc')", summary: "Sort by a column letter, 'asc' or 'desc'. Sorting uses the UNDERLYING values, so numbers and dates order correctly. Pass null to clear the sort.", caution: "changes what the user is looking at" },
        { name: "setFilter", kind: "method", signature: "setFilter(column, values)", summary: "Filter a column to the given values - pass the DISPLAYED text, from getColumnValues(). A string or an array. Pass null to remove this column's filter.", caution: "changes what the user is looking at" },
        { name: "clearFilters", kind: "method", signature: "clearFilters()", summary: "Remove every column filter.", caution: "changes what the user is looking at" },
        { name: "selectRange", kind: "method", signature: "selectRange(range)", summary: "Select an A1 range in the grid, as a click-and-drag would. Pass null to clear the selection.", caution: "changes what the user is looking at" },
        { name: "scrollTo", kind: "method", signature: "scrollTo(range)", summary: "Scroll a cell or range into the visible area without changing the selection.", caution: "changes what the user is looking at" },
        { name: "showCells", kind: "method", signature: "showCells(range)", summary: "Select a range AND scroll it into view - this is how you point the user at what you are talking about.", caution: "changes what the user is looking at" },
        { name: "setColumnOrder", kind: "method", signature: "setColumnOrder(columns)", summary: "Reorder the grid's columns. Give the column letters in the order you want; any you leave out keep their relative order after the ones you named.", caution: "changes what the user is looking at; drops the current selection" },
        { name: "moveColumn", kind: "method", signature: "moveColumn(column, before?)", summary: "Move one column in front of another ('move D before B'). Omit `before` to move it to the end.", caution: "changes what the user is looking at; drops the current selection" },
        { name: "copySelection", kind: "method", signature: "copySelection(mode?)", summary: "Put the selected range on the SYSTEM clipboard, as Ctrl+C does. Often refused when the window is not focused - use getSelectionText() to read it yourself.", caution: "writes to the system clipboard" },
        { name: "reload", kind: "method", signature: "reload()", summary: "Re-read the workbook from disk, in case the file changed outside the app.", caution: "reloads the document and drops the current view" },
        { name: "openRangePage", kind: "method", signature: "openRangePage(range?, options?)", summary: "Open a range as a Markdown table in a new Persephone page, to show the user what you read.", caution: "opens a new page" },
    ];

    XA.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, workbookChanged() {}, sheetChanged() {} };

        /** Distinct-value scans, keyed `sheet\u0000columnKey`. A worksheet does not change after a
         *  parse, so a column is scanned once; `workbookChanged()` clears it. */
        const valuesCache = new Map();

        // ── A1 notation ─────────────────────────────────────────────────────────────────────
        // Column letters and 1-based row numbers are the only addressing this surface speaks.
        // SheetJS already has the encoders, and they are the same ones buildGrid used to name the
        // columns — so a letter here is literally the header the user is looking at.

        function colLetter(index) {
            return XLSX.utils.encode_col(index);
        }

        /** "c3" (the grid's column key) → 3 → "D". The key is authoritative and order-independent;
         *  the column's `name` happens to equal this but is display data. */
        function letterOfKey(key) {
            return colLetter(Number(String(key).slice(1)));
        }

        function keyOfLetter(letter) {
            return "c" + XLSX.utils.decode_col(letter);
        }

        function parseColumn(column, what) {
            if (typeof column !== "string" || !/^[A-Za-z]{1,3}$/.test(column.trim())) {
                throw new Error("Pass a spreadsheet column letter" + (what ? " " + what : "")
                    + ' like "B" or "AC"; got ' + JSON.stringify(column) + ".");
            }
            return column.trim().toUpperCase();
        }

        /** A1 range text → a 0-based { s: { r, c }, e: { r, c } }, clamped to the sheet's used
         *  range. Accepts the four shapes a spreadsheet user actually writes:
         *    "B2:D50"  a rectangle        "B2"   a single cell
         *    "B:D"     whole columns      "2:50" whole rows
         *  Omitted means the whole used range. */
        function parseRange(text, used) {
            if (text === undefined || text === null || text === "") return used;
            if (typeof text !== "string") {
                throw new Error("Range must be A1 notation text like \"B2:D50\"; got " + JSON.stringify(text) + ".");
            }
            const raw = text.trim().toUpperCase().replace(/\$/g, "");
            const cell = /^([A-Z]{1,3})(\d+)$/;
            const rect = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/;
            const cols = /^([A-Z]{1,3}):([A-Z]{1,3})$/;
            const rows = /^(\d+):(\d+)$/;

            let box = null;
            let m;
            if ((m = rect.exec(raw))) {
                box = { s: { c: XLSX.utils.decode_col(m[1]), r: Number(m[2]) - 1 },
                        e: { c: XLSX.utils.decode_col(m[3]), r: Number(m[4]) - 1 } };
            } else if ((m = cell.exec(raw))) {
                box = { s: { c: XLSX.utils.decode_col(m[1]), r: Number(m[2]) - 1 },
                        e: { c: XLSX.utils.decode_col(m[1]), r: Number(m[2]) - 1 } };
            } else if ((m = cols.exec(raw))) {
                box = { s: { c: XLSX.utils.decode_col(m[1]), r: used.s.r },
                        e: { c: XLSX.utils.decode_col(m[2]), r: used.e.r } };
            } else if ((m = rows.exec(raw))) {
                box = { s: { c: used.s.c, r: Number(m[1]) - 1 },
                        e: { c: used.e.c, r: Number(m[2]) - 1 } };
            } else {
                throw new Error('Could not read "' + text + '" as a range. Use A1 notation: '
                    + '"B2:D50" for a block, "B2" for one cell, "B:D" for whole columns, '
                    + '"2:50" for whole rows, or omit it for the whole sheet.');
            }

            // Written backwards ("D50:B2") is a normal thing to type; normalize rather than refuse.
            const norm = {
                s: { r: Math.min(box.s.r, box.e.r), c: Math.min(box.s.c, box.e.c) },
                e: { r: Math.max(box.s.r, box.e.r), c: Math.max(box.s.c, box.e.c) },
            };
            // Clamp into the used range: asking for "A1:ZZ100000" on a 7-row sheet should give the
            // 7 rows, not 100,000 blanks.
            const clamped = {
                s: { r: Math.max(norm.s.r, used.s.r), c: Math.max(norm.s.c, used.s.c) },
                e: { r: Math.min(norm.e.r, used.e.r), c: Math.min(norm.e.c, used.e.c) },
            };
            if (clamped.s.r > clamped.e.r || clamped.s.c > clamped.e.c) {
                throw new Error('Range "' + text + '" lies entirely outside this sheet\'s data ('
                    + rangeText(used) + ").");
            }
            return clamped;
        }

        /** Drop keys whose value is undefined. An undefined field does not survive the trip to the
         *  agent as an absent one — it arrives as an explicit `null`, which reads as "the answer is
         *  nothing" rather than "this does not apply". Every result goes through here. */
        function compact(obj) {
            for (const key of Object.keys(obj)) {
                if (obj[key] === undefined) delete obj[key];
            }
            return obj;
        }

        function rangeText(box) {
            return colLetter(box.s.c) + (box.s.r + 1) + ":" + colLetter(box.e.c) + (box.e.r + 1);
        }

        // ── workbook access ─────────────────────────────────────────────────────────────────

        function requireWorkbook() {
            const wb = ctx.getWorkbook();
            if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
                throw new Error("No workbook is open in this board yet.");
            }
            return wb;
        }

        /** Resolve a sheet name to a PARSED worksheet. A workbook over 4 MB parses sheets on
         *  demand (see ensureSheetParsed in app.js), so naming a sheet the user has never opened
         *  is legitimate and simply parses it here. */
        function requireSheet(name) {
            const wb = requireWorkbook();
            const sheetName = name === undefined || name === null || name === ""
                ? ctx.getActiveSheet()
                : String(name);
            if (!sheetName) throw new Error("No worksheet is active.");
            if (wb.SheetNames.indexOf(sheetName) < 0) {
                throw new Error('This workbook has no sheet named "' + sheetName + '". It has: '
                    + wb.SheetNames.map((n) => '"' + n + '"').join(", ") + ".");
            }
            ctx.ensureSheetParsed(sheetName);
            const ws = wb.Sheets[sheetName];
            if (!ws) throw new Error('Worksheet "' + sheetName + '" could not be parsed.');
            return { name: sheetName, ws };
        }

        function usedRange(ws) {
            const ref = ws && ws["!ref"];
            if (!ref) return null;
            return XLSX.utils.decode_range(ref);
        }

        function requireUsedRange(sheet) {
            const used = usedRange(sheet.ws);
            if (!used) throw new Error('Sheet "' + sheet.name + '" is empty — it has no cells.');
            return used;
        }

        /** One cell, straight out of the parsed worksheet. `dense: true` (see app.js) puts cells in
         *  ws["!data"][r][c] and leaves NO address keys at all, so the dense path is the real one
         *  and the encode_cell lookup is only a safety net for a sparse sheet. */
        function cellAt(ws, r, c) {
            const data = ws["!data"];
            if (data) {
                const row = data[r];
                return row ? row[c] : undefined;
            }
            return ws[XLSX.utils.encode_cell({ r: r, c: c })];
        }

        /** What the cell SHOWS — `cell.w`, Excel's own formatted text. This is the projection the
         *  grid displays, searches, filters and copies, so it is what this surface reports and what
         *  setFilter matches against. */
        function displayOf(cell) {
            if (cell == null || cell.v == null) return "";
            return cell.w != null ? cell.w : String(cell.v);
        }

        /** The value BEHIND the cell — a number, a boolean, a string, or a Date rendered as ISO so
         *  it survives the JSON trip to the agent intact. */
        function rawOf(cell) {
            if (cell == null || cell.v == null) return null;
            const v = cell.v;
            return v instanceof Date ? v.toISOString() : v;
        }

        // ── grid access ─────────────────────────────────────────────────────────────────────
        // The grid is DESTROYED and rebuilt on every sheet switch (renderSheet in app.js), and is
        // null for an empty sheet — so it is looked up live on every call and never held.

        function requireGrid() {
            const grid = ctx.getGrid();
            if (!grid || grid.isDestroyed()) {
                const sheet = ctx.getActiveSheet();
                throw new Error(sheet
                    ? 'There is no grid on screen: sheet "' + sheet + '" is empty. '
                        + "Switch to a sheet with data using goToSheet(name)."
                    : "No workbook is open in this board yet.");
            }
            return grid;
        }

        /** The grid's columns WITHOUT the row-number gutter, in the order they are drawn.
         *  `__row` is an av-grid status column: it is kept out of the focus, the selection and
         *  every copy path, and it is not a spreadsheet column, so it never appears here. */
        function dataColumns(grid) {
            return grid.getColumns().filter((c) => !c.isStatusColumn);
        }

        /** Grid column index (which INCLUDES the status column) for a spreadsheet letter, as
         *  selectRange and scrollToCell want it. Order-independent: the user may have reordered. */
        function gridColIndex(grid, letter) {
            const key = keyOfLetter(letter);
            const index = grid.getColumns().findIndex((c) => c.key === key);
            if (index < 0) {
                const present = dataColumns(grid).map((c) => letterOfKey(c.key));
                throw new Error('Column ' + letter + ' is not in this sheet. It has: '
                    + present.join(", ") + ".");
            }
            return index;
        }

        /** Display index of an Excel row number — its position on screen after the current sort
         *  and filters, which is the only thing selectRange and scrollToCell understand. Returns
         *  -1 when a filter is hiding that row. */
        function displayIndexOfRow(grid, rowNumber) {
            const visible = grid.getVisibleRows();
            for (let i = 0; i < visible.length; i++) {
                if (visible[i].__row === rowNumber) return i;
            }
            return -1;
        }

        // ── selection ───────────────────────────────────────────────────────────────────────

        /** The selection, described in spreadsheet terms.
         *
         *  The honest part: a grid selection is a rectangle over DISPLAYED rows, and once a sort or
         *  filter is applied those rows are not contiguous in the sheet. So the row numbers are
         *  always listed explicitly, and `range` — the A1 box — is only reported when it really is
         *  one contiguous block of the sheet. Reporting a tidy "B2:D10" for a set of rows scattered
         *  by a sort would be a lie an agent would act on. */
        function describeSelection(grid) {
            const sel = grid.getSelection();
            if (!sel) return null;

            // getSelection().columns INCLUDES the __row status column when the selection starts at
            // the left edge, even though getSelectionText() correctly drops it. Filter it here so
            // the two agree.
            const columns = sel.columns.filter((c) => !c.isStatusColumn).map((c) => letterOfKey(c.key));
            const rowNumbers = sel.rows.map((r) => r.__row);
            if (columns.length === 0 || rowNumbers.length === 0) return null;

            const contiguousRows = rowNumbers.every((n, i) => i === 0 || n === rowNumbers[i - 1] + 1);
            const colIndexes = columns.map((l) => XLSX.utils.decode_col(l));
            const contiguousCols = colIndexes.every((n, i) => i === 0 || n === colIndexes[i - 1] + 1);
            const isBlock = contiguousRows && contiguousCols;

            const out = {
                range: isBlock
                    ? columns[0] + rowNumbers[0] + ":" + columns[columns.length - 1] + rowNumbers[rowNumbers.length - 1]
                    : undefined,
                columns: columns,
                rows: rowNumbers,
                rowCount: rowNumbers.length,
                columnCount: columns.length,
                cellCount: rowNumbers.length * columns.length,
                activeCell: sel.focusRow != null && grid.getFocus()
                    ? letterOfKey(grid.getFocus().columnKey) + grid.getFocus().rowKey
                    : undefined,
            };
            compact(out);
            if (!isBlock) {
                out.note = "These rows and/or columns are not contiguous in the sheet — the current "
                    + "sort, filters or column order put them side by side on screen. The row and "
                    + "column lists above are exact; there is no single A1 range for this selection.";
            }
            return out;
        }

        // ── reading cells ───────────────────────────────────────────────────────────────────

        /** Read a rectangle out of the WORKBOOK — sheet order, every row, filters and sort
         *  irrelevant. This is the default because it answers "what is in the file". */
        function readSheetCells(sheet, box, raw) {
            const letters = [];
            for (let c = box.s.c; c <= box.e.c; c++) letters.push(colLetter(c));

            const maxRows = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, letters.length)));
            const lastRow = Math.min(box.e.r, box.s.r + maxRows - 1);
            const truncated = lastRow < box.e.r;

            const rows = [];
            for (let r = box.s.r; r <= lastRow; r++) {
                const cells = [];
                for (let c = box.s.c; c <= box.e.c; c++) {
                    const cell = cellAt(sheet.ws, r, c);
                    cells.push(raw ? rawOf(cell) : displayOf(cell));
                }
                rows.push({ row: r + 1, cells: cells });
            }
            return { letters: letters, rows: rows, truncated: truncated, totalRows: box.e.r - box.s.r + 1 };
        }

        /** Read what is ON SCREEN — the grid's displayed rows, in display order, after the current
         *  sort and filters, and in the current column order. The columns are taken from the grid
         *  (so a reorder shows through) but still restricted to the letters the range names. */
        function readViewCells(grid, box, raw) {
            const wanted = new Set();
            for (let c = box.s.c; c <= box.e.c; c++) wanted.add("c" + c);
            const cols = dataColumns(grid).filter((c) => wanted.has(c.key));
            if (cols.length === 0) {
                throw new Error("None of the columns in that range are in the grid.");
            }
            const letters = cols.map((c) => letterOfKey(c.key));

            const visible = grid.getVisibleRows();
            const wantedRows = visible.filter((r) => r.__row >= box.s.r + 1 && r.__row <= box.e.r + 1);

            const maxRows = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, letters.length)));
            const truncated = wantedRows.length > maxRows;
            const slice = truncated ? wantedRows.slice(0, maxRows) : wantedRows;

            const rows = slice.map((row) => ({
                row: row.__row,
                cells: cols.map((c) => {
                    if (raw) {
                        const v = row[c.key];
                        return v === undefined ? null : (v instanceof Date ? v.toISOString() : v);
                    }
                    const text = row["d" + c.key.slice(1)];
                    return text == null ? "" : text;
                }),
            }));
            return { letters: letters, rows: rows, truncated: truncated, totalRows: wantedRows.length };
        }

        function readCells(range, options) {
            const opts = options || {};
            const sheet = requireSheet(opts.sheet);
            const used = requireUsedRange(sheet);
            const box = parseRange(range, used);
            const raw = !!opts.raw;

            if (opts.view) {
                if (opts.sheet && opts.sheet !== ctx.getActiveSheet()) {
                    throw new Error("{ view: true } reads what is on screen, so it only works on "
                        + 'the active sheet ("' + ctx.getActiveSheet() + '"). Either drop the '
                        + "sheet option, or call goToSheet(" + JSON.stringify(opts.sheet) + ") first.");
                }
                const read = readViewCells(requireGrid(), box, raw);
                read.source = "view";
                read.sheet = sheet.name;
                read.box = box;
                return read;
            }
            const read = readSheetCells(sheet, box, raw);
            read.source = "sheet";
            read.sheet = sheet.name;
            read.box = box;
            return read;
        }

        function truncationNote(read) {
            if (!read.truncated) return undefined;
            return "Truncated: " + read.rows.length + " of " + read.totalRows + " rows. Ask for a "
                + "smaller range, or use saveCsv(path, range) to write the whole thing to a file.";
        }

        // ── formatting reads ────────────────────────────────────────────────────────────────

        function escapePipes(text) {
            return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
        }

        /** A Markdown pipe table, with the Excel row number as the first column — without it a
         *  table lifted out of the middle of a sheet has no way to say which rows it covers. */
        function toMarkdown(read) {
            const header = ["Row"].concat(read.letters);
            const lines = [
                "| " + header.join(" | ") + " |",
                "| " + header.map(() => "---").join(" | ") + " |",
            ];
            for (const row of read.rows) {
                lines.push("| " + [row.row].concat(row.cells.map((v) => escapePipes(v == null ? "" : v))).join(" | ") + " |");
            }
            return lines.join("\n");
        }

        function csvCell(value) {
            const text = value == null ? "" : String(value);
            return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }

        function toCsv(read) {
            const lines = [["Row"].concat(read.letters).map(csvCell).join(",")];
            for (const row of read.rows) {
                lines.push([row.row].concat(row.cells).map(csvCell).join(","));
            }
            return lines.join("\r\n");
        }

        // ── distinct column values ──────────────────────────────────────────────────────────

        /** The distinct DISPLAYED values of a column, most frequent first — which is exactly the
         *  checklist the user sees in the header funnel, and exactly what setFilter matches. */
        function columnValues(sheet, letter) {
            const cacheKey = sheet.name + "\u0000" + letter;
            if (valuesCache.has(cacheKey)) return valuesCache.get(cacheKey);

            const used = requireUsedRange(sheet);
            const c = XLSX.utils.decode_col(letter);
            if (c < used.s.c || c > used.e.c) {
                throw new Error("Column " + letter + " is outside this sheet's data ("
                    + colLetter(used.s.c) + "–" + colLetter(used.e.c) + ").");
            }
            const counts = new Map();
            for (let r = used.s.r; r <= used.e.r; r++) {
                const text = displayOf(cellAt(sheet.ws, r, c));
                counts.set(text, (counts.get(text) || 0) + 1);
            }
            const list = Array.from(counts, ([value, count]) => ({ value: value, count: count }))
                .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
            valuesCache.set(cacheKey, list);
            return list;
        }

        // ── writing files ───────────────────────────────────────────────────────────────────

        /** An absolute path is required for every write: a relative path would resolve against the
         *  board folder, quietly dropping the file into the board's own (published) folder. */
        function requireAbsolutePath(path, what) {
            if (typeof path !== "string" || path.trim() === "") {
                throw new Error("Pass an absolute file path to write the " + what + " to.");
            }
            const absolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
            if (!absolute) {
                throw new Error("The " + what + " path must be ABSOLUTE (e.g. C:\\temp\\out.csv); "
                    + '"' + path + '" is relative and would land inside the board folder.');
            }
            return path;
        }

        // ── the published model ─────────────────────────────────────────────────────────────

        const app = {
            aiVision: {
                kind: "ExcelBoard",
                summary: "The Excel Viewer board's live model for the open workbook and the grid on screen.",
                overview: "Call getStats() first: every sheet, its size, and the state of the view.\n"
                    + "Read data with getCells(range) — A1 notation, e.g. \"B2:D50\"; add { view: true } for what is on screen.\n"
                    + "Drive the grid like the user does: goToSheet, setSearch, setSort, setFilter, selectRange, setColumnOrder.\n"
                    + "Filter values are the DISPLAYED text — get them from getColumnValues(column).",
                help: HELP,
                members: MEMBERS,
                summarize: () => {
                    const wb = ctx.getWorkbook();
                    const grid = ctx.getGrid();
                    return {
                        kind: "ExcelBoard",
                        fileName: ctx.getFileName(),
                        filePath: ctx.getFilePath(),
                        sheetCount: wb && wb.SheetNames ? wb.SheetNames.length : undefined,
                        activeSheet: ctx.getActiveSheet() || undefined,
                        isLoaded: !!(wb && wb.SheetNames && wb.SheetNames.length),
                        // Cheap: read off the live grid, never a scan of the workbook.
                        visibleRowCount: grid && !grid.isDestroyed() ? grid.getState().rowCount : undefined,
                        isFiltered: grid && !grid.isDestroyed() ? grid.getFilters().length > 0 : undefined,
                        hint: "Call getStats() for the sheets and the state of the view.",
                    };
                },
            },

            get fileName() { return ctx.getFileName(); },
            get filePath() { return ctx.getFilePath(); },
            get sheetNames() {
                const wb = ctx.getWorkbook();
                return wb && wb.SheetNames ? wb.SheetNames.slice() : [];
            },
            get isLoaded() {
                const wb = ctx.getWorkbook();
                return !!(wb && wb.SheetNames && wb.SheetNames.length);
            },
            get activeSheet() { return ctx.getActiveSheet() || undefined; },
            set activeSheet(name) { app.goToSheet(name); },

            // ── reading ─────────────────────────────────────────────────────────────────────

            getStats() {
                requireWorkbook();
                // Deliberately NOT cached: a sheet's `parsed` flag flips the first time anything
                // reads it, so a cached sheet list would keep reporting "not parsed yet" for a
                // sheet that is now loaded. It is only a `!ref` read per sheet anyway.
                const sheets = app.getSheets().sheets;
                return {
                    fileName: ctx.getFileName(),
                    filePath: ctx.getFilePath(),
                    sheetCount: sheets.length,
                    sheets: sheets,
                    view: app.getView(),
                    note: "Data reads (getCells/getMarkdown/getCsv) read the FILE and ignore the "
                        + "sort and filters; pass { view: true } to read what is on screen instead.",
                };
            },

            getSheets() {
                const wb = requireWorkbook();
                const active = ctx.getActiveSheet();
                const sheets = wb.SheetNames.map((name) => {
                    const ws = wb.Sheets[name];
                    if (!ws) {
                        // A workbook over 4 MB parses one sheet at a time (app.js), so this is the
                        // normal state of an unopened sheet, not an error. Naming it in any read
                        // parses it on demand.
                        return { name: name, active: name === active, parsed: false,
                                 note: "Not parsed yet; reading it or switching to it will parse it." };
                    }
                    const used = usedRange(ws);
                    if (!used) return { name: name, active: name === active, parsed: true, empty: true, rowCount: 0, columnCount: 0 };
                    return {
                        name: name,
                        active: name === active,
                        parsed: true,
                        empty: false,
                        range: rangeText(used),
                        firstRow: used.s.r + 1,
                        lastRow: used.e.r + 1,
                        columns: colLetter(used.s.c) + "–" + colLetter(used.e.c),
                        rowCount: used.e.r - used.s.r + 1,
                        columnCount: used.e.c - used.s.c + 1,
                    };
                });
                return { count: sheets.length, active: active || undefined, sheets: sheets };
            },

            getView() {
                const wb = ctx.getWorkbook();
                if (!wb) throw new Error("No workbook is open in this board yet.");
                const active = ctx.getActiveSheet();
                const grid = ctx.getGrid();
                if (!grid || grid.isDestroyed()) {
                    return compact({ sheet: active || undefined, hasGrid: false,
                             note: active ? 'Sheet "' + active + '" is empty, so there is no grid to describe.'
                                          : "No sheet is active." });
                }
                const state = grid.getState();
                const sort = grid.getSort();
                const columns = dataColumns(grid).map((c) => letterOfKey(c.key));
                const naturalOrder = columns.slice().sort((a, b) => XLSX.utils.decode_col(a) - XLSX.utils.decode_col(b));
                const reordered = columns.join(",") !== naturalOrder.join(",");
                const searchText = ctx.getSearchText();

                return {
                    sheet: active,
                    hasGrid: true,
                    rowCount: state.rowCount,
                    totalRowCount: state.sourceRowCount,
                    hiddenByFilters: state.sourceRowCount - state.rowCount,
                    sort: sort ? { column: letterOfKey(sort.key), direction: sort.direction } : null,
                    filters: grid.getFilters().map((f) => ({
                        column: letterOfKey(f.columnKey),
                        // Normalized filters carry { value, label } options; the agent only ever
                        // needs the displayed text it would pass back to setFilter.
                        values: Array.isArray(f.value)
                            ? f.value.map((v) => (v && typeof v === "object" && "value" in v ? v.value : v))
                            : f.value,
                    })),
                    search: searchText || null,
                    columnOrder: columns,
                    columnsReordered: reordered,
                    selection: describeSelection(grid),
                    visible: {
                        firstRow: state.viewport.firstRow >= 0 ? state.viewport.firstRow + 1 : null,
                        lastRow: state.viewport.lastRow >= 0 ? state.viewport.lastRow + 1 : null,
                        note: "Screen positions among the DISPLAYED rows, not Excel row numbers.",
                    },
                };
            },

            getCells(range, options) {
                const read = readCells(range, options);
                return compact({
                    sheet: read.sheet,
                    range: rangeText(read.box),
                    source: read.source,
                    columns: read.letters,
                    rowCount: read.rows.length,
                    rows: read.rows,
                    truncated: read.truncated || undefined,
                    note: truncationNote(read),
                });
            },

            getMarkdown(range, options) {
                const read = readCells(range, options);
                const table = toMarkdown(read);
                const note = truncationNote(read);
                return note ? table + "\n\n> " + note : table;
            },

            getCsv(range, options) {
                const read = readCells(range, options);
                return toCsv(read);
            },

            getColumnValues(column, options) {
                const opts = options || {};
                const letter = parseColumn(column);
                const sheet = requireSheet(opts.sheet);
                const list = columnValues(sheet, letter);
                const limit = Number(opts.maxValues) > 0 ? Number(opts.maxValues) : 200;
                const shown = list.slice(0, limit);
                return compact({
                    sheet: sheet.name,
                    column: letter,
                    distinctCount: list.length,
                    values: shown,
                    truncated: list.length > shown.length || undefined,
                    note: "These are the DISPLAYED values — pass them verbatim to "
                        + "setFilter(" + JSON.stringify(letter) + ", [...]). The underlying value "
                        + "will not match.",
                });
            },

            search(query, options) {
                requireWorkbook();
                if (typeof query !== "string" || query === "") throw new Error("Pass the text to search for.");
                const opts = options || {};
                const maxHits = Number(opts.maxHits) > 0 ? Number(opts.maxHits) : 100;
                const names = opts.allSheets
                    ? requireWorkbook().SheetNames.slice()
                    : [opts.sheet || ctx.getActiveSheet()];

                let test;
                if (opts.regex) {
                    let re;
                    try {
                        re = new RegExp(query, opts.caseSensitive ? "" : "i");
                    } catch (err) {
                        throw new Error("That is not a valid regular expression: " + err.message);
                    }
                    test = (text) => re.test(text);
                } else {
                    const needle = opts.caseSensitive ? query : query.toLowerCase();
                    test = (text) => {
                        const hay = opts.caseSensitive ? text : text.toLowerCase();
                        return opts.wholeCell ? hay === needle : hay.indexOf(needle) >= 0;
                    };
                }

                const hits = [];
                let total = 0;
                for (const name of names) {
                    const sheet = requireSheet(name);
                    const used = usedRange(sheet.ws);
                    if (!used) continue;
                    for (let r = used.s.r; r <= used.e.r; r++) {
                        for (let c = used.s.c; c <= used.e.c; c++) {
                            const text = displayOf(cellAt(sheet.ws, r, c));
                            if (text === "" || !test(text)) continue;
                            total++;
                            if (hits.length < maxHits) {
                                hits.push({
                                    sheet: sheet.name,
                                    address: colLetter(c) + (r + 1),
                                    row: r + 1,
                                    column: colLetter(c),
                                    value: text,
                                });
                            }
                        }
                    }
                }
                return compact({
                    query: query,
                    sheetsSearched: names,
                    matchCount: total,
                    hits: hits,
                    truncated: total > hits.length || undefined,
                    note: total === 0
                        ? "No cell's displayed text matches. Searching reads what the cells SHOW, "
                            + "so a formatted number matches its formatted text."
                        : "Point the user at one with showCells(address).",
                });
            },

            getSelectionText(mode) {
                const grid = requireGrid();
                if (!grid.getSelection()) {
                    throw new Error("Nothing is selected. Call selectRange(range) first.");
                }
                return grid.getSelectionText(mode || "copy");
            },

            // ── writing files ───────────────────────────────────────────────────────────────

            async saveCsv(path, range, options) {
                requireAbsolutePath(path, "CSV");
                // Written straight from the workbook with no MAX_CELLS bound — the whole point of
                // saving is the range that was too big to return.
                const opts = options || {};
                const sheet = requireSheet(opts.sheet);
                const used = requireUsedRange(sheet);
                const box = parseRange(range, used);
                const read = opts.view
                    ? readViewCells(requireGrid(), box, !!opts.raw)
                    : readSheetCellsUnbounded(sheet, box, !!opts.raw);
                const text = toCsv(read);
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path: path, sheet: sheet.name, range: rangeText(box), rows: read.rows.length, chars: text.length };
            },

            async saveMarkdown(path, range, options) {
                requireAbsolutePath(path, "Markdown");
                const opts = options || {};
                const sheet = requireSheet(opts.sheet);
                const used = requireUsedRange(sheet);
                const box = parseRange(range, used);
                const read = opts.view
                    ? readViewCells(requireGrid(), box, !!opts.raw)
                    : readSheetCellsUnbounded(sheet, box, !!opts.raw);
                const text = "# " + (ctx.getFileName() || "Workbook") + " — " + sheet.name + " "
                    + rangeText(box) + "\n\n" + toMarkdown(read) + "\n";
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path: path, sheet: sheet.name, range: rangeText(box), rows: read.rows.length, chars: text.length };
            },

            // ── driving the grid ────────────────────────────────────────────────────────────

            goToSheet(name) {
                const wb = requireWorkbook();
                const sheetName = String(name);
                if (wb.SheetNames.indexOf(sheetName) < 0) {
                    throw new Error('This workbook has no sheet named "' + sheetName + '". It has: '
                        + wb.SheetNames.map((n) => '"' + n + '"').join(", ") + ".");
                }
                if (sheetName === ctx.getActiveSheet()) {
                    return { sheet: sheetName, changed: false, note: "Already the active sheet." };
                }
                ctx.showSheet(sheetName);
                const grid = ctx.getGrid();
                return {
                    sheet: sheetName,
                    changed: true,
                    hasGrid: !!(grid && !grid.isDestroyed()),
                    rowCount: grid && !grid.isDestroyed() ? grid.getState().rowCount : 0,
                    note: "A tab switch rebuilds the grid, so the previous sheet's sort, filters, "
                        + "search and selection are gone — they belonged to that sheet.",
                };
            },

            setSearch(text) {
                const grid = requireGrid();
                const value = text == null ? "" : String(text);
                ctx.setSearchText(value);
                return {
                    search: value || null,
                    rowCount: grid.getState().rowCount,
                    totalRowCount: grid.getState().sourceRowCount,
                    note: value
                        ? "Every whitespace-separated word must appear somewhere in a row; the "
                            + "words are highlighted inside the cells."
                        : "Search cleared.",
                };
            },

            setSort(column, direction) {
                const grid = requireGrid();
                if (column === null || column === undefined || column === "") {
                    grid.setSort(undefined);
                    return { sort: null, note: "Sort cleared; rows are back in sheet order." };
                }
                const letter = parseColumn(column, "to sort by");
                const key = keyOfLetter(letter);
                if (!dataColumns(grid).some((c) => c.key === key)) {
                    throw new Error("Column " + letter + " is not in this sheet.");
                }
                const dir = direction === null || direction === undefined ? "asc" : String(direction).toLowerCase();
                if (dir !== "asc" && dir !== "desc") {
                    throw new Error('Direction must be "asc" or "desc"; got ' + JSON.stringify(direction) + ".");
                }
                grid.setSort({ key: key, direction: dir });
                return {
                    sort: { column: letter, direction: dir },
                    rowCount: grid.getState().rowCount,
                    note: "Sorted on the UNDERLYING values, so numbers order numerically and dates "
                        + "by instant — not by the text on screen.",
                };
            },

            setFilter(column, values) {
                const grid = requireGrid();
                const letter = parseColumn(column, "to filter");
                const key = keyOfLetter(letter);
                if (!dataColumns(grid).some((c) => c.key === key)) {
                    throw new Error("Column " + letter + " is not in this sheet.");
                }
                if (values === null || values === undefined
                    || (Array.isArray(values) && values.length === 0)) {
                    grid.removeFilter(key);
                    return { column: letter, filter: null, rowCount: grid.getState().rowCount,
                             note: "Filter removed from column " + letter + "." };
                }
                const list = (Array.isArray(values) ? values : [values]).map((v) => (v == null ? "" : String(v)));
                grid.applyFilter({ columnKey: key, value: list });

                const rowCount = grid.getState().rowCount;
                // The one failure that looks like a bug: the values were the UNDERLYING ones, so
                // they match no displayed text and the grid goes empty with no complaint. Check it
                // and say so, rather than letting the agent conclude the data is missing.
                let note;
                if (rowCount === 0) {
                    const sheet = requireSheet();
                    const known = new Set(columnValues(sheet, letter).map((v) => v.value));
                    const unknown = list.filter((v) => !known.has(v));
                    note = unknown.length > 0
                        ? "NOTHING MATCHED. These values are not among column " + letter + "'s "
                            + "displayed values: " + unknown.map((v) => JSON.stringify(v)).join(", ")
                            + ". Filters match the text the cell SHOWS (e.g. \"$19.50\", not 19.5) — "
                            + "call getColumnValues(" + JSON.stringify(letter) + ") for the list that works."
                        : "No rows match — another column's filter is excluding them all.";
                } else {
                    note = "Filters match the DISPLAYED text of a cell.";
                }
                return {
                    column: letter,
                    filter: { column: letter, values: list },
                    rowCount: rowCount,
                    totalRowCount: grid.getState().sourceRowCount,
                    note: note,
                };
            },

            clearFilters() {
                const grid = requireGrid();
                grid.clearFilters();
                return { filters: [], rowCount: grid.getState().rowCount, note: "All column filters removed." };
            },

            selectRange(range) {
                const grid = requireGrid();
                if (range === null || range === undefined || range === "") {
                    grid.clearFocus();
                    return { selection: null, note: "Selection cleared." };
                }
                const sheet = requireSheet();
                const box = parseRange(range, requireUsedRange(sheet));

                // Columns: indices into the grid's CURRENT order, which the user may have changed.
                const letters = [];
                for (let c = box.s.c; c <= box.e.c; c++) letters.push(colLetter(c));
                const colIdx = letters.map((l) => gridColIndex(grid, l));
                const minCol = Math.min.apply(null, colIdx);
                const maxCol = Math.max.apply(null, colIdx);
                if (maxCol - minCol + 1 !== letters.length) {
                    throw new Error("Columns " + letters.join(", ") + " are not next to each other "
                        + "in the current column order (" + dataColumns(grid).map((c) => letterOfKey(c.key)).join(", ")
                        + "). A grid selection is a rectangle on screen, so it cannot span a gap. "
                        + "Reset the order with setColumnOrder(null) first, or select a block that is contiguous.");
                }

                // Rows: display indices, which move under a sort and vanish under a filter.
                const rowIdx = [];
                const missing = [];
                for (let r = box.s.r; r <= box.e.r; r++) {
                    const index = displayIndexOfRow(grid, r + 1);
                    if (index < 0) missing.push(r + 1);
                    else rowIdx.push(index);
                }
                if (missing.length > 0) {
                    throw new Error("Row" + (missing.length === 1 ? " " : "s ") + missing.slice(0, 10).join(", ")
                        + (missing.length > 10 ? ", …" : "") + " cannot be selected: the current "
                        + "filters are hiding them. Call clearFilters() first.");
                }
                const minRow = Math.min.apply(null, rowIdx);
                const maxRow = Math.max.apply(null, rowIdx);
                if (maxRow - minRow + 1 !== rowIdx.length) {
                    throw new Error("Rows " + (box.s.r + 1) + "–" + (box.e.r + 1) + " are not next "
                        + "to each other on screen: the current sort has moved them apart. A grid "
                        + "selection is a rectangle on screen. Call setSort(null) to restore sheet order.");
                }

                grid.selectRange(minRow, minCol, maxRow, maxCol);
                return { selection: describeSelection(grid), note: "Selected — call scrollTo(range) "
                    + "or use showCells(range) to bring it into view as well." };
            },

            clearSelection() {
                const grid = requireGrid();
                grid.clearFocus();
                return { selection: null, note: "Selection cleared." };
            },

            scrollTo(range) {
                const grid = requireGrid();
                const sheet = requireSheet();
                const box = parseRange(range, requireUsedRange(sheet));
                const rowIndex = displayIndexOfRow(grid, box.s.r + 1);
                if (rowIndex < 0) {
                    throw new Error("Row " + (box.s.r + 1) + " is not on screen: the current filters "
                        + "are hiding it. Call clearFilters() first.");
                }
                const colIndex = gridColIndex(grid, colLetter(box.s.c));
                grid.scrollToCell(rowIndex, colIndex);
                return { scrolledTo: colLetter(box.s.c) + (box.s.r + 1), sheet: sheet.name };
            },

            showCells(range) {
                const selected = app.selectRange(range);
                const scrolled = app.scrollTo(range);
                return {
                    selection: selected.selection,
                    scrolledTo: scrolled.scrolledTo,
                    note: "Selected and scrolled into view — the user can see what you are pointing at.",
                };
            },

            setColumnOrder(columns) {
                const grid = requireGrid();
                const all = grid.getColumns().slice();
                const status = all.filter((c) => c.isStatusColumn);
                const data = all.filter((c) => !c.isStatusColumn);

                let ordered;
                if (columns === null || columns === undefined) {
                    // Back to spreadsheet order — the state the grid was built in.
                    ordered = data.slice().sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
                } else {
                    const list = Array.isArray(columns) ? columns : [columns];
                    const letters = list.map((l) => parseColumn(l));
                    const seen = new Set();
                    ordered = [];
                    for (const letter of letters) {
                        const key = keyOfLetter(letter);
                        if (seen.has(key)) throw new Error("Column " + letter + " is listed twice.");
                        const col = data.find((c) => c.key === key);
                        if (!col) {
                            throw new Error("Column " + letter + " is not in this sheet. It has: "
                                + data.map((c) => letterOfKey(c.key)).join(", ") + ".");
                        }
                        seen.add(key);
                        ordered.push(col);
                    }
                    // Anything not named keeps its current relative order, after the named ones —
                    // so "put C and A first" is one call, not a full enumeration.
                    for (const col of data) if (!seen.has(col.key)) ordered.push(col);
                }

                // The selection is INDEX-based on columns, so a reorder leaves it pointing at
                // different cells — measured: a 3-column selection became a 1-column one. Drop it
                // rather than leave the user with a selection that silently moved.
                const had = !!grid.getSelection();
                grid.setColumns(status.concat(ordered));
                if (had) grid.clearFocus();

                return compact({
                    columnOrder: ordered.map((c) => letterOfKey(c.key)),
                    selectionCleared: had || undefined,
                    note: "Sort and filters survive a reorder"
                        + (had ? "; the selection does not, so it was cleared." : ".")
                        + " setColumnOrder(null) restores spreadsheet order.",
                });
            },

            moveColumn(column, before) {
                const grid = requireGrid();
                const letter = parseColumn(column, "to move");
                const current = dataColumns(grid).map((c) => letterOfKey(c.key));
                if (current.indexOf(letter) < 0) {
                    throw new Error("Column " + letter + " is not in this sheet. It has: " + current.join(", ") + ".");
                }
                const rest = current.filter((l) => l !== letter);
                if (before === null || before === undefined || before === "") {
                    return app.setColumnOrder(rest.concat([letter]));
                }
                const target = parseColumn(before, "to move in front of");
                const at = rest.indexOf(target);
                if (at < 0) {
                    throw new Error("Column " + target + " is not in this sheet (or is the column "
                        + "being moved). It has: " + current.join(", ") + ".");
                }
                rest.splice(at, 0, letter);
                return app.setColumnOrder(rest);
            },

            async copySelection(mode) {
                const grid = requireGrid();
                if (!grid.getSelection()) {
                    throw new Error("Nothing is selected. Call selectRange(range) first.");
                }
                const ok = await grid.copySelection(mode || "copy");
                return {
                    copied: ok,
                    mode: mode || "copy",
                    note: ok
                        ? "The selection is on the system clipboard."
                        : "The clipboard refused the write — this usually means the window does not "
                            + "have OS focus. Use getSelectionText() to read the same text directly.",
                };
            },

            async reload() {
                await ctx.reload();
                return {
                    sheet: ctx.getActiveSheet() || undefined,
                    note: "Re-read from disk. The sort, filters, search and selection are gone.",
                };
            },

            openRangePage(range, options) {
                const read = readCells(range, options);
                const title = (ctx.getFileName() || "Workbook") + " — " + read.sheet + " " + rangeText(read.box);
                const note = truncationNote(read);
                return P.openContent({
                    editor: "md-view",
                    language: "markdown",
                    title: title,
                    content: "# " + title + "\n\n" + toMarkdown(read) + (note ? "\n\n> " + note : "") + "\n",
                });
            },
        };

        /** The unbounded read behind saveCsv / saveMarkdown. Deliberately separate from
         *  readSheetCells so the MAX_CELLS bound can never be forgotten on the call that returns
         *  its result to the agent. */
        function readSheetCellsUnbounded(sheet, box, raw) {
            const letters = [];
            for (let c = box.s.c; c <= box.e.c; c++) letters.push(colLetter(c));
            const rows = [];
            for (let r = box.s.r; r <= box.e.r; r++) {
                const cells = [];
                for (let c = box.s.c; c <= box.e.c; c++) {
                    const cell = cellAt(sheet.ws, r, c);
                    cells.push(raw ? rawOf(cell) : displayOf(cell));
                }
                rows.push({ row: r + 1, cells: cells });
            }
            return { letters: letters, rows: rows, truncated: false, totalRows: rows.length };
        }

        let remote = null;

        return {
            register() {
                remote = aiVision.expose(app);
            },
            /** A different workbook (or a reload): every cache belongs to the previous file. */
            workbookChanged() {
                valuesCache.clear();
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
            /** A sheet switch. The workbook caches stay valid (they are keyed by sheet), but the
             *  shape's summary values — active sheet, row count — have all changed. */
            sheetChanged() {
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
        };
    };
})();
