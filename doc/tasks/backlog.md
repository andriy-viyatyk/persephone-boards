# Task Backlog

Ideas and future board work not yet planned for implementation.

---

## Legacy binary Office formats (`.doc`, `.ppt`)

The BT-001/002/003 viewers target the modern OOXML formats (`.xlsx`/`.docx`/`.pptx`) plus
legacy `.xls` (which SheetJS reads well). Legacy **`.doc`** (Word 97-2003 binary) and **`.ppt`**
(PowerPoint 97-2003 binary) OLE compound formats have **no good pure-JS renderer** and are
deliberately out of scope for those tasks.

Options if legacy support is later wanted:

- [ ] **LibreOffice headless conversion** — a board could shell out via `persephone.execute()` to
  `soffice --headless --convert-to pdf`, then view the PDF. Near-perfect fidelity for ALL Office
  formats (modern + legacy), but requires LibreOffice installed on the machine. Could be a single
  "Office Viewer" board covering everything, or a fallback path inside the format-specific boards.

---

## Shared "Office Viewer" board (consolidation)

If the three format-specific boards prove to overlap heavily, consider a single **Office Viewer**
board with `fileMasks: ["*.xlsx","*.xls","*.docx","*.pptx"]` that dispatches to the right
renderer by extension. Decide after BT-001..003 ship — keeping them separate first keeps each
library's footprint and failure modes isolated during development.

---

## New viewer boards for developer and data formats (2026-10-05)

Formats a developer meets daily that Persephone cannot show yet. Each fits the existing viewer
pattern (`fileMasks`, `editorKind: "simple"`, read the opened file, no network).

- [ ] **Parquet Viewer** (`*.parquet`) — columnar data files from Spark, Databricks/Delta Lake,
  pandas and data lakes. Show the schema (columns, types, row groups, compression) in a sidebar and
  the rows in a sortable/filterable grid, paged by row group so large files stay fast. Candidate
  libraries: `hyparquet` (pure JS, no dependencies, reads in the browser) or `duckdb-wasm` (much
  larger, but adds SQL queries like the SQLite Viewer). Reuse the SQLite Viewer's grid/sidebar layout.
- [ ] **HAR Viewer** (`*.har`) — HTTP Archive JSON exported from a browser's Network tab. Request
  list (method, URL, status, type, size, time) with a timing waterfall, filters by type/status/text,
  and a detail pane with headers, cookies, query and timings. Open a response body in a Persephone
  editor (JSON grid, Monaco, image). HAR files often contain cookies and `Authorization` headers:
  offer a "mask secrets" toggle on by default. Possible follow-up in Persephone itself: export the
  built-in browser's network log as HAR.
- [x] **Certificate Viewer** (`*.cer`, `*.crt`, `*.der`, `*.pem`, `*.pfx`, `*.p12`) — moved to BT-030. X.509
  certificates for TLS, code signing and client auth. Decode subject, issuer, validity (highlight
  expired / expiring soon), serial, SHA-1/SHA-256 fingerprints, public key, key usage, SAN and other
  extensions; show every certificate of a PEM bundle or chain. PFX/P12 need a password prompt.
  Never display or copy private key material. Candidate libraries: `@peculiar/x509` or `pkijs`
  (pure JS, WebCrypto).
- [ ] **LaTeX Viewer** (`*.tex`) — source with highlighting plus a rendered preview side by side.
  A pure-JS preview covers common documents (`latex.js` renders a LaTeX subset to HTML; KaTeX for
  maths only). Full fidelity needs a real TeX engine: an optional "Compile to PDF" through
  `persephone.execute()` with `tectonic` or `pdflatex` if installed, then show the PDF. Lowest
  priority of the four — the preview is the hard part, and Monaco already shows the source.
