# SQLite Viewer — board notes

A Persephone **simple custom-editor board**: a read-only SQL browser for SQLite databases
(`.db`, `.sqlite`, `.sqlite3`, `.db3`). Tables & views are listed in a **Persephone sidebar
panel** (a secondary view); the main view has a free-form SQL box and renders results in an
**av-grid** grid. Fully **offline** and **zero-dependency**: the SQL engine is
`node:sqlite` running on **Persephone's own bundled Node runtime** via
`persephone.executeNode()` (introduced in Persephone 4.0.16 — US-882). `minAppVersion` is
**5.0.2**, the version that has `persephone.aiVision`, which the agent surface needs.

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
│  SQL box + av-grid            │ ─────────► │  node:sqlite, readOnly          │
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

## The result grid (av-grid)

`renderResult(res)` **destroys and rebuilds** the grid for every result — a clean lifecycle beats
juggling `setColumns`/`setRows`, and it drops the previous result's sort, filters and selection,
which belonged to that result. `buildGrid(res)` turns one server reply into `{ columns, rows }`:

- Rows arrive from the server as **arrays**, so each column gets a synthetic key (`"c0"`, `"c1"`,
  …) and the column's `name` is only a label. That is what survives `SELECT a.x, b.x` returning
  two columns called `x` — and it is why the agent surface addresses a column by position when a
  name is ambiguous.
- Each row carries `__row`, its 1-based position in the result, shown in a pinned status column
  (`isStatusColumn`) and used as the row key. It survives sorting and filtering.
- The **raw** value goes in under the key, untouched. av-grid's hook-precedence table then splits
  the three consumers that would otherwise disagree:

| Consumer | Reads | Result |
|---|---|---|
| Screen, search box, filter funnel | `formatValue` | a NULL shows as the word `NULL` |
| **Sorting** | `row[key]` (**never** `formatValue`) | raw values, compared by runtime type |
| **Copy** | `copyValue` | a NULL copies as `""`, not the word |

That is why this build has **no custom sorter at all** — the Tabulator build only ever had the
display string, so it needed `localeCompare(…, { numeric: true })` and still sorted by text.

Right-alignment is inferred per column: only when every value the column actually holds is a
number. An all-NULL or empty column stays left-aligned rather than being guessed at.

Everything else is av-grid's own and the board binds **nothing** for it: sorting, the cascading
filter checklist + `filterBar: true` chips, the toolbar Search box (`setSearchString`), range
selection, Ctrl+C / Ctrl+Shift+C, and the right-click Copy / Copy as… menu (correctly reduced to
copy-only because the grid isn't `editable`).

## The agent surface (AiVision)

`sqlite-aivision.js` publishes a live model of the open database at `pages[pageId].editor.app` via
`persephone.aiVision.expose(root)`. `app.js` constructs it with a bag of **accessors** (never
values) and calls `register()` at the top of `boot()`.

**Two sources of truth, answering different questions:**

| | Holds | Used for |
|---|---|---|
| The **database** (the resident server) | Everything — any table, any join, any aggregate | All data reads, through `query(sql)`, which does **not** touch the screen |
| The **grid** (av-grid) | ONE result as displayed: sorted, filtered, searched, selected, reordered | `getView()` and every action |

`runQuery(sql)` is the explicit bridge: it puts a query on the user's screen. Keeping `query(sql)`
off the grid is what lets an agent answer a question without disturbing what the user is reading.

**SQL is the read API,** and that is why this surface is shaped differently from the spreadsheet
boards. There is no rich cell-range reader here: an agent that can write SELECT can project,
filter, join and aggregate better than any options bag. The reading half is thin; the driving half
is where the detail is.

**Values come back RAW** (`null` is `null`, a number is a number) — the opposite of excel-viewer,
because in SQL the difference between `NULL` and `''` carries meaning and must not be flattened.
The grid's displayed text is the exception, and it is what filters match.

## Key files

| File | Role |
|------|------|
| `index.html` | Main view shell: top bar (db name · Search · Open… · Reload), SQL textarea + Run/Stop, status line, `#grid` + `#state` overlay. All board CSS lives here. Loads CSS in order (board-base → av-grid → board overrides) and JS (av-grid → sqlite-aivision → app). |
| `app.js` | Main logic: resident-server lifecycle (`startServer`/`stopServer`/`request` with id-matched pending map + TextDecoder line framing), `runQuery`/`cancelQuery`, `buildGrid`/`renderResult`, shared-state wiring, the AiVision accessor bag. |
| `sqlite-aivision.js` | The **AiVision agent surface** — the whole of it. Defines `window.SQLiteAI` only; `app.js` builds the model from it. Column/row addressing, the database reads, grid driving, the published member list and help text. |
| `tables.html` / `tables.js` | The "Tables" sidebar panel — pure renderer over shared state; groups Tables/Views with row counts. |
| `scripts/db-server.mjs` | The backend: `node:sqlite` readOnly, JSON-lines protocol, schema (+ per-table counts/columns, individually guarded), 20k row cap. |
| `guides/index.md` | User-facing board guide (`audience: both`) — what the board opens and what an assistant can do with it. |
| `guides/agent.md` | Agent-facing reference (`audience: agent`) — the call table, the two sources, and the two traps (displayed-text filters, on-screen-rectangle selection). |
| `board-manifest.json` | Editor association (4 masks, priority 100, kind simple) + `secondaryViews` + `guides: "guides"` + `minAppVersion: 5.0.2`. |
| `lib/av-grid.umd.js` + `lib/av-grid.css` | Vendored **av-grid 2.11.1** (MIT) — the renderer. No skin file: av-grid reads the `--p-*` contract directly. |
| `lib/vec0.dll` | Vendored **sqlite-vec 0.1.9** loadable extension (MIT, windows-x86_64) — makes `vec0` virtual tables queryable incl. KNN MATCH. |
| `icon.svg` | Database-cylinder glyph, explicit `#4D9FE6` (visible on dark AND light themes — never `currentColor`). |

## Run & test

- Open any `.db` file → routes to this board. Plain open → empty state + Open… button.
- Iterate: edit files → `board_refresh { pageId }` → screenshot. The **Tables panel** is
  frame index 1: `browser_tabs { pageId, action: "select", index: 1 }` then snapshot/click;
  `index: 0` returns to the main view.
- The test database is `_test/sqlite-viewer-test.db` (gitignored; regenerate with the generator in
  the task notes). It is deliberately awkward: `people` mixes NULLs, an empty string, the literal
  string `"NULL"`, a runaway-long cell and BLOBs; `big` has 20,000 rows (virtualization + both row
  caps); `docs` is an FTS5 table; `active_people` is a view. Synthetic data only — **no personal
  data in a fixture or a screenshot**, both of which are public.
- Covered live (2026-07-19, dev 4.0.16, real mneme index-v2.db): association; auto-query
  (1,000 rows/21 ms); sidebar render (15 tables, counts, `chunks_vec` = `—`); panel-click →
  main round trip; FTS5 MATCH + 3-table JOIN + snippet (48 rows/4 ms); bad SQL error;
  readonly write rejection; vec0 error; BLOB placeholders; 20k truncation via recursive CTE;
  Stop during a 100M-step CTE (status `Running… → Cancelling… → Query cancelled.`, server
  respawned, Run re-enabled); reload; `ui.log` clean.
- **Read [Driving the grid from an agent](https://raw.githubusercontent.com/andriy-viyatyk/av-grid/main/docs/api.md)
  before concluding anything from a click.** Persephone's `click` fires a bare synthetic `click` —
  no `pointerdown`, which is where av-grid resolves focus, cell focus and drags — and `pressKey`
  fires `isTrusted: false` keys, which **cannot** drive the clipboard on any browser. Both failures
  look exactly like grid bugs. Prefer the API (through `pages[id].editor.app`, or `grid.*` in
  `evaluate`), and **verify Ctrl+C by hand**.

### Testing the agent surface

Drive it the way an agent does — through `pages[pageId].editor.app.<member>` over the MCP, not
`evaluate` — so the member list, the CAUTION flags and the error text all get exercised:

- `getStats()`, then `query("SELECT …")` with a JOIN + GROUP BY: the answer must arrive **without**
  the grid changing.
- `query("UPDATE people SET name='x'")` must fail with *attempt to write a readonly database*. This
  is the security claim in the guides; re-check it whenever the server changes.
- `setFilter("city", ["NULL"])` must match the null rows. `setFilter("city", ["Paris"])` must
  produce the "NOTHING MATCHED … not among column city's displayed values" note, and a filter that
  is excluded by *another* column's filter must produce the other note instead. Both were verified.
- `selectRange` must refuse under each of the three causes: while filtered, while sorted, and after
  a reorder that genuinely splits the columns (move a middle column, not an edge one — moving an
  edge column often leaves the span contiguous and the call correctly succeeds).
- A duplicate-name result (`SELECT p.id, p.name, o.id, o.item FROM …`): `setSort("id")` must refuse
  and name the positions; `setSort("#3")` must work.
- `showRange(3, 6, "name", "score")` then confirm the **paint**, not just the state:
  `document.querySelectorAll('.avg-data-cell.avg-in-selection').length` should equal the cell count
  and the cell text should be the right cells. **The board page must be the ACTIVE tab** — a
  background page's frame is `0x0`, so the grid paints nothing and the count is `0` while the
  model's state is perfectly correct. `grid.getState().viewport.width === 0` is the tell; call
  `pages.showPage(pageId)` first.
- `query("SELECT * FROM big", { maxCells: 20 })` must truncate with a note; `saveCsv(path,
  "SELECT * FROM big")` must write all 20,000 rows.
- `stopQuery()` during a recursive-CTE query, then a normal `query()` to prove the server came back.
- `ui.log` stays clean.

## Gotchas

- **No in-frame SQL engine, ever** — the board CSP blocks WASM and eval. The bundled-Node
  backend (`executeNode`) is the design, not an optimization. Don't "simplify" to sql.js.
- **Stop = server restart.** SQLite has no cross-process query cancel; `cancelQuery()` kills
  the child and respawns it. The killed query's pending promise rejects with the internal
  reason `"restarting query server"` — `runQuery`'s catch deliberately ignores that exact
  message (and `"query server stopped"`) so the user only sees "Query cancelled.", not a
  transient error flash. Keep the strings in sync if you rename them.
- **Rows are arrays; columns come from `stmt.columns()`** (correct even for 0-row results,
  falls back to first-row keys). Duplicate column names (e.g. `SELECT a.x, b.x`) render as two
  identically-titled grid columns — but each holds its **own** value, because the grid keys off
  position (`c0`, `c1`), not the name. That was a real quirk of the Tabulator build; it is fixed.
- **Cell values never touch innerHTML.** av-grid writes a cell's `formatValue` text as text, so db
  content cannot inject markup. Don't introduce a `render` hook here that returns a markup string.
- **CSP forbids remote network.** av-grid is **vendored locally** under `lib/` and loaded with a
  relative `<script>` path — never a CDN URL (blocked, silent failure). Its UMD build ships as
  `av-grid.umd.cjs`; it is vendored **renamed to `.js`** so it loads as an ordinary classic script,
  and it puts the module namespace on `window.AVGrid` — the class is `AVGrid.AVGrid`.
- **`injectStyles: false`, and link `av-grid.css` yourself.** av-grid otherwise injects its
  stylesheet during `create()` — i.e. *after* this page's own `<style>` block — and
  `.avg-data-cell` would then out-rank the board's rules at equal specificity. Linking it in
  `<head>` puts the board's overrides last. A board rule must still out-specify one av-grid class:
  write `.avg-data-cell.sv-null`, not a bare `.sv-null`.
- **The board does NOT bind Ctrl+C, and does NOT help the grid take focus.** Both were needed
  under Tabulator — whose clipboard module goes through `document.execCommand("copy")`, which never
  fires in a board iframe — and both are gone. av-grid copies through the browser's own `copy`
  event. Don't reintroduce either on the evidence of an MCP-driven click or keypress; see the
  "Run & test" note.
- **Don't set widths on the data columns.** av-grid detects them from the header label and the
  first 50 rows, measured through the cell's *display* value, bounded 60–300px.
- **Schema counts can be slow on huge DBs** — `count(*)` per table at open. Acceptable v1
  trade-off; if it bites, make counts lazy.
- **`minAppVersion: 5.0.2` is real, and it has two floors.** `executeNode` doesn't exist before
  4.0.16 (the board fails at spawn), and `persephone.aiVision` doesn't exist before 5.0.2 (the
  agent surface silently does not publish — `createAiVisionModel` returns its no-op stub). Don't
  lower it.

### Gotchas specific to the agent surface

Every one of these was **measured** on the live board.

- **`getState()` does NOT report `highlightString`.** `searchString` is in the snapshot; the
  highlight is not. So the model tracks it in its own `highlight` variable, reset in
  `resultChanged()` because each result builds a brand-new grid that carries no options over. If
  av-grid later adds it to the snapshot, read it from there and delete the variable.
- **Never count DOM marks in the same turn as `setOptions`.** `setOptions({ highlightString })`
  schedules a repaint, so a `querySelectorAll('.avg-search-match')` immediately after counts the
  marks from *before* the change and reports 0 on a highlight that is about to land perfectly.
  (That exact bug shipped in the first draft and was caught by a screenshot.) `countMatches()`
  computes the figure from the ROWS instead — deterministic, and it needs no frame.
- **Filters match the DISPLAYED text.** A SQL null shows as the word `NULL`, so
  `setFilter("city", ["NULL"])` is what filters to the null rows. Numbers happen to be safe here
  (`String(58.5) === "58.5"`) which is NOT true of excel-viewer's formatted columns — don't
  generalise between the two boards. `setFilter` diffs the values it was given against
  `getColumnValues()` when nothing matches and names the ones that are not real, and it
  distinguishes that from *another* column's filter excluding everything. Do not remove that check.
- **`selectTable()` must return its `runQuery` promise.** The sidebar click ignores the return
  value, but `openTable()` awaits it — without the `return`, it resolves before the query has run
  and cheerfully reports the PREVIOUS result. (Measured: it did exactly that.)
- **A failed `runQuery` leaves the previous result on screen** — deliberate board behaviour, so an
  error never wipes the user's data. That means the only record of what went wrong is the status
  line, which the agent cannot see, so `ctx.getStatus()` exists purely to carry the SQLite error
  out into the thrown message. Keep it.
- **`reload()` re-runs nothing.** It re-opens the connection and leaves the result on screen, which
  is then STALE. The member summary and the returned note both say so; if you ever make reload
  re-run the query, fix both.
- **A `setColumns()` reorder preserves sort, filters and widths — but NOT the selection**, which is
  column-*index* based. `setColumnOrder` therefore clears it explicitly rather than leave the user
  with one that silently moved. Note that a reorder does not always split a span: moving an EDGE
  column often leaves the requested columns contiguous and `selectRange` correctly succeeds.
- **`getSelection().columns` includes the `__row` status column; `getSelectionText()` does not.**
  `describeSelection` filters status columns out so the two agree.
- **DO NOT hold a reference to `grid`.** `renderResult()` destroys and rebuilds it on every result,
  and it is absent before the first query. Everything goes through `ctx.getGrid()` and
  `requireGrid()`, which is also what produces a useful error instead of a `TypeError`.
- **A grid selection is a rectangle on SCREEN, not on the result.** `rowSpan`/`colSpan` map result
  row numbers and column positions through the display order and refuse with the specific cause
  (filter/search, sort, column order). Likewise `describeSelection` only reports a tidy
  `fromRow`/`toRow` when the rows and columns really are contiguous.
- **`undefined` does not survive the trip to the agent as an absent field — it arrives as `null`**,
  which reads as "the answer is nothing" rather than "this does not apply". Hence `compact()` on
  every returned object; keep using it.
- **`saveCsv` / `saveMarkdown` use a separate unbounded reader** (`askUnbounded`) so the
  `MAX_CELLS` cap can never accidentally apply to the call whose entire purpose is the result that
  was too big to return. Do not merge it with `ask`.
- **Two different row caps, and conflating them is a real error.** The server stops at 20,000 rows
  (`serverTruncated`); one call returns about 20,000 cells (`truncated`). A read that hits only the
  first still looks complete.
- **The search box and the grid must be set together.** `ctx.setSearchText` writes the `<input>`
  value *and* calls `grid.setSearchString`. Setting only the grid leaves the box showing something
  else — the user's view would disagree with the user's controls.

## Reference

- Generic board API + `executeNode` docs: **`read_guide("boards")`**.
- AiVision (publishing an object model): **`guides.agents["ai-vision"]`**.
- av-grid API: `https://raw.githubusercontent.com/andriy-viyatyk/av-grid/main/docs/api.md`
  (npm: `av-grid`). Read it rather than guessing — it is deliberately not AG-Grid-shaped, and the
  docs on `main` can be AHEAD of the vendored build. Check `AVGrid.version` before trusting a
  feature (excel-viewer shipped around a `highlightString` that its pinned 2.1.0 did not have;
  this board vendors 2.11.1, where it works).
- Design history: `doc/tasks/BT-005-sqlite-viewer/` (this repo) and US-882 in the Persephone
  repo (`doc/tasks/US-882-board-execute-node/`).
