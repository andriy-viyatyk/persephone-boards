// SQLite Viewer board — the AiVision agent surface.
//
// Why this exists: an agent asked about a SQLite database on screen could only read it by shelling
// out to a sqlite3 binary the user may not have, or by guessing at an accessibility snapshot of a
// virtualized grid. It never needed to. This board already holds a warm, read-only connection to
// the database (a resident node:sqlite server) AND a live av-grid showing one result of it. This
// file publishes both at `pages[pageId].editor.app`.
//
// Four things shaped the design:
//
//   1. **Two different sources of truth, and they answer different questions.** The DATABASE
//      answers everything — any table, any join, any aggregate — through `query(sql)`, which
//      returns rows to the agent and does NOT touch the screen. The GRID holds ONE result as the
//      user is currently looking at it: sorted, filtered, searched, with a selection and a column
//      order. Data questions go to the database; view state and every action go to the grid.
//      `runQuery(sql)` is the deliberate bridge — it puts a query on the user's screen.
//   2. **SQL is the read API, and that changes the shape of this surface.** Unlike the spreadsheet
//      boards, there is no point in a rich cell-range reader: an agent that can write SELECT can
//      already project, filter, join and aggregate far better than any options bag. So the reading
//      half is thin (`query`, `getTables`, `getSchema`) and the driving half is where the detail
//      is. The connection is opened **readOnly** by the server, so no SQL an agent sends can
//      change the file — that is enforced at the SQLite level, not by inspecting the statement.
//   3. **Addressing is what the user sees: result row numbers and column names.** The rail down
//      the left of the grid shows a 1-based position in the RESULT, and that number is this
//      surface's row address everywhere — it survives sorting and filtering, which display indices
//      do not. Columns are addressed by name. Since `SELECT a.x, b.x` legitimately returns two
//      columns called `x`, a name that is ambiguous is refused and `"#3"` (1-based position in the
//      result) is offered instead. The grid's own vocabulary — keys like `c2`, display indices
//      that move under a sort — is internal and never crosses this boundary.
//   4. **Values come back RAW, unlike the spreadsheet boards.** A SQL NULL is not the empty string
//      and an agent must be able to tell them apart, so `query` and `getRows` return `null` as
//      `null` and numbers as numbers. The grid SHOWS a null as the literal text "NULL", and
//      av-grid filters and searches against displayed text — so `setFilter` wants "NULL", which is
//      what `getColumnValues` hands back. That is the one place the two representations differ and
//      it is signposted at every call that touches it.
//
// Everything here is READ-ONLY with respect to the database. The grid is not `editable`, the
// connection is readOnly, and the save* methods write NEW files at a path the agent names.
(() => {
    const SA = (window.SQLiteAI = window.SQLiteAI || {});

    // Bound on the cells one call may return. The server already caps a result at 20,000 rows, and
    // 20,000 rows of 27 columns would blow any result budget; a read truncates and says so rather
    // than failing, and points at saveCsv() for the whole thing.
    const MAX_CELLS = 20000;

    const HELP = `This is a SQLite database (.db / .sqlite / .sqlite3 / .db3) open in the SQLite
Viewer board. It holds a warm, READ-ONLY connection, so you can query it directly - no sqlite3
binary, no external tool, and nothing you send can modify the file.

Start with getStats(). It reports the database file, every table and view with its row count and
columns, and the state of the grid on screen.

ASKING THE DATABASE. query(sql) runs any SELECT and returns the rows TO YOU without changing what
the user is looking at. That is the main read, and SQL is the whole API: project, join, filter,
group and aggregate in the statement rather than reading rows and post-processing them. getTables()
lists the tables and views; getSchema(name) gives the CREATE statement and the column definitions.
A result is bounded, so for something large use saveCsv(path, sql) and read the file.

Values come back RAW: a SQL NULL is null, a number is a number. BLOBs are replaced with a
"[BLOB n bytes]" placeholder by the server - binary never crosses to the page.

PUTTING A QUERY ON SCREEN. runQuery(sql) types the statement into the board's SQL box and runs it,
so the user sees the result you are talking about. openTable(name) is the shortcut the sidebar uses
(SELECT * FROM the table, limited). Both replace what is on screen.

DRIVING THE GRID. getView() reports everything about the current view in one call. Then:
setSearch(text) drives the toolbar search box; setSort(column, direction) sorts; setFilter(column,
values) filters; selectRange(fromRow, toRow, fromColumn, toColumn) selects cells and
scrollTo(row, column) brings them into view; setColumnOrder / moveColumn reorder the columns;
highlightText(text) marks words in place WITHOUT hiding any rows.

ROWS AND COLUMNS. A row is addressed by the number in the rail down the left of the grid - its
1-based position in the RESULT, which does not move when the user sorts or filters. A column is
addressed by name; when a result has two columns of the same name, use "#3" for the third column
of the result instead.

FILTER VALUES ARE THE DISPLAYED TEXT, NOT THE RAW VALUE. The grid shows a NULL as the word "NULL",
so setFilter(column, ["NULL"]) is how you filter to the null rows - null itself matches nothing.
Call getColumnValues(column) for the exact strings that will work, and pass those.

SHOWING THE USER. showRange(...) selects a block of cells and scrolls it into view - that is how
you point at what you are talking about. highlightText(text) is the other pointer: it marks the
words wherever they appear without removing any rows, which setSearch would.

Paths passed to saveCsv and saveMarkdown must be ABSOLUTE.`;

    const MEMBERS = [
        { name: "fileName", kind: "property", summary: "Name of the open database file." },
        { name: "filePath", kind: "property", summary: "Absolute path of the open database on disk." },
        { name: "isLoaded", kind: "property", summary: "Whether a database is open and its query server is running." },
        { name: "tableNames", kind: "property", summary: "Every table and view in the database, by name." },
        { name: "sql", kind: "property", summary: "The text in the board's SQL box. Assigning types it in WITHOUT running it - call runQuery(sql) to run.", writable: true },
        { name: "rowCount", kind: "property", summary: "Rows in the result currently on screen (before any grid filter)." },

        { name: "getStats", kind: "method", signature: "getStats()", summary: "What this database is: every table and view with its row count and columns, plus the query on screen and the state of the grid. Read this first." },
        { name: "getTables", kind: "method", signature: "getTables()", summary: "The tables and views with their row counts and column names. A virtual table whose module is not loaded reports rowCount: null rather than failing." },
        { name: "getSchema", kind: "method", signature: "getSchema(name?)", summary: "The CREATE statement and column definitions (type, notnull, default, primary key) for one table or view - or for all of them when name is omitted." },
        { name: "query", kind: "method", signature: "query(sql, options?)", summary: "Run SQL and return the rows TO YOU, leaving the screen alone. This is the main read. Options: { format: 'rows' | 'markdown' | 'csv', maxCells }. Values come back raw - a SQL NULL is null.", caution: "runs the SQL you give it against the database; the connection is read-only, so it cannot modify the file" },
        { name: "getRows", kind: "method", signature: "getRows(options?)", summary: "The result already on screen, without re-running it. Options: { view, fromRow, toRow, columns, format, display }. Default is the whole result as the query returned it; { view: true } is what the grid is showing, in display order, after the current sort and filters." },
        { name: "getColumnValues", kind: "method", signature: "getColumnValues(column)", summary: "The distinct DISPLAYED values of one column of the result, with a count of each. THESE ARE THE STRINGS setFilter WANTS - call this before filtering. A null shows up here as \"NULL\"." },
        { name: "getView", kind: "method", signature: "getView()", summary: "Everything about the view the user is looking at, in one call: the query, the columns in display order, sort, filters, search text, highlight, selected cells, and how many rows the filters are hiding." },
        { name: "getSelectionText", kind: "method", signature: "getSelectionText(mode?)", summary: "The selected cells as text, without touching the clipboard. Mode: 'copy' (TSV, default), 'copyWithHeaders', 'copyAsJson', 'copyAsHtmlTable'." },

        { name: "saveCsv", kind: "method", signature: "saveCsv(path, sql?)", summary: "Write a result to a CSV file at an absolute path you name - the query you pass, or the result on screen. No size bound: use this instead of query() for something too large to receive in one call.", caution: "writes a new file to disk" },
        { name: "saveMarkdown", kind: "method", signature: "saveMarkdown(path, sql?)", summary: "Write a result to a Markdown table file at an absolute path you name.", caution: "writes a new file to disk" },

        { name: "runQuery", kind: "method", signature: "runQuery(sql)", summary: "Put SQL in the board's query box and run it, so the USER sees the result. Replaces what is on screen, including its sort, filters and selection.", caution: "changes what the user is looking at; runs the SQL you give it (the connection is read-only)" },
        { name: "openTable", kind: "method", signature: "openTable(name)", summary: "Browse a table or view on screen - the same thing the user does by clicking it in the Tables sidebar (SELECT * FROM it, limited to 1000 rows).", caution: "changes what the user is looking at" },
        { name: "stopQuery", kind: "method", signature: "stopQuery()", summary: "Cancel a query that is still running, as the Stop button does. SQLite has no cross-process cancel, so this restarts the query server.", caution: "kills and respawns the query server" },
        { name: "setSearch", kind: "method", signature: "setSearch(text)", summary: "Type into the board's toolbar search box. Every whitespace-separated word must appear somewhere in a row, and the words are marked inside the cells. Pass '' to clear. This HIDES rows - use highlightText to mark without hiding.", caution: "changes what the user is looking at" },
        { name: "highlightText", kind: "method", signature: "highlightText(text)", summary: "Mark words wherever they appear in the grid WITHOUT hiding any rows - the pointer for words that came from somewhere other than this grid. Pass '' to clear.", caution: "changes what the user is looking at" },
        { name: "setSort", kind: "method", signature: "setSort(column, direction = 'asc')", summary: "Sort by a column, 'asc' or 'desc'. Sorting reads the RAW values, so a numeric column orders numerically and nulls group at the ascending end. Pass null to clear the sort.", caution: "changes what the user is looking at" },
        { name: "setFilter", kind: "method", signature: "setFilter(column, values)", summary: "Filter a column to the given values - pass the DISPLAYED text, from getColumnValues() (a null is \"NULL\"). A string or an array. Pass null to remove this column's filter.", caution: "changes what the user is looking at" },
        { name: "clearFilters", kind: "method", signature: "clearFilters()", summary: "Remove every column filter.", caution: "changes what the user is looking at" },
        { name: "selectRange", kind: "method", signature: "selectRange(fromRow, toRow, fromColumn?, toColumn?)", summary: "Select a block of cells, as a click-and-drag would. Rows are result row numbers (the rail down the left); omit the columns to take the whole width.", caution: "changes what the user is looking at" },
        { name: "clearSelection", kind: "method", signature: "clearSelection()", summary: "Drop the current cell selection.", caution: "changes what the user is looking at" },
        { name: "scrollTo", kind: "method", signature: "scrollTo(row, column?)", summary: "Scroll a cell into the visible area without changing the selection.", caution: "changes what the user is looking at" },
        { name: "showRange", kind: "method", signature: "showRange(fromRow, toRow, fromColumn?, toColumn?)", summary: "Select a block of cells AND scroll it into view - this is how you point the user at what you are talking about.", caution: "changes what the user is looking at" },
        { name: "setColumnOrder", kind: "method", signature: "setColumnOrder(columns)", summary: "Reorder the grid's columns. Give the column names in the order you want; any you leave out keep their relative order after the ones you named. Pass null to restore the order the query returned.", caution: "changes what the user is looking at; drops the current selection" },
        { name: "moveColumn", kind: "method", signature: "moveColumn(column, before?)", summary: "Move one column in front of another ('move price before qty'). Omit `before` to move it to the end.", caution: "changes what the user is looking at; drops the current selection" },
        { name: "copySelection", kind: "method", signature: "copySelection(mode?)", summary: "Put the selected cells on the SYSTEM clipboard, as Ctrl+C does. Often refused when the window does not have OS focus - use getSelectionText() to read it yourself.", caution: "writes to the system clipboard" },
        { name: "reload", kind: "method", signature: "reload()", summary: "Re-open the database from disk, in case it changed outside the app. It re-runs nothing, so the result on screen stays as it was and is now stale - re-run it with runQuery(sql) to see the new data.", caution: "reopens the database; a query still running is killed" },
        { name: "openResultPage", kind: "method", signature: "openResultPage(options?)", summary: "Open the result on screen as a Markdown table in a new Persephone page, to show the user what you read.", caution: "opens a new page" },
    ];

    SA.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, databaseChanged() {}, resultChanged() {} };

        // The highlight, tracked here because av-grid's `getState()` does NOT report
        // `highlightString` (measured — `searchString` is in the snapshot, this one is not). Each
        // result builds a brand-new grid with no options carried over, so it resets with the grid.
        let highlight = "";

        // ── small helpers ───────────────────────────────────────────────────────────────────

        /** Drop keys whose value is undefined. An undefined field does not survive the trip to the
         *  agent as an absent one — it arrives as an explicit `null`, which reads as "the answer is
         *  nothing" rather than "this does not apply". Every result goes through here. */
        function compact(obj) {
            for (const key of Object.keys(obj)) {
                if (obj[key] === undefined) delete obj[key];
            }
            return obj;
        }

        /** The text the grid SHOWS for a value — the projection av-grid's search, filters and
         *  column funnels all match against. Must stay identical to `formatValue` in app.js. */
        function displayText(value) {
            return value == null ? "NULL" : String(value);
        }

        function quoteIdent(name) {
            return '"' + String(name).replace(/"/g, '""') + '"';
        }

        function requireOpen() {
            if (!ctx.isOpen()) {
                throw new Error("No database is open in this board yet.");
            }
        }

        function requireResult() {
            requireOpen();
            const res = ctx.getResult();
            if (!res) {
                throw new Error("No query has been run yet — there is nothing on screen. "
                    + "Run one with runQuery(sql), or browse a table with openTable(name).");
            }
            return res;
        }

        /** The grid is DESTROYED and rebuilt on every result, and is absent before the first query
         *  and for a result with no columns — so it is looked up live on every call, never held. */
        function requireGrid() {
            const grid = ctx.getGrid();
            if (!grid || grid.isDestroyed()) {
                requireOpen();
                throw new Error("There is no grid on screen. Run a query with runQuery(sql), or "
                    + "browse a table with openTable(name).");
            }
            return grid;
        }

        function requireAbsolutePath(path, what) {
            if (typeof path !== "string" || path.trim() === "") {
                throw new Error("The " + what + " path is required and must be a string.");
            }
            const absolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
            if (!absolute) {
                throw new Error("The " + what + " path must be ABSOLUTE (e.g. C:\\temp\\out.csv); "
                    + '"' + path + '" is relative and would land inside the board folder.');
            }
            return path;
        }

        // ── columns ─────────────────────────────────────────────────────────────────────────
        // A result column's identity is its POSITION, because SQL lets two columns share a name
        // (`SELECT a.x, b.x`). The grid key encodes that position — "c2" is the third column of the
        // result — and stays correct no matter how the user reorders the grid. The name is a label.

        function keyOfPosition(position) {
            return "c" + (position - 1);
        }

        function positionOfKey(key) {
            return Number(String(key).slice(1)) + 1;
        }

        /**
         * Resolve a column reference to its result position (1-based).
         *
         * Accepts the name shown in the header, a number, or "#3" — because a name is what an agent
         * naturally has and a position is what a duplicate name forces it to fall back to. An
         * ambiguous name is REFUSED with the positions that would disambiguate it, rather than
         * silently picking the first: picking would give a plausible answer about the wrong column.
         */
        function resolveColumn(ref) {
            const res = requireResult();
            const names = res.columns || [];

            if (typeof ref === "number") {
                if (!Number.isInteger(ref) || ref < 1 || ref > names.length) {
                    throw new Error("Column position " + ref + " is out of range — this result has "
                        + names.length + " column" + (names.length === 1 ? "" : "s") + ".");
                }
                return ref;
            }

            const text = String(ref == null ? "" : ref).trim();
            if (/^#\d+$/.test(text)) return resolveColumn(Number(text.slice(1)));
            if (text === "") {
                throw new Error("A column is required. This result has: " + names.join(", ") + ".");
            }

            const exact = [];
            const loose = [];
            for (let i = 0; i < names.length; i++) {
                if (names[i] === text) exact.push(i + 1);
                else if (String(names[i]).toLowerCase() === text.toLowerCase()) loose.push(i + 1);
            }
            const hits = exact.length > 0 ? exact : loose;

            if (hits.length === 1) return hits[0];
            if (hits.length === 0) {
                throw new Error('This result has no column named "' + text + '". It has: '
                    + names.map((n, i) => n + ' (#' + (i + 1) + ")").join(", ") + ".");
            }
            throw new Error('This result has ' + hits.length + ' columns named "' + text
                + '" — at positions ' + hits.map((h) => "#" + h).join(", ")
                + '. Address the one you want by position, e.g. "#' + hits[0] + '".');
        }

        function columnLabel(position) {
            const res = requireResult();
            const name = (res.columns || [])[position - 1];
            return name + " (#" + position + ")";
        }

        /** The grid's columns WITHOUT the row-number rail, in the order they are drawn. `__row` is
         *  an av-grid status column: it is kept out of the focus, the selection and every copy path
         *  on its own, and it is not a result column, so it never appears here. */
        function dataColumns(grid) {
            return grid.getColumns().filter((c) => !c.isStatusColumn);
        }

        /** Grid column index (which INCLUDES the status column) for a result position, as
         *  selectRange and scrollToCell want it. Order-independent: the user may have reordered. */
        function gridColIndex(grid, position) {
            const key = keyOfPosition(position);
            const index = grid.getColumns().findIndex((c) => c.key === key);
            if (index < 0) {
                throw new Error("Column " + columnLabel(position) + " is not in the grid on screen.");
            }
            return index;
        }

        /** Display index of a result row number — its position on screen after the current sort and
         *  filters, which is the only thing selectRange and scrollToCell understand. Returns -1 when
         *  a filter or the search box is hiding that row. */
        function displayIndexOfRow(grid, rowNumber) {
            const visible = grid.getVisibleRows();
            for (let i = 0; i < visible.length; i++) {
                if (visible[i].__row === rowNumber) return i;
            }
            return -1;
        }

        // ── selection ───────────────────────────────────────────────────────────────────────

        /** The selection, described in result terms.
         *
         *  The honest part: a grid selection is a rectangle over DISPLAYED rows, and once a sort or
         *  a filter is applied those rows are not contiguous in the result. So the row numbers are
         *  always listed explicitly, and `fromRow`/`toRow` — the tidy block — are only reported when
         *  the selection really is one contiguous run of the result. Reporting "rows 2 to 10" for a
         *  set of rows a sort scattered would be a lie an agent would act on. */
        function describeSelection(grid) {
            const sel = grid.getSelection();
            if (!sel) return null;

            // getSelection().columns INCLUDES the __row status column when the selection starts at
            // the left edge, even though getSelectionText() correctly drops it. Filter it here so
            // the two agree.
            const positions = sel.columns.filter((c) => !c.isStatusColumn).map((c) => positionOfKey(c.key));
            const rowNumbers = sel.rows.map((r) => r.__row);
            if (positions.length === 0 || rowNumbers.length === 0) return null;

            const names = (requireResult().columns || []);
            const contiguousRows = rowNumbers.every((n, i) => i === 0 || n === rowNumbers[i - 1] + 1);
            const contiguousCols = positions.every((n, i) => i === 0 || n === positions[i - 1] + 1);
            const isBlock = contiguousRows && contiguousCols;

            const out = {
                fromRow: isBlock ? rowNumbers[0] : undefined,
                toRow: isBlock ? rowNumbers[rowNumbers.length - 1] : undefined,
                columns: positions.map((p) => names[p - 1]),
                columnPositions: positions,
                rows: rowNumbers,
                rowCount: rowNumbers.length,
                columnCount: positions.length,
                cellCount: rowNumbers.length * positions.length,
            };
            compact(out);
            if (!isBlock) {
                out.note = "These rows and/or columns are not contiguous in the result — the current "
                    + "sort, filters or column order put them side by side on screen. The row and "
                    + "column lists above are exact; there is no single from/to block for this selection.";
            }
            return out;
        }

        // ── reading rows ────────────────────────────────────────────────────────────────────

        function boundRows(rows, columnCount, maxCells) {
            const cap = Math.max(1, Math.floor((maxCells || MAX_CELLS) / Math.max(1, columnCount)));
            return { rows: rows.slice(0, cap), truncated: rows.length > cap, totalRows: rows.length };
        }

        /** Shape a { columns, rows } pair the way every read returns it: raw values by default,
         *  each row tagged with the result row number the grid's rail shows. */
        function shapeRows(names, rows, options) {
            const opts = options || {};
            const display = !!opts.display;
            const bounded = boundRows(rows, names.length, opts.maxCells);
            return {
                columns: names.slice(),
                rows: bounded.rows.map((entry) => ({
                    row: entry.row,
                    cells: display ? entry.cells.map(displayText) : entry.cells.slice(),
                })),
                rowCount: bounded.rows.length,
                totalRows: bounded.totalRows,
                truncated: bounded.truncated,
            };
        }

        function truncationNote(read, what, maxCells) {
            if (!read.truncated) return undefined;
            return "TRUNCATED: showing the first " + read.rowCount + " of " + read.totalRows
                + " rows (about " + (maxCells || MAX_CELLS) + " cells is the limit for one call). "
                + "Use saveCsv(path" + (what ? ", " + what : "") + ") to write the whole thing to a "
                + "file instead.";
        }

        // ── formatting ──────────────────────────────────────────────────────────────────────

        function escapePipes(text) {
            return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
        }

        /** A Markdown pipe table, with the result row number as the first column — without it a
         *  table lifted out of the middle of a result has no way to say which rows it covers. */
        function toMarkdown(read) {
            const header = ["Row"].concat(read.columns);
            const lines = [
                "| " + header.join(" | ") + " |",
                "| " + header.map(() => "---").join(" | ") + " |",
            ];
            for (const row of read.rows) {
                lines.push("| " + [row.row].concat(row.cells.map((v) => escapePipes(displayText(v)))).join(" | ") + " |");
            }
            return lines.join("\n");
        }

        function csvCell(value) {
            const text = value == null ? "" : String(value);
            return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }

        function toCsv(read) {
            const lines = [["Row"].concat(read.columns).map(csvCell).join(",")];
            for (const row of read.rows) {
                lines.push([row.row].concat(row.cells).map(csvCell).join(","));
            }
            return lines.join("\r\n");
        }

        function formatRead(read, format, note) {
            if (format === "markdown") {
                return compact({ columns: read.columns, rowCount: read.rowCount, totalRows: read.totalRows, markdown: toMarkdown(read), note: note });
            }
            if (format === "csv") {
                return compact({ columns: read.columns, rowCount: read.rowCount, totalRows: read.totalRows, csv: toCsv(read), note: note });
            }
            if (format && format !== "rows") {
                throw new Error('Unknown format "' + format + '". Use "rows" (the default), "markdown" or "csv".');
            }
            return compact(Object.assign({}, read, { note: note }));
        }

        // ── the database ────────────────────────────────────────────────────────────────────

        /** Ask the server, and turn its reply into the shape every read here returns. Deliberately
         *  does NOT go near the grid: this is the path that answers a question without disturbing
         *  the user's screen. */
        async function ask(sql, options) {
            requireOpen();
            const statement = String(sql == null ? "" : sql).trim();
            if (statement === "") throw new Error("A SQL statement is required.");
            const reply = await ctx.ask(statement);
            const names = reply.columns || [];
            const entries = (reply.rows || []).map((cells, i) => ({ row: i + 1, cells: cells }));
            const read = shapeRows(names, entries, options);
            read.sql = statement;
            read.ms = reply.ms;
            // The server's own 20,000-row cap is a different thing from this call's cell bound,
            // and an agent that conflates them would think it had the whole table.
            read.serverTruncated = reply.truncated ? true : undefined;
            return read;
        }

        /** Every row of a result, with no cell bound at all. Deliberately separate from `ask` so
         *  the MAX_CELLS cap can never be forgotten on the call whose entire purpose is the result
         *  that was too big to return. */
        async function askUnbounded(sql) {
            requireOpen();
            const statement = String(sql == null ? "" : sql).trim();
            if (statement === "") throw new Error("A SQL statement is required.");
            const reply = await ctx.ask(statement);
            return {
                sql: statement,
                columns: (reply.columns || []).slice(),
                rows: (reply.rows || []).map((cells, i) => ({ row: i + 1, cells: cells })),
                rowCount: (reply.rows || []).length,
                totalRows: (reply.rows || []).length,
                truncated: false,
                serverTruncated: !!reply.truncated,
            };
        }

        function tableList() {
            return (ctx.getSchemaTables() || []).map((t) => compact({
                name: t.name,
                type: t.type,
                rowCount: t.rows == null ? undefined : t.rows,
                unreadable: t.rows == null ? true : undefined,
                columns: t.columns || undefined,
            }));
        }

        function findTable(name) {
            const wanted = String(name == null ? "" : name).trim();
            const tables = ctx.getSchemaTables() || [];
            let hit = tables.find((t) => t.name === wanted);
            if (!hit) hit = tables.find((t) => String(t.name).toLowerCase() === wanted.toLowerCase());
            if (!hit) {
                throw new Error('This database has no table or view named "' + wanted + '". It has: '
                    + tables.map((t) => t.name).join(", ") + ".");
            }
            return hit;
        }

        // ── the view ────────────────────────────────────────────────────────────────────────

        function describeView() {
            const res = requireResult();
            const grid = ctx.getGrid();
            const live = grid && !grid.isDestroyed() ? grid : null;
            const state = live ? live.getState() : null;
            const names = res.columns || [];

            const view = {
                sql: res.sql,
                ms: res.ms,
                resultRowCount: res.rowCount,
                resultTruncated: res.truncated ? true : undefined,
                // Columns in the order the grid is DRAWING them, each carrying the position it
                // occupies in the result — the two differ the moment anything is reordered.
                columns: live
                    ? dataColumns(live).map((c) => ({ name: names[positionOfKey(c.key) - 1], position: positionOfKey(c.key) }))
                    : names.map((n, i) => ({ name: n, position: i + 1 })),
                visibleRowCount: state ? state.rowCount : undefined,
                hiddenRowCount: state ? res.rowCount - state.rowCount : undefined,
                sort: undefined,
                filters: [],
                searchText: ctx.getSearchText() || undefined,
                highlightText: highlight || undefined,
                selection: live ? describeSelection(live) || undefined : undefined,
            };

            if (live) {
                const sort = live.getSort();
                if (sort && sort.key) {
                    view.sort = { column: names[positionOfKey(sort.key) - 1], position: positionOfKey(sort.key), direction: sort.direction };
                }
                view.filters = live.getFilters().map((f) => ({
                    column: names[positionOfKey(f.columnKey) - 1],
                    position: positionOfKey(f.columnKey),
                    values: Array.isArray(f.value) ? f.value.map((v) => (v && typeof v === "object" && "value" in v ? v.value : v)) : f.value,
                }));
            }
            return compact(view);
        }

        /** The distinct DISPLAYED values of one result column, most frequent first — which is
         *  exactly the checklist the user sees in the header funnel, and exactly what setFilter
         *  matches against. */
        function columnValues(position) {
            const res = requireResult();
            const index = position - 1;
            const counts = new Map();
            for (const cells of res.rows || []) {
                const text = displayText(cells[index]);
                counts.set(text, (counts.get(text) || 0) + 1);
            }
            return Array.from(counts.entries())
                .map(([value, count]) => ({ value: value, count: count }))
                .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
        }

        /** How many of the rows the grid is currently showing contain any of these words, matched
         *  the way av-grid matches them: whitespace-split, case-insensitive, against the DISPLAYED
         *  text of each cell. */
        function countMatches(grid, text) {
            const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
            if (words.length === 0) return { rows: 0, cells: 0 };
            const names = (requireResult().columns || []);
            let rows = 0;
            let cells = 0;
            for (const row of grid.getVisibleRows()) {
                let hit = false;
                for (let i = 0; i < names.length; i++) {
                    const t = displayText(row["c" + i] === undefined ? null : row["c" + i]).toLowerCase();
                    if (words.some((w) => t.indexOf(w) >= 0)) {
                        cells++;
                        hit = true;
                    }
                }
                if (hit) rows++;
            }
            return { rows: rows, cells: cells };
        }

        /** Map a run of result row numbers onto display indices, refusing with the SPECIFIC cause
         *  when the grid cannot draw them as one rectangle. The three causes are genuinely
         *  different problems with different fixes, so naming the wrong one would send an agent
         *  down the wrong path. */
        function rowSpan(grid, fromRow, toRow) {
            const res = requireResult();
            const first = Math.min(fromRow, toRow);
            const last = Math.max(fromRow, toRow);
            if (!Number.isInteger(first) || first < 1 || last > res.rowCount) {
                throw new Error("Rows " + fromRow + "-" + toRow + " are out of range — this result "
                    + "has " + res.rowCount + " row" + (res.rowCount === 1 ? "" : "s") + ".");
            }

            const indices = [];
            for (let n = first; n <= last; n++) {
                const at = displayIndexOfRow(grid, n);
                if (at < 0) {
                    throw new Error("Row " + n + " is not on screen: a filter or the search box is "
                        + "hiding it. Call clearFilters() (and setSearch('')) first, then select.");
                }
                indices.push(at);
            }
            const contiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
            if (!contiguous) {
                throw new Error("Rows " + first + "-" + last + " are not next to each other on "
                    + "screen — the current sort has moved them apart, and a selection is a "
                    + "rectangle of what is DISPLAYED. Call setSort(null) first, then select.");
            }
            return { start: Math.min(indices[0], indices[indices.length - 1]), end: Math.max(indices[0], indices[indices.length - 1]) };
        }

        /** The same, for columns: a span of result positions must be drawn side by side. */
        function colSpan(grid, fromColumn, toColumn) {
            const res = requireResult();
            const fromPos = fromColumn == null ? 1 : resolveColumn(fromColumn);
            const toPos = toColumn == null ? (fromColumn == null ? (res.columns || []).length : fromPos) : resolveColumn(toColumn);
            const first = Math.min(fromPos, toPos);
            const last = Math.max(fromPos, toPos);

            const indices = [];
            for (let p = first; p <= last; p++) indices.push(gridColIndex(grid, p));
            const contiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
            if (!contiguous) {
                throw new Error("Columns " + columnLabel(first) + " to " + columnLabel(last)
                    + " are not next to each other on screen — the columns have been reordered, and "
                    + "a selection is a rectangle of what is DISPLAYED. Call setColumnOrder(null) "
                    + "first, then select.");
            }
            return { start: Math.min(indices[0], indices[indices.length - 1]), end: Math.max(indices[0], indices[indices.length - 1]), fromPos: first, toPos: last };
        }

        function selectionResult(grid, extra) {
            return compact(Object.assign({ selection: describeSelection(grid) || undefined }, extra || {}));
        }

        // ── the published model ─────────────────────────────────────────────────────────────

        const app = {
            aiVision: {
                kind: "SQLiteBoard",
                summary: "The SQLite Viewer board's live model for the open database and the result grid on screen.",
                overview: "Call getStats() first: every table and view, and the state of the view.\n"
                    + "Ask the database with query(sql) — it returns rows to you and leaves the screen alone.\n"
                    + "Put a query on the user's screen with runQuery(sql) or openTable(name).\n"
                    + "Drive the grid like the user does: setSearch, setSort, setFilter, showRange, setColumnOrder.\n"
                    + "Filter values are the DISPLAYED text (a null is \"NULL\") — get them from getColumnValues(column).",
                help: HELP,
                members: MEMBERS,
                summarize: () => {
                    const res = ctx.getResult();
                    const grid = ctx.getGrid();
                    const live = grid && !grid.isDestroyed() ? grid : null;
                    const tables = ctx.getSchemaTables() || [];
                    return compact({
                        kind: "SQLiteBoard",
                        fileName: ctx.getFileName(),
                        filePath: ctx.getFilePath(),
                        isLoaded: ctx.isOpen(),
                        objectCount: tables.length || undefined,
                        sql: res ? res.sql : undefined,
                        resultRowCount: res ? res.rowCount : undefined,
                        // Cheap: read off the live grid, never a scan of the result.
                        visibleRowCount: live ? live.getState().rowCount : undefined,
                        isFiltered: live ? live.getFilters().length > 0 : undefined,
                        hint: "Call getStats() for the tables and the state of the view; query(sql) to read data.",
                    });
                },
            },

            get fileName() { return ctx.getFileName(); },
            get filePath() { return ctx.getFilePath(); },
            get isLoaded() { return ctx.isOpen(); },
            get tableNames() { return (ctx.getSchemaTables() || []).map((t) => t.name); },
            get rowCount() {
                const res = ctx.getResult();
                return res ? res.rowCount : 0;
            },
            get sql() { return ctx.getSql(); },
            set sql(text) { ctx.setSql(text); },

            // ── reading ─────────────────────────────────────────────────────────────────────

            getStats() {
                requireOpen();
                const res = ctx.getResult();
                const grid = ctx.getGrid();
                const live = grid && !grid.isDestroyed() ? grid : null;
                const tables = tableList();
                return compact({
                    fileName: ctx.getFileName(),
                    filePath: ctx.getFilePath(),
                    tableCount: tables.filter((t) => t.type === "table").length,
                    viewCount: tables.filter((t) => t.type === "view").length,
                    tables: tables,
                    onScreen: res
                        ? compact({
                            sql: res.sql,
                            columns: res.columns,
                            rowCount: res.rowCount,
                            truncated: res.truncated ? true : undefined,
                            visibleRowCount: live ? live.getState().rowCount : undefined,
                            sorted: live && live.getSort() ? true : undefined,
                            filtered: live && live.getFilters().length > 0 ? true : undefined,
                            searchText: ctx.getSearchText() || undefined,
                        })
                        : undefined,
                    sqlBox: ctx.getSql() || undefined,
                    queryRunning: ctx.isQueryRunning() ? true : undefined,
                    note: res
                        ? undefined
                        : "No query has been run yet. query(sql) reads without changing the screen; "
                            + "runQuery(sql) puts a result in front of the user.",
                });
            },

            getTables() {
                requireOpen();
                return { tables: tableList() };
            },

            async getSchema(name) {
                requireOpen();
                // sqlite_master is read whole and filtered here rather than interpolating the name
                // into a WHERE clause — there is nothing to quote and nothing to get wrong.
                const master = await ctx.ask(
                    "SELECT type, name, sql FROM sqlite_master "
                    + "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
                );
                const rows = (master.rows || []).map((r) => ({ type: r[0], name: r[1], sql: r[2] }));

                if (name == null) {
                    return { objects: rows.map((r) => compact({ name: r.name, type: r.type, sql: r.sql || undefined })) };
                }

                const table = findTable(name);
                const entry = rows.find((r) => r.name === table.name);
                const info = await ctx.ask("PRAGMA table_info(" + quoteIdent(table.name) + ")");
                return compact({
                    name: table.name,
                    type: table.type,
                    rowCount: table.rows == null ? undefined : table.rows,
                    sql: (entry && entry.sql) || undefined,
                    columns: (info.rows || []).map((r) => compact({
                        position: r[0] + 1,
                        name: r[1],
                        type: r[2] || undefined,
                        notNull: r[3] ? true : undefined,
                        defaultValue: r[4] == null ? undefined : r[4],
                        primaryKey: r[5] ? r[5] : undefined,
                    })),
                });
            },

            async query(sql, options) {
                const opts = options || {};
                const read = await ask(sql, opts);
                const notes = [];
                const bound = truncationNote(read, "sql", opts.maxCells);
                if (bound) notes.push(bound);
                if (read.serverTruncated) {
                    notes.push("The database server stopped at its own 20,000-row cap, so this is "
                        + "not the whole result. Add a LIMIT / WHERE, or aggregate in the SQL.");
                }
                const out = formatRead(read, opts.format, notes.length ? notes.join(" ") : undefined);
                out.sql = read.sql;
                out.ms = read.ms;
                return compact(out);
            },

            getRows(options) {
                const opts = options || {};
                const res = requireResult();
                const names = res.columns || [];

                // Which rows: the whole result as the query returned it (the default), or what the
                // grid is actually showing, in display order, after the current sort and filters.
                let entries;
                if (opts.view) {
                    const grid = requireGrid();
                    entries = grid.getVisibleRows().map((row) => ({
                        row: row.__row,
                        cells: names.map((_n, i) => {
                            const v = row["c" + i];
                            return v === undefined ? null : v;
                        }),
                    }));
                } else {
                    entries = (res.rows || []).map((cells, i) => ({ row: i + 1, cells: cells }));
                }

                // Row numbers always mean the same thing — the number in the rail — whether the
                // rows came from the result or from the screen.
                if (opts.fromRow != null || opts.toRow != null) {
                    const first = opts.fromRow == null ? 1 : Number(opts.fromRow);
                    const last = opts.toRow == null ? res.rowCount : Number(opts.toRow);
                    entries = entries.filter((e) => e.row >= Math.min(first, last) && e.row <= Math.max(first, last));
                }

                // Which columns: a subset, in the order asked for, or all of them.
                let outNames = names.slice();
                if (opts.columns != null) {
                    const list = Array.isArray(opts.columns) ? opts.columns : [opts.columns];
                    const positions = list.map(resolveColumn);
                    outNames = positions.map((p) => names[p - 1]);
                    entries = entries.map((e) => ({ row: e.row, cells: positions.map((p) => e.cells[p - 1]) }));
                }

                const read = shapeRows(outNames, entries, opts);
                const out = formatRead(read, opts.format, truncationNote(read, undefined, opts.maxCells));
                out.sql = res.sql;
                out.view = !!opts.view;
                return compact(out);
            },

            getColumnValues(column) {
                const position = resolveColumn(column);
                const values = columnValues(position);
                return {
                    column: (requireResult().columns || [])[position - 1],
                    position: position,
                    distinctCount: values.length,
                    values: values,
                    note: "These are the DISPLAYED strings, which is what setFilter matches — a SQL "
                        + "null appears here as \"NULL\".",
                };
            },

            getView() {
                return describeView();
            },

            getSelectionText(mode) {
                const grid = requireGrid();
                if (!grid.getSelection()) {
                    throw new Error("Nothing is selected. Call selectRange(fromRow, toRow) first.");
                }
                return grid.getSelectionText(mode || "copy");
            },

            // ── writing files ───────────────────────────────────────────────────────────────

            async saveCsv(path, sql) {
                requireAbsolutePath(path, "CSV");
                // Written with no MAX_CELLS bound — the whole point of saving is the result that
                // was too big to return.
                const read = sql == null
                    ? (() => { const r = requireResult(); return { sql: r.sql, columns: r.columns || [], rows: (r.rows || []).map((cells, i) => ({ row: i + 1, cells: cells })), serverTruncated: !!r.truncated }; })()
                    : await askUnbounded(sql);
                const text = toCsv(read);
                await P.writeFile(path, text, { encoding: "utf8" });
                return compact({
                    path: path,
                    sql: read.sql,
                    rows: read.rows.length,
                    chars: text.length,
                    note: read.serverTruncated
                        ? "The database server stopped at its own 20,000-row cap, so the file is not the whole result."
                        : undefined,
                });
            },

            async saveMarkdown(path, sql) {
                requireAbsolutePath(path, "Markdown");
                const read = sql == null
                    ? (() => { const r = requireResult(); return { sql: r.sql, columns: r.columns || [], rows: (r.rows || []).map((cells, i) => ({ row: i + 1, cells: cells })), serverTruncated: !!r.truncated }; })()
                    : await askUnbounded(sql);
                const text = "# " + (ctx.getFileName() || "Database") + "\n\n```sql\n" + read.sql
                    + "\n```\n\n" + toMarkdown(read) + "\n";
                await P.writeFile(path, text, { encoding: "utf8" });
                return compact({
                    path: path,
                    sql: read.sql,
                    rows: read.rows.length,
                    chars: text.length,
                    note: read.serverTruncated
                        ? "The database server stopped at its own 20,000-row cap, so the file is not the whole result."
                        : undefined,
                });
            },

            // ── putting a query on screen ───────────────────────────────────────────────────

            async runQuery(sql) {
                requireOpen();
                const statement = String(sql == null ? "" : sql).trim();
                if (statement === "") throw new Error("A SQL statement is required.");
                if (ctx.isQueryRunning()) {
                    throw new Error("A query is already running. Wait for it, or call stopQuery().");
                }
                await ctx.run(statement);
                const res = ctx.getResult();
                // runQuery reports what the user can now see. A failed statement leaves the PREVIOUS
                // result on screen (that is the board's own behaviour — an error must not wipe the
                // user's data), so say which query the reported result belongs to.
                if (!res || res.sql !== statement) {
                    // The board deliberately keeps the previous result on screen when a statement
                    // fails — an error must not wipe the user's data — so the only record of what
                    // went wrong is the status line, which the agent cannot see. Carry it out.
                    const status = (ctx.getStatus() || "").trim().replace(/^Error:\s*/, "");
                    throw new Error("The statement did not run"
                        + (status ? ": " + status : " — the board reported no error either.")
                        + " The previous result is still on screen.");
                }
                return compact({
                    sql: res.sql,
                    columns: res.columns,
                    rowCount: res.rowCount,
                    ms: res.ms,
                    truncated: res.truncated ? true : undefined,
                    note: res.truncated
                        ? "Stopped at the server's 20,000-row cap — this is not the whole result."
                        : undefined,
                });
            },

            async openTable(name) {
                requireOpen();
                const table = findTable(name);
                if (ctx.isQueryRunning()) {
                    throw new Error("A query is already running. Wait for it, or call stopQuery().");
                }
                await ctx.openTable(table.name);
                const res = ctx.getResult();
                return compact({
                    table: table.name,
                    type: table.type,
                    sql: res ? res.sql : undefined,
                    rowCount: res ? res.rowCount : undefined,
                    note: "Browsing on screen, limited to 1000 rows. Use query(sql) to read the "
                        + "whole table, or runQuery(sql) to put a different statement on screen.",
                });
            },

            async stopQuery() {
                if (!ctx.isQueryRunning()) {
                    return { stopped: false, note: "No query is running." };
                }
                await ctx.stop();
                return { stopped: true, note: "The query server was restarted; the database is open again." };
            },

            // ── driving the grid ────────────────────────────────────────────────────────────

            setSearch(text) {
                const grid = requireGrid();
                const value = text == null ? "" : String(text);
                ctx.setSearchText(value);
                const state = grid.getState();
                return compact({
                    searchText: value || undefined,
                    visibleRowCount: state.rowCount,
                    hiddenRowCount: requireResult().rowCount - state.rowCount,
                    note: value && state.rowCount === 0
                        ? "No rows match. The search is over the DISPLAYED text of every column and "
                            + "every whitespace-separated word must appear somewhere in the row."
                        : undefined,
                });
            },

            highlightText(text) {
                const grid = requireGrid();
                const value = text == null ? "" : String(text);
                // `highlightString` marks and filters NOTHING — the right tool when the words came
                // from somewhere other than this grid (a query result, something the user asked
                // about). setSearch is the one that also hides rows.
                grid.setOptions({ highlightString: value || undefined });
                highlight = value;
                // Counted from the ROWS, never from the DOM: setOptions schedules a repaint, so a
                // querySelectorAll in this same turn counts the marks from BEFORE the change and
                // reports 0 on a highlight that is about to land perfectly. (Measured.)
                const hits = countMatches(grid, value);
                return compact({
                    highlightText: value || undefined,
                    matchingRows: value ? hits.rows : undefined,
                    matchingCells: value ? hits.cells : undefined,
                    note: value && hits.cells === 0
                        ? "Nothing matched: none of those words appear in the rows the grid is "
                            + "currently showing. A filter or the search box may be hiding them."
                        : undefined,
                });
            },

            setSort(column, direction) {
                const grid = requireGrid();
                if (column == null) {
                    grid.setSort(undefined);
                    return { sorted: false, note: "Sort cleared — the rows are back in result order." };
                }
                const position = resolveColumn(column);
                const dir = String(direction || "asc").toLowerCase();
                if (dir !== "asc" && dir !== "desc") {
                    throw new Error('Direction must be "asc" or "desc"; got "' + direction + '".');
                }
                grid.setSort({ key: keyOfPosition(position), direction: dir });
                return {
                    column: (requireResult().columns || [])[position - 1],
                    position: position,
                    direction: dir,
                    note: "Sorting reads the RAW values, so a numeric column orders numerically and "
                        + "nulls group at the ascending end.",
                };
            },

            setFilter(column, values) {
                const grid = requireGrid();
                const position = resolveColumn(column);
                const key = keyOfPosition(position);
                const name = (requireResult().columns || [])[position - 1];

                if (values == null || (Array.isArray(values) && values.length === 0)) {
                    grid.removeFilter(key);
                    return { column: name, position: position, filtered: false, visibleRowCount: grid.getState().rowCount };
                }

                const list = (Array.isArray(values) ? values : [values]).map((v) => displayText(v));
                grid.applyFilter({ columnKey: key, value: list });
                const rowCount = grid.getState().rowCount;

                // A zero-match filter is almost always the displayed-text trap — diff what was
                // asked for against the column's real values and name the ones that are not there,
                // rather than leaving an empty grid with no explanation.
                let note;
                if (rowCount === 0) {
                    const known = new Set(columnValues(position).map((v) => v.value));
                    const unknown = list.filter((v) => !known.has(v));
                    note = unknown.length > 0
                        ? "NOTHING MATCHED. These values are not among column " + name + "'s displayed "
                            + "values: " + unknown.map((v) => JSON.stringify(v)).join(", ")
                            + ". Filters match the text the cell SHOWS (a SQL null shows as \"NULL\") — "
                            + "call getColumnValues(" + JSON.stringify(name) + ") for the list that works."
                        : "No rows match — another column's filter is excluding them all.";
                }
                return compact({
                    column: name,
                    position: position,
                    values: list,
                    filtered: true,
                    visibleRowCount: rowCount,
                    note: note,
                });
            },

            clearFilters() {
                const grid = requireGrid();
                grid.clearFilters();
                return { filtered: false, visibleRowCount: grid.getState().rowCount };
            },

            selectRange(fromRow, toRow, fromColumn, toColumn) {
                const grid = requireGrid();
                if (fromRow == null) {
                    grid.clearFocus();
                    return { selection: undefined, note: "Selection cleared." };
                }
                const last = toRow == null ? fromRow : toRow;
                const rows = rowSpan(grid, Number(fromRow), Number(last));
                const cols = colSpan(grid, fromColumn, toColumn);
                grid.selectRange(rows.start, cols.start, rows.end, cols.end);
                return selectionResult(grid);
            },

            clearSelection() {
                const grid = requireGrid();
                grid.clearFocus();
                return { selection: undefined, note: "Selection cleared." };
            },

            async scrollTo(row, column) {
                const grid = requireGrid();
                const rows = rowSpan(grid, Number(row), Number(row));
                const position = column == null ? 1 : resolveColumn(column);
                await grid.scrollToCell(rows.start, gridColIndex(grid, position));
                return { row: Number(row), column: (requireResult().columns || [])[position - 1] };
            },

            async showRange(fromRow, toRow, fromColumn, toColumn) {
                const grid = requireGrid();
                const last = toRow == null ? fromRow : toRow;
                const rows = rowSpan(grid, Number(fromRow), Number(last));
                const cols = colSpan(grid, fromColumn, toColumn);
                grid.selectRange(rows.start, cols.start, rows.end, cols.end);
                await grid.scrollToCell(rows.start, cols.start);
                return selectionResult(grid, { scrolledTo: { row: Math.min(Number(fromRow), Number(last)) } });
            },

            setColumnOrder(columns) {
                const grid = requireGrid();
                const res = requireResult();
                const all = grid.getColumns();
                const status = all.filter((c) => c.isStatusColumn);
                const data = all.filter((c) => !c.isStatusColumn);

                let ordered;
                if (columns == null) {
                    // Back to the order the query returned — sort by result position, not by the
                    // order the grid happens to hold them in.
                    ordered = data.slice().sort((a, b) => positionOfKey(a.key) - positionOfKey(b.key));
                } else {
                    const list = Array.isArray(columns) ? columns : [columns];
                    const wanted = list.map(resolveColumn).map(keyOfPosition);
                    const seen = new Set();
                    ordered = [];
                    for (const key of wanted) {
                        if (seen.has(key)) continue;
                        seen.add(key);
                        ordered.push(data.find((c) => c.key === key));
                    }
                    // Anything not named keeps its current relative order, after the named ones.
                    for (const column of data) {
                        if (!seen.has(column.key)) ordered.push(column);
                    }
                }

                // The selection is INDEX-based on columns, so a reorder leaves it pointing at
                // different cells — measured on the sibling board: a 3-column selection became a
                // 1-column one. Drop it rather than leave the user with a selection that moved.
                const had = !!grid.getSelection();
                grid.setColumns(status.concat(ordered));
                if (had) grid.clearFocus();

                const names = res.columns || [];
                return compact({
                    columns: ordered.map((c) => names[positionOfKey(c.key) - 1]),
                    selectionCleared: had ? true : undefined,
                    note: had ? "The selection was cleared: it is column-index based and a reorder would have moved it." : undefined,
                });
            },

            moveColumn(column, before) {
                const grid = requireGrid();
                const moved = keyOfPosition(resolveColumn(column));
                const data = dataColumns(grid).map((c) => c.key).filter((k) => k !== moved);
                if (before == null) {
                    data.push(moved);
                } else {
                    const target = keyOfPosition(resolveColumn(before));
                    if (target === moved) {
                        throw new Error("A column cannot be moved before itself.");
                    }
                    data.splice(data.indexOf(target), 0, moved);
                }
                return app.setColumnOrder(data.map((k) => positionOfKey(k)));
            },

            async copySelection(mode) {
                const grid = requireGrid();
                if (!grid.getSelection()) {
                    throw new Error("Nothing is selected. Call selectRange(fromRow, toRow) first.");
                }
                const ok = await grid.copySelection(mode || "copy");
                return {
                    copied: !!ok,
                    mode: mode || "copy",
                    note: ok
                        ? "On the system clipboard."
                        : "The clipboard refused the write — this usually means the window does not "
                            + "have OS focus. Use getSelectionText() to read the same text directly.",
                };
            },

            async reload() {
                await ctx.reload();
                const res = ctx.getResult();
                return compact({
                    fileName: ctx.getFileName(),
                    sql: res ? res.sql : undefined,
                    // Reload re-opens the CONNECTION; it deliberately does not re-run anything, so
                    // the user keeps the result they were looking at. That result is now STALE — it
                    // was read before the reload — and saying "the view was reset" would be a lie
                    // that hides exactly the thing a reload was called for.
                    note: res
                        ? "Re-opened from disk. The result on screen is still the one read BEFORE "
                            + "the reload — re-run it with runQuery(sql) to see the current data."
                        : "Re-opened from disk. Nothing is on screen yet.",
                });
            },

            openResultPage(options) {
                const read = app.getRows(Object.assign({}, options || {}, { format: "rows" }));
                const title = (ctx.getFileName() || "Database") + " — " + read.rowCount + " rows";
                return P.openContent({
                    editor: "md-view",
                    language: "markdown",
                    title: title,
                    content: "# " + title + "\n\n```sql\n" + read.sql + "\n```\n\n"
                        + toMarkdown(read) + (read.note ? "\n\n> " + read.note : "") + "\n",
                });
            },
        };

        let remote = null;

        return {
            register() {
                remote = aiVision.expose(app);
            },
            /** A different database (or a reload): the tables, and everything derived from them,
             *  belong to the previous file. */
            databaseChanged() {
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
            /** A new result on screen. The columns, the row count and the whole view have changed —
             *  and the grid itself was rebuilt, so it carries none of the old grid's options. */
            resultChanged() {
                highlight = "";
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
        };
    };
})();
