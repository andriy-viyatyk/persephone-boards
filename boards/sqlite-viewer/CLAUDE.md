# SQLite Viewer — board notes

A Persephone **simple custom-editor board**: a read-only SQL browser for SQLite databases
(`.db`, `.sqlite`, `.sqlite3`, `.db3`). Tables & views are listed in a **Persephone sidebar
panel** (a secondary view); the main view has a free-form SQL box and renders results in a
**Tabulator** grid. Fully **offline** and **zero-dependency**: the SQL engine is
`node:sqlite` running on **Persephone's own bundled Node runtime** via
`persephone.executeNode()` (requires Persephone **4.0.16**, which introduced it — US-882).

> New here? The generic board authoring reference is `read_guide("boards")` (MCP). This file
> documents only what's specific to *this* board.

## Purpose

Opens as the default editor for `*.db / *.sqlite / *.sqlite3 / *.db3`
(`editorPriority: 100` — plain extensions, nothing zip-based, so no archive-view conflict).
First target: mneme index files (`.mneme/<model>/index-v2.db`), but it's a generic viewer for
any SQLite file. Opened plainly (no file) it shows an empty state + an Open… dialog button.

## Architecture — resident query server

The board iframe CSP has **no `wasm-unsafe-eval` / `unsafe-eval`**, so an in-frame SQL engine
is impossible (sql.js is WASM; alasql needs eval). Instead:

```
iframe (UI)                                 bundled-Node child process
┌──────────────────────────────┐            ┌────────────────────────────────┐
│ app.js                        │ executeNode│ scripts/db-server.mjs           │
│  SQL box + Tabulator grid     │ ─────────► │  node:sqlite, readOnly          │
│  JSON lines over stdin ──────────────────► │  {id,op:"query",sql}            │
│  ◄────────────────── one JSON per line ────│  {id,columns,rows,ms,truncated} │
└──────────────────────────────┘            └────────────────────────────────┘
```

- **One spawn per opened db** (`persephone.executeNode("scripts/db-server.mjs", [dbPath],
  { name: "db" })`), then each query costs only SQLite time — the db handle and page cache
  stay warm. Board unload kills the child via Persephone's job reaping.
- The server opens the db **`readOnly: true`** — a stray `UPDATE`/`DELETE` from the query box
  fails safely ("attempt to write a readonly database"). Verified.
- Protocol: ready message on spawn (`{ready, tables}` — the schema), then request/reply JSON
  lines matched by `id`. Rows are **arrays** (not objects): preserves column order and
  survives duplicate column names. BLOBs become `[BLOB n bytes]` server-side (never raw
  binary); BigInt/±Infinity/NaN become strings.
- Hard server-side cap **20 000 rows** per result (`MAX_ROWS`), streamed via
  `stmt.iterate()` so a huge result never materializes; the status line reports truncation.
- Full SQLite SELECT power works: JOINs, GROUP BY, CTEs, **FTS5 `MATCH` + `snippet()`**
  (verified against a real mneme index).
- **sqlite-vec is bundled** (`lib/vec0.dll`, official prebuilt windows-x86_64 from the
  v0.1.9 release; MIT — see `lib/LICENSE`). `db-server.mjs` opens the db with
  `allowExtension: true`, best-effort `loadExtension()`s it (`loadVecExtension`), then
  re-disables extension loading. So `vec0` virtual tables (mneme's `chunks_vec`) are
  fully queryable — row counts, `vec_length()`/`vec_version()`, and **KNN
  `MATCH … AND k = N`** all verified live. On load failure (or a non-Windows platform)
  the viewer degrades to the old behavior: vec0 tables error per-query, sidebar count `—`.
  Any OTHER unknown virtual-table module (spatialite etc.) still errors per-query.

## Tables sidebar — secondary view + shared state

The table list is NOT an in-board panel — it's a **secondary view** (`tables.html` +
`tables.js`) declared in the manifest (`secondaryViews: [{ id: "tables", … }]`), so it renders
in Persephone's own sidebar. Coordination via `persephone.state.*`:

- main → `merge({ db: { name, tables }, selected })` — schema for the panel to render.
- panel → `merge({ run: { name, seq: Date.now() } })` — "run SELECT * for this table";
  `seq` makes re-clicking the same table re-run. The main view guards with `lastRunSeq`
  (seeded from `state.get()` at boot so a stale command from a previous lifetime is ignored).
- Click → main fills `SELECT * FROM "name" LIMIT 1000` and runs it.

## Key files

| File | Role |
|------|------|
| `index.html` | Main view shell: top bar (db name · Open… · Reload), SQL textarea + Run/Stop, status line, `#grid` + `#state` overlay. All board CSS lives here. |
| `app.js` | Main logic: resident-server lifecycle (`startServer`/`stopServer`/`request` with id-matched pending map + TextDecoder line framing), `runQuery`/`cancelQuery`, Tabulator rendering, shared-state wiring, copy handling. |
| `tables.html` / `tables.js` | The "Tables" sidebar panel — pure renderer over shared state; groups Tables/Views with row counts. |
| `scripts/db-server.mjs` | The backend: `node:sqlite` readOnly, JSON-lines protocol, schema (+ per-table counts/columns, individually guarded), 20k row cap. |
| `board-manifest.json` | Editor association (4 masks, priority 100, kind simple) + `secondaryViews` + `minAppVersion: 4.0.16`. |
| `lib/tabulator.*` | Vendored **Tabulator 6.5.1** (MIT) + Persephone skin (`tabulator.css`). |
| `lib/vec0.dll` | Vendored **sqlite-vec 0.1.9** loadable extension (MIT, windows-x86_64) — makes `vec0` virtual tables queryable incl. KNN MATCH. |
| `icon.svg` | Database-cylinder glyph, explicit `#4D9FE6` (visible on dark AND light themes — never `currentColor`). |

## Run & test

- Open any `.db` file → routes to this board. Plain open → empty state + Open… button.
- Iterate: edit files → `board_refresh { pageId }` → screenshot. The **Tables panel** is
  frame index 1: `browser_tabs { pageId, action: "select", index: 1 }` then snapshot/click;
  `index: 0` returns to the main view.
- Covered live (2026-07-19, dev 4.0.16, real mneme index-v2.db): association; auto-query
  (1,000 rows/21 ms); sidebar render (15 tables, counts, `chunks_vec` = `—`); panel-click →
  main round trip; FTS5 MATCH + 3-table JOIN + snippet (48 rows/4 ms); bad SQL error;
  readonly write rejection; vec0 error; BLOB placeholders; 20k truncation via recursive CTE;
  Stop during a 100M-step CTE (status `Running… → Cancelling… → Query cancelled.`, server
  respawned, Run re-enabled); reload; `ui.log` clean.

## Gotchas

- **No in-frame SQL engine, ever** — the board CSP blocks WASM and eval. The bundled-Node
  backend (`executeNode`) is the design, not an optimization. Don't "simplify" to sql.js.
- **Stop = server restart.** SQLite has no cross-process query cancel; `cancelQuery()` kills
  the child and respawns it. The killed query's pending promise rejects with the internal
  reason `"restarting query server"` — `runQuery`'s catch deliberately ignores that exact
  message (and `"query server stopped"`) so the user only sees "Query cancelled.", not a
  transient error flash. Keep the strings in sync if you rename them.
- **Rows are arrays; columns come from `stmt.columns()`** (correct even for 0-row results,
  falls back to first-row keys). Duplicate column names (e.g. `SELECT a.x, b.x`) render as
  two identically-titled grid columns holding the same object value — a documented quirk.
- **Cell values are inserted as text nodes** (`cellFormatter` returns a `TextNode`, NULL adds
  a class + returns the safe literal "NULL") — never innerHTML; db content can't inject
  markup. Keep it that way.
- **Tabulator's clipboard module is dead in the board iframe** (execCommand-based). Copy is
  owned by the board: `copySelection()` builds TSV from `getRanges()` + `navigator.clipboard`
  (same as excel-viewer). Also: Tabulator puts `.tabulator` on `#grid` ITSELF — CSS overrides
  must target `#grid.tabulator`, not descendants.
- **Schema counts can be slow on huge DBs** — `count(*)` per table at open. Acceptable v1
  trade-off; if it bites, make counts lazy.
- **`minAppVersion: 4.0.16` is real**: `executeNode` doesn't exist earlier — on 4.0.15 the
  board would fail at spawn. Don't lower it. Publishing this board only makes sense once
  Persephone ≥ 4.0.16 is actually released to users.

## Reference

- Generic board API + `executeNode` docs: **`read_guide("boards")`**.
- Design history: `doc/tasks/BT-005-sqlite-viewer/` (this repo) and US-882 in the Persephone
  repo (`doc/tasks/US-882-board-execute-node/`).
