# BT-003: PowerPoint Viewer board (.pptx)

## Status

**Status:** Planned
**Priority:** Low *(hardest, lowest fidelity — do last)*
**Board id:** `powerpoint-viewer`
**Started:**
**Completed:**

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

- [ ] `boards/powerpoint-viewer/board-manifest.json` — `name: "PowerPoint Viewer"`,
  `fileMasks: ["*.pptx"]`, `editorPriority: 100`, `editorName: "PowerPoint"`,
  `editorKind: "simple"`, `version: "1.0.0"`, `minAppVersion: "4.0.14"`.
- [ ] `boards/powerpoint-viewer/lib/` — vendored PPTXjs + jQuery + JSZip (+ any PPTXjs helper
  scripts/CSS it requires) with `LICENSE` / `VERSION.txt` for each. Load scripts in dependency
  order via same-origin `<script>` tags.
- [ ] `boards/powerpoint-viewer/board-base.css`, `icon.svg`.
- [ ] `boards/powerpoint-viewer/index.html` — shell: top bar (file name · slide counter ·
  prev/next · Reload) + a `#slides` container PPTXjs renders into.
- [ ] `boards/powerpoint-viewer/app.js`:
  - `load()`: `getFilePath()` → `readFile(base64)` → hand the bytes to PPTXjs (it accepts an
    ArrayBuffer/File; check the exact API for the vendored version — most builds expose a jQuery
    `$("#slides").pptxToHtml({ ... })` or a data-URL/File input).
  - Empty state when no file; `render()` never throws (inline error overlay).
  - Read-only; re-render on toolbar **Reload** / `board_refresh` only.
- [ ] `boards/powerpoint-viewer/CLAUDE.md` — board notes incl. the **fidelity caveat**.
- [ ] `boards/powerpoint-viewer/WHATS-NEW.md` — `## 1.0.0` + one line.

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

- [ ] Opening a `.pptx` in Persephone opens it in the PowerPoint Viewer by default.
- [ ] A multi-slide deck renders all slides; prev/next (or scroll) navigates them.
- [ ] Text, images, and basic shapes are legible/recognizable.
- [ ] Empty / plain open shows a clean empty state (no crash).
- [ ] Fully offline — `ui.log` clean.
- [ ] Editor-switch flips to the built-in editor and back.

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

_None yet._
