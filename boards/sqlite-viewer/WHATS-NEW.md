# What's New

## 1.0.0

- Initial release: read-only SQL browser for SQLite databases (.db / .sqlite / .sqlite3 / .db3).
- Tables & views listed in a Persephone sidebar panel with row counts — click to browse.
- Free-form SQL box (Ctrl+Enter to run): full SELECT power incl. JOINs, GROUP BY, and FTS5 MATCH.
- Bundles the sqlite-vec extension (vec0), so vector tables — e.g. mneme index embeddings — are browsable and KNN MATCH queries work.
- Results in a sortable, filterable grid with range selection and TSV copy.
- Runs on Persephone's bundled Node runtime — no Node/Python install needed (requires Persephone 4.0.16).
