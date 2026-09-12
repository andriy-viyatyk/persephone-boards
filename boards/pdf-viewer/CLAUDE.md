# pdf-viewer — board notes

Viewer for PDF documents. Registered as a custom editor for `*.pdf`.

This board exists to move pdf.js **out of the Persephone installer** (~21 MB of vendored pdf.js
shipped to every user, PDF reader or not) and make PDF viewing an opt-in catalog install.
Persephone's built-in PDF editor still exists while this board is verified against it; it is
removed once parity is confirmed.

## How it works

The board does **not** implement a PDF viewer. It hosts pdf.js's own **unmodified stock viewer**
(`lib/pdfjs/web/viewer.html`) in a nested iframe and feeds it bytes:

1. `persephone.getFilePath()` — a readable **local** path for the source Persephone opened us for
   (`editorKind: "simple"`).
2. `persephone.readFile(path, { encoding: "binary" })` → a `Uint8Array`, which is what pdf.js
   wants. (1.0.2 moved off `"base64"`, which cost a decode and capped the board at ~400 MB.)
3. `frame.contentWindow.PDFViewerApplication.open({ data: bytes })`.

Four deliberate choices, each load-bearing:

- **Nested iframe, not a hand-written canvas viewer.** Reusing the stock viewer means search,
  thumbnails, outline, page navigation, zoom/fit, rotate, the text-selection layer, annotations,
  print and download all work with none of our code. A custom canvas viewer would mean
  re-implementing every one of them.
- **Bytes handed over directly, not via a `blob:` URL.** The nested frame shares this board's
  `board://<host>` origin, so we can reach into it and call `open({ data })`. A `blob:` URL would
  need `connect-src blob:`, which the board CSP does not grant — `connect-src` is `'self'` only.
- **The frame is loaded with an EMPTY `?file=` parameter.** The stock viewer does
  `file = params.get("file") ?? defaultUrl` then `if (file) this.open(...)`. An empty value is
  falsy, so its auto-open is suppressed. This matters because our vendored copy has pdf.js's own
  sample document pruned out — without the empty parameter the viewer would try to load a file
  that isn't there and flash an error before our `open({ data })` lands.
- **`editorSources: "any"` in the manifest, and no source-specific code.** Persephone only offers a
  non-local source (an archive entry, an `http(s)` URL) to a simple board that declares this; the
  default is `"local"`. With it declared, `getFilePath()` returns a path to a temp file Persephone
  materialized from the page's content pipe, named after the original source. So all three source
  kinds arrive through one code path — see **Sources** below for the two behavioral consequences.

## Sources

Local files, archive entries (`archive.zip!doc.pdf`) and `http(s)` URLs all work, and the board
does not distinguish between them: `getFilePath()` always yields a local path. Two consequences
the code must respect, and does:

- **The call can be slow.** For a remote PDF it completes only after the whole document has been
  downloaded (Persephone's content pipe reads all-or-nothing), so the board shows an "Opening…"
  status before awaiting it and starts the viewer frame loading in parallel.
- **The call can reject** — a missing archive entry, an HTTP failure. That is distinct from the
  `undefined` returned when the board is opened plainly rather than as a file's editor, and it is
  the only failure mode that did not exist while the board was local-only.

## The agent surface (`pages[pageId].editor.app`)

Since 1.1.0 the board publishes an AiVision model (`pdf-aivision.js`) so an agent can **read the
open document directly** instead of converting the file with an external tool. It works because
the nested viewer frame is same-origin: `frame.contentWindow.PDFViewerApplication.pdfDocument` is
a full `PDFDocumentProxy`, already parsed. Text, search, outline, metadata, and page rendering all
come from it; nothing is re-read from disk.

The model is read-only with respect to the PDF. `saveText` / `savePageImage` / `savePageImages`
only ever create new files, at an **absolute** path the agent names (a relative path would land
inside the board's own folder, so it is rejected).

Two design points worth keeping:

- **`getStats()` exists because transport is the bottleneck, not extraction.** Extracting all 14
  pages of `_test/sample.pdf` takes ~120 ms and yields 83k characters, while a `call` result is
  bounded at 20k. Reporting per-page character counts lets an agent plan its reads instead of
  discovering the limit by truncation.
- **`hasTextLayer` and `pagesWithUnreadableText` are the honesty flags.** A PDF can return no text
  (a scan) or *wrong* text (mojibake). Both are reported, and both route the agent to
  `savePageImage`, which is the actual answer. See the gotchas below.

`elements` / `highlight` are deliberately **not** implemented — see the gotcha.

The agent-facing documentation is `guides/agent.md`, which ships with the board.

## Key files

| File | Purpose |
|------|---------|
| `index.html` | Full-bleed iframe + a status overlay used for errors and the capability table |
| `app.js` | The whole board: path → bytes → `PDFViewerApplication.open`, plus the capability probes |
| `pdf-aivision.js` | The AiVision model published at `pages[pageId].editor.app` |
| `guides/` | The board's own user + agent documentation, mounted by Persephone |
| `lib/pdfjs/` | Unmodified pdf.js 5.4.530, pruned. See `lib/VERSION.txt` |
| `lib/VERSION.txt` | pdf.js version, license pointer, and exactly what was pruned + what must NOT be |

## Capability probes

`app.js` runs three probes and renders them in the status overlay whenever there is no document or
the document fails. They exist because this board is the first to need a nested iframe, a Worker,
and WebAssembly inside the board sandbox, and a CSP block otherwise presents as an unexplained
blank frame. Verified verdicts on Persephone 4.0.18:

| Probe | Directive | Verdict |
|-------|-----------|---------|
| Nested iframe | `frame-src 'self'` | works |
| pdf.js worker | `worker-src 'self'` | works |
| WebAssembly | `script-src 'wasm-unsafe-eval'` | works |

`frame-src` and `wasm-unsafe-eval` were **added to Persephone's board CSP** for this board; on an
older build the iframe fails and the overlay says so. That is why `minAppVersion` is `4.0.18`.

Keep the probes. They are cheap, they only surface on failure, and they turn "the board is blank"
into a directive name.

## Gotchas

- **The nested viewer frame gets the Persephone shim injected too.** The `board://` handler injects
  the theme palette + bridge shim into *every* `.html` it serves, including `viewer.html`. Harmless,
  but it means the shim's `contextmenu` handler replaces pdf.js's right-click menu inside the
  viewer, and the shim in that frame never completes a handshake (its parent is this board, not the
  host), so `persephone.*` inside the viewer frame is inert.
- **The viewer keeps its own light/dark styling**, independent of Persephone's theme. It does not
  follow the `--p-*` palette; only the board's status overlay does.
- **`app.editors.resolveId("x.pdf")` returns the BUILT-IN id**, not this board — that call consults
  only the built-in registry. To confirm the board actually claimed a file, check the page's
  `editor` field for `board-editor:<root>` (via `list_pages`).
- **`editorPriority` is 200 while the built-in PDF editor still exists** (it claims `.pdf` at 100,
  and ties go to the built-in). Once the built-in is removed only Monaco's `0` floor remains to
  beat, so this should drop to a low value before publishing.
- **Rendering a page MUST use `intent: "print"`.** pdf.js's default `"display"` intent drives its
  render loop with `requestAnimationFrame`, and Chromium does not fire rAF in a window that is not
  painting. An agent renders while the user is in another application, so the Persephone window is
  usually unfocused — and then `document.visibilityState` still reads `"visible"`, rAF never fires,
  and the render promise **never settles**. No error, no rejection; it surfaces only as a call
  timeout. Measured in this exact state: `display` = hang, `print` = 41 ms. `renderPage()` also
  races a 30 s timeout so a regression says so instead of hanging.
- **The render canvas MUST come from the VIEWER frame's document**, not the board's. pdf.js
  registers the PDF's fonts as font faces on the document that owns the document proxy — 12 faces
  in the viewer frame, 0 in the board frame. Render into a board-frame canvas and you get a
  pixel-perfect page layout in which **every glyph is a hollow box**, with no error anywhere. This
  is only catchable by *looking* at the output, which is why the board's verification reads the
  PNG back rather than trusting the byte count.
- **pdf.js returns prototyped objects that the AiVision resolver will not serialize.** Its metadata
  `info` reaches an agent as `"No AiVision descriptor yet for Object"` unless normalized — hence
  `toPlain()` (a JSON round-trip) in `pdf-aivision.js`.
- **No `elements` / `highlight` in the model.** `aiVision.createElements` binds `data-name`
  attributes in the **board's own** document and the highlight overlay runs there, but every viewer
  control (`#pageNumber`, `#findInput`, `#zoomInButton`) lives in the nested frame. A `highlight`
  would silently point at nothing, so none is published; `snapshot()` drives the viewer UI instead.
- **Extracted text can be wrong, not just missing.** A font with no `ToUnicode` map — routine for
  chart and figure labels — extracts as symbol soup (`$!"# %!"#`) that reads like content. It
  cannot be caught per page (on `_test/sample.pdf` the affected pages still score 0.85
  letters-per-character, because only the *figure* is garbled), so `findGarbled()` tests per token:
  4+ characters, no vowel, no digit, at least one symbol, trailing punctuation stripped. Validated
  on that fixture at 0 false positives across 12 clean pages, flagging pages 10 and 13.
- **pdf.js internals move between versions.** `PDFViewerApplication.pdfSidebar` and
  `pdfDocument._transport._worker` do not exist under those names in 5.4.530. Don't probe
  internals; drive the viewer through `eventBus` and documented `PDFViewerApplication` methods.

## Not yet supported

**Writing.** The board is read-only: no annotation persistence, no form-field save, no dirty
tracking. pdf.js's own download button still works (it saves a copy).

Transport cost is negligible on a 1 MB PDF (a few ms over the bridge), which is why the board reads
the whole file rather than streaming it.

## Test

`_test/sample.pdf` in the repo root (gitignored) is pdf.js's own 14-page sample paper — a good
fixture: real text layer, no outline, multiple pages.

```
open_board { path: "<repo>/boards/pdf-viewer" }                 → plain open shows the capability table
execute_script  app.pages.openFile("<repo>/_test/sample.pdf")   → opens in this board
list_pages                                                      → editor should be board-editor:<root>
```

Cover all three source kinds — they take different paths through Persephone even though the board
code is identical, so a local-only pass proves little:

```
app.pages.openFile("<repo>/_test/sample.pdf")            → local file
app.openRawLink("<repo>/_test/pdfs.zip!sample.pdf")      → archive entry (materialized)
app.openRawLink("https://<host>/some.pdf")               → remote URL (materialized)
```

**Testing the agent surface.** `_test/scanned.pdf` (gitignored, regenerate with the recipe below)
is an **image-only PDF with no text layer** — the fixture that proves the scanned-document path,
which `sample.pdf` cannot. Build one by wrapping any JPEG in a minimal one-page PDF whose only
content is a `DCTDecode` image XObject drawn with `q w 0 0 h 0 0 cm /Im0 Do Q`.

```
pages[pageId].editor.app.getStats()                  → sample.pdf: 14 pages, 82791 chars,
                                                       pagesWithUnreadableText [10, 13]
                                                     → scanned.pdf: hasTextLayer false + the note
pages[pageId].editor.app.getText(13, 14)             → page markers, real prose
pages[pageId].editor.app.search("trace tree")        → hits with page numbers and snippets
pages[pageId].editor.app.savePageImage("<abs>.png", 1)
```

**Always READ the rendered PNG back, don't just check it was written.** The font-realm bug
produces a correctly-sized file, a valid PNG, and a perfect page layout in which every glyph is an
empty box — byte counts and return values all look healthy.

Then check `ui.log` — it must contain only `board loaded`. A **"fake worker"** warning there means
the pdf.js Worker was blocked and parsing fell back in-thread (correct output, janky UI).

Note that a manifest edit does **not** take effect on reload: Persephone caches board manifests
until a trust change or restart, so after touching `editorSources` / `editorPriority` /
`fileMasks` you must unregister + re-register the board (or restart) before testing.
