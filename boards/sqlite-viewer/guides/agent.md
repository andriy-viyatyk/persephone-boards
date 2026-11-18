---
title: "SQLite Viewer for agents"
audience: agent
summary: "Query and DRIVE an open SQLite database through pages[i].editor.app: any SELECT against a warm read-only connection, plus the SQL box, search, sort, filters, selection and column order the user sees."
---

# SQLite Viewer for agents

The board publishes a live model of the open database at **`pages[pageId].editor.app`**. It holds
a warm, **read-only** connection, so reading it costs nothing extra: **never shell out to a
sqlite3 binary, and never open the file yourself** — that was the workaround this model exists to
remove.

The connection is opened with SQLite's own read-only flag. No statement you send can modify the
file; an `UPDATE` fails with *attempt to write a readonly database*. That is an engine guarantee,
not a filter over your SQL.

## Start here

```js
pages[pageId].editor.app.getStats()
```

Every table and view with its row count and columns, the query currently on screen, and the state
of the grid.

## The two sources, and which one answers your question

| You want | Call | Touches the screen |
|---|---|---|
| Data — anything at all | `query(sql)` | **No.** The answer comes to you |
| The user to SEE a result | `runQuery(sql)` / `openTable(name)` | Yes, it replaces what is on screen |
| What is on screen right now | `getView()` / `getRows({ view: true })` | No |

`query(sql)` is the main read and it is almost always what you want: SQL is the whole API, so
project, join, filter, group and aggregate in the statement rather than pulling rows and
post-processing them. Reach for `runQuery` when the point is to show the user something.

## Reading

| Call | Gives you |
|---|---|
| `query(sql, options?)` | Rows from any SELECT. `{ format: 'rows' \| 'markdown' \| 'csv', maxCells }` |
| `getTables()` | Tables and views with row counts and column names |
| `getSchema(name?)` | The CREATE statement and column definitions — type, notnull, default, primary key |
| `getRows(options?)` | The result already on screen, without re-running it |
| `getColumnValues(column)` | The distinct **displayed** values of one column of the result |
| `getSelectionText(mode?)` | The selected cells as text, without the clipboard |
| `saveCsv(path, sql?)` / `saveMarkdown(path, sql?)` | Write a result to a file — no size bound |

### Values are raw

A SQL `NULL` comes back as `null`, a number as a number. That is the opposite of the spreadsheet
boards, and deliberate: in SQL the difference between `NULL` and `''` carries meaning, so the
model must not flatten it. A BLOB never reaches the page — the server replaces it with a
`"[BLOB 1234 bytes]"` placeholder.

The grid is the exception: it **shows** a null as the literal text `NULL`, and that displayed text
is what searches and filters match against. See below.

### Size

Two different caps, and conflating them will make you think you have a whole table when you do
not:

- The **database server** stops at 20,000 rows per result. A read that hit it says
  `serverTruncated: true` — aggregate in the SQL, or add a `LIMIT`/`WHERE`.
- **One call** returns about 20,000 cells and **truncates rather than failing**, telling you how
  many rows of how many it gave you. For more, use `saveCsv(path, sql)` — that one has no bound —
  and read the file.

## Rows and columns

- A **row** is addressed by the number in the rail down the left of the grid: its 1-based position
  in the **result**. It does not move when the user sorts or filters, which display indices do.
- A **column** is addressed by name. `SELECT a.x, b.x` legitimately returns two columns called
  `x`, so an ambiguous name is **refused**, naming the positions that would resolve it — address
  the one you want as `"#3"`, the third column of the result. `"#n"` is stable under reordering.

## Driving the grid

`getView()` reports the whole view in one call. Then:

| Call | Does |
|---|---|
| `runQuery(sql)` | Type the statement into the box and run it. Replaces the result, its sort, filters and selection |
| `openTable(name)` | What a sidebar click does: `SELECT * FROM` it, limited to 1000 rows |
| `stopQuery()` | Cancel a running query — it restarts the query server |
| `setSearch(text)` | Type in the toolbar search box. `""` clears it. This **hides** rows |
| `highlightText(text)` | Mark words wherever they appear, hiding nothing. `""` clears it |
| `setSort(column, direction)` | `"asc"` / `"desc"`; `setSort(null)` clears |
| `setFilter(column, values)` | Filter to these values; `setFilter(column, null)` removes that column's filter |
| `clearFilters()` | Remove every filter |
| `selectRange(fromRow, toRow, fromColumn?, toColumn?)` | Select cells, as a drag would. Omit the columns for the whole width |
| `scrollTo(row, column?)` | Bring a cell into view without changing the selection |
| `showRange(...)` | Select **and** scroll — this is how you point at something |
| `setColumnOrder(columns)` / `moveColumn(column, before?)` | Reorder; `setColumnOrder(null)` restores result order |
| `copySelection(mode?)` | Put the selection on the system clipboard |
| `reload()` | Re-open the file from disk |

`sql` is a writable property: assigning to it types a statement into the box **without** running
it, for when you want the user to press Run themselves.

### Filter values are the DISPLAYED text

**This is the one that will catch you.** The grid shows a SQL null as the word `NULL`, and
filtering matches what the cell shows — so `setFilter("city", ["NULL"])` is how you filter to the
null rows, and `setFilter("city", [null])` would be matching against the string `"NULL"` anyway.
Numbers are usually safe here (`58.5` displays as `"58.5"`), but do not rely on it.

```js
app.getColumnValues("city")          // → [{ value: "Kyoto", count: 3 }, { value: "NULL", count: 2 }, …]
app.setFilter("city", ["NULL"])      // pass those strings verbatim
```

If you get it wrong, `setFilter` tells you: it checks the values you passed against the column's
real ones and says which are not there, rather than leaving you with an empty grid and no reason.
It also distinguishes that from *another* column's filter excluding everything.

### Selection is a rectangle ON SCREEN

A grid selection is a rectangle of what is displayed, not of the result. So `selectRange` refuses,
with a specific reason, when:

- a **filter or the search box** is hiding one of the rows → `clearFilters()` / `setSearch("")` first
- a **sort** has moved the rows apart → `setSort(null)` first
- a **reordered column** has put a gap between the columns → `setColumnOrder(null)` first

Take the refusal at face value and clear the thing it names; do not select a different range and
hope. The reverse also holds: `getView().selection` reports the exact row numbers and column names
always, and only reports a tidy `fromRow`/`toRow` block when the selection really is one
contiguous run of the result.

**Reordering columns clears the selection.** Sort and filters survive a reorder; the selection is
index-based and would silently end up on different cells, so it is dropped instead.

## Showing the user

`showRange(fromRow, toRow, fromColumn, toColumn)` selects a block and scrolls it into view. That is
the pointer — use it whenever you are talking about specific rows, so the user sees what you mean
instead of decoding row numbers.

`highlightText(text)` is the other one: it marks words wherever they appear and hides nothing,
which is right when the words came from somewhere other than this grid. `setSearch` also filters,
so it is a search, not a highlight.

`openResultPage(options?)` opens the result as a Markdown table in a new Persephone page when you
want to show the user what you read rather than where it is.

## Example results

```text
getStats() -> { fileName, filePath, tableCount, viewCount, tables: [...], onScreen: { sql, columns, rowCount, ... }, note }
getTables() -> { tables: [{ name: "people", type: "table", rowCount: 3, columns: ["name"] }] }
getTables() with an unavailable virtual-table count -> { tables: [{ name: "virtual_data", type: "table", unreadable: true, columns: ["value"] }] }
getSchema("people") -> { name: "people", type: "table", rowCount: 3, sql: "CREATE TABLE people (name TEXT)", columns: [{ position: 1, name: "name", type: "TEXT" }] }
query("SELECT name FROM people") -> { columns: ["name"], rows: [{ row: 1, cells: ["Ada"] }], rowCount: 1, totalRows: 1, sql: "SELECT name FROM people", ms: 1 }
getRows() -> same rows object plus `sql` and `view: false`
getColumnValues("name") -> { column: "name", position: 1, distinctCount: 1, values: [{ value: "Ada", count: 1 }], note: "..." }
getView() -> { sql: "SELECT name FROM people", ms: 1, resultRowCount: 1, columns: [{ name: "name", position: 1 }], visibleRowCount: 1, hiddenRowCount: 0, sort: null, filters: [], ... }
getSelectionText() -> "Ada"
saveCsv() -> "Row,name\r\n1,Ada"
saveMarkdown() -> "# people.db\n\n```sql\nSELECT name FROM people\n```\n\n| Row | name |\n| --- | --- |\n| 1 | Ada |\n"
runQuery("SELECT name FROM people") -> { sql: "SELECT name FROM people", columns: ["name"], rowCount: 1, ms: 1 }
openTable("people") -> { table: "people", type: "table", sql: "SELECT * FROM people LIMIT 1000", rowCount: 3, note: "..." }
stopQuery() -> { stopped: false, note: "No query is running." } or { stopped: true, note: "..." }
setSearch("Ada") -> { searchText: "Ada", visibleRowCount: 1, hiddenRowCount: 0 }
highlightText("Ada") -> { highlightText: "Ada", matchingRows: 1, matchingCells: 1 }
setSort("name", "asc") -> { column: "name", position: 1, direction: "asc", note: "..." }
setFilter("name", ["Ada"]) -> { column: "name", position: 1, values: ["Ada"], filtered: true, visibleRowCount: 1 }
clearFilters() -> { filtered: false, visibleRowCount: 1 }
selectRange(1, 1) -> selection result from `selectionResult()`
clearSelection() -> { selection: undefined, note: "Selection cleared." }
scrollTo(1, "name") -> { row: 1, column: "name" }
showRange(1, 1) -> selection result with `scrolledTo: { row: 1 }`
setColumnOrder(["name"]) -> { columns: ["name"] }
moveColumn("name") -> same result shape as setColumnOrder()
copySelection() -> { copied: true, mode: "copy", note: "..." }
reload() -> { fileName: "people.db", sql: "SELECT name FROM people", note: "..." }
openResultPage() -> return value from Persephone's openContent call for a Markdown page
```

`query()` defaults to the rows object shown above. Table rows use `{ row, cells }`; a missing row count is omitted and represented by `unreadable: true` in `getTables()` when SQLite cannot read it.

## Not features

- **No writing.** The connection is read-only at the SQLite level. `save*` writes **new** files, at
  absolute paths you name (a relative path is refused — it would land inside the board's own folder).
- **No transactions, no PRAGMA that writes, no ATTACH of a writable database** — all of it fails at
  the engine for the same reason.
- **`reload()` re-runs nothing.** It re-opens the connection and leaves the user's result on
  screen, which is then **stale**. Re-run it with `runQuery(sql)` to see current data.
- **A failed `runQuery` leaves the previous result on screen** — the board will not wipe the user's
  data over a typo. The error text comes back to you in the thrown message.
