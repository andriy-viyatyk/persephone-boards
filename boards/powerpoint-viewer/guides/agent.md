---
title: "PowerPoint Viewer for agents"
audience: agent
summary: "Read an open .pptx through pages[i].editor.app: slides as Markdown in visual reading order, speaker notes, chart series data, tables, outline, search and embedded images."
---

# PowerPoint Viewer for agents

The board publishes a live model of the open deck at **`pages[pageId].editor.app`**. The deck is
already parsed and rendered inside the board, so reading it costs nothing extra: **never convert
the file with an external tool, and never re-read the bytes yourself** — that was the workaround
this model exists to remove.

Slide numbers are **1-based** everywhere, matching the counter the user sees on screen.

## Start here

```
pages[pageId].editor.app.getStats()
```

`getStats()` is the first call for any deck you have not read. It reports the slide count and each
slide's title, character, table, image and chart counts, and **whether it has speaker notes**.

```json
{ "slideCount": 6, "totalChars": 365, "totalMarkdownChars": 832, "totalTables": 1,
  "totalImages": 1, "totalCharts": 1, "slidesWithNotes": 4, "slidesWithText": 6, "scanMs": 1,
  "slides": [ { "slide": 1, "title": "Quarterly Review", "chars": 45, "markdownChars": 130,
                "tables": 0, "images": 0, "charts": 0, "hasNotes": true, "hasText": true }, … ] }
```

A `call` result is bounded (20 000 characters by default), so for a long deck read a slide range
you can receive, raise `maxLength`, or use `saveMarkdown` and read the file.

## Reading

**`getMarkdown(from, to)` is the main read — use it by default.**

| Call | What you get |
|---|---|
| `getMarkdown(from, to, options?)` | A slide range as Markdown, `## Slide N — Title` per slide |
| `getText(from, to, options?)` | The same range as plain prose, no markup |
| `getSlideMarkdown(n, options?)` | One slide |
| `getNotes(n?)` | Speaker notes per slide |
| `search(query, options?)` | `{ hitCount, slides, hits: [{ slide, match, snippet }] }` — options: `caseSensitive`, `regex`, `maxHits`, `contextChars`, `notes` |
| `getOutline()` | Every slide's `{ slide, title }`, in order |
| `getTables(n?)` | Tables as `{ slide, rowCount, columnCount, rows }` |
| `getCharts(n?)` | Chart series, categories and values |
| `getImages()` | Embedded pictures with slide, size and format |
| `getMetadata()` | Title, author, dates, and what the authoring app recorded |

Slide titles come from the deck's actual title **placeholder**, not from guessing which text is
biggest — so `getOutline()` is reliable enough to plan a read against. For a long deck, **`search`
first, then read the slides it names.**

## Read the speaker notes

`getMarkdown` includes them by default; pass `{ notes: false }` to leave them out, and
`getNotes()` returns them on their own.

They are **not written on the slides** — they are the presenter's script, and for "what is this
deck actually saying" they are frequently more informative than the bullets, which are often just
captions. A slide reading `Architecture` plus a diagram may carry its entire meaning in its notes.

`search` covers notes by default too (`{ notes: false }` to restrict it to the slides).

## Charts: read the data, not the picture

```
pages[pageId].editor.app.getCharts()
→ { count, charts: [ { index, slide, title, categories, series: [ { name, values } ] } ] }
```

These are the deck's **own** chart values. Do **not** try to read figures off the rendered chart:
the rendering carries only axis tick marks and a placeholder title, so anything you infer from it
is a guess when the exact numbers are one call away.

## Pictures

Text extraction cannot read what is inside a diagram, screenshot or SmartArt graphic. Pull it out
and look at it:

```
pages[pageId].editor.app.getImages()
→ { count, images: [ { index, slide, alt, width, height, format, bytes } ] }

pages[pageId].editor.app.saveImage("C:\\Users\\me\\AppData\\Local\\Temp\\fig1.png", 0)
→ { path, slide, width, height, format, bytes }
```

Then open that file with your own image-reading tool. `saveImages(directory)` writes them all at
once. The bytes are the deck's own embedded picture, copied out **unchanged** — not a re-render —
so what you read is exactly what the deck contains.

This matters more here than in the Word or PDF boards: **this renderer is approximate** for
SmartArt, complex shapes and some fonts. When a slide's meaning looks like it lives in a graphic,
read the graphic rather than trusting the extracted text to carry it.

There is no way to render a whole SLIDE as an image.

## Writing files

`saveMarkdown(path, from, to, options?)`, `saveText(path, from, to, options?)`,
`saveImage(path, index)` and `saveImages(directory)` are the only things that touch disk, and they
only ever create **new** files at a path you name. The open deck is never modified.

Paths must be **absolute** — a relative path would resolve inside the board's own folder, so it is
rejected with an error saying so.

## Showing the user

- `showText(query, options?)` scrolls the user's view to a phrase **and flashes it**. Options:
  `caseSensitive`, `occurrence` (default 1). It reports the slide it found the phrase on. Note it
  can only show what is **rendered**: a phrase that appears only in the speaker notes is not on
  screen and cannot be highlighted.
- `goToSlide(n)` scrolls to a slide. `currentSlide` is readable and writable and does the same.
- `openTextPage(from, to)` opens the extracted Markdown as a new page and returns its page id.

## What this model does not do

It is **read-only** with respect to the deck: no editing, no adding slides, no changing notes.

**Bulleted vs numbered is not reported.** Every body paragraph is emitted as a `-` item indented
by its real outline level. The level is exact; the marker style is not available — bullet markers
are not rendered, and in the package the style is inherited from the slide layout rather than set
on the paragraph. Do not infer numbering from the output.

Inline emphasis (bold, italic) is not carried into the Markdown — only block structure is.

Animations, transitions and builds do not exist here: you see each slide's final state.

To drive the board's own UI (the prev/next buttons, the Reload button), use the board editor's
`snapshot()` / `click()` rather than this model.
