# PowerPoint Viewer — board notes

A Persephone **simple custom-editor board**: a read-only viewer for PowerPoint decks (`.pptx`).
It renders every slide to HTML with **pptx-preview** and shows them stacked in a scrollable,
scale-to-fit view with a slide counter + prev/next. Fully **offline** (no CDN / no network).
Persephone hands the board the file **path**; the board reads the bytes itself, hands the
`ArrayBuffer` to pptx-preview, and renders — there is no write path.

> New here? The generic Persephone board authoring reference (the `persephone.*` bridge, the
> `--p-*` theme contract, CSP rules, reload/test flow) is available any time via the
> **`read_guide("boards")`** MCP tool and the bundled Demo board. This file documents only
> what's specific to *this* board.

## Purpose

Persephone opens this board as the editor for `*.pptx` files. The manifest
(`board-manifest.json`) associates it: `fileMasks: ["*.pptx"]`, `editorName: "PowerPoint"` (the
editor-switch label), `editorKind: "simple"` (the board gets a file **path**, not a content
host — it reads the bytes itself), and **`editorPriority: 200`** — see the gotcha below on why
this must be **> 100** for `.pptx`. Opened plainly (no file) it shows an empty-state message.

Legacy `.ppt` (the old binary format) is **out of scope** — there is no pure-JS renderer for it,
and pptx-preview handles only OOXML `.pptx`. See `doc/tasks/backlog.md`.

## Library choice — pptx-preview (not PPTXjs)

The task plan floated **PPTXjs**, but it drags in **jQuery** and takes its input as a **URL** it
fetches via ajax (awkward under the board CSP). We chose **pptx-preview** (1.0.7, ISC, actively
maintained) instead:

- **No jQuery.** It's a modern TS library that takes an in-memory **`ArrayBuffer`** directly —
  a perfect fit for the simple-board "read the bytes yourself" pattern.
- **Self-contained UMD.** `lib/pptx-preview.umd.js` bundles its own JSZip (unzip), echarts
  (charts), lodash, uuid, tslib — so it's the **only** library file the board needs (~1.3 MB,
  the largest of the three viewer boards, but a single offline file). See `lib/VERSION.txt`.

## How it works

1. `app.js` `load()` calls `persephone.getFilePath()`. Empty/undefined → empty-state overlay.
   Otherwise it reads the file with `persephone.readFile(path, { encoding: "base64" })`, decodes
   the base64 to a `Uint8Array`, and calls:
   ```js
   const previewer = pptxPreview.init(slidesEl, { width: 960, height: 540, mode: "list" });
   await previewer.preview(bytes.buffer);
   ```
2. pptx-preview builds a `.pptx-preview-wrapper` containing one `.pptx-preview-slide-wrapper-N`
   per slide. `mode: "list"` renders **all** slides (vs `"slide"` = one at a time). Images are
   inlined as `data:` URLs by the library (offline-safe — verified).
3. **The board owns layout + navigation.** `index.html` CSS overrides `.pptx-preview-wrapper` to
   flow naturally (its default is a fixed 1-slide-tall internally-scrolling viewport) so all
   slides stack in **our** `#scroll` container. `app.js` then:
   - `fitToWidth()` scales the whole stack to the board width via CSS **`zoom`** (Chromium; unlike
     `transform: scale`, zoom re-flows so scroll height stays correct and text stays crisp),
     recomputed on resize via a `ResizeObserver`.
   - Tracks the current slide (counter `n / total`, prev/next buttons, Arrow/PageUp-Down keys),
     and a scroll listener keeps the counter in sync with free scrolling.
4. **Read-only, no content host.** No `onContentChange`; the only re-render triggers are the
   toolbar **Reload** button and the `board_refresh` MCP tool. `load()` clears the previous render
   first and is wrapped so a parse failure degrades to an error overlay + `notify(..., "error")`.

## Fidelity caveat (set expectations)

This is the **lowest-fidelity** of the three viewers — pptx rendering in JS is approximate:

- **Animations / transitions / builds** are not rendered (static slides only).
- **Aspect ratio:** slides are rendered into a fixed **960×540 (16:9)** viewport. A 4:3 (or other)
  deck is scaled into that box, so its proportions may be slightly off. (Passing the deck's native
  slide size would fix it, but pptx-preview takes the viewport size up front; 16:9 is the common
  case. A reasonable v1 trade-off.)
- **Fonts / some shape effects / SmartArt / complex charts** may render approximately.

It's a viewer for *reading* a deck, not a pixel-faithful PowerPoint. Say so if fidelity matters.

## Key files

| File | Role |
|------|------|
| `index.html` | Page shell: top bar (file name · slide counter · prev/next · Reload) + `#scroll`/`#slides` host + `#state` overlay. Holds the `.pptx-preview-wrapper` / `.pptx-preview-slide-wrapper` CSS overrides that make slides flow + read as cards. |
| `app.js` | All logic: `load()` (path → bytes → `pptxPreview.init` + `preview`), `fitToWidth()` (zoom scaling + `ResizeObserver`), slide navigation (counter, prev/next, keys, scroll-sync), state overlay. |
| `board-manifest.json` | Simple custom-editor association (`fileMasks: ["*.pptx"]`, `editorPriority: 200`, `editorName: "PowerPoint"`, `editorKind: "simple"`). |
| `lib/pptx-preview.umd.js` | Vendored **pptx-preview** 1.0.7, ISC — the renderer. Self-contained UMD (bundles JSZip/echarts/lodash/uuid/tslib). Exposes global `pptxPreview`. |
| `lib/LICENSE`, `lib/VERSION.txt` | License texts (ISC + bundled MIT/0BSD/Apache-2.0) + vendored versions/sources. |
| `board-base.css` | Shared Persephone board theme defaults (don't recreate). |
| `icon.svg` | Board icon (slide/presentation glyph, PowerPoint orange). |
| `WHATS-NEW.md` | Short human changelog. Record changes under the next version's heading. |

## Run & test

- Open any `.pptx` file in Persephone → it opens in this board by default; the "PowerPoint" ↔
  built-in switch is in the page toolbar.
- After editing board files, reload with the in-board **Reload** button, or `board_refresh` (MCP).
  Iterate loop: edit → `board_refresh` → `browser_take_screenshot { pageId }` (screenshot, not just
  the a11y snapshot — slides are a visual thing).
- Cover: a multi-slide deck (counter + prev/next + scroll), a slide with an image, a slide with
  bullets, an empty/plain open (empty state), a reload. `ui.log` should stay clean (no CSP).
- Generate a quick test `.pptx` with **pandoc**: a markdown file with `#`/`##` headers (→ slides),
  bullets, and an `![](img.png)` image, then `pandoc deck.md -o deck.pptx` (pandoc embeds the image
  into the pptx, so the result is self-contained/offline).

## Gotchas (the non-obvious decisions)

- **`editorPriority` MUST be > 100 for `.pptx`.** A `.pptx` is a ZIP-based archive, and
  Persephone's built-in **archive-view** claims archive files at **priority 100**. The
  custom-editor resolver only lets a board win when its priority is **strictly greater** than the
  best built-in (`best.priority > builtinPriority`), so `editorPriority: 100` **ties and loses** —
  the file opens as an archive. Hence `200` (same trap the Excel and Word viewers hit).
- **Editing the manifest doesn't refresh the association live.** The custom-editor registry only
  re-reads manifests on a **trust change**. After changing `fileMasks`/`editorPriority`, re-trust
  the board (`unregisterBoard` + `registerBoard`, or restart the app).
- **Use the UMD build, not the ES build.** `pptx-preview.umd.js` bundles all deps into one file.
  The ES build (`pptx-preview.es.js`) externalizes JSZip/echarts/lodash/uuid, which you'd then have
  to vendor and wire up separately — more moving parts for no benefit here.
- **The UMD externalizes Node builtins — harmless here.** Its factory lists `stream`/`events`/
  `buffer`/`util` as externals, which resolve to `undefined` globals in the browser. Those code
  paths aren't hit during pptx rendering (verified: decks render, `ui.log` clean). Don't be alarmed
  by the `require$$0` references in the minified source.
- **CSP forbids remote network.** The renderer is vendored locally and loaded with a relative path
  — never a CDN URL. Embedded images are inlined as `data:` URLs by pptx-preview, so nothing is
  fetched.
- **We override pptx-preview's wrapper layout.** By default `.pptx-preview-wrapper` is a fixed
  `width×height` box that scrolls internally (one slide tall). The board CSS forces it to
  `height: auto; overflow: visible` so all slides stack in our own scroll container, and `app.js`
  scales the stack with `zoom`. If a future pptx-preview version renames those classes, this layout
  (and the `slideEls` query for `.pptx-preview-slide-wrapper`) needs updating.
- **`zoom`, not `transform: scale`.** Scaling uses CSS `zoom` (Chromium-only, fine in the Electron
  board) so the scroll height reflects the scaled size and `scrollIntoView` nav stays accurate.
- **Read-only.** No write path. Switch to a built-in editor to edit; this board only reads.

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- The Excel and Word viewer boards (`boards/excel-viewer/`, `boards/word-viewer/`) are the sibling
  precedents — same `editorKind: "simple"` binary-reading pattern and the same
  `editorPriority > 100` zip-based-type finding.
