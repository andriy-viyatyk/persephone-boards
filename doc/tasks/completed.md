# Completed Tasks

Completed board tasks, newest first. One row per task — a compressed evidence summary that
survives after the task folder is deleted.

| ID | Title | Board | Notes |
|----|-------|-------|-------|
| BT-001 | Excel Viewer board (.xlsx / .xls) | `excel-viewer` v1.0.0 | Read-only viewer: SheetJS 0.20.3 parses `.xlsx`+`.xls` → Tabulator 6.5.1 grid. Excel-style (column letters + row numbers), formatted dates/cached formula values, numeric-aware sort, per-column filter, range-select + Copy (right-click menu **and** Ctrl/Cmd+C via own `copySelection`, since Tabulator's clipboard is dead in the board iframe), virtualized large sheets, no zebra striping. Tested live in Persephone. **Key finding:** zip-based types need `editorPriority > 100` to beat the built-in archive viewer (applies to BT-002/BT-003). |
