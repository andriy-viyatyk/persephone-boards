# DrawIO Viewer — board notes

A Persephone **content-host custom-editor board**: a read-only viewer for diagrams.net /
draw.io (`.drawio`) diagrams. It renders the diagram fully **offline** (no CDN / no network).
Persephone owns the file (pipe / encoding / encryption / auto-save cache / dirty state); this
board reads the content through the injected `persephone.host.*` bridge and shares that one
host with the built-in editors — switch to Monaco to edit the raw XML, switch back to see the
diagram update, Ctrl+S saves.

> New here? The generic Persephone board authoring reference (the `persephone.*` bridge,
> the `--p-*` theme contract, CSP rules, reload/test flow) is available any time via the
> **`read_guide("boards")`** MCP tool and the bundled Demo board. This file documents only
> what's specific to *this* board.

## Purpose

Persephone opens this board as the editor for `*.drawio` files. The manifest
(`board-manifest.json`) associates it: `fileMasks: ["*.drawio"]`, `editorPriority: 100`
(so it's the default editor for `.drawio`, outranking Monaco), `editorName: "DrawIO"` (the
label in the editor-switch widget — the user can flip between the diagram and the raw XML),
and `editorKind: "content-host"` (Persephone backs the board with a content host and injects
`persephone.host.*`). Opened plainly (no content host) it shows an empty-state message.

## How it works

1. `app.js` `load()` reads the current content with `persephone.host.getContent()` and
   subscribes to `persephone.host.onContentChange()` (re-render on host change). It still calls
   `persephone.getFilePath()` — but only for the file-name label in the top bar; the content
   itself comes from the host, never from `readFile`.
2. `render(xml)` (never throws) drives the view. `parsePages(xml)` splits the `<mxfile>` into
   its `<diagram>` pages (via `DOMParser`) and re-wraps **each** page into a standalone
   single-page `<mxfile>`. On unparseable / transiently-invalid XML it degrades to the inline
   error overlay rather than crashing the `onContentChange` callback (Monaco can hand us
   mid-edit XML when the host transfers back).
3. `renderPage(pageXml)` hands a page to the vendored **GraphViewer** (`lib/viewer-static.min.js`)
   by creating a `.mxgraph` div with a `data-mxgraph` JSON config and calling
   `GraphViewer.createViewerForElement(div, cb)` — but **deferred** until `#canvas` has a non-zero
   width (see Gotchas). GraphViewer decompresses encoded (`deflate`+base64) diagram bodies itself.
   It returns a promise that settles when the view is final, and keeps the viewer instance.
4. `zoomPan.onRendered()` fits the freshly-rendered diagram to the viewport and centers it, and
   drives all zoom/pan interaction (see **Zoom & pan** below).
5. For multi-page files, `renderTabs()` renders a page tab bar (see Gotchas). The top bar is
   `[ file name ][ tabs (centered) ][ Open-in-Drawing · Save (SVG/PNG) · Copy icons ]`.
6. **Copy** (the icon button; `diagramToPngBlob` + `copyPng`) rasterizes the current page's SVG
   to a PNG (2×, white background) and writes it to the clipboard with `navigator.clipboard.write`.
7. **Save** (the download+caret icon) opens a dropdown menu (`#saveMenu`) with **Save as SVG** and
   **Save as PNG**, both saving the current page to a user-chosen path via `persephone.saveFileDialog`
   + `persephone.writeFile`:
   - *SVG* (`diagramToSvgString` + `saveSvg`) serializes the rendered vector SVG (white background
     rect, natural size) — a faithful, resolution-independent export (no rasterization), mirroring
     the built-in editors' "Save as SVG".
   - *PNG* (`diagramToPngBlob` + `savePng`) reuses the Copy rasterization (2×, white background) and
     writes the blob base64-encoded (`writeFile { encoding: "base64" }`).

## Zoom & pan

The `zoomPan` controller in `app.js` is a vanilla-JS port of Persephone's built-in
`BaseImageView` (the shared zoom/pan behind the app's Image and Mermaid viewers), so the UX
matches those editors: the diagram opens **centered and zoomed-to-fit**, wheel **zooms toward
the cursor**, left-drag **pans**, and **double-click** (or clicking the bottom-right **% pill**)
resets to fit. `+`/`-`/`0` keys zoom in/out/reset. Scale is clamped to 0.1×–10×; it never
upscales past fit on reset (a small diagram sits at 100%, centered — matching the built-ins).

Layout: `#diagram` is the clipped viewport; `#canvas` fills it and is **GraphViewer's container**
(it needs a definite width to size the graph against — see Gotchas). The transform target is the
`.mxgraph` diagram box GraphViewer renders inside `#canvas`: it carries an explicit px size, so
its `offsetWidth/Height` give the true natural size (immune to the CSS transform), and it is
absolutely centered (`left/top:50%` + a `translate(-50%,-50%)` baseline) and scaled about its
center, so `translate(0,0)+scale` keeps its center pinned to the viewport center. The rendered
diagram is **SVG**, so CSS scaling is vector-crisp — no quality loss, no need for GraphViewer's
own (CSP-blocked) zoom toolbar. The view resets to fit on every content change / page switch
(same as BaseImageView resetting on `src` change).

## Content-host round-trip (the point of this board)

The host is **shared** with the built-in editors. `.drawio` opens in DrawIO by default; the
"DrawIO" ↔ raw-XML **switch** (page toolbar) transfers the *same* host to Monaco with no reload
and no data loss. Edit the XML in Monaco, switch back → the host transfers to DrawIO, its
`onContentChange` fires with the current content, and the diagram re-renders with the edits.
**Ctrl+S** saves through Persephone's pipe automatically — the board writes no save code (the
shim wires the document-level Ctrl+S). This viewer is **read-only**, so it never calls
`persephone.host.setContent()`; editing is Monaco's job (the classic source-edit / live-preview
pairing). Because Persephone owns the pipe, this now works over `https://` and inside archives
and on encrypted files too — not just plain local paths.

## The agent surface (AiVision)

`drawio-aivision.js` publishes the open diagram at `pages[pageId].editor.app`
(`window.DrawioAI.createAiVisionModel(ctx)`; `app.js` builds the `ctx` accessor bag and calls
`register()`). The board runs identically without it — nothing in `app.js` depends on the model
beyond one `contentChanged()` notification.

**Why the surface exists at all**, given that a `.drawio` is XML: the XML on disk is usually
*not* readable. draw.io compresses each `<diagram>` body (`encodeURIComponent` → raw deflate →
base64), so a file saved by the desktop or web app is a handful of base64 blobs. The board has
draw.io's own `Graph.decompress` loaded. On top of that, this is a content-host board, so the
content is what the user is *looking at* — including unsaved Monaco edits, and files inside an
archive / behind `https://` / encrypted, where there is no path to read. Both were verified
live (a page stored compressed came back as real XML; an unsaved Monaco edit was visible to the
model the moment the host transferred back).

The model parses the host content **itself** rather than reusing `parsePages()`: it needs the
decoded body, the `<object>` wrappers, absolute geometry and the edge endpoints, none of which
the render path cares about. Both walk the same ordered `<diagram>` list, so page numbers agree.

| Half | What it does |
|---|---|
| Reading | `getStats`, `describe` (the main read — shapes in reading order, containers, `A -> B: "label"`), `getShapes`, `getConnections`, `getShape`, `getText`, `search`, `getXml`, `getView` |
| Vision | `savePageImage` / `savePageSvg` / `savePageImages` — rendered **off screen**, so a read never moves the user |
| Driving | `goToPage`, `focusShape` / `clearHighlight`, `zoomToFit`, `setZoom`, `reload`, `openTextPage`, `openInDrawing`, plus `highlight()` over five declared `elements` |

`focusShape` is the point of the driving half: it switches to the shape's page, zooms to it and
rings it on screen. Unlike the PDF board, every control here lives in the board's own document,
so `createElements` / `highlight` work and are declared for the tabs, the save/copy/pencil
buttons and the zoom pill.

## Key files

| File | Role |
|------|------|
| `index.html` | Page shell: top bar (file name left · page tabs centered · Open-in-Drawing / Save (SVG·PNG dropdown) / Copy-PNG icons right), the `#saveMenu` dropdown popover, diagram viewport (`#diagram` › `#canvas`), state overlay, zoom-% pill. Inline `<script>` sets the offline globals **before** loading the viewer (see Gotchas). |
| `drawio-aivision.js` | The AiVision agent surface: parses the host XML into pages → shapes → connections (decompressing bodies via `Graph.decompress`), shapes the reads, and drives the view through the `ctx` bag. Defines `window.DrawioAI` only. |
| `guides/` | `index.md` (audience `both`, `editorId: "board"`) and `agent.md` — shipped in the ZIP and shown on the board's Info page. |
| `app.js` | All logic: `host.getContent` + `host.onContentChange` → `render` → `parsePages` → `renderTabs`/`renderPage`; the `zoomPan` controller (fit/center + wheel-zoom/drag-pan/reset, a BaseImageView port); `getFilePath` for the name label + save default-name (`currentFilePath`); `diagramToPngBlob`/`copyPng` (clipboard, natural-size); the Save menu — `diagramToSvgString`/`saveSvg` + `savePng` (`saveFileDialog` + `writeFile`) with `openSaveMenu`/`closeSaveMenu`. `render(xml)` never throws (degrades to the error overlay). No in-board refresh — a host change / the board toolbar's Reload re-renders. Also owns everything the agent surface drives: `showPageAt` (the one page-switch entry point), `renderOffscreen` (any page, without touching the view), `cellRect` (a cell id → where it was drawn) and the `ctx` bag. |
| `board-manifest.json` | Content-host custom-editor association (`fileMasks` / `editorPriority` / `editorName` / `editorKind: "content-host"`). |
| `lib/viewer-static.min.js` | Vendored jgraph/drawio GraphViewer, **v30.3.8**, Apache-2.0 (see `lib/LICENSE`, `lib/VERSION.txt`). ~4 MB, includes inlined stencils. |
| `board-base.css` | Shared Persephone board theme defaults (don't recreate). |
| `icon.svg` | Board icon. |
| `WHATS-NEW.md` | Short human changelog (one line per change). Record changes under the next version's heading (e.g. `## 1.0.2`); `board-manifest.json` `version` matches it at release. |

## Run & test

- Open any `.drawio` file in Persephone → it opens in this board by default; the "DrawIO" ↔
  raw-XML switch is in the page toolbar.
- **The content-host round-trip is the key test:** open a `.drawio` → switch to Monaco → edit
  the XML → switch back to DrawIO → the diagram reflects the edits (no reload, no data loss) →
  Ctrl+S → the file saves (tab's unsaved dot clears). Try it over an archive entry / `https://`
  URL too — the content host makes those work now.
- After editing board files, reload with the in-board **Reload** button, or `board_refresh`
  (MCP). Iterate loop: edit → `board_refresh` → `browser_snapshot { pageId }`.
- Cover: single-page, multi-page (tab bar appears), compressed diagram bodies, a **large**
  diagram (`_test/large.drawio` — starts fit-to-viewport + centered; wheel-zoom, drag-pan,
  double-click reset all work), an empty file, and a plain open (no content host → empty state).
  `ui.log` should stay clean (no CSP violations).
- **The agent-surface fixture** is `_test/drawio-aivision-test.drawio` (generated, gitignored):
  three pages — one **compressed** with a swimlane container, an HTML (`<b>`/`<br>`) label and an
  `<object>`-wrapped cell carrying custom attributes; one **plain** flowchart; one with **no
  labels at all**. That combination is what makes the decode, the container nesting, the HTML
  label, the `data` attributes and the `textChars: 0` path all testable in one file.
- Agent-surface checklist, from `call pages[<id>].editor.app`: `getStats()` (three pages, one
  flagged `pagesWithoutText`), `describe()` (containers nested, arrows as `A -> B`),
  `getXml(1)` (real XML out of a compressed page), `getShape("Postgres")` (`data` from the
  `<object>` wrapper), `focusShape("Event queue")` **then screenshot** — the ring must sit on
  that shape, not near it — `goToPage(3)`, `savePageImage(path, 3)` and read the PNG, an
  ambiguous name (refused with ids), a relative path (refused), and a Monaco round trip
  (switch → edit → switch back → `getText()` shows the unsaved edit).

## Gotchas (the non-obvious decisions)

- **CSP forbids remote network.** The board CSP blocks CDN scripts, remote stylesheets, and
  cross-host `fetch` (`connect-src 'self'`). So the viewer is **vendored locally** and the
  inline `<script>` in `index.html` repoints every base URL the bundle would otherwise resolve
  to diagrams.net (`DRAW_MATH_URL`, `STENCIL_PATH`, `IMAGE_PATH`, `mxBasePath`, …) to a
  same-origin `./lib` path, and sets `mxLoadResources = mxLoadStylesheets = mxForceIncludes =
  false`. A missing asset then becomes a harmless local 404 instead of a CSP violation. **These
  globals must be set before `viewer-static.min.js` loads.**
- **GraphViewer's built-in toolbar can't be used.** Its page/zoom toolbar needs remote
  sprite/stylesheet assets (blocked by CSP), so this board builds its **own** always-visible
  page tab bar in `app.js` (`renderTabs`) and its **own** zoom/pan (`zoomPan`, a BaseImageView
  port) instead — offline, and clearer than drawio's hover toolbar.
- **`resize:true` is required in the GraphViewer config** — that is what makes GraphViewer stamp
  an explicit px size on the `.mxgraph` box (the natural size `zoomPan` fits to). `resize:false`
  is unreliable: it renders large diagrams at natural size but leaves small ones **unprocessed
  (0×0)**. `nav:false` (own zoom/pan); `center:true` is harmless (the `.mxgraph` box already hugs
  the graph). GraphViewer fits diagrams *wider than the container* down to the container width;
  `zoomPan` then does the final fit + centering over that.
- **Rendering is deferred until `#canvas` has a non-zero width.** GraphViewer processes each
  `.mxgraph` **exactly once**, and if `processElements()` runs while the container is momentarily
  0-wide (a reflow right after a board reload), its fit-to-width collapses to nothing and the
  element is left **permanently blank** — re-calling won't recover it. This only hit *large*
  diagrams (small ones need no fit), and only *intermittently* (timing). `renderPage` therefore
  waits (via `requestAnimationFrame`) for `canvas.offsetWidth >= 1` before calling
  `processElements()`. Do not call it eagerly.
- **Multi-page rendering** works by re-wrapping each `<diagram>` back into its own `<mxfile>`
  and rendering one at a time; if the XML has no `<diagram>`, the raw file is handed to
  GraphViewer as a last resort.
- **Read-only.** It never writes content (no `persephone.host.setContent()`). It reads via
  `persephone.host.getContent()` + `persephone.host.onContentChange()`, and uses
  `persephone.getFilePath()` only for the file-name label. Saving (Ctrl+S) is Persephone's — the
  shim wires it to the host with no board code.
- **`render()` must never throw.** `onContentChange` can deliver transiently-invalid XML when
  the shared host transfers back from Monaco mid-edit; a throw would kill the callback. So
  `render(xml)` swallows parse/render failures into the inline error overlay (and deliberately
  does **not** `P.notify` — a toast per mid-edit state would be noise).
- **Copy to clipboard.** The current page's SVG rasterizes cleanly to PNG via an offscreen
  canvas (drawio's `foreignObject` HTML labels do NOT taint the canvas in Electron/Chromium,
  so `toBlob` works). `navigator.clipboard.write` works because the board runs in a secure
  context (`board://`) and Persephone grants the board frame clipboard permission (the iframe's
  `allow="clipboard-read; clipboard-write"`); it still needs a focused window + a user gesture
  (the button click), so it can't be triggered from an unfocused/automated context.
- **`createViewerForElement`, not `processElements`.** `processElements()` is a `forEach` over
  every unprocessed `.mxgraph` calling `createViewerForElement` — and it **discards the viewer it
  creates**. The instance is what holds `viewer.graph`, the only honest map from a cell id to
  where that cell was drawn, so `renderPage` calls the per-element factory directly and keeps it.
  Consequence: nothing may call `processElements()` any more, or it would process the offscreen
  host's `.mxgraph` as well.
- **A cell's state is NOT where it is drawn.** GraphViewer puts its view transform on the SVG
  draw pane (`<g transform="scale(1,1)translate(-32,-32)">`) rather than folding it into the cell
  states, so `graph.view.getState(cell)` is up to a page margin away from the shape. Measured: the
  state said 370,248 and the cylinder was drawn at 338,216 — a ring placed from the state alone
  sat a shape-width down and to the right of the thing it was pointing at, which *looks* like a
  working feature until you screenshot it. `cellRect()` maps the state through the pane's own
  `getCTM()`, which stays right whatever transform the renderer picks.
- **Rendering a page the user is not on is done OFF SCREEN.** `renderOffscreen()` builds a
  throwaway `.mxgraph` in a 1600px-wide host parked at `left:-30000px`, so `savePageImage(path, 4)`
  never yanks the user to page 4. Two traps it handles: the host needs a real width for the same
  reason `#canvas` does, and GraphViewer reports a failure by **never calling back** (it swallows
  the error into the element), so there is a 20s timeout — without it a bad page hangs an agent
  call with nothing to go on. drawio's `foreignObject` HTML labels rasterize fine from a detached
  SVG clone (verified by reading the written PNG), same as the on-screen Copy path.
- **A page switch is not done when `showPageAt` returns.** The render defers to a
  `requestAnimationFrame`, and `zoomPan.onRendered` then polls for a non-zero box before it fits.
  `renderPage` resolves only after two further frames, and `showPageAt` returns that promise —
  without it `goToPage(3)` followed by a measurement reads the PREVIOUS page. Tab clicks ignore
  the promise; the agent surface awaits it.
- **The ring lives inside the transform target.** `zoomPan.setRing` appends it to the `.mxgraph`
  box, so it pans and zooms with the diagram instead of drifting off the shape; `apply()`
  counter-scales its border (`2 / scale`), or a 2px border at 4× paints as an 8px slab. Each
  render builds a new `.mxgraph`, so `onRendered` forgets the ring with it.
- **`undefined` reaches the agent as `null`.** A result built from optional fields arrives as a
  wall of nulls that reads as "this shape has no container, no data, no label". `compact()` in
  the model drops undefined keys; a deliberate `null` (an arrow attached to nothing) survives.
- **`lightbox: false`** in the GraphViewer config — otherwise clicking the diagram tries to
  open the drawio lightbox, which under the board CSP falls back to opening `viewer.diagrams.net`
  in the browser (a dead remote page).

## Upgrading the vendored viewer

Download a newer `viewer-static.min.js` from `jgraph/drawio`
(`https://raw.githubusercontent.com/jgraph/drawio/<tag>/src/main/webapp/js/viewer-static.min.js`),
replace `lib/viewer-static.min.js`, and update `lib/VERSION.txt`. Then re-test the offline
globals still suppress remote probes (watch `ui.log` for CSP violations).
