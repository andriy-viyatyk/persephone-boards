---
title: "DrawIO Viewer for agents"
audience: agent
summary: "Read a .drawio diagram through pages[i].editor.app: decompressed XML, shapes and connections as data, a describe() rendition, page images for vision, and focusShape to point the user at a box."
---

# DrawIO Viewer for agents

The board publishes a live model of the open diagram at **`pages[pageId].editor.app`**.

**Do not read the `.drawio` file yourself.** draw.io compresses each page by default
(`encodeURIComponent` → raw deflate → base64), so the file is usually a handful of opaque blobs;
and this is a content-host board, so what is on screen may include edits the user has not saved,
and may come from inside an archive or from a URL where there is no path to open. This model has
draw.io's own decoder loaded and reads what the user is looking at.

## Start here

```js
pages[pageId].editor.app.getStats()
```

Every page with its shape and connection counts and how much label text it carries, plus whether
the file is compressed.

Then the main read:

```js
pages[pageId].editor.app.describe()        // the current page
pages[pageId].editor.app.describe("all")   // every page
```

`describe()` is the diagram as prose: shapes in reading order with their containers, then the
arrows as `A -> B: "label"`. It is far smaller and far clearer than the XML, and it is what you
want unless you are computing over the diagram.

## Reading

| Call | Gives you |
|---|---|
| `describe(page?, options?)` | The page as Markdown — shapes, containers, connections. `{ maxChars, ids }` |
| `getShapes(page?)` | Shapes as data: id, text, kind, container, absolute position and size, custom attributes |
| `getConnections(page?)` | Arrows as data: label, and the id + text at each end |
| `getShape(ref, page?)` | One shape in full, including every connection into and out of it |
| `getText(page?)` | Just the labels, one per line |
| `search(query, options?)` | Shapes and connections whose text matches, across every page |
| `getXml(page?)` | The DECOMPRESSED mxGraphModel XML — what the file would hold uncompressed |
| `getView()` | What is on screen: page, zoom, diagram size, which shape is ringed |

Geometry is **absolute**, resolved through container chains: a box inside a swimlane reads at its
real position on the page, not at its offset from the lane. Labels are resolved from HTML
(`<b>API gateway</b><br>rate limiting` reads as `API gateway\nrate limiting`), and an `<object>`
wrapper's custom attributes come back as `data`.

## When there is nothing to read

A page with **`textChars: 0`** is a picture — an icon layout, a wireframe, shapes and arrows with
no words. `getText()` will honestly return nothing, and no amount of XML will tell you what it
shows.

```js
app.savePageImage("C:\\Users\\you\\Temp\\page-2.png", 2)   // then open the file and look at it
```

Reach for it in one more case: whenever the answer depends on **colour, icons, or spatial
arrangement** rather than on the words. The labels do not tell you that two boxes sit inside the
same dashed region; the image does.

`savePageImage` renders **off screen** — it does not move the user to that page. `savePageSvg`
writes vector instead, and `savePageImages(directory)` does every page. Every path must be
absolute; a relative one is refused rather than written inside the board's own folder.

## Referring to a shape

Anywhere a shape reference is asked for, pass its **id** or its **text**. Ids are stable but often
generated (`2_HGaZ8rQZ-xVyPUt0K-3`), so text is usually what you have. Two boxes may legitimately
say the same thing: an ambiguous text is **refused**, listing the ids that matched, rather than
resolved to whichever came first. Take the refusal and pass an id.

## Pointing at something

| Call | Does |
|---|---|
| `focusShape(ref, options?)` | Switch to the shape's page, zoom to it, and ring it on screen |
| `clearHighlight()` | Remove the ring |
| `goToPage(page)` | Switch the page tab. A 1-based number or a page name |
| `zoomToFit()` / `setZoom(scale)` | The zoom the user sees |
| `highlight(name, message)` | Ring one of the BOARD's own controls — see `elements` |
| `reload()` | Re-read from the content host and re-render |
| `openTextPage(page?)` | Open `describe()` as a new Markdown page for the user |
| `openInDrawing()` | Open the current page as an editable copy in the Drawing editor |

**`focusShape` is how you point.** When you are talking about one box, ring it — the user then
sees which one you mean instead of decoding a description of where to look. It searches the
current page first, then the rest of the file, so a name from `describe()` is enough.

`currentPage` is writable, and assigning to it is the same as `goToPage`.

## Not features

- **No writing.** The board never sends content back to the host, so nothing here can modify the
  diagram. `save*` writes NEW files at absolute paths you name.
- **No editing of shapes, styles or layout.** To change a diagram, the user switches the page to
  the Text Editor and edits the XML — you can tell them so, and `highlight()` cannot reach that
  control because it belongs to Persephone's page toolbar, not to this board.
- **A shape that is not drawn cannot be ringed.** `focusShape` reads the position from the live
  renderer, so a collapsed or hidden cell is refused with that reason rather than ringed at a
  guessed place.
