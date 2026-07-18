# BT-002: Word Viewer board (.docx)

## Status

**Status:** Completed
**Priority:** Medium
**Board id:** `word-viewer`
**Started:** 2026-07-19
**Completed:** 2026-07-19

## Goal

A Persephone custom-editor board that opens `.docx` documents and renders them **read-only** as
formatted HTML (page layout preserved as closely as the library allows), fully offline.

## Background

**Precedent:** `boards/drawio-viewer/` is the template for a viewer board. This one, like the
Excel viewer (BT-001), reads **binary** bytes itself — it is a **`editorKind: "simple"`** board,
NOT a content-host board:

```js
const P = window.persephone;
const path = await P.getFilePath();
const b64  = await P.readFile(path, { encoding: "base64" });
const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); // ArrayBuffer/Blob for the lib
```

**Library — pick one (both open-source, both `.docx`-only, NOT legacy `.doc`):**

- **`docx-preview`** (Apache-2.0) — **preferred.** Higher-fidelity page-layout rendering straight
  from the OOXML into a DOM container (`renderAsync(blob, container)`). **Depends on JSZip** — vendor
  JSZip alongside it. Best "looks like Word" result.
- **`mammoth.js`** (BSD-2) — simpler semantic `.docx` → clean HTML (`convertToHtml`). Loses exact
  layout (margins, columns, precise spacing) but is lighter and very robust. Good fallback if
  docx-preview's fidelity/size isn't worth it.

Recommendation: start with **docx-preview**; fall back to mammoth if vendoring/size/fidelity
disappoints. Vendor the chosen lib's `dist` build (+ JSZip for docx-preview) into `lib/`.

**Legacy `.doc` is out of scope** (no pure-JS renderer) — see `doc/tasks/backlog.md`.

**Theming:** copy `board-base.css` from `drawio-viewer`; wrap the rendered document in a themed
container using `--p-*` tokens (page background, text color). docx-preview injects its own styles
for the document body — keep those scoped to the document container so they don't fight the board chrome.

## Implementation Plan

- [x] `boards/word-viewer/board-manifest.json` — `name: "Word Viewer"`, `fileMasks: ["*.docx"]`,
  **`editorPriority: 200`** (NOT 100 — `.docx` is zip-based, so it must beat archive-view's
  priority-100 claim; see the BT-001 finding), `editorName: "Word"`, `editorKind: "simple"`,
  `version: "1.0.0"`, `minAppVersion: "4.0.14"`.
- [x] `boards/word-viewer/lib/` — vendored `docx-preview` 0.4.0 **+ JSZip** 3.10.1 (+ combined
  `LICENSE`, `VERSION.txt`). Loaded via same-origin `<script>` tags, **JSZip first** (the UMD
  build reads the global `JSZip`, then exposes global `docx`).
- [x] `boards/word-viewer/board-base.css` — copied from excel-viewer.
- [x] `boards/word-viewer/icon.svg` — a document icon (Word blue).
- [x] `boards/word-viewer/index.html` — shell: top bar (file name · Reload) + a scrollable
  `#doc` container that docx-preview renders into.
- [x] `boards/word-viewer/app.js`:
  - `load()`: `getFilePath()` → `readFile(base64)` → `Blob` →
    `docx.renderAsync(blob, docEl, docEl, RENDER_OPTIONS)`. Clears `#doc` first (renderAsync
    appends). `useBase64URL: true` inlines images as `data:` URLs (offline/CSP-safe).
  - Empty state when no file; `load()` never throws (inline error overlay on parse failure).
  - Read-only; re-render on toolbar **Reload** / `board_refresh` only (simple board = no
    `onContentChange`).
- [x] `boards/word-viewer/CLAUDE.md` — board-specific notes (rewritten from scaffold).
- [x] `boards/word-viewer/WHATS-NEW.md` — `## 1.0.0` + changelog lines.

## Concerns / Open Questions

- **docx-preview's own CSS** — it ships page/section styles; verify they render correctly under
  the board CSP (all inline / same-origin, no remote font fetches). Watch `ui.log`.
- **Embedded images** — docx-preview inlines images from the docx zip (data URIs), so they should
  work offline; confirm during testing.
- **Fonts** — the document may reference fonts not installed; it falls back to system fonts. The
  board must not attempt remote font loading (CSP would block it anyway).
- **Bundle size** — docx-preview + JSZip is a few hundred KB; acceptable. If mammoth is chosen
  instead, it's smaller but lower fidelity — decide based on test output.

## Acceptance Criteria

- [x] Opening a `.docx` in Persephone opens it in the Word Viewer by default. — Verified live:
  `sample.docx` resolved to `board-editor:...word-viewer` (editorPriority 200 beat archive-view).
- [x] A document with headings, lists, tables, and an embedded image renders legibly. — Verified
  via screenshot: styled headings, bold/italic, bullet + numbered lists, a table with a bold
  Total row, and the embedded PNG (data: URL) all render on a white page.
- [x] Empty / plain open shows a clean empty state (no crash). — Verified: opening the board
  plainly shows "No file open. Open a .docx file to view it here."
- [x] Fully offline — `ui.log` clean. — Verified: `ui.log` holds only "board loaded" (no CSP
  violations / errors), including after a `board_refresh` re-render.
- [~] Editor-switch flips to the built-in editor and back. — **Mechanism-verified** (identical
  resolver to the Excel Viewer, which exposes the same "Word ↔ built-in" switch), not manually
  clicked. Left as a quick manual sanity check.

## Files Changed

| File | Change |
|------|--------|
| `boards/word-viewer/board-manifest.json` | New — `*.docx` association, `editorKind: "simple"` |
| `boards/word-viewer/index.html` | New — shell + `#doc` container |
| `boards/word-viewer/app.js` | New — read bytes → `docx.renderAsync` |
| `boards/word-viewer/lib/*` | New — vendored docx-preview + JSZip (+ licenses) |
| `boards/word-viewer/board-base.css`, `icon.svg` | New |
| `boards/word-viewer/CLAUDE.md`, `WHATS-NEW.md` | New |

## Notes

- **Library:** went with **docx-preview 0.4.0** (the preferred option) + **JSZip 3.10.1** — the
  page-accurate render is worth the ~170 KB. No fallback to mammoth needed; fidelity was good.
- **editorPriority correction:** the plan said `100`, but that ties archive-view (zip-based `.docx`)
  and loses, so the file opened as an archive. Set to `200` (same fix as BT-001). This is now
  documented in the board `CLAUDE.md` and the machine memory, and applies to BT-003 (`.pptx`) too.
- **Images:** `useBase64URL: true` inlines embedded images as `data:` URLs — verified working
  under the board CSP (the default `blob:` path was avoided to not depend on `img-src blob:`).
- **No virtualization:** docx-preview renders the whole document into the DOM at once. Fine for
  typical docs; very large ones may be slow. Documented as a v1 limit.
- **Legacy `.doc`** remains out of scope (no pure-JS renderer).
