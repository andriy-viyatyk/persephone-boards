# What's New

## 1.1.0

- **An AI assistant can now read the PDF you have open.** Ask it about the document and it reads
  the text straight from the page — no converting the file first, and nothing leaves your machine.
- It can search a long PDF for a topic, read just the pages that matter, and tell you which page
  something is on.
- **Scanned PDFs work too.** Where there is no text to extract, the assistant renders the page as
  an image and reads that instead — so a scan is no longer a dead end.
- It can also save a page as a PNG or JPEG, or the text as a file, wherever you ask.
- Requires Persephone 5.0.2.

## 1.0.2

- Reads the file as raw bytes instead of base64 — faster on large files, and files
  over ~400 MB can now be opened at all (base64 of one exceeded the browser's maximum
  string length). Requires Persephone 4.0.21.

## 1.0.1

- Added a catalog screenshot, shown on the board's card in Persephone's Search boards tab.

## 1.0.0

- First version. Views PDF documents using the stock pdf.js viewer (search, thumbnails,
  outline, zoom/fit, rotate, print).
- Opens a local file, a PDF inside an archive (`archive.zip!doc.pdf`), and a PDF at an
  `http(s)` URL.
- Read-only, and fully offline — pdf.js is bundled, nothing is fetched from the network.
