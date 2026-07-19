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
  into the docx zip, so the result is self-contained/offline).

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
- **Fidelity is docx-preview's.** Most layout (headings, lists, tables, images, columns, headers/
  footers) renders well, but exotic OOXML features (complex fields, some drawing objects, tracked
  changes unless enabled) may render approximately. It's a viewer, not Word.

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- The Excel Viewer board (`boards/excel-viewer/`) is the sibling precedent — same `editorKind:
  "simple"` binary-reading pattern and the same `editorPriority > 100` zip-based-type finding.
