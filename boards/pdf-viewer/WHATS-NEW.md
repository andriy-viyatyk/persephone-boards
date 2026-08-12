# What's New

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
