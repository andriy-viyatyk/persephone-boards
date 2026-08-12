# What's New — Excel Viewer

One line per change, newest first. Keep it short. Record pending changes under a heading for
the **next version** you'll release (the version `board-manifest.json` will be bumped to).

## 1.1.1

- **Large workbooks open ~45% faster.** A 20.5 MB / 124k-row file went from ~10.9 s to ~6.0 s,
  and switching sheets from ~2.0 s to ~0.4 s.
- Workbooks over 4 MB now parse only the sheet you're looking at; the others are parsed the first
  time you open them.

## 1.1.0

- Rebuilt on the **av-grid** renderer (replacing Tabulator) — a smaller, faster grid that follows
  the app theme with no skin file.
- **Dates and numbers now sort correctly.** Sorting reads each cell's real value instead of its
  displayed text, so a date column orders by date and `100` no longer lands before `12`.
- **Column filters are now a searchable checklist** of the column's distinct values (cascading
  with the other columns' filters), with removable filter chips above the grid.
- **New: a Search box** in the toolbar — filters rows across every column at once, and highlights
  the words you searched for inside the cells.
- Ctrl+Shift+C copies the selection with the column letters as a header row.
- Right-click adds **Copy as…** — With Headers, JSON, or a formatted HTML table.

## 1.0.2

- Added a catalog screenshot, shown on the board's card in Persephone's Search boards tab.

## 1.0.1

- Toolbar and grid-header chrome now follows Persephone's own theme chrome color (Persephone 4.0.16+; unchanged look on older versions), with softer hover highlights.

## 1.0.0
- Read-only viewer for Excel spreadsheets (`.xlsx` and legacy `.xls`), one tab per worksheet.
- Excel-style grid: column-letter headers, row numbers, formatted cell values (dates, numbers,
  cached formula results).
- Column sorting (numeric-aware), per-column filtering, and spreadsheet-style range selection.
- Copy the selected cell/range as TSV — via right-click **Copy** or Ctrl/Cmd+C.
- Handles large sheets smoothly via virtualized rendering.
