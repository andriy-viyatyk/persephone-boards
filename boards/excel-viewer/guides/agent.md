---
title: "Excel Viewer for agents"
audience: agent
summary: "Read and DRIVE an open workbook through pages[i].editor.app: cells by A1 range on any sheet, plus the sheet tabs, search box, sort, filters, selection and column order the user sees."
---

# Excel Viewer for agents

The board publishes a live model of the open workbook at **`pages[pageId].editor.app`**. The
workbook is already parsed and the sheet is already rendered inside the board, so reading it costs
nothing extra: **never convert the file with an external tool, and never re-read the bytes
yourself** — that was the workaround this model exists to remove.

This board is not a wrapper around someone else's viewer, so the model is larger than the PDF,
Word or PowerPoint ones: **everything the user can do to this grid, you can do**, and they watch it
happen on screen.

Addressing is spreadsheet-native throughout — **column letters and 1-based Excel row numbers**,
in A1 notation. That is what the file, the user and the screen all already say.

## Start here

```js
pages[pageId].editor.app.getStats()
```

Every sheet with its used range and dimensions, plus the state of the view — sort, filters, search
text, column order, selection. That tells you both what is in the file and what the user is
currently looking at.

## The two sources, and which one answers your question

This is the one thing to get right.

| You want | Call | Reads |
|---|---|---|
| What is in the file | `getCells(range)` | The **workbook** — sheet order, every row, filters and sort irrelevant, any sheet |
| What is on screen | `getCells(range, { view: true })` | The **grid** — display order, after the current sort and filters, active sheet only |

`getCells` defaults to the file, which is almost always what you want. Reach for `{ view: true }`
right after you have applied a filter or a sort and want to see the result the user is seeing.

Reading the file works on **any sheet**, including one the user has never opened — pass
`{ sheet: "Name" }`. A large workbook parses sheets on demand, and naming one parses it exactly as
clicking its tab would. You do not need to switch tabs to read a sheet, and you should not: a tab
switch is a visible change to the user's view.

## Reading

| Call | Gives you |
|---|---|
| `getCells(range?, options?)` | Values as structured rows, each tagged with its Excel row number |
| `getMarkdown(range?, options?)` | The same range as a Markdown table |
| `getCsv(range?, options?)` | The same range as CSV |
| `getSheets()` | Every worksheet, its used range, and which is active |
| `search(query, options?)` | Cells whose displayed text matches, as A1 addresses |
| `getColumnValues(column)` | The distinct **displayed** values of one column |
| `saveCsv(path, range?)` / `saveMarkdown(path, range?)` | Write a range to a file — no size bound |

Ranges accept every shape a spreadsheet user writes: `"B2:D50"` for a block, `"B2"` for one cell,
`"B:D"` for whole columns, `"2:50"` for whole rows, or omitted for the sheet's whole used range.
A range wider than the data is clamped to it, so `"A1:ZZ99999"` is a safe way to say "everything".

### Displayed text vs the underlying value

Cells come back as the text the cell **displays** — `"$19.50"`, `"1/15/26"` — because that is what
the user sees and what every match in this board is made against. Pass `{ raw: true }` for the
value behind it (`19.5`, an ISO date string) when you need to compute with it.

### Size

A call result is bounded to about 20,000 cells and **truncates rather than failing**, telling you
how many rows of how many it gave you. For a whole large sheet use `saveCsv(path)` — that one has
no bound — and read the file.

## Driving the grid

`getView()` reports the whole view in one call. Then:

| Call | Does |
|---|---|
| `goToSheet(name)` | Switch tab. Rebuilds the grid, so that sheet's sort, filters, search and selection are gone |
| `setSearch(text)` | Type in the toolbar search box. `""` clears it |
| `setSort(column, direction)` | `"asc"` / `"desc"`; `setSort(null)` clears |
| `setFilter(column, values)` | Filter to these values; `setFilter(column, null)` removes that column's filter |
| `clearFilters()` | Remove every filter |
| `selectRange(range)` | Select cells, as a drag would |
| `scrollTo(range)` | Bring a cell into view without changing the selection |
| `showCells(range)` | Select **and** scroll — this is how you point at something |
| `setColumnOrder(columns)` / `moveColumn(column, before?)` | Reorder; `setColumnOrder(null)` restores spreadsheet order |
| `getSelectionText(mode?)` / `copySelection(mode?)` | Read the selection / put it on the system clipboard |
| `reload()` | Re-read the file from disk |

### Filter values are the DISPLAYED text

**This is the one that will catch you.** Filtering a currency column by `19.5` matches **nothing**;
`"$19.50"` matches. Sorting reads the underlying value and filtering reads the displayed text, and
this board deliberately feeds them different things, so on every formatted column the two disagree.

Always:

```js
app.getColumnValues("D")            // → [{ value: "$19.50", count: 1 }, …]
app.setFilter("D", ["$19.50"])      // pass those strings verbatim
```

If you get it wrong, `setFilter` tells you: it checks the values you passed against the column's
real ones and says which are not there, rather than leaving you with an empty grid and no reason.

### Selection is a rectangle ON SCREEN

A grid selection is a rectangle of what is displayed, not of the sheet. So `selectRange` refuses,
with a specific reason, when:

- a **filter** is hiding one of the rows → `clearFilters()` first
- a **sort** has moved the rows apart → `setSort(null)` first
- a **reordered column** has put a gap between the columns → `setColumnOrder(null)` first

Take the refusal at face value and clear the thing it names; do not select a different range and
hope. The reverse also holds: `getView().selection` reports the exact row numbers and column
letters always, and only reports a single `range` string when the selection really is one
contiguous block of the sheet.

**Reordering columns clears the selection.** Sort and filters survive a reorder; the selection is
index-based and would silently end up on different cells, so it is dropped instead.

## Showing the user

`showCells(range)` selects a range and scrolls it into view. That is the pointer — use it whenever
you are talking about specific cells, so the user sees what you mean instead of decoding row
numbers.

There is **no way to highlight text inside cells**; the selection is the only pointer. (`setSearch`
does highlight matched words, but it also filters the rows, so it is a search, not a highlight.)

`openRangePage(range?)` opens a range as a Markdown table in a new Persephone page when you want to
show the user what you read rather than where it is.

## Not features

- **No editing.** The grid is not editable and there is no write path to the open workbook. `save*`
  writes **new** files, at absolute paths you name (a relative path is refused — it would land
  inside the board's own folder).
- **No formulas.** The board parses cached results, not formula text. A formula cell reads as its
  last computed value.
- **No merged-cell spans.** A merge's value is in its top-left cell; the rest read as empty.
- **No header row.** Row 1 is data. Columns are always the spreadsheet letters, because an
  arbitrary sheet has no guaranteed header.
- **No cross-sheet driving.** Sorting, filtering, selecting and reordering act on the sheet on
  screen. Reading does not — it reaches any sheet.
