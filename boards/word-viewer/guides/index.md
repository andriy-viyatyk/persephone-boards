---
title: "Word Viewer"
audience: both
summary: "The Word Viewer board: what it opens, and how an AI assistant reads the document you have open."
editorId: "board"
---

# Word Viewer

Word Viewer is a Persephone **board** that opens `.docx` documents. It renders them
page-accurately — headings, lists, tables, embedded pictures, headers and footers, and footnotes
all appear as they do in Word, on white paper pages you scroll through. Zoom with **Ctrl+Wheel**
(or Ctrl +/−/0); the percentage pill at the bottom-right resets to 100% when clicked.

It is **read-only**. Nothing you do in the board changes the document. To edit one, switch to
another editor from the page toolbar.

It opens a `.docx` from anywhere Persephone can reach one: a file on disk, a document inside a
`.zip`, or an `http(s)` URL.

Legacy `.doc` files — the old binary Word format — are not supported.

## Letting an assistant read the document

This is the part worth knowing about. With a document open, you can simply ask your AI assistant
about it — "summarise this", "what does the risk section say?", "pull the numbers out of the
budget table" — and it reads the document **directly from the page you are looking at**.

There is no conversion step, no export, and no upload: the document is already parsed inside the
board, and the assistant reads it there. Nothing is sent anywhere.

A few things follow from that:

- **It reads the structure, not just the words.** Headings, tables and lists arrive intact, so it
  can quote a table properly or summarise one section rather than blurring the whole document
  together.
- **It can tell you where something is.** Ask where a topic is discussed and it can search the
  whole document, answer with page numbers, then read just those pages.
- **It can point at things.** Ask it to show you a phrase and it scrolls your view to it and
  highlights it for a moment.
- **It can look at your charts.** A chart, diagram or screenshot pasted into the document is a
  picture, and words cannot describe what is inside it — so the assistant pulls the picture out
  and looks at it directly.
- **It can save pieces for you.** The document as Markdown or plain text, or any of its pictures,
  written wherever you ask.

Unlike a PDF, a Word document always contains real text, so there is no scanned-document case
here: if the assistant says a page is empty, that page really is empty.

## For agents

The model and every method are documented in
[Word Viewer for agents](./agent.md).
