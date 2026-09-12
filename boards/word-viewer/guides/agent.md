---
title: "Word Viewer for agents"
audience: agent
summary: "Read an open .docx through pages[i].editor.app: Markdown with headings, tables and lists intact, search, outline, tables as data, and embedded images."
---

# Word Viewer for agents

The board publishes a live model of the open Word document at **`pages[pageId].editor.app`**. The
document is already parsed and rendered inside the board, so reading it costs nothing extra:
**never convert the file with an external tool, and never re-read the bytes yourself** — that was
the workaround this model exists to remove.

Page numbers are **1-based** everywhere, matching the pages the user sees on screen.

## Start here

```
pages[pageId].editor.app.getStats()
```

`getStats()` is the first call for any document you have not read. It reports the page count and
the character, line, table and image count of **every page**, which is what lets you decide how to
read the document rather than discovering its size by hitting a truncated result.

```json
{ "pageCount": 3, "totalChars": 923, "totalMarkdownChars": 1029, "totalLines": 24,
  "totalTables": 1, "totalImages": 1, "pagesWithText": 3, "scanMs": 1,
  "pages": [ { "page": 1, "chars": 338, "markdownChars": 393, "lines": 9,
               "tables": 1, "images": 0, "headings": 2, "hasText": true }, … ] }
```

A `call` result is bounded (20 000 characters by default), so for anything long, read a page range
you can receive, raise `maxLength`, or use `saveMarkdown` and read the file.

## Reading

**`getMarkdown(from, to)` is the main read — use it by default.** Unlike a PDF, a `.docx` carries
real structure, and this preserves it:

| In the document | In the Markdown |
|---|---|
| Heading 1 … Heading 6 | `#` … `######` |
| Table | A pipe table, first row as the header |
| Bulleted list | `- item`, indented by its level |
| Numbered list | `1. item` (Markdown renumbers, so a partial page range stays correct) |
| Hyperlink | `[label](target)` |
| Embedded picture | `![alt]()` — a marker, not the data; see **Pictures** below |

| Call | What you get |
|---|---|
| `getMarkdown(from, to)` | A page range as Markdown, with a `--- page N ---` marker between pages |
| `getText(from, to)` | The same range as plain prose, no markup |
| `getPageMarkdown(n)` | One page, no page marker |
| `search(query, options?)` | `{ hitCount, pages, hits: [{ page, match, snippet }] }` — options: `caseSensitive`, `regex`, `maxHits`, `contextChars` |
| `getOutline()` | Headings flattened to `{ title, level, page }` — the document's shape before you read it |
| `getTables(page?)` | Tables as `{ page, rowCount, columnCount, rows }`, rows as arrays of cell strings |
| `getMetadata()` | Title, author, dates, and what the authoring app recorded |

For a long document, **`search` first, then read the pages it names.** Reading 200 pages to find
one clause is the wrong shape.

Use **`getTables()`** rather than re-parsing figures back out of the Markdown — it gives you the
cells as data, already separated.

## Text is always real here

A `.docx` stores characters, not glyph outlines. There is **no scanned-document case and no
garbled-font case** — the two failure modes that dominate reading a PDF do not exist in this
format. If `getMarkdown` reports a page is empty, that page is genuinely empty. Check
`getImages()` in that case: the content may be a picture.

## Pictures

Text extraction cannot read what is inside a chart, diagram or screenshot. Pull it out and look
at it:

```
pages[pageId].editor.app.getImages()
→ { count, images: [ { index, page, alt, width, height, format, bytes } ] }

pages[pageId].editor.app.saveImage("C:\\Users\\me\\AppData\\Local\\Temp\\fig1.png", 0)
→ { path, page, width, height, format, bytes }
```

Then open that file with your own image-reading tool. `saveImages(directory)` writes them all at
once. The bytes are the document's own embedded picture, copied out **unchanged** — not a
re-render — so what you read is exactly what the document contains.

There is **no way to render a whole page as an image**, and nothing here needs one: the text is
never missing.

## Writing files

`saveMarkdown(path, from, to)`, `saveText(path, from, to)`, `saveImage(path, index)` and
`saveImages(directory)` are the only things that touch disk, and they only ever create **new**
files at a path you name. The open document is never modified.

Paths must be **absolute** — a relative path would resolve inside the board's own folder, so it is
rejected with an error saying so.

## Showing the user

- `showText(query, options?)` scrolls the user's view to a phrase **and flashes it**, so they can
  see exactly what you are referring to. Options: `caseSensitive`, `occurrence` (default 1). It
  reports the page it found the phrase on.
- `goToPage(n)` scrolls to a page. `currentPage` is readable and writable and does the same thing.
- `openTextPage(from, to)` opens the extracted Markdown as a new page and returns its page id.

## What this model does not do

It is **read-only** with respect to the document: no editing, no comments, no tracked changes.

Inline emphasis (bold, italic) is **not** carried into the Markdown — only block structure is.
Deliberate: within a sentence it rarely changes meaning, and reconstructing it from the rendered
spans produced more noise than signal.

Repeating page headers and footers are kept out of the body text and appended to the page as a
`_[page header/footer]_` line, so running furniture does not bury the content — but footnotes,
which render into the same area, are not silently dropped.

To drive the board's own UI (the Reload button, the zoom pill), use the board editor's
`snapshot()` / `click()` rather than this model.
