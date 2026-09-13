# What's New

## 1.1.0

- Rebuilt on the **av-grid** renderer (replacing Tabulator) — a smaller, faster grid that follows
  the app theme with no skin file.
- **Numbers now sort as numbers.** Sorting reads each cell's real value instead of its displayed
  text, so `100` no longer lands before `12` and NULLs group together.
- **Column filters are now a searchable checklist** of the column's distinct values (cascading
  with the other columns' filters), with removable filter chips above the grid — replacing the
  per-column text boxes.
- **New: a Search box** in the toolbar — filters rows across every column at once, and highlights
  the words you searched for inside the cells.
- Ctrl+Shift+C copies the selection with the column names as a header row; right-click adds
  **Copy as…** — With Headers, JSON, or a formatted HTML table.
- **An AI agent can now read and drive this board directly.** Ask the assistant about the open
  database and it queries it itself — no sqlite3 tool, and nothing it sends can change the file.
- It can do what you can do: run a query onto your screen, browse a table, search, sort, filter,
  select a block of cells and scroll it into view, and reorder the columns.
- Requires Persephone 5.0.2.

## 1.0.1

- Added a catalog screenshot, shown on the board's card in Persephone's Search boards tab.

## 1.0.0

- Initial release: read-only SQL browser for SQLite databases (.db / .sqlite / .sqlite3 / .db3).
- Tables & views listed in a Persephone sidebar panel with row counts — click to browse.
- Free-form SQL box (Ctrl+Enter to run): full SELECT power incl. JOINs, GROUP BY, and FTS5 MATCH.
- Bundles the sqlite-vec extension (vec0), so vector tables — e.g. mneme index embeddings — are browsable and KNN MATCH queries work.
- Results in a sortable, filterable grid with range selection and TSV copy.
- Runs on Persephone's bundled Node runtime — no Node/Python install needed (requires Persephone 4.0.16).
