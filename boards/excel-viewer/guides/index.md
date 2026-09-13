---
title: "Excel Viewer"
audience: both
summary: "The Excel Viewer board: what it opens, and how an AI assistant reads and drives the workbook you have open."
editorId: "board"
---

# Excel Viewer

Excel Viewer is a Persephone **board** that opens Excel workbooks — `.xlsx` and the legacy binary
`.xls`. Each worksheet gets a tab, and the sheet you are on is shown in a spreadsheet-style grid:
column-letter headers, a row-number rail down the left, and each cell showing exactly what Excel
shows — `$19.50`, `1/15/26`, cached formula results.

It is **read-only**. Nothing you do in the board changes the file. To edit one, switch to another
editor from the page toolbar.

## What you can do in the grid

- **Sort** — click a header: ascending, then descending, then off. Sorting uses the real values
  behind the cells, so a number column orders numerically and a date column orders by date.
- **Filter** — every header has a funnel with a searchable checklist of that column's values.
  Filters cascade against each other, and what you have filtered shows as removable chips above
  the grid.
- **Search** — the toolbar box narrows to rows containing every word you type, and highlights
  those words inside the cells.
- **Select and copy** — click and drag, or Shift+arrows. Ctrl+C copies as TSV (so it pastes back
  into a spreadsheet as cells), Ctrl+Shift+C adds the column letters as a header row, and
  right-click offers **Copy as…** JSON or an HTML table.
- **Reorder columns** — drag a header sideways.
- **Reload** — the toolbar button re-reads the file from disk if it changed outside the app.

Large workbooks open one sheet at a time: a file over 4 MB parses only the sheet you are looking
at, and parses the others the first time you open them.

## Asking an AI assistant about the workbook

The board publishes a live model of the open workbook to Persephone's agent layer, so an assistant
can read and drive it directly — with no converting the file first, and no external tools.

It can **read** the data: any range of any sheet, including sheets you have never opened, as
values, a table, or CSV. Cells come back as the text you see on screen, and it can ask for the
underlying numbers and dates when it needs to calculate with them.

It can also **do what you can do**, and you will see it happen:

- switch to another sheet tab
- type in the search box
- sort a column, or filter one to particular values
- select a range of cells and scroll it into view
- reorder the columns

That last group is how it points at things. Ask *"which rows are missing a status?"* and it can
select exactly those cells, so you can see what it means rather than reading a list of row numbers.

It can also write a range out to a CSV or Markdown file when the data is too big to discuss in a
message, or open it as a new Persephone page to show you what it read.

### What it will not do

- **It never changes the workbook.** There is no write path to the open file. Files it writes are
  new files, at a path it tells you.
- **It cannot highlight text inside cells.** Selecting a range is how it points at something.
- **It cannot select cells that are not next to each other on screen.** A selection is a rectangle
  in the grid, so if a sort, a filter or a reordered column has moved the cells apart, it will say
  so rather than select the wrong ones.
- **Merged cells** are not shown merged — the value appears in the top-left cell only.
- **Row 1 is data, not headers.** A sheet may have no header row, so columns are always labelled
  with their spreadsheet letters.
