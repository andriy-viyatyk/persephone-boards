# Excel Viewer — board notes

A Persephone **simple custom-editor board**: a read-only viewer for Excel spreadsheets
(`.xlsx` and legacy `.xls`). It renders each worksheet in an **av-grid** grid, fully
**offline** (no CDN / no network). Persephone hands the board the file **path**; the board reads
the bytes itself, parses them with **SheetJS**, and renders — there is no write path.

> New here? The generic Persephone board authoring reference (the `persephone.*` bridge, the
> `--p-*` theme contract, CSP rules, reload/test flow) is available any time via the
> **`read_guide("boards")`** MCP tool and the bundled Demo board. This file documents only
> what's specific to *this* board.

## Purpose

Persephone opens this board as the editor for `*.xlsx` / `*.xls` files. The manifest
(`board-manifest.json`) associates it: `fileMasks: ["*.xlsx", "*.xls"]`, `editorName: "Excel"`
(the editor-switch label), `editorKind: "simple"` (the board gets a file **path**, not a content
host — it reads the bytes itself), and **`editorPriority: 200`** — see the gotcha below on why
this must be **> 100** for `.xlsx`. Opened plainly (no file) it shows an empty-state message.

## How it works

1. `app.js` `load()` calls `persephone.getFilePath()`. Empty/undefined → empty-state overlay.
   Otherwise it reads the file with `persephone.readFile(path, { encoding: "base64" })`, decodes
   the base64 to a `Uint8Array` with an indexed loop, and parses it with `XLSX.read(bytes,
   READ_OPTIONS)` — `{ type: "array", cellDates: true, cellFormula: false, dense: true }`. On a
   file ≥ `LAZY_PARSE_MIN_BYTES` (4 MB) only the first sheet is parsed (`sheets: 0`); the others
   are parsed when first selected. See **Load performance** below — every one of those choices is
   a measured one, and two of them are easy to "clean up" back into a 5× slower board.
2. A **sheet tab bar** is built from `workbook.SheetNames` (shown only when there's more than one
   sheet). Clicking a tab calls `renderSheet(name)`.
3. `buildGrid(ws)` turns one worksheet into av-grid `{ columns, rows }`, **Excel-style**:
   - Iterates the sheet's used range (`ws['!ref']` → `XLSX.utils.decode_range`).
   - One grid column per spreadsheet column, named with its **column letter** (A, B, C…) via
     `XLSX.utils.encode_col`; `key` is `"c" + colIndex`.
   - Each cell contributes **two** row properties: the **raw** value under the column's key
     (`c3`) and Excel's **formatted text** under a parallel key (`d3`). See "Raw + formatted"
     below — this is the central design decision of the rewrite.
   - Row data carries `__row` = the 1-based Excel row number, shown in a pinned status column
     and used as the row key.
   - Row 1 is **NOT** treated as a header — arbitrary sheets may have no header row.
4. `renderSheet` **destroys and rebuilds** the grid per sheet switch (a clean lifecycle beats
   juggling `setColumns`/`setRows`, and it drops the previous sheet's sort/filters/selection,
   which belonged to that sheet). Empty sheet → state overlay, no grid.
5. **Read-only, no content host.** There's no `onContentChange` (that's a content-host feature);
   the only re-render triggers are the toolbar **Reload** button and the `board_refresh` MCP tool
   (which re-runs `app.js`). `load()` is wrapped so a parse failure degrades to an error overlay
   and a `notify(..., "error")` rather than crashing.

## Load performance

Measured on a real 20.5 MB workbook: **124,150 rows × 27 columns**, 3.35 M cells, two sheets.
It opened in ~10.9 s before this pass and ~6.0 s after. The breakdown is worth keeping, because
it is not where anyone guesses:

| Stage | Before | After | What changed |
|---|---:|---:|---|
| `persephone.readFile` (main reads + base64-encodes + ships 26 MB over the port) | 100 ms | 100 ms | — it was never the disk |
| `atob` | 34 ms | 34 ms | — |
| base64 string → `Uint8Array` | **1352 ms** | **26 ms** | indexed loop instead of `Uint8Array.from(bin, ch => ch.charCodeAt(0))` |
| `XLSX.read` | 7767 ms | 5400 ms | `dense: true`, `cellFormula: false`, first sheet only |
| `buildGrid` (3.35 M cells → row objects) | 1560 ms | 321 ms | reads `ws["!data"][r][c]` instead of building 3.35 M `encode_cell` address strings |
| **Total** | **~10.9 s** | **~6.0 s** | |

Sheet switching went from ~2.0 s to ~0.4 s (rebuild only; an already-parsed sheet is kept).

Rules that follow from this — all three are things a tidy-up would undo:

- **Do NOT rewrite the decode loop as `Uint8Array.from(binaryString, ch => ch.charCodeAt(0))`.**
  It reads better and costs **52×** more (1352 ms vs 26 ms on 20 MB): that form runs the callback
  through the generic iterator protocol, one call per byte.
- **Do NOT drop `dense: true`,** and do not "restore" `ws[XLSX.utils.encode_cell(...)]` lookups
  in `buildGrid`. Dense sheets put cells in `ws["!data"][r][c]` and have **no address keys at
  all**, so the sparse path is not just slower, it reads `undefined`. `buildGrid` keeps a
  fallback for a sparse sheet; it is a safety net, not the intended path.
- **`cellDates: true` and `cellText` (default on) are load-bearing** — the first is what makes
  dates sort by instant, the second produces `cell.w`, the formatted text this board displays.
  Turning `cellText` off is another ~700 ms and leaves nothing to render. `cellFormula: false` is
  safe only because nothing here reads `cell.f`.

Per-sheet parsing is a size-dependent trade: each `XLSX.read` re-pays a fixed unzip +
shared-string cost that scales with the **file** (~1.0 s here, ~10 ms on a small workbook), so
deferring wins on a big file — you rarely open every sheet — and loses on a small one, where it
would add a hitch to a switch that is otherwise free. Hence the 4 MB threshold. Below it the
workbook is parsed whole and `fileBytes` is released; above it `fileBytes` is retained so another
sheet can be parsed on demand.

Verified equivalent, not just faster: 478,872 cells sampled across the whole 124 k-row sheet
compared raw value and formatted text against the old sparse parse — **0 mismatches** — and a
sort of a 124,150-row date column produced 0 inversions in both directions.

**What is left, if this ever needs to be faster.** The remaining ~5.4 s is SheetJS parsing, and
nothing in this board can shrink it. Two real options, neither taken here:
*(a)* parse in a **Worker** (the board CSP allows `worker-src 'self'`) — this does not make the
parse faster and posting 124 k built row objects back costs its own structured clone, but it
would keep the UI responsive and allow a progress indicator;
*(b)* **progressive first paint** — `sheetRows: 500` parses in ~1.6 s, so the first screen could
appear ~4 s sooner, with the full parse swapped in behind it (which needs (a) to not freeze).
A third would be an app change: a binary `encoding` for `persephone.readFile`, which would drop
the base64 encode + `atob` + decode (~160 ms here) and the 26 MB string entirely.

## Raw + formatted — why every cell is stored twice

A viewer must *look* like Excel (so `$19.50`, `5/30/26`, cached formula results) but *sort* like
Excel (so 100 > 12, and a date orders by instant). Those want different values, so the board keeps
both and tells av-grid which consumer reads which:

- `row["c3"]` = **raw** `cell.v` — a number, a `Date`, a boolean, a string.
- `row["d3"]` = **formatted** `cell.w` (falling back to `String(cell.v)`).
- The column's `formatValue: (column, row) => row["d3"]` is the plain-text projection.

av-grid's hook-precedence table then does the rest, for free:

| Consumer | Reads | Result |
|---|---|---|
| Screen | `formatValue` | Excel's own text |
| Search box, filter funnel, copy | `formatValue` | you search and copy what you see |
| **Sorting** | `row[key]` (**never** `formatValue`) | raw values, compared by runtime type |

That is why this build has **no custom sorter at all** — and why dates now sort correctly, which
the previous Tabulator build could not do (it only ever had the display string, so it needed a
`localeCompare(..., { numeric: true })` sorter and still sorted dates lexically).

## Grid features (all av-grid, configured in `renderSheet`)

- **Sorting** — click a header; ascending → descending → none. Numeric and date columns sort by
  value (see above). No sorter code.
- **Filtering** — every header carries a funnel opening a searchable, virtualized checklist of
  that column's distinct values, cascaded against the other columns' filters. `filterBar: true`
  adds removable chips above the grid; the bar takes **no vertical space until something is
  filtered**.
- **Search** — the toolbar box calls `grid.setSearchString()`. Every whitespace-separated word
  must appear in some column's displayed value, and each one is **highlighted inside the cells**
  (av-grid 2.1+, on by default — see the `highlightSearch` note in `renderSheet`).
- **Range selection** — click and drag, or Shift+arrows. The row-number gutter is a status
  column (`isStatusColumn`), so av-grid keeps it out of the focus, the selection and every copy
  path on its own — a copied range pastes into a spreadsheet with no row numbers glued to the
  front, and it needs no code here.
- **Copy** — Ctrl+C, Ctrl+Shift+C (with the column letters as a header row) and right-click
  **Copy** / **Copy as…** (With Headers, JSON, HTML table) are all av-grid's own, and the menu is
  correctly reduced to copy-only because the grid isn't `editable`. **The board binds nothing.**
- **Virtualization** — 20,000 rows render in ~90 ms with ~230 cells in the DOM; scrolling and
  sorting stay flat. No row cap needed.
- **Column widths** — detected from the header label and the first 50 rows, measured as the cell
  *displays* them, so our `formatValue` is what counts. Bounded 60–300px. The board sets no width
  on a data column.

## Key files

| File | Role |
|------|------|
| `index.html` | Page shell: top bar (file name · sheet tabs · Search · Reload) + `#grid` host + `#state` overlay. Loads CSS in order (board-base → av-grid → board overrides) and JS (av-grid → xlsx → app). Board-specific grid CSS (the row-number rail) lives here. |
| `app.js` | All logic: `load()` (path → bytes → `XLSX.read`), `buildGrid()` (worksheet → columns+rows), `renderSheet()` (the av-grid instance), `renderTabs()`, `ROW_COLUMN`, state overlay. |
| `board-manifest.json` | Simple custom-editor association (`fileMasks`, `editorPriority: 200`, `editorName`, `editorKind: "simple"`). |
| `lib/xlsx.full.min.js` | Vendored **SheetJS** 0.20.3, Apache-2.0 — the parser (reads `.xlsx` + `.xls`). |
| `lib/av-grid.umd.js` + `lib/av-grid.css` | Vendored **av-grid** 2.1.0, MIT — the renderer. No skin file: av-grid reads the `--p-*` contract directly. |
| `lib/LICENSE`, `lib/VERSION.txt` | License texts + vendored versions for both libraries. |
| `board-base.css` | Shared Persephone board theme defaults (don't recreate). |
| `icon.svg` | Board icon (spreadsheet glyph). |
| `WHATS-NEW.md` | Short human changelog. Record changes under the next version's heading. |

## Run & test

- Open any `.xlsx` / `.xls` file in Persephone → it opens in this board by default; the "Excel" ↔
  built-in switch is in the page toolbar.
- After editing board files, reload with the in-board **Reload** button, or `board_refresh` (MCP).
  Iterate loop: edit → `board_refresh` → `browser_snapshot { pageId }` / `browser_take_screenshot`.
- Test workbooks live at `_test/excel-viewer-test.xlsx` (sheets: **Sales** — mixed types, a
  number format, gaps, one runaway-long cell; **Big** — 20,000 rows; **Empty**) and
  `_test/excel-viewer-test.xls` (legacy, single sheet). Regenerate with SheetJS under Node:
  `XLSX.write(wb, { type: "buffer", bookType })` + `fs.writeFileSync` (the browser build's
  `writeFile` fs hookup is unreliable under Node).
- Cover: sheet switching, the legacy `.xls`, the big sheet (virtualization), the empty sheet, a
  plain open with no file (empty state), sorting a numeric **and** a date column, a funnel filter
  + the chip bar, the search box, a range select + Ctrl+C, and right-click → Copy.
  `ui.log` should stay clean (no CSP violations, no errors).
- **Read [Driving the grid from an agent](https://raw.githubusercontent.com/andriy-viyatyk/av-grid/main/docs/api.md)
  before concluding anything from a click.** Persephone's `browser_click` fires a bare synthetic
  `click` — no `pointerdown`, which is where av-grid resolves focus, cell focus and drags — and
  `browser_press_key` fires `isTrusted: false` keys, which **cannot** drive the clipboard on any
  browser. Both failures look exactly like grid bugs; three were reported against av-grid from
  this board on that basis and none were real. Prefer the API (`grid.focusCell`, `selectRange`,
  `copySelection`, `getState`), synthesise the full pointer sequence in `browser_evaluate` when a
  real gesture is needed, and **verify Ctrl+C by hand**.

## Gotchas (the non-obvious decisions)

- **`editorPriority` MUST be > 100 for `.xlsx`.** A `.xlsx` is a ZIP-based archive, and
  Persephone's built-in **archive-view** claims archive files at **priority 100**
  (`editor-matchers.ts`). The custom-editor resolver only lets a board win when its priority is
  **strictly greater** than the best built-in (`custom-editor-registry.ts`:
  `best.priority > builtinPriority`), so `editorPriority: 100` **ties and loses** — the file opens
  as an archive. Hence `200`. (`.xls` is *not* zip-based, so it only competes with Monaco at
  priority 0 and would win at any positive priority — but keep them equal for consistency.) This
  same trap applies to any zip-based type: `.docx`, `.pptx`, `.ods`, `.epub`, etc.
- **Editing the manifest doesn't refresh the association live.** The custom-editor registry only
  re-reads manifests on a **trust change** (it subscribes to trust, not the filesystem). After
  changing `fileMasks`/`editorPriority`, re-trust the board (`unregisterBoard` + `registerBoard`,
  or restart the app) or the old manifest data sticks and the file opens with the built-in editor.
  A board that isn't trusted at all doesn't claim its file masks either — if `.xlsx` suddenly
  opens as an archive, check `trustedBoards.txt` before suspecting the code.
- **CSP forbids remote network.** Both libraries are **vendored locally** under `lib/` and loaded
  with relative `<script>`/`<link>` paths — never a CDN URL (blocked, silent failure). av-grid's
  UMD build ships as `av-grid.umd.cjs`; it is vendored **renamed to `.js`** so it loads as an
  ordinary classic script, and it puts the module namespace on `window.AVGrid` — the class is
  `AVGrid.AVGrid`, and the helpers (`inferColumns`, …) hang off the same object.
- **`injectStyles: false`, and link `av-grid.css` yourself.** av-grid otherwise injects its
  stylesheet during `create()` — i.e. *after* this page's own `<style>` block — and
  `.avg-data-cell` would then out-rank the board's rules at equal specificity. Linking it in
  `<head>` puts the board's overrides last. A board rule must still out-specify one av-grid
  class: write `.avg-data-cell.xl-rownum`, not a bare `.xl-rownum`.
- **The board does NOT bind Ctrl+C, and does NOT help the grid take focus.** Both were once
  workarounds here and both are gone — they were fixing a test harness, not the grid (see the
  "Run & test" note above). A press inside the grid takes DOM focus itself, and Ctrl+C /
  Ctrl+Shift+C copy through the browser's own `copy` event. Don't reintroduce either on the
  evidence of an MCP-driven click or keypress. *(The Tabulator build did genuinely need its own
  copy — it went through `document.execCommand("copy")` — which is why this looked familiar.)*
- **Don't set widths on the data columns.** av-grid detects them from the header label and the
  first 50 rows, measured through the cell's *display* value, so `formatValue` is what it sees —
  which is exactly right here, since the raw values include `Date` objects whose width means
  nothing. (av-grid ≤ 2.0.0 only detected widths for *inferred* columns and gave explicit ones a
  flat 140px; the board carried a `detectWidths()` probe for that, deleted in 2.1.0.)
- **Read-only.** No write path, no `persephone.writeFile` for the opened file. Switch to a
  built-in editor to edit; this board only reads. `editable` is left off, which is also what
  reduces av-grid's context menu to Copy / Copy as… with no Paste or row/column items.
- **Merged cells** aren't spanned (av-grid has uniform cells and no cell-spanning); a merge shows
  its value in the top-left cell only. Known fidelity limit.
- **Row 1 is data.** A viewer opens arbitrary sheets with no guaranteed header row, so the grid
  never promotes row 1 to a header — column headers are always the spreadsheet letters.

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- av-grid API: `https://raw.githubusercontent.com/andriy-viyatyk/av-grid/main/docs/api.md`
  (npm: `av-grid`). Read it rather than guessing — it is deliberately not AG-Grid-shaped.
- Recommended components + skins catalog:
  `https://raw.githubusercontent.com/andriy-viyatyk/persephone/main/boards-assets/manifest.json`
