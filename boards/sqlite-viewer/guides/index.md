---
title: "SQLite Viewer"
audience: both
summary: "The SQLite Viewer board: what it opens, and how an AI assistant reads and drives the database you have open."
editorId: "board"
---

# SQLite Viewer

SQLite Viewer is a Persephone **board** that opens SQLite databases — `.db`, `.sqlite`,
`.sqlite3` and `.db3`. The tables and views are listed in a **Tables** panel in Persephone's
sidebar with their row counts; the main view has a free-form SQL box and shows each result in a
spreadsheet-style grid, with a row-number rail down the left and the column names as headers.

It is **read-only**, and not by convention: the database is opened with SQLite's own read-only
flag, so an `UPDATE` or `DELETE` typed into the query box fails at the engine rather than being
filtered out by the board.

The SQL engine is Persephone's own bundled Node runtime, so there is nothing to install — no
`sqlite3` binary, no Python. The bundled **sqlite-vec** extension is loaded too, so `vec0` vector
tables (mneme's embeddings, for instance) are queryable, KNN `MATCH` included.

## What you can do

- **Browse** — click a table or view in the Tables panel and it runs `SELECT * FROM` it.
- **Query** — type any SELECT and press **Run** (or Ctrl+Enter). Full SQLite: JOINs, GROUP BY,
  CTEs, window functions, FTS5 `MATCH` with `snippet()`.
- **Stop** — a runaway query can be cancelled; the status line reports it.
- **Sort** — click a header: ascending, then descending, then off. Sorting uses the real values
  behind the cells, so a number column orders numerically and NULLs group together.
- **Filter** — every header has a funnel with a searchable checklist of that column's values.
  Filters cascade against each other, and what you have filtered shows as removable chips above
  the grid.
- **Search** — the toolbar box narrows to rows containing every word you type, and highlights
  those words inside the cells.
- **Select and copy** — click and drag, or Shift+arrows. Ctrl+C copies as TSV (so it pastes back
  into a spreadsheet as cells), Ctrl+Shift+C adds the column names as a header row, and
  right-click offers **Copy as…** JSON or an HTML table.
- **Reorder columns** — drag a header sideways.
- **Reload** — the toolbar button re-opens the file from disk if it changed outside the app. It
  does not re-run your query; press Run again to see the new data.

A NULL shows as a muted italic **NULL**, so it stays distinguishable from an empty string — and
it copies as an empty cell rather than the word. A BLOB is never loaded into the page: it shows as
`[BLOB 1234 bytes]`. Results are capped at 20,000 rows, and the status line says when a result was
cut off.

## Asking an AI assistant about the database

The board publishes a live model of the open database to Persephone's agent layer, so an
assistant can read and drive it directly.

It can **query** it: any SELECT, answered from the same warm connection the board uses, returned
straight to the assistant without changing what you are looking at. It can list the tables and
views, and read any table's CREATE statement and column definitions. Values reach it exactly as
SQLite holds them, so it can tell a NULL from an empty string and compute with the numbers.

It can also **do what you can do**, and you will see it happen:

- run a query onto your screen, or browse a table the way the sidebar does
- type in the search box, or mark words without hiding any rows
- sort a column, or filter one to particular values
- select a block of cells and scroll it into view
- reorder the columns
- stop a query that is taking too long

That middle group is how it points at things. Ask *"which orders have no customer?"* and it can
select exactly those cells, so you can see what it means rather than reading a list of row
numbers.

It can also write a result out to a CSV or Markdown file when it is too big to discuss in a
message, or open it as a new Persephone page to show you what it read.

### What it will not do

- **It cannot change the database.** The connection is read-only at the SQLite level, so no
  statement it sends can write to the file — this is enforced by the engine, not by the board
  inspecting the SQL. Files it writes are new files, at a path it tells you.
- **It cannot select cells that are not next to each other on screen.** A selection is a rectangle
  in the grid, so if a sort, a filter or a reordered column has moved the cells apart, it will say
  so rather than select the wrong ones.
- **It does not see more than 20,000 rows of a result** — the same cap you get. For more than
  that it has to aggregate in the SQL, or write the result to a file.
