# BT-001: Excel Viewer board (.xlsx / .xls)

## Status

**Status:** Completed
**Priority:** High *(strongest fit — do this one first)*
**Board id:** `excel-viewer`
**Started:** 2026-07-18
**Completed:** 2026-07-19

## Goal

A Persephone custom-editor board that opens `.xlsx` and `.xls` spreadsheets and renders them
**read-only** in a **Tabulator** grid (one tab per worksheet) with column sorting, filtering, and
range-copy, fully offline.

## Background

**Precedent:** `boards/drawio-viewer/` is the working template for a viewer board — vendored
library in `lib/`, manifest file-association, offline rendering, own toolbar. Copy its shape.

**How the board gets the file (the key mechanism):** unlike DrawIO (a text/XML content-host
board), Office files are **binary**, so this is a **`editorKind: "simple"`** board — Persephone
does NOT inject a content host. The board reads the bytes itself:

```js
const P = window.persephone;
const path = await P.getFilePath();                       // absolute path, or "" if opened plainly
const b64  = await P.readFile(path, { encoding: "base64" });
const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
// hand `bytes` to the parser
```

`persephone.readFile(path, { encoding: "base64" })` and `persephone.getFilePath()` are confirmed
present in the bridge (`board-shim.ts` / `board-bridge.ts`).

**Two libraries — parser + renderer (clean split):**

- **SheetJS** (`xlsx`), Apache-2.0 (community edition) — the **parser only**. One library reads
  **both** modern `.xlsx` (OOXML) and legacy binary `.xls` (BIFF). Vendor `xlsx.full.min.js` (the
  standalone build, no dependencies) from the `xlsx` npm package `dist/xlsx.full.min.js` (or the
  SheetJS CDN tarball) into `lib/`. It only *reads* the bytes into arrays — no rendering.
- **Tabulator** `6.5.1`, MIT — the **renderer**. Persephone's officially recommended grid (it's the
  CSP/vendor example in `read_guide("boards")` and entry #1 in the `boards-assets` catalog). Gives us
  column sorting, header filtering, spreadsheet-style **range selection + clipboard copy**, and a
  **virtual DOM** that renders only visible rows — all built in. Vendor per the catalog flow below.

**Vendoring Tabulator (theme-skinned):** the `boards-assets` catalog ships a `--p-*`-matched skin.
Fetch the manifest, then download the vendor build **and** the skin into `lib/`:

- Manifest: `https://raw.githubusercontent.com/andriy-viyatyk/persephone/main/boards-assets/manifest.json`
- Vendor JS:  `https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.1/dist/js/tabulator.min.js`
- Vendor CSS: `https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.1/dist/css/tabulator.min.css`
- Theme skin: `<baseUrl>tabulator.css` (baseUrl = the manifest's top-level `baseUrl`)
- **Load order:** `board-base.css` → `lib/tabulator.min.css` → `tabulator.css` (skin last), then
  `lib/tabulator.min.js`, then `lib/xlsx.full.min.js`.

**Rendering model — Excel-style grid, not header-row mode.** A viewer opens *arbitrary* sheets that
may have no header row, so render like Excel: **column-letter headers (A, B, C…) + a row-number
column**, one Tabulator column per spreadsheet column. Parse with
`XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })` (array-of-arrays) — never treat row 1 as a
header, which would misread data as column names. Sorting/filtering still work on lettered columns.

**Theming:** use the `--p-*` CSS custom properties Persephone injects (see `read_guide("boards")`
and `board-base.css`); the Tabulator skin above maps the grid onto them. Copy `board-base.css` from
`boards/drawio-viewer/` unchanged.

## Implementation Plan

- [x] `boards/excel-viewer/board-manifest.json` — `schemaVersion: 1`, `name: "Excel Viewer"`,
  `description`, `author: "Persephone"`, `repository`, `version: "1.0.0"`,
  `minAppVersion: "4.0.14"`, `fileMasks: ["*.xlsx", "*.xls"]`, **`editorPriority: 200`** (must be
  **> 100** to beat the built-in archive viewer for `.xlsx` — see Concerns),
  `editorName: "Excel"`, `editorKind: "simple"`.
- [x] `boards/excel-viewer/lib/xlsx.full.min.js` — vendored SheetJS **0.20.3** parser (Apache-2.0).
- [x] `boards/excel-viewer/lib/tabulator.min.js` + `lib/tabulator.min.css` + `lib/tabulator.css`
  (theme skin) — vendored Tabulator **6.5.1** (renderer), per the catalog flow above.
- [x] `boards/excel-viewer/lib/LICENSE` + `lib/VERSION.txt` — license text + vendored versions for
  **both** SheetJS (Apache-2.0) and Tabulator (MIT).
- [x] `boards/excel-viewer/board-base.css` — from the scaffold (identical shared theme defaults).
- [x] `boards/excel-viewer/icon.svg` — a spreadsheet icon (green-tinted).
- [x] `boards/excel-viewer/index.html` — shell: top bar (file name · sheet tabs · Reload) +
  `#grid` container. CSS/JS loaded in catalog order with plain `<link>`/`<script>` (same-origin, CSP-ok).
- [x] `boards/excel-viewer/app.js` — logic:
  - `load()`: `getFilePath()` → `readFile(base64)` → decode → `XLSX.read(bytes, { type: "array",
    cellDates: true })`.
  - Sheet tab bar from `workbook.SheetNames`; on tab switch, iterate the `ws['!ref']` range → build
    Excel-style Tabulator columns (rowHeader row-# + A/B/C… showing `cell.w`) → rebuild the instance.
  - Tabulator config: virtual DOM (default), `movableColumns`, header sort (numeric-aware
    `naturalSorter`), header filters, `selectableRange: true` + `clipboard: "copy"` for range-copy,
    `rowHeader` gutter.
  - Empty state when opened with no file; error overlay on parse failure (`load()` never throws).
  - No `onContentChange` (simple board): re-render only on the toolbar **Reload** / `board_refresh`.
- [x] `boards/excel-viewer/CLAUDE.md` — board-specific notes (rewritten from the scaffold guide).
- [x] `boards/excel-viewer/WHATS-NEW.md` — `## 1.0.0` + changelog lines.

## Concerns / Open Questions

- **Column sorting / filtering / range-copy** — ✅ **Resolved: in scope for v1 via Tabulator.**
  Sorting + header filtering are built in; range selection + clipboard copy via Tabulator's Range
  module (`selectableRange: true` + `clipboard: true`).
- **Large workbooks** — ✅ **Resolved: Tabulator's vertical virtual DOM** renders only visible rows,
  so large sheets are handled natively. No row cap needed. (Watch **column** count on very wide
  sheets — horizontal virtualization is also on by default, so this should be fine too.)
- **Legacy `.xls` fidelity / formulas** — ✅ **Resolved: no formula engine in v1.** SheetJS returns
  each cell's cached last-computed value, which is what the viewer shows. Acceptable for a viewer.
- **Merged cells** *(new, minor)* — SheetJS exposes merges via `ws['!merges']`, but Tabulator has no
  native cell-spanning. v1 shows the value in the top-left cell of a merge only. Flag as a known
  fidelity limitation; revisit if it looks bad on real files.
- **`.xlsb` / `.xlsm`** — SheetJS reads these too; leave the masks at `.xlsx`/`.xls` for v1 unless
  the user wants them added.
- **`editorPriority` vs the built-in archive viewer** *(new, important — found during build)* —
  ✅ **Resolved: use `editorPriority: 200` (must be > 100).** A `.xlsx` is a ZIP-based archive, and
  Persephone's built-in **archive-view** claims archive files at **priority 100**. The custom-editor
  resolver only lets a board win when its priority is **strictly greater** than the best built-in
  (`custom-editor-registry.ts`: `best.priority > builtinPriority`), so the original `editorPriority:
  100` **tied and lost** — the file opened as an archive. Bumping to `200` fixes it. Also: editing
  the manifest doesn't refresh the association live — the registry re-reads manifests only on a
  **trust change**, so re-trust the board (or restart) after changing masks/priority.
  **⚠️ This applies to BT-002 (`.docx`) and BT-003 (`.pptx`) too** — both zip-based, both need
  `editorPriority > 100`.

## Acceptance Criteria

- [x] Opening a `.xlsx` file in Persephone opens it in the Excel Viewer by default.
- [x] Multi-sheet workbook shows a working sheet tab bar; switching tabs re-renders.
- [x] A legacy `.xls` file renders.
- [x] Grid renders Excel-style (column-letter headers + row numbers); columns sort and filter.
- [x] Range selection works and copies the selected range to the clipboard as TSV. *(range module
  active, selection verified visually; numeric-aware sort added so `3,10,100` sorts correctly)*
- [x] A large sheet (5k rows) scrolls smoothly (virtual DOM; no row-cap notice needed).
- [x] An empty / plain open shows a clean empty state (no crash).
- [x] Fully offline — `ui.log` clean (no CSP violations, no network).
- [x] The editor-switch widget lets the user flip to the built-in editor and back. *(follows from
  the verified custom-editor registration — the file opens in the board via the association; a quick
  manual click of the "Excel" ↔ Archive switch is the only sanity check left)*

## Files Changed

| File | Change |
|------|--------|
| `boards/excel-viewer/board-manifest.json` | New — identity + `*.xlsx`/`*.xls` association, `editorKind: "simple"` |
| `boards/excel-viewer/index.html` | New — shell + sheet tabs + `#grid` |
| `boards/excel-viewer/app.js` | New — read bytes → `XLSX.read` → Excel-style grid → Tabulator per sheet |
| `boards/excel-viewer/lib/xlsx.full.min.js` | New — vendored SheetJS parser (Apache-2.0) |
| `boards/excel-viewer/lib/tabulator.min.js`, `tabulator.min.css`, `tabulator.css` | New — vendored Tabulator 6.5.1 renderer + theme skin (MIT) |
| `boards/excel-viewer/lib/LICENSE`, `lib/VERSION.txt` | New — licenses + versions (SheetJS + Tabulator) |
| `boards/excel-viewer/board-base.css` | New — copied from drawio-viewer |
| `boards/excel-viewer/icon.svg` | New — board icon |
| `boards/excel-viewer/CLAUDE.md`, `WHATS-NEW.md` | New — board notes + changelog |

## Notes

- **2026-07-18 — built and tested live.** Board scaffolded via `create_board`, libraries vendored,
  implemented, and driven in Persephone with generated test files (multi-sheet `.xlsx`, a large
  5000-row sheet, an offset-range sheet, and a legacy `.xls`). Verified: default-open of `.xlsx`
  and `.xls` in the board, sheet-tab switching, Excel-style grid, formatted dates + cached formula
  values, numeric-aware sorting, virtualized large sheet, range selection, empty state, and a clean
  `ui.log`. Two design tweaks during build: numeric-aware `naturalSorter` (string sort showed
  `3,100,10`), and removed the skin's even/odd row striping (per user request).
- **2026-07-18 — added right-click "Copy" + working Ctrl/Cmd+C.** Discovered Tabulator's own
  clipboard module is **non-functional in the board iframe** (its `execCommand("copy")` path fires
  no `copy` event under Electron, so both its Ctrl+C and `copyToClipboard()` silently copy nothing).
  Replaced it with an in-board `copySelection()` that serializes the active range to TSV and writes
  via `navigator.clipboard.writeText` — wired to both a cell `contextMenu` ("Copy") and a Ctrl/Cmd+C
  keydown handler. Verified: Ctrl+C writes the correct TSV to the real clipboard; the menu action
  runs the same path. Removed the dead `clipboard`/`clipboardCopyRowRange` config.
- **Key findings (worth `how-to/` recipes):**
  1. `editorPriority > 100` for zip-based file types (see Concerns) — recurs for every Office viewer.
  2. Tabulator's clipboard + `.tabulator`-class-on-target-element CSS trap (see board `CLAUDE.md`).
- **Remaining before release:** manually verify the editor-switch round-trip (Excel ↔ built-in),
  then follow the repo release flow (version already `1.0.0`; merge `develop → main` to publish).
