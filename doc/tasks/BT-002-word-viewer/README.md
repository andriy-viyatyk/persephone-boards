# BT-002: Word Viewer board (.docx)

## Status

**Status:** Planned
**Priority:** Medium
**Board id:** `word-viewer`
**Started:**
**Completed:**

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

- [ ] `boards/word-viewer/board-manifest.json` — `name: "Word Viewer"`, `fileMasks: ["*.docx"]`,
  `editorPriority: 100`, `editorName: "Word"`, `editorKind: "simple"`, `version: "1.0.0"`,
  `minAppVersion: "4.0.14"`.
- [ ] `boards/word-viewer/lib/` — vendored `docx-preview` build **+ JSZip** (+ `LICENSE`,
  `VERSION.txt` for each). Load both via same-origin `<script>` tags in the right order.
- [ ] `boards/word-viewer/board-base.css` — copied from drawio-viewer.
- [ ] `boards/word-viewer/icon.svg` — a document icon.
- [ ] `boards/word-viewer/index.html` — shell: top bar (file name · Reload) + a scrollable
  `#doc` container that docx-preview renders into.
- [ ] `boards/word-viewer/app.js`:
  - `load()`: `getFilePath()` → `readFile(base64)` → `Blob`/`ArrayBuffer` →
    `docx.renderAsync(blob, document.getElementById("doc"))`.
  - Empty state when no file; `render()` never throws (inline error overlay on parse failure).
  - Read-only; re-render on toolbar **Reload** / `board_refresh` only (simple board = no
    `onContentChange`).
- [ ] `boards/word-viewer/CLAUDE.md` — board-specific notes (rewrite from scaffold).
- [ ] `boards/word-viewer/WHATS-NEW.md` — `## 1.0.0` + one line.

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

- [ ] Opening a `.docx` in Persephone opens it in the Word Viewer by default.
- [ ] A document with headings, lists, tables, and an embedded image renders legibly.
- [ ] Empty / plain open shows a clean empty state (no crash).
- [ ] Fully offline — `ui.log` clean.
- [ ] Editor-switch flips to the built-in editor and back.

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

_None yet._
