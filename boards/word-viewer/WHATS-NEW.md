# What's New — Word Viewer

One line per change, newest first. Keep it short. Record pending changes under a heading for
the **next version** you'll release (the version `board-manifest.json` will be bumped to).

## 1.1.0

- **An AI assistant can now read the Word document you have open.** Ask it about the document and
  it reads it straight from the page — no converting the file first, and nothing leaves your machine.
- It reads the document's **structure**, not just its words: headings, tables and lists come
  through intact, so it can quote a table or summarise a section properly.
- It can search a long document for a topic, read just the pages that matter, and tell you which
  page something is on — then scroll your view there and highlight it.
- **Charts and pictures too.** It can pull an embedded image out of the document and look at it.
- It can save the document as Markdown or plain text, or save its pictures, wherever you ask.
- A `.docx` inside a `.zip`, or at a web address, now opens in this board as well.
- Requires Persephone 5.0.2.

## 1.0.3

- Added a catalog screenshot, shown on the board's card in Persephone's Search boards tab.

## 1.0.2

- Zoom the document with **Ctrl+Wheel** (also Ctrl +/-/0), with a zoom-percent pill at the bottom-right — click it to reset to 100%.

## 1.0.1

- Toolbar chrome now follows Persephone's own theme chrome color (Persephone 4.0.16+; unchanged look on older versions), with softer hover highlights.

## 1.0.0
- Read-only viewer for Word documents (`.docx`), rendered page-accurate ("looks like Word").
- Renders headings, lists, tables, embedded images, headers/footers, and footnotes.
- Fully offline — bundled renderer (docx-preview + JSZip), no network access.
