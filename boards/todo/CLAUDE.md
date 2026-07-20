# Todo — board notes

A Persephone **content-host custom-editor board** with a **secondary (sidebar) view**. It
reimplements the built-in Todo editor as a sandboxed board: the todo list in the main view,
a **Lists & Tags** panel in the sidebar, coordinated through the board bridge. It is the
EPIC-044 proving ground — registered **alongside** the built-in Todo (it does not replace it).

> New here? The generic Persephone board authoring reference (the `persephone.*` bridge, the
> `--p-*` theme contract, CSP rules, secondary views & shared state, reload/test flow) is
> available any time via the **`read_guide("boards")`** MCP tool and the bundled Demo board.
> This file documents only what's specific to *this* board.

## What it is

Persephone associates this board with `*.todo.json` files via `board-manifest.json`:
`fileMasks: ["*.todo.json"]`, `editorKind: "content-host"` (Persephone owns the file and injects
`persephone.host.*`), `editorName: "Todo"` (the switch-widget label), and
`editorPriority: 0` — **switch-option-only**, so the built-in "ToDo" editor stays the default
for `.todo.json`; the user flips to "Todo" via the editor-switch widget. The manifest also
declares one secondary view: `{ id: "lists", title: "Lists & Tags" }`.

## Architecture (one file, two frames)

`index.html` + `app.js` serve **both** frames; `app.js` branches on `persephone.view`:
- `persephone.view === "main"` → the todo list (`#main-root`): search, quick-add, item rows.
- `persephone.view === "lists"` → the Lists & Tags panel (`#lists-root`): list/tag CRUD + selection.

The two frames share **one** Persephone-owned content host and **one** shared-state object, so
they stay in sync with no direct frame-to-frame messaging.

### Content — `persephone.host.*` (the file)

- `load()` reads `persephone.host.getContent()`, parses the JSON, and subscribes to
  `persephone.host.onContentChange()` to re-render on any change (including the *other* frame's
  writes). If `getContent()` rejects (the board was opened plainly, with no content host) it
  shows an empty state.
- All mutations serialize `data` back with `persephone.host.setContent()`. **Ctrl+S saves
  automatically** (the shim wires it) — no save code here.
- A frame's own `setContent` does **not** re-fire its own `onContentChange` (echo-guarded), so a
  frame never re-renders from its own write; the *other* frame does receive it.

### Selection/search — `persephone.state.*` (cross-frame UI state)

- The **main** view owns `persephone.state.init({ selectedList, selectedTag, searchText }, { restorableKeys: ["selectedList", "selectedTag"] })`.
- Every frame reads via `state.onChange` (the source of truth) and writes selection/search via
  `state.merge`. `selectedList`/`selectedTag` **persist** across restart & board reload;
  `searchText` is transient (not restorable) — mirroring the built-in.
- Each frame computes its own `filteredItems`/`listCounts` from the parsed data + shared selection.

## The `.todo.json` format (must match the built-in)

`{ "type": "todo-editor", "lists": string[], "tags": {name,color}[], "items": TodoItem[], "state": {} }`,
pretty-printed with **4-space** indent. `TodoItem = { id, list, title, done, createdDate,
doneDate: string|null, comment: string|null, tag: string|null }`. On load the board reproduces
the built-in's normalization: dedup lists/tags, orphan auto-add (a referenced list/tag missing
from the arrays is appended), per-item defaults, and single-list auto-select is **not** applied
here (selection is shared-state, seeded empty = "All"). The `state` map (per-item UI heights) is
**preserved untouched** across parse→serialize so a file round-trips cleanly to/from the built-in
Todo editor.

## Run & test

1. Trust the board once: `open_board("C:\\projects\\persephone-boards\\todo")` (or the Trust
   dialog). Until trusted, the `*.todo.json` association is inert.
2. Open any `*.todo.json` → it opens in the built-in Todo by default; switch the editor to
   **"Todo"** via the page toolbar's editor-switch widget.
3. **Key tests:**
   - Add a list in the **Lists & Tags** panel → it appears; select it → the main list filters.
   - Add/toggle/edit/delete items in the main view → the panel's counts update live (cross-frame
     host sync). Ctrl+S → the tab's unsaved dot clears.
   - Switch to Monaco → the raw JSON reflects the edits → switch back → the board re-renders. No
     data loss, no reload.
   - Restart Persephone / reload the board → the selected list/tag is restored (search is not).
4. After editing board files, reload with the in-board **Reload** button or `board_refresh` (MCP).
   Inspect the secondary view with `browser_tabs` (list → select `board-secondary:lists`) then
   `browser_snapshot`. Watch `ui.log` for CSP violations (there should be none — no remote network).

## Gotchas (non-obvious decisions)

- **`load()` starts with `await persephone.getFilePath()` — now redundant, kept as harmless.**
  It was originally the ready-gate for a shim limitation (`host.*` rejected / no-oped before the
  board handshake landed). The shim has since been fixed: `host.getContent()`/`getLanguage()`/
  `onContentChange()` await the handshake internally and are safe to call at any time, so the
  gate buys nothing anymore. Left in place because it's a no-op-cost line; feel free to drop it.
- **Re-render must not clobber an in-progress edit.** A cross-frame write triggers a full
  `#todo-list` rebuild. Free-text edits (title/comment) are **debounced** (300ms) and do not
  re-render locally; on any rebuild, `captureFocus`/`restoreFocus` re-focus the same
  `data-item-id` + `data-field` field and restore the caret. Discrete actions (toggle/add/delete/
  tag) write immediately and re-render.
- **No `window.confirm`/`prompt`.** Deletes use a small in-board confirm overlay; renames use an
  inline edit input — both CSP-safe and independent of blocked browser dialogs.
- **No external libraries / no remote network.** Everything is vendored (`board-base.css`) or
  inline. Tag colors are named CSS colors mirrored from the app palette.
- **`editorPriority: 0` is intentional.** The built-in Todo stays the default; this board is the
  A/B alternative. Bump the priority above 20 to make it the default (not the current intent).
