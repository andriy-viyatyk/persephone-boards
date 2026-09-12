# Word Viewer — board notes

A Persephone **simple custom-editor board**: a read-only viewer for Word documents (`.docx`).
It renders each document **page-accurately** ("looks like Word") with **docx-preview**, fully
**offline** (no CDN / no network). Persephone hands the board the file **path**; the board reads
the bytes itself, hands them to docx-preview (which unzips the OOXML with **JSZip**), and renders
into a scrollable page container — there is no write path.

> New here? The generic Persephone board authoring reference (the `persephone.*` bridge, the
> `--p-*` theme contract, CSP rules, reload/test flow) is available any time via the
> **`read_guide("boards")`** MCP tool and the bundled Demo board. This file documents only
> what's specific to *this* board.

## Purpose

Persephone opens this board as the editor for `*.docx` files. The manifest
(`board-manifest.json`) associates it: `fileMasks: ["*.docx"]`, `editorName: "Word"` (the
editor-switch label), `editorKind: "simple"` (the board gets a file **path**, not a content
host — it reads the bytes itself), and **`editorPriority: 200`** — see the gotcha below on why
this must be **> 100** for `.docx`. Opened plainly (no file) it shows an empty-state message.

Legacy `.doc` (the old BIFF binary format) is **out of scope** — there is no pure-JS renderer for
it, and docx-preview handles only OOXML `.docx`. See `doc/tasks/backlog.md`.

## How it works

1. `app.js` `load()` calls `persephone.getFilePath()`. Empty/undefined → empty-state overlay.
   Otherwise it reads the file with `persephone.readFile(path, { encoding: "base64" })`, decodes
   the base64 to a `Uint8Array`, wraps it in a `Blob`, and calls
   `docx.renderAsync(blob, docEl, docEl, RENDER_OPTIONS)`.
2. docx-preview parses the OOXML (using the global `JSZip` to unzip it) and renders the document
   into `#doc` as one `<section class="docx">` **page** per page break, wrapped in a
   `.docx-wrapper` "desk". It injects its own `<style>` into the same container (the second
   `docEl` arg = styleContainer), so its CSS stays scoped to the document area.
3. **Read-only, no content host.** There's no `onContentChange` (that's a content-host feature);
   the only re-render triggers are the toolbar **Reload** button and the `board_refresh` MCP tool
   (which re-runs `app.js`). `load()` clears `#doc` first (renderAsync *appends*), and is wrapped
   so a parse failure degrades to an error overlay + a `notify(..., "error")` rather than crashing.

## Rendering choices (docx-preview `RENDER_OPTIONS` in `app.js`)

- **`inWrapper: true`** (default) — wraps each section as a paper **page** (white sheet, our CSS
  adds a border + shadow) on a themed "desk". This is the "looks like Word" view.
- **`breakPages: true`** — honor page breaks so multi-page documents paginate.
- **`useBase64URL: true`** — inline embedded images as **`data:` URLs** rather than the default
  `blob:` URLs. `data:` is the safe choice under the board CSP (no dependence on `img-src blob:`);
  verified working — the test doc's embedded PNG renders. Images come from the docx zip, so they
  are fully offline.
- **`ignoreFonts: false`** — use fonts **embedded in the docx** (they arrive as base64 in the zip,
  offline-safe). Documents referencing non-embedded fonts fall back to system fonts; the board
  never fetches a remote font (CSP would block it anyway).
- Headers, footers, footnotes, endnotes are all rendered.

## The agent surface (`pages[pageId].editor.app`)

Since 1.1.0 the board publishes an AiVision model (`word-aivision.js`) so an agent can **read the
open document directly** instead of converting the file with an external tool. It works because
docx-preview renders into **this board's own document** — no nested frame, no origin boundary. The
rendered DOM *is* the content, already paginated into one `section.docx` per page break.

Four deliberate divergences from `pdf-viewer`'s model, each forced by the format:

- **Markdown is the primary read, not plain text.** A PDF yields positioned glyphs, so flat prose
  is the honest ceiling. A `.docx` keeps structure, and flattening it would *destroy* information
  the document carries. `getMarkdown()` is the main read; `getText()` is the no-markup fallback.
  Both render from one shared block list, so they can never disagree about content, only markup.
- **No `hasTextLayer`, no `pagesWithUnreadableText`.** A `.docx` stores characters, so the scanned
  case and the ToUnicode-mojibake case — half the PDF model — have no analogue. Their absence is a
  fact about the format, not an omission.
- **No page renderer.** `useBase64URL: true` means every picture is already a `data:` URL in the
  DOM, so `saveImage()` is a base64 write of the document's own bytes (verified byte-identical to
  `word/media/*`), not a canvas render. None of the PDF board's rendering hazards exist here. What
  is *not* offered is an image of a whole PAGE: there is no HTML-to-canvas path, and unlike a
  scanned PDF nothing needs one.
- **`showText()` can exist here.** The PDF board could highlight nothing (its viewer controls live
  in a nested frame). Here the document is in the board's own DOM, so a `Range` around the match
  is wrapped, scrolled to, flashed, and unwrapped.

`getMetadata()` is why `app.js` retains `currentBytes`: document properties live in
`docProps/core.xml`, which docx-preview does not surface. JSZip is already loaded as the renderer's
own dependency, so it is a re-unzip of what is in memory — never a second read from disk.

The agent-facing documentation is `guides/agent.md`, which ships with the board.

## Theming

The **pages stay authentic white paper** — that's how a Word document is meant to look regardless
of the app theme. Only the **desk** behind the pages is themed (`#doc .docx-wrapper` background =
`--p-bg`) so it blends with the app, and each page gets a `--p-border` + shadow so its edges read
even when the app is in a light theme (near-white desk). The board **chrome** (top bar) uses the
`--p-*` tokens like the other viewer boards. See the `#doc .docx-wrapper` / `section.docx`
overrides in `index.html`.

## Key files

| File | Role |
|------|------|
| `index.html` | Page shell: top bar (file name · Reload) + `#doc` scroll container + `#state` overlay. Board-specific docx-preview CSS overrides (desk background, page border/shadow) live here. Loads `board-base.css`, then JS: **jszip → docx-preview → app** (order matters). |
| `app.js` | All logic: `load()` (path → bytes → `Blob` → `docx.renderAsync`), state overlay, reload wiring. `RENDER_OPTIONS` holds the docx-preview config. |
| `word-aivision.js` | The AiVision model published at `pages[pageId].editor.app` |
| `guides/` | The board's own user + agent documentation, mounted by Persephone |
| `board-manifest.json` | Simple custom-editor association (`fileMasks: ["*.docx"]`, `editorPriority: 200`, `editorName: "Word"`, `editorKind: "simple"`). |
| `lib/docx-preview.min.js` | Vendored **docx-preview** 0.4.0, Apache-2.0 — the renderer (UMD build; reads global `JSZip`, exposes global `docx`). |
| `lib/jszip.min.js` | Vendored **JSZip** 3.10.1, MIT — the ZIP reader docx-preview depends on. Must load first. |
| `lib/LICENSE`, `lib/VERSION.txt` | License texts + vendored versions/sources for both libraries. |
| `board-base.css` | Shared Persephone board theme defaults (don't recreate). |
| `icon.svg` | Board icon (document glyph, Word blue). |
| `WHATS-NEW.md` | Short human changelog. Record changes under the next version's heading. |

## Run & test

- Open any `.docx` file in Persephone → it opens in this board by default; the "Word" ↔ built-in
  switch is in the page toolbar.
- After editing board files, reload with the in-board **Reload** button, or `board_refresh` (MCP).
  Iterate loop: edit → `board_refresh` → `browser_take_screenshot { pageId }` (screenshot, not just
  the a11y snapshot — the rendered document is a visual thing).
- Cover: a document with headings, lists, tables, and an embedded image (legibility); an
  empty/plain open (empty state); a reload. `ui.log` should stay clean (no CSP).
- Generate a quick test `.docx` with **pandoc**: write a markdown file with headings/lists/a
  table/an `![](img.png)` image and run `pandoc sample.md -o sample.docx` (pandoc embeds the image
  into the docx zip, so the result is self-contained/offline). With no pandoc on PATH, a minimal
  OOXML package can be written directly with Python's `zipfile` — it needs `[Content_Types].xml`,
  `_rels/.rels`, `word/document.xml` + its `.rels`, `word/styles.xml`, and `word/numbering.xml` if
  it has lists.

**Testing the agent surface.** `_test/sample.docx` (gitignored) is a purpose-built 3-page fixture:
two heading levels, a bordered table, a bulleted AND a numbered list, an embedded PNG, page breaks,
and populated `docProps` — between them they exercise every branch of the block walker.

```
pages[pageId].editor.app.getStats()          → 3 pages, 923 chars, 1 table, 1 image
pages[pageId].editor.app.getMarkdown()       → # / ## headings, a pipe table, - and 1. lists
pages[pageId].editor.app.getOutline()        → 5 headings with levels and page numbers
pages[pageId].editor.app.getTables()         → rows as arrays
pages[pageId].editor.app.getMetadata()       → title/author/dates from docProps/core.xml
pages[pageId].editor.app.saveImage("<abs>.png", 0)
pages[pageId].editor.app.showText("...")     → scrolls + flashes, reports the page
```

**Verify a saved image by comparing it to `word/media/*` in the zip**, not by its byte count — a
hash match proves exact extraction, which is stronger than "it looked fine".

**Also cover the non-local sources** (1.1.0 added `editorSources: "any"`), since they take
different paths through Persephone even though the board code is identical:

```
pages.openFile("<repo>/_test/sample.docx")                  → local file
pages.openUrl("<repo>/_test/docs2.zip!sample.docx")         → archive entry (materialized)
```

Note that two copies of this board can be registered at once — the repo working copy and the
**installed published** one from the catalog. They both claim `*.docx`, and the installed one may
win, so you end up testing shipped code instead of your edits. Check the page's `editor` field for
the root you expect; `boards.unregisterBoard(<installed root>)` removes the installed copy's trust
without deleting it.

## Gotchas (the non-obvious decisions)

- **`editorPriority` MUST be > 100 for `.docx`.** A `.docx` is a ZIP-based archive, and
  Persephone's built-in **archive-view** claims archive files at **priority 100**. The
  custom-editor resolver only lets a board win when its priority is **strictly greater** than the
  best built-in (`best.priority > builtinPriority`), so `editorPriority: 100` **ties and loses** —
  the file opens as an archive. Hence `200` (matches the Excel Viewer, which hit the exact same
  trap). This applies to any zip-based type: `.docx`, `.pptx`, `.xlsx`, `.ods`, `.epub`, etc.
- **Editing the manifest doesn't refresh the association live.** The custom-editor registry only
  re-reads manifests on a **trust change**. After changing `fileMasks`/`editorPriority`, re-trust
  the board (`unregisterBoard` + `registerBoard`, or restart the app) or the old manifest data
  sticks and the file opens with the built-in editor.
- **Load order: JSZip before docx-preview.** docx-preview's UMD wrapper reads the **global
  `JSZip`** (and then exposes the global `docx`). If `jszip.min.js` isn't loaded first, docx-preview
  can't unzip the OOXML. See the `<script>` order in `index.html`.
- **CSP forbids remote network.** Both libraries are **vendored locally** under `lib/` and loaded
  with relative paths — never a CDN URL (blocked, silent failure). Embedded images use `data:` URLs
  (`useBase64URL: true`), embedded fonts come from the zip — nothing is fetched.
- **renderAsync *appends*.** It adds to `#doc` rather than replacing, so `load()` clears
  `docEl.innerHTML` before each render — otherwise a reload stacks the document twice (and leaves
  the previous injected `<style>` behind).
- **No virtualization.** docx-preview renders the whole document into the DOM at once (unlike the
  Excel Viewer's virtualized Tabulator). Very large documents (hundreds of pages) may render
  slowly / use a lot of memory. Acceptable for a v1 viewer; revisit if it bites.
- **Read-only.** No write path, no `persephone.writeFile` for the opened file. Switch to a built-in
  editor to edit; this board only reads.
- **docx-preview renders headings as `<p>`, not `<h1>` — the level is in the CLASS.** A Word
  "Heading 2" style becomes `class="docx_heading2"` (style id, lowercased, `docx_` prefix). There
  is no heading tag anywhere in the output, and computed font size/weight do NOT distinguish a
  heading either (measured: a heading and a body paragraph both reported 14px/400). The class is
  the only signal. `docx_title` is the document-title style and reads as an H1.
- **List items are `display: list-item`, and that is the signal to use.** The marker is a CSS
  `::before`, so `innerText` never contains it. The class `docx-num-<numId>-<ilvl>` carries the
  list identity and indent level. Ordered vs bulleted is distinguishable ONLY from the generated
  content: an ordered list's `::before` is built from `counter(...)`, a bulleted one's is a
  literal glyph (`"•\9 "`). All three facts were measured against `_test/sample.docx`, not assumed.
- **`innerText` is not good enough for reading the document.** It flattens tables to run-together
  text, drops list markers, and loses heading levels entirely. The model walks blocks instead —
  see `walkBlocks()`.
- **A `data:`-URL `<img>` is an exact copy of the packaged picture.** `saveImage()` writes the
  base64 payload straight through; verified byte-identical (same SHA-256) to `word/media/image1.png`
  inside the zip. Do not add a canvas round-trip "to normalize it" — that would only lose fidelity.
- **Base64 size estimates must subtract the padding.** `length * 3 / 4` reported 258 bytes for a
  256-byte PNG. `base64Bytes()` subtracts the trailing `=` count.
- **`Range.surroundContents()` splits text nodes, so the unwrap must move children out.** Removing
  the wrapper span directly deletes the text with it — which is exactly what happened once during
  testing and required a reload to recover. `flashRange()` re-inserts the children before removing
  the span, then calls `normalize()`; verified that after the flash expires there are zero
  `.ai-flash` spans left and the page text is unchanged.
- **The `.ai-flash` highlight uses fixed colors, not `--p-*` tokens.** It sits on the document
  page, which stays authentic white paper in every theme, so a dark-theme token would be invisible.
- **Fidelity is docx-preview's.** Most layout (headings, lists, tables, images, columns, headers/
  footers) renders well, but exotic OOXML features (complex fields, some drawing objects, tracked
  changes unless enabled) may render approximately. It's a viewer, not Word.

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- The Excel Viewer board (`boards/excel-viewer/`) is the sibling precedent — same `editorKind:
  "simple"` binary-reading pattern and the same `editorPriority > 100` zip-based-type finding.
