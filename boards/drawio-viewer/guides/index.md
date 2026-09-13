---
title: "DrawIO Viewer"
audience: both
summary: "The DrawIO Viewer board: what it opens, and how an AI assistant reads and points at the diagram you have open."
editorId: "board"
---

# DrawIO Viewer

DrawIO Viewer is a Persephone **board** that opens diagrams.net / draw.io `.drawio` files. It
renders them fully offline — no internet, no diagrams.net — with a page tab bar for multi-page
files, wheel zoom, drag pan, and a zoom pill in the corner that resets the view to fit.

It is **read-only**: it never writes to the file. But it shares Persephone's content pipe with
the built-in editors, so the **DrawIO ↔ Text Editor switch** in the page toolbar is a live
round trip — edit the raw XML in Monaco, switch back, and the diagram redraws with your edits.
**Ctrl+S** saves. That also means it opens a `.drawio` from anywhere Persephone can reach one:
a file on disk, one inside a `.zip`, an `http(s)` URL, or an encrypted file.

## What you can do

- **Browse pages** — a multi-page file shows its pages as tabs across the top.
- **Zoom and pan** — the wheel zooms toward the cursor, left-drag pans, double-click (or a click
  on the zoom pill) fits the page to the window. `+` / `-` / `0` do the same from the keyboard.
- **Copy** — the copy icon puts the current page on the clipboard as a PNG, ready to paste into
  a document or a chat.
- **Save as image** — the download icon offers **SVG** (vector, resolution-independent) or
  **PNG** (2×), written wherever you choose.
- **Open in Drawing Editor** — the pencil icon opens the page as an editable copy in Persephone's
  Drawing editor. It is a copy; your `.drawio` is untouched.

## Asking an AI assistant about the diagram

The board publishes a live model of the open diagram to Persephone's agent layer, so an assistant
can read it and point at things in it.

This is worth knowing about, because a `.drawio` file is normally **unreadable from disk**:
draw.io compresses each page, so the file is mostly base64 blobs. The board has draw.io's own
decoder, so the assistant reads the real diagram — and it reads what you are *looking at*,
including edits you have not saved yet.

It can read the diagram as a **description** rather than as XML: the shapes in reading order,
which ones sit inside which container, and the arrows as "A → B: label". It can search the
labels across every page, and pull out one shape with everything attached to it.

It can also **look at the picture**. Plenty of diagrams have no words in them at all — an icon
layout, a wireframe, shapes and arrows. The assistant renders a page to an image and reads it
with its own vision, which is also what it should do when the answer depends on colour or
arrangement rather than on the words.

And it can **point**: ask *"where does billing write to the database?"* and it can switch to the
right page, zoom to that shape and draw a ring around it on screen, so you see what it means
instead of reading a description of where to look. It can also ring one of the board's own
buttons when it is telling you which control to press.

### What it will not do

- **It cannot change the diagram.** The board never writes content back, so nothing the assistant
  does can modify the file. Images it saves are new files, at a path it tells you.
- **It renders off screen.** Saving a picture of page 4 does not move you to page 4 — only the
  actions meant to point at something (switching pages, zooming, ringing a shape) change what
  you see.
