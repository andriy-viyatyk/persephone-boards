---
title: "PDF Viewer for agents"
audience: agent
summary: "Read an open PDF through pages[i].editor.app: text by page range, search, outline, metadata, and page images for scanned documents."
---

# PDF Viewer for agents

The board publishes a live model of the open PDF at **`pages[pageId].editor.app`**. The document
is already parsed by pdf.js inside the board, so reading it costs nothing extra: **never convert
the file with an external tool, and never re-read the bytes yourself** — that was the workaround
this model exists to remove.

Page numbers are **1-based** everywhere, matching what the viewer shows the user.

## Start here

```
pages[pageId].editor.app.getStats()
```

`getStats()` is the first call for any document you have not read. It reports the page count and
the **character and line count of every page**, which is what lets you decide how to read the
document rather than discovering the size by hitting a truncated result.

```json
{ "pageCount": 14, "totalChars": 82791, "totalLines": 1490,
  "pagesWithText": 14, "hasTextLayer": true, "scanMs": 537,
  "pagesWithUnreadableText": [10, 13],
  "pages": [ { "page": 1, "chars": 5021, "lines": 85, "hasText": true }, … ] }
```

A `call` result is bounded (20 000 characters by default). A 14-page paper is ~83 000 characters,
so **most documents cannot be read in one call** — read a page range you can receive, or raise
`maxLength`, or use `saveText` and read the file.

## Reading

| Call | What you get |
|---|---|
| `getText(from, to)` | Text of a page range, with a `--- page N ---` marker between pages |
| `getPageText(n)` | One page, no marker |
| `search(query, options?)` | `{ hitCount, pages, hits: [{ page, match, snippet }] }` — options: `caseSensitive`, `regex`, `maxHits`, `contextChars` |
| `getOutline()` | Bookmarks flattened to `{ title, level, page }`, so "chapter 4 starts on page 37" |
| `getMetadata()` | Title, author, producer, creation date, and XMP when present |
| `getPageLabels()` | Printed labels (`i`, `ii`, `1`) when they differ from page position |

For a long document, **`search` first, then read the pages it names.** Reading 200 pages to find
one clause is the wrong shape.

Text is joined in pdf.js's content-stream order, which reproduces reading order well — including
multi-column pages. No layout reconstruction is attempted, because the heuristics for it read
worse than the plain order when they guess wrong.

## Two ways text is not there

**1. The PDF is a scan.** `hasTextLayer: false` and every page has `chars: 0`. pdf.js does no OCR,
so `getText()` has nothing to return and says so instead of returning `""`. Render the page and
read the picture:

```
pages[pageId].editor.app.savePageImage("C:\\Users\\me\\AppData\\Local\\Temp\\p1.png", 1)
→ { path, page, width, height, format, bytes }
```

Then open that file with your own image-reading tool. This is the whole answer for scanned
contracts, invoices and forms — and equally for a figure, chart or dense table on a page that
*does* have text.

**2. The text is mojibake.** When an embedded font carries no `ToUnicode` map — routine for the
labels inside charts — the text extracts as symbol soup like `$!"# %!"#`. This is worse than
missing text, because it reads like content. `getStats()` reports those pages in
`pagesWithUnreadableText` with a sample. The prose around them is still correct.
**Never interpret a garbled run — render that page and read the image.**

## Images

| Call | Use |
|---|---|
| `savePageImage(path, n, options?)` | One page to an absolute path. **Preferred.** |
| `savePageImages(directory, from, to, options?)` | A range into a directory as `page-01.png`, … |
| `getPageImage(n, options?)` | A base64 data URL — usually far too large for a call result; prefer the file |

Options: `scale` (default `1.5`, max `4` — 1.5 puts a Letter page at ~918×1188, legible without
being huge), `format` (`"png"` or `"jpeg"`), `quality` (JPEG, default `0.85`).

## Writing files

`saveText(path, from, to)` and the two image calls are the only things that touch disk, and they
only ever create **new** files at a path you name. The open PDF is never modified.

Paths must be **absolute** — a relative path would resolve inside the board's own folder, so it is
rejected with an error saying so.

## Showing the user

- `goToPage(n)` scrolls the user's view, so they are looking at the page you are discussing.
  `currentPage` is readable and writable and does the same thing.
- `openTextPage(from, to)` opens the extracted text as a new Markdown page and returns its page id.

## What this model does not do

There are **no `elements` and no `highlight`**. Every control of the viewer UI (the page field,
the find bar, the zoom buttons) lives in a nested iframe, and the element-highlight overlay only
reaches the board's own document, so a `highlight` here would silently point at nothing. To drive
the viewer's UI, use the board editor's own `snapshot()` / `click()` / `type()` instead.

It is also read-only with respect to the PDF: no annotation, no form filling, no page editing.
