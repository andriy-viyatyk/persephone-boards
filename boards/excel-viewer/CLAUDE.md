# Excel Viewer — board notes

A Persephone **simple custom-editor board**: a read-only viewer for Excel spreadsheets
(`.xlsx` and legacy `.xls`). It renders each worksheet in a **Tabulator** grid, fully
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
   the base64 to a `Uint8Array`, and parses it with `XLSX.read(bytes, { type: "array",
   cellDates: true })`.
2. A **sheet tab bar** is built from `workbook.SheetNames` (shown only when there's more than one
   sheet). Clicking a tab calls `renderSheet(name)`.
3. `buildGrid(ws)` turns one worksheet into Tabulator `{ columns, data }`, **Excel-style**:
   - Iterates the sheet's used range (`ws['!ref']` → `XLSX.utils.decode_range`).
   - One grid column per spreadsheet column, titled with its **column letter** (A, B, C…) via
     `XLSX.utils.encode_col`; field keyed `"c" + colIndex`.
   - Each cell shows its **formatted text** (`cell.w` — dates, number formats, cached formula
     values) falling back to `String(cell.v)`. Row 1 is **NOT** treated as a header — arbitrary
     sheets may have no header row.
   - Row data carries `__row` = the 1-based Excel row number, shown in a frozen gutter.
4. `renderSheet` **destroys and rebuilds** the Tabulator instance per sheet switch (a clean
   lifecycle beats juggling `setColumns`/`replaceData`; switches are infrequent). Empty sheet →
   state overlay, no table.
5. **Read-only, no content host.** There's no `onContentChange` (that's a content-host feature);
   the only re-render triggers are the toolbar **Reload** button and the `board_refresh` MCP tool
   (which re-runs `app.js`). `load()` is wrapped so a parse failure degrades to an error overlay
   and a `notify(..., "error")` rather than crashing.

## Grid features (all Tabulator, configured in `renderSheet`)

- **Sorting** — per-column header sort. Cells are formatted strings, so columns use a
  `naturalSorter` (`localeCompare` with `numeric: true`) — numeric columns and `item-N` labels
  sort by value, not lexically. (Dates, shown as formatted text, still sort lexically — a known
  v1 limit.)
- **Filtering** — a per-column header-filter input (`headerFilter: "input"`).
- **Range selection** — `selectableRange: true` (cell ranges; drag to select). Column/row
  range-select are off so header clicks stay free for sort/filter. The row-number gutter is
  Tabulator's dedicated **`rowHeader`** (not a plain frozen column) — a frozen column that isn't
  the range header warns under `selectableRange`.
- **Copy** — right-click **Copy** (a cell `contextMenu`) and **Ctrl/Cmd+C** both call
  `copySelection()`, which builds TSV from the active range(s) (`rangeToTsv`) and writes it with
  `navigator.clipboard.writeText`. We do NOT use Tabulator's clipboard module — see the gotcha
  below.
- **Virtualization** — Tabulator's vertical virtual DOM (default) renders only visible rows, so
  large sheets (tens of thousands of rows) stay smooth. No row cap needed.
- **`layout: "fitData"`** — columns size to content (capped at `maxWidth: 420`); horizontal
  scroll for wide sheets. `movableColumns: true`.

## Key files

| File | Role |
|------|------|
| `index.html` | Page shell: top bar (file name · sheet tabs · Reload) + `#grid` host + `#state` overlay. Loads CSS in catalog order (base → tabulator vendor → skin) and JS (tabulator → xlsx → app). Board-specific grid CSS (row-number gutter, striping override) lives here. |
| `app.js` | All logic: `load()` (path → bytes → `XLSX.read`), `buildGrid()` (worksheet → Excel-style columns+data), `renderSheet()` (Tabulator instance), `renderTabs()`, `naturalSorter`, `ROW_HEADER`, state overlay. |
| `board-manifest.json` | Simple custom-editor association (`fileMasks`, `editorPriority: 200`, `editorName`, `editorKind: "simple"`). |
| `lib/xlsx.full.min.js` | Vendored **SheetJS** 0.20.3, Apache-2.0 — the parser (reads `.xlsx` + `.xls`). |
| `lib/tabulator.min.js` + `.min.css` + `tabulator.css` | Vendored **Tabulator** 6.5.1, MIT — the renderer + Persephone theme skin (from the boards-assets catalog). |
| `lib/LICENSE`, `lib/VERSION.txt` | License texts + vendored versions for both libraries. |
| `board-base.css` | Shared Persephone board theme defaults (don't recreate). |
| `icon.svg` | Board icon (spreadsheet glyph). |
| `WHATS-NEW.md` | Short human changelog. Record changes under the next version's heading. |

## Run & test

- Open any `.xlsx` / `.xls` file in Persephone → it opens in this board by default; the "Excel" ↔
  built-in switch is in the page toolbar.
- After editing board files, reload with the in-board **Reload** button, or `board_refresh` (MCP).
  Iterate loop: edit → `board_refresh` → `browser_snapshot { pageId }` / `browser_take_screenshot`.
- Cover: a multi-sheet workbook (tab bar + switching), a legacy `.xls`, a large sheet
  (virtualization), an offset/empty-cell sheet, an empty/plain open (empty state), sorting a
  numeric column, filtering, and a range select + Ctrl+C. `ui.log` should stay clean (no CSP).
- Generate test files with SheetJS under Node: `XLSX.write(wb, { type: "buffer", bookType })` +
  `fs.writeFileSync` (the browser build's `writeFile` fs hookup is unreliable under Node).

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
- **CSP forbids remote network.** Both libraries are **vendored locally** under `lib/` and loaded
  with relative `<script>`/`<link>` paths — never a CDN URL (blocked, silent failure).
- **Tabulator puts its `.tabulator` class on the target element ITSELF** (`#grid`), not a child. So
  a CSS override written as `#grid .tabulator .tabulator-row` (descendant) matches **nothing** — it
  silently fails to apply. Target `#grid` directly: `#grid.tabulator {…}`, `#grid .tabulator-row {…}`.
  This bit the even/odd striping override (see `index.html`).
- **Tabulator's clipboard module doesn't work in the board iframe.** Its copy goes through the
  legacy `document.execCommand("copy")` path, whose `copy` event never fires in this Electron
  iframe, so both its Ctrl+C keybinding and `table.copyToClipboard()` **silently copy nothing**.
  That's why this board owns copy itself: `copySelection()` builds the TSV from `table.getRanges()`
  and calls `navigator.clipboard.writeText` (the board frame has clipboard permission; the menu
  click / keypress supplies the required user gesture). Don't re-enable `clipboard: "copy"` expecting
  it to work. Note also the range API's `getData()`/`getCells()` are unreliable here — read cells via
  `range.getRows()` × `range.getColumns()` + `row.getCell(col).getValue()` (what `rangeToTsv` does).
- **Read-only.** No write path, no `persephone.writeFile` for the opened file. Switch to a
  built-in editor to edit; this board only reads.
- **Formatted values, not raw.** Cells show `cell.w` (Excel's formatted text) so the grid looks
  like Excel. The trade-off: sort keys are display strings — handled for numbers via
  `naturalSorter`, but **dates sort lexically** (formatted text) and there's no numeric-format
  editing. Acceptable for a viewer.
- **Merged cells** aren't spanned (Tabulator has no native cell-spanning); a merge shows its value
  in the top-left cell only. Known v1 fidelity limit.
- **Row 1 is data.** A viewer opens arbitrary sheets with no guaranteed header row, so the grid
  never promotes row 1 to a header — column headers are always the spreadsheet letters.

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- Recommended components + skins catalog (Tabulator lives here):
  `https://raw.githubusercontent.com/andriy-viyatyk/persephone/main/boards-assets/manifest.json`
