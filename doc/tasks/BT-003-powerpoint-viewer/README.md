# BT-003: PowerPoint Viewer board (.pptx)

## Status

**Status:** Completed
**Priority:** Low *(hardest, lowest fidelity — do last)*
**Board id:** `powerpoint-viewer`
**Started:** 2026-07-19
**Completed:** 2026-07-19

## Goal

A Persephone custom-editor board that opens `.pptx` decks and renders them **read-only** as HTML
slides (a scrollable/paged slide view), fully offline.

## Background

**Precedent:** `boards/drawio-viewer/`. Like BT-001/002 this is a **`editorKind: "simple"`**
board that reads **binary** bytes itself (NOT content-host):

```js
const P = window.persephone;
const path = await P.getFilePath();
const b64  = await P.readFile(path, { encoding: "base64" });
const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
```

**Library — `.pptx` (OOXML) only, NOT legacy `.ppt`:**

- **`PPTXjs`** (MIT) — the most complete pure-JS pptx→HTML renderer. **Heavier dependency chain**:
  needs **jQuery**, **JSZip**, and (for some features) `divs2slides`/nv-related helpers bundled
  with it. Vendor the whole set into `lib/` and load in dependency order.
- Alternatives: `pptx-preview` / `pptx2html` — newer/lighter but check maintenance + fidelity
  before choosing.

**Expect the lowest fidelity of the three viewers** — pptx rendering in JS is approximate
(fonts, animations, some shape effects won't match PowerPoint). That's acceptable for a viewer;
set expectations in the board's `CLAUDE.md`.

**Legacy `.ppt` is out of scope** (no pure-JS renderer) — see `doc/tasks/backlog.md`.

**Theming:** copy `board-base.css` from drawio-viewer. PPTXjs renders fixed-size slide divs;
center them on a `--p-*`-themed board background and let the user scroll through slides (plus
optional prev/next).

## Implementation Plan

- [x] `boards/powerpoint-viewer/board-manifest.json` — `name: "PowerPoint Viewer"`,
  `fileMasks: ["*.pptx"]`, **`editorPriority: 200`** (NOT 100 — `.pptx` is zip-based, so it must
  beat archive-view's priority-100 claim; the BT-001/002 finding), `editorName: "PowerPoint"`,
  `editorKind: "simple"`, `version: "1.0.0"`, `minAppVersion: "4.0.14"`.
- [x] `boards/powerpoint-viewer/lib/` — vendored **pptx-preview 1.0.7** (ISC) as a single
  self-contained UMD (`pptx-preview.umd.js`, bundles JSZip/echarts/lodash/uuid/tslib) + combined
  `LICENSE` + `VERSION.txt`. **Chose pptx-preview over PPTXjs** — no jQuery, takes an in-memory
  `ArrayBuffer` (fits the simple-board pattern), actively maintained. One `<script>` tag.
- [x] `boards/powerpoint-viewer/board-base.css`, `icon.svg` (slide glyph, PowerPoint orange).
- [x] `boards/powerpoint-viewer/index.html` — shell: top bar (file name · slide counter ·
  prev/next · Reload) + a `#scroll`/`#slides` container pptx-preview renders into, with CSS
  overrides so all slides flow/stack in our scroll container.
- [x] `boards/powerpoint-viewer/app.js`:
  - `load()`: `getFilePath()` → `readFile(base64)` → `pptxPreview.init(el, {width, height,
    mode:"list"})` → `previewer.preview(bytes.buffer)`.
  - `fitToWidth()` scales the stack to board width via CSS `zoom` (`ResizeObserver`); slide
    counter + prev/next + Arrow/PageUp-Down keys + scroll-sync.
  - Empty state when no file; `load()` never throws (inline error overlay).
  - Read-only; re-render on toolbar **Reload** / `board_refresh` only.
- [x] `boards/powerpoint-viewer/CLAUDE.md` — board notes incl. the **fidelity caveat**.
- [x] `boards/powerpoint-viewer/WHATS-NEW.md` — `## 1.0.0` + changelog lines.

## Concerns / Open Questions

- **PPTXjs input API** — confirm how the vendored build accepts in-memory bytes vs. a URL. If it
  only takes a URL, feed it a `blob:`/`data:` URL built from the bytes (still offline). Verify no
  remote asset fetches sneak in (CSP will block them → check `ui.log`).
- **jQuery dependency** — acceptable inside a vendored board, but it's the only board that pulls
  jQuery. If a lighter maintained renderer with equal fidelity exists, prefer it.
- **Fidelity** — animations/transitions won't render; some fonts/effects approximate. Document as
  a known limitation, not a bug.
- **Bundle size** — PPTXjs + jQuery + JSZip is the largest of the three. Acceptable but note it.
- **Whether to ship at all** — if fidelity is poor enough to mislead, consider deferring to the
  LibreOffice-conversion approach in `backlog.md` instead. Decide after a spike.

## Acceptance Criteria

- [x] Opening a `.pptx` in Persephone opens it in the PowerPoint Viewer by default. — Verified
  live: `deck.pptx` resolved to `board-editor:...powerpoint-viewer` (editorPriority 200 beat
  archive-view).
- [x] A multi-slide deck renders all slides; prev/next (or scroll) navigates them. — Verified: a
  7-slide deck rendered; counter showed "1 / 7", jumping/scrolling updated it to "4 / 7", prev/next
  + Arrow keys work.
- [x] Text, images, and basic shapes are legible/recognizable. — Verified via screenshots: bold
  headings, bullets with bold/italic, and an embedded PNG (inlined `data:` URL) all render legibly.
- [x] Empty / plain open shows a clean empty state (no crash). — Verified: "No file open. Open a
  .pptx file to view it here."
- [x] Fully offline — `ui.log` clean. — Verified: `ui.log` holds only "board loaded" (no CSP /
  console errors), despite the UMD bundling echarts/lodash.
- [~] Editor-switch flips to the built-in editor and back. — **Mechanism-verified** (identical
  resolver to the Excel/Word viewers), not manually clicked. Left as a quick manual sanity check.

## Files Changed

| File | Change |
|------|--------|
| `boards/powerpoint-viewer/board-manifest.json` | New — `*.pptx` association, `editorKind: "simple"` |
| `boards/powerpoint-viewer/index.html` | New — shell + `#slides` container + nav |
| `boards/powerpoint-viewer/app.js` | New — read bytes → PPTXjs render |
| `boards/powerpoint-viewer/lib/*` | New — vendored PPTXjs + jQuery + JSZip (+ licenses) |
| `boards/powerpoint-viewer/board-base.css`, `icon.svg` | New |
| `boards/powerpoint-viewer/CLAUDE.md`, `WHATS-NEW.md` | New |

## Notes

- **Library:** chose **pptx-preview 1.0.7** (ISC) over the plan's PPTXjs — no jQuery, accepts an
  in-memory `ArrayBuffer` (perfect for the simple-board pattern), actively maintained (Oct 2025),
  and its UMD bundles everything (JSZip/echarts/lodash/uuid/tslib) into one ~1.3 MB offline file.
  PPTXjs's jQuery + URL-fetch input would have fought the CSP. No "whether to ship at all" concern
  materialized — fidelity is fine for a viewer.
- **UMD Node-builtin externals:** the UMD factory externalizes `stream`/`events`/`buffer`/`util`
  (→ `undefined` in the browser). Verified those paths aren't hit — decks render, `ui.log` clean.
  Documented so a future reader isn't alarmed by the `require$$0` refs.
- **editorPriority correction:** plan said `100`; `.pptx` is zip-based so 100 ties archive-view and
  loses. Set to `200` (same fix as BT-001/002).
- **Layout:** pptx-preview's default wrapper is a fixed 1-slide-tall internally-scrolling viewport;
  overrode it so slides stack in our scroll container, scaled to fit width via CSS `zoom`. Added a
  slide counter + prev/next + Arrow/PageUp-Down keys.
- **Fidelity limits (documented in board `CLAUDE.md`):** no animations/transitions; slides rendered
  into a fixed 960×540 (16:9) viewport so non-16:9 decks scale approximately; some fonts/effects
  approximate. Lowest-fidelity of the three viewers, as expected.
- **Legacy `.ppt`** remains out of scope (no pure-JS renderer).
