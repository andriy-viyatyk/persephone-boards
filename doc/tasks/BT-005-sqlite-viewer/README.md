# BT-005: SQLite Viewer board (.db / .sqlite / .sqlite3 / .db3)

## Status

**Status:** In Progress
**Priority:** Medium
**Started:** 2026-07-19

## Summary

A read-only SQL browser board for SQLite database files: sidebar table/view list, a free-form
SQL textarea (full SQLite SELECT power incl. FTS5), and results in a Tabulator grid. First
target: mneme index files (`.mneme/<model>/index-v2.db`).

## Why

- SQLite files are opaque binary in every current editor; users (e.g. mneme users) have no way
  to peek inside a `.db` file from Persephone.
- First consumer of Persephone 4.0.16's **`persephone.executeNode()`** (US-882 in the app repo)
  — proves out the "resident backend server on the bundled Node runtime" board pattern with
  zero dependencies on the user's machine.

## Acceptance Criteria

- [x] Opens `.db`/`.sqlite`/`.sqlite3`/`.db3` as the default editor (simple editorKind).
- [x] Table/view list with row counts as a **secondary view** (Persephone sidebar panel, per
      user request), synced with the main view via `persephone.state.*`; click →
      `SELECT * FROM "t" LIMIT 1000` auto-runs in the main view.
- [x] Free-form SQL (Ctrl+Enter to run) incl. JOIN / GROUP BY / FTS5 MATCH; errors shown inline.
- [x] Strictly read-only (`readOnly: true` connection); BLOBs shown as `[BLOB n bytes]`.
- [x] Result grid: sort, per-column filter, range select + copy (TSV), virtualized.
- [x] Resident query server via `executeNode` — one spawn per opened db, JSON lines over stdin.
- [x] Verified live against the real mneme index db; `ui.log` clean; `minAppVersion: 4.0.16`.
- [x] Board `CLAUDE.md` rewritten; `WHATS-NEW.md` created.
- [ ] Published (blocked: wait until Persephone ≥ 4.0.16 is released to users — the board
      cannot run on 4.0.15).

## Technical Approach

Chosen (agreed with user 2026-07-19; see memory + US-882 in the persephone repo):

- Board iframe CSP forbids WASM/eval → no in-frame SQL engine (sql.js/alasql impossible).
- Backend = `scripts/db-server.mjs` run via `persephone.executeNode` on Persephone's bundled
  Node 24 (`node:sqlite`, FTS5 built in). Resident-server protocol: requests
  `{id, op:"query", sql}` / `{id, op:"schema"}` over stdin, one JSON reply per line on stdout
  (`{id, columns, rows, ms, truncated}` | `{id, error}`); ready message on spawn.
- Rows sent as arrays (not objects) to preserve column order and survive duplicate column
  names; server-side hard cap 20 000 rows per result.
- UI reuses excel-viewer's Tabulator patterns (natural sort, header filters, range select,
  own TSV copy — Tabulator's clipboard module is dead in the board iframe).

## Notes

### 2026-07-19
- Blocked-on-US-882 phase done: feature shipped in dev 4.0.16, boards guide documents
  `executeNode` + resident-server pattern.
- Board built and fully verified live against dev 4.0.16 + the real mneme index db
  (association, sidebar panel round trip, FTS5 JOIN + snippet, readonly write rejection,
  vec0 error, BLOB placeholders, 20k truncation, Stop/cancel via server respawn, reload,
  clean ui.log). Test evidence in `boards/sqlite-viewer/CLAUDE.md` → Run & test.
- Publish deliberately deferred until Persephone 4.0.16 is released (minAppVersion gate).
- Styling: user wants chrome (top bar / Tables panel / grid header / gutter) to match
  Persephone's own — the app uses `--color-bg-dark` (#181818 dark) for chrome, but boards
  only get `--p-panel` (= `--color-bg-light`, #313131 — an INPUT color). Filed **US-883**
  in the persephone repo to export `--p-bg-dark` (+ optional `--p-hover`,
  `--p-tree-selection`); user implements it in a separate chat. Board CSS is already
  written as `var(--p-bg-dark, var(--p-panel))` etc. — identical look today, snaps to real
  chrome when US-883 lands (then re-verify with a screenshot + a theme switch).
- User follow-up: `chunks_vec` errored with "no such module: vec0" (sqlite-vec virtual
  table — mneme loads that extension itself; plain `node:sqlite` doesn't have it). Fixed by
  **vendoring sqlite-vec v0.1.9** (`lib/vec0.dll`, official windows-x86_64 prebuilt,
  dual-licensed MIT OR Apache-2.0 — MIT text added to `lib/LICENSE`; Windows-only is fine,
  Persephone is Windows-only). `db-server.mjs` loads it best-effort at open and re-disables
  extension loading after. Verified live: sidebar count 3,124 (was `—`), `vec_version()`
  v0.1.9, SELECT with `[BLOB 3072 bytes]` embeddings, KNN `MATCH … AND k=5` self-similarity
  query 14 ms with correct distance=0 top hit. `ui.log` clean.
