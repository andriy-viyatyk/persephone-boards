# What's New — Excel Viewer

One line per change, newest first. Keep it short. Record pending changes under a heading for
the **next version** you'll release (the version `board-manifest.json` will be bumped to).

## 1.0.0
- Read-only viewer for Excel spreadsheets (`.xlsx` and legacy `.xls`), one tab per worksheet.
- Excel-style grid: column-letter headers, row numbers, formatted cell values (dates, numbers,
  cached formula results).
- Column sorting (numeric-aware), per-column filtering, and spreadsheet-style range selection.
- Copy the selected cell/range as TSV — via right-click **Copy** or Ctrl/Cmd+C.
- Handles large sheets smoothly via virtualized rendering.
