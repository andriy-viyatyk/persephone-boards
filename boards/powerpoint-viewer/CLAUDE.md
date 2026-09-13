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

## The agent surface

`pptx-aivision.js` publishes a live model of the open deck at `pages[pageId].editor.app` via
`persephone.aiVision.expose(root)`, so an agent reads the deck **from the rendered DOM** instead of
shelling out to a converter. `app.js` builds it from `window.PPTXAI.createAiVisionModel(ctx)`,
passing a small `ctx` (slide host, file path/name, retained bytes, current slide, scroll-to-slide);
the model owns everything else. `guides/` documents it for users and agents.

Published: `getStats` (read first), `getMarkdown` / `getText` / `getSlideMarkdown`, `getNotes`,
`search`, `getOutline`, `getTables`, `getCharts`, `getImages`, `getMetadata`, the `save*` family,
and `goToSlide` / `showText` / `openTextPage`.

**It is a hybrid: rendered DOM + a re-unzip of the package.** The DOM gives text, tables and
pictures; the package gives what the renderer never draws — speaker notes, chart series data and
the authoritative slide title. Both halves are needed; see the gotchas below for why.

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
| `board-manifest.json` | Simple custom-editor association (`fileMasks: ["*.pptx"]`, `editorPriority: 200`, `editorName: "PowerPoint"`, `editorKind: "simple"`, `editorSources: "any"`, `guides: "guides"`). |
| `pptx-aivision.js` | The AiVision agent surface — the whole agent-facing model. Defines `window.PPTXAI` only; `app.js` constructs it. Loaded before `app.js`. |
| `guides/` | Board guides (`index.md` user-facing, `agent.md` agent-facing), declared as `"guides": "guides"` in the manifest. |
| `lib/jszip.min.js` | JSZip 3.10.1 (MIT) — vendored SEPARATELY for the agent surface; pptx-preview's own copy is bundled and not reachable. See the gotcha below. |
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

### Testing the agent surface

The fixture that matters is built with **python-pptx** (`pip install python-pptx`) and must keep
all six cases, because each one caught a real defect: a **title slide**, **multi-level bullets**,
a **table**, an **embedded picture**, a **chart**, **speaker notes on non-consecutive slides**
(1, 2, 4, 6 — this is what proves the rels mapping), and a slide whose shapes are added
**bottom-first** (this is what proves the geometric sort). Keep it in `_test/` — gitignored.

Read it back through the model, not just the DOM:

```
pages[id].editor.app.getStats()        → slide count, titles, per-slide counts, hasNotes
pages[id].editor.app.getMarkdown()     → slide 5 must read TOP before BOTTOM
pages[id].editor.app.getNotes()        → must report slides 1, 2, 4, 6 (not 1-4)
pages[id].editor.app.getCharts()       → exact series values, no 图表标题 in the output
```

**Verify a saved image by hashing it against `ppt/media/*` in the package**, not by its byte
count — a hash match proves exact extraction, which is stronger than "it looked fine".

**Verify `showText` leaves the DOM intact.** After ~3s: `.ai-flash` count back to 0, the wrapped
text still present, and no split text nodes. A broken unwrap deletes slide text silently.

**Also cover the non-local sources** (1.1.0 added `editorSources: "any"`), since they take
different paths through Persephone even though the board code is identical:

```
pages.openFile("<repo>/_test/sample.pptx")                  → local file
pages.openUrl("<repo>/_test/decks.zip!sample.pptx")         → archive entry (materialized)
```

Two traps around registration:

- Two copies of this board can be registered at once — the repo working copy and the **installed
  published** one from the catalog. Both claim `*.pptx` and the installed one may win, so you end
  up testing shipped code instead of your edits. Check the page's `editor` field for the root you
  expect; `boards.unregisterBoard(<installed root>)` removes the installed copy's trust without
  deleting it.
- After changing `fileMasks` / `editorPriority` / **`editorSources`**, the association does not
  refresh live — the registry only re-reads manifests on a **trust change**. Symptom seen in
  practice: a `.zip!deck.pptx` entry kept opening in **archive-view** with no board option in
  `editorSwitches`. Fix: `unregisterBoard` + `registerBoard` (the user must answer the trust
  dialog), or restart the app.

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
- **The vendored `pptx-preview.umd.js` is patched — keep the patch on re-vendor.** Its picture
  (`p:pic`) parser read `r.rels[f].target` with no null-guard (every sibling case null-guards).
  When a slide's picture actually lives on its **slideLayout/slideMaster** (a template logo), the
  blip's `r:embed` is resolved against the *slide's* rels context — not found — so the lookup threw
  and pptx-preview dropped the **whole slide** from the model. A real 12-slide deck loaded as 1
  slide. Patched to skip an unresolvable-rel picture instead of crashing the slide
  (`(g=(r.rels[f]||{}).target)&&(...)`). All slides now load; properly-embedded images are
  unaffected (verified: a deck's 4 embedded images still render); only the unresolvable layout
  logo is omitted. See `lib/VERSION.txt` for the exact before/after. **Re-apply if you re-vendor.**
- **DOM order is NOT reading order — this is the big one.** A slide is a canvas: pptx-preview
  emits shapes in the deck's shape/z order, which is AUTHORING order. Measured with a fixture whose
  bottom textbox was added first — the DOM emits the footer before the headline. `pptx-aivision.js`
  therefore reads each shape's pixel `left`/`top` and sorts blocks by them (same-row shapes, within
  12px, ordered left-to-right). Drop that sort and slides come out scrambled SILENTLY, and only on
  the decks where it matters. Keep the fixture's out-of-order slide.
- **Tables and pictures are not `.shape-wrapper`.** Only text shapes get that class. A table and a
  picture are emitted as bare **unclassed** positioned `<div>` siblings, and a chart as
  `.chart-node`. A walk restricted to `.shape-wrapper` reports a table slide as title-only — it
  LOOKS like the renderer dropped the content when it did not. Walk all `.slide-wrapper` children
  and classify by content (`querySelector("table") / ("img")` / the chart class).
- **Speaker notes are never rendered, so the package is re-opened.** Verified: no notes text
  anywhere in the DOM, and `pptxPreview` exposes only `init` — the previewer object has render
  methods and **no parsed-model accessor**, so there is no back door. Notes are often the real
  narrative of a deck, so the surface re-unzips the retained bytes to read
  `ppt/notesSlides/*.xml`. Same pass also reads `ppt/charts/*.xml` and the title placeholder.
- **JSZip must be vendored a SECOND time.** pptx-preview bundles its own JSZip *internally* and
  exposes no global (`typeof JSZip === "undefined"` with the UMD loaded). So the agent surface
  cannot borrow it and `lib/jszip.min.js` is vendored alongside — the same file the Word Viewer
  board uses. It re-unzips bytes ALREADY IN MEMORY; never a re-read from disk.
- **Map notes to slides through the rels, never by file-name index.** `notesSlideN.xml` is
  numbered by creation order, so a deck with notes on slides 1, 2, 4 and 6 has
  `notesSlide1..4` — index alignment would attribute them to slides 1-4. Resolve
  `ppt/slides/_rels/slideN.xml.rels` instead. Slide ORDER likewise comes from `presentation.xml`'s
  `sldIdLst` through the presentation rels, not from the `slideN.xml` names.
- **Every placeholder renders as `shape-undefined`** — the DOM carries no title/body distinction,
  so title-vs-body from the DOM alone is only a font-size guess. The package has
  `<p:ph type="title"/>` (or `ctrTitle`), which is what `getOutline()` and the `## Slide N — Title`
  headings use. The matching body text block is skipped by title-string equality so it is not
  repeated.
- **Don't read chart figures off the rendering.** Charts render as `.chart-node` with an echarts
  **SVG**, so the text is extractable — but it is only axis ticks, plus a leaked echarts default
  title `图表标题` ("Chart Title") that is pure noise. The real series/categories/values are in
  `ppt/charts/chart1.xml`; that is what `getCharts()` returns.
- **Bullet marker style is deliberately NOT reported.** Markers are not rendered (no `::before`
  content, nothing in `innerText`), and in the package the bullet style is inherited from the slide
  layout/master rather than set on the paragraph — a normally authored deck has no `buChar` on its
  own paragraphs at all. Resolving it means walking master inheritance for little gain. Indent
  LEVEL, though, is exact: `padding-left` is 36px per level. Body paragraphs are emitted as `-`
  items at their level, and both guides say the marker style is unavailable.
- **Base64 padding skews the reported image size.** `floor(len * 3 / 4)` overstates a payload by up
  to 2 bytes; subtract the `=` padding. Verified: a 179-byte PNG reports 179, and the saved file is
  byte-identical (same SHA-256) to `ppt/media/image1.png` in the package.
- **`.ai-flash` uses fixed colors, not `--p-*` tokens.** It sits ON the slide, which stays white
  paper in every theme, so a dark-theme token would be invisible there.
- **Unwrapping the flash span must move its children out first.** `span.remove()` deletes the
  wrapped TEXT with it — silently corrupting the rendered slide. Re-insert the children before
  removing the span, then `normalize()` the parent.
- **Read-only.** No write path. Switch to a built-in editor to edit; this board only reads.

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- The Excel and Word viewer boards (`boards/excel-viewer/`, `boards/word-viewer/`) are the sibling
  precedents — same `editorKind: "simple"` binary-reading pattern and the same
  `editorPriority > 100` zip-based-type finding.
