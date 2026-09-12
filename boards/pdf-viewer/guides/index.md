---
title: "PDF Viewer"
audience: both
summary: "The PDF Viewer board: what it opens, and how an AI assistant reads the document you have open."
editorId: "board"
---

# PDF Viewer

PDF Viewer is a Persephone **board** that opens `.pdf` documents. It hosts Mozilla's
**pdf.js** viewer, so the reading experience is the familiar one: search, thumbnails, the
document outline, page navigation, zoom and fit, rotate, text selection, and print.

It is **read-only**. Nothing you do in the board changes the PDF. pdf.js's own download button
still works and saves a copy.

It opens a PDF from anywhere Persephone can reach one: a file on disk, a PDF inside a `.zip`,
or an `http(s)` URL.

## Letting an assistant read the document

This is the part worth knowing about. With a PDF open, you can simply ask your AI assistant
about it — "summarise this", "what does it say about pricing?", "pull the figures out of the
table on page 4" — and it reads the document **directly from the page you are looking at**.

There is no conversion step, no export, and no upload: the document is already parsed inside the
board, and the assistant reads it there. Nothing is sent anywhere.

A few things follow from that:

- **It can tell you where something is.** Ask where a topic is discussed and it can search the
  whole document and answer with page numbers, then read just those pages.
- **Scanned documents work.** If a PDF is a scan — a picture of a page with no real text in it —
  the assistant renders the page to an image and reads that instead. Older scanned contracts,
  invoices and forms are all readable.
- **It can show you what it read.** Ask it to open the extracted text and it appears as a new
  Markdown page next to the PDF.
- **It can save pieces for you.** A page as a PNG or JPEG, or the text of a page range as a text
  file, written wherever you ask.

One honest limitation: the text inside **charts and figures** sometimes extracts as meaningless
symbols, because the font embedded for those labels carries no character map. The assistant is
told when that happens, and reads the page as an image instead rather than guessing.

## For agents

The model and every method are documented in
[PDF Viewer for agents](./agent.md).
