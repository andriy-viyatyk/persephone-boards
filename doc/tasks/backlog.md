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
