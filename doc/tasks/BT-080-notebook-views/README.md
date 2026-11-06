# BT-080: Notebook board — Markdown preview and av-grid view for JSON array notes

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `notebook`

## Goal

Add per-note Markdown preview and an editable JSON array grid to the Notebook board. [EPIC-137](../../../../persephone/doc/epics/EPIC-137.md) is the binding design; preserve existing notebook files and do not publish in this task.

## Background

- BT-078's `cards.js` owns cards by note ID, mounts `createEditor` from `editor.js` in `.note-editor`, reconciles retained cards in place, and destroys editors on removal. `app.js` owns pending field edits, the 300 ms debounce, host reconciliation and flush; `model.js` `viewForEditor` maps `md-view` to Preview, `grid-json` to Grid, all other values to Code. BT-079 is finished; integrate with its completed layout. Currently `.card-heading` contains title, language and comment action, while `.card-metadata` contains category, tags, date, expand and delete. Put the accessible view toggle alongside the language picker in the title area without displacing those controls.
- The built-in notebook switches embedded editors by `content.editor`; its `NoteItemEditModel` persists `data.state[noteId]["editorSettings:grid-json"]` as a **JSON string**, parsed into an object with `columns: [{key, name?, width?, hidden?, dataType?, filterType?}]`, plus filters, search, sort, CSV and focus settings. Width can be a number or percentage. Preserve all existing fields and keys; stale column keys must not be passed to the grid.
- Built-in Grid discovers keys from sampled rows, infers string/number/boolean by majority of non-null values (ties favor string, then number), calculates widths, uses identity external to row objects, creates blank `{}` rows and uniquely named string columns, deletes a column's properties from every row, and serializes live rows via `JSON.stringify(rows, null, 4)`. Its general JSON editor also accepts a single object; this board intentionally accepts only arrays of objects. It uses live grid rows because adding rows can replace the array. Never inject synthetic IDs into user data: duplicate or editable `id` fields cannot be row identity.
- The component catalog is `C:/projects/persephone/boards-assets/manifest.json`: marked 15.0.12, highlight.js 11.11.1 and its `markdown.css` skin; av-grid 2.14.0 is the current npm latest with UMD and CSS bundles already vendored here. `boards/agent-log-viewer` demonstrates marked plus locally vendored DOMPurify; `boards/excel-viewer` and `boards/sqlite-viewer` vendor av-grid with `lib/VERSION.txt` and license texts. Notebook already has CodeMirror versions and licenses there: append, do not replace them. All runtime assets must be local under `boards/notebook/lib/`; board CSP blocks CDN/network access.
- The live boards guide describes `persephone.openRawLink(href)` and automatic routing of links leaving the board origin. It accepts absolute paths and specific schemes, rejecting relative paths. Opening within Persephone needs no `openExternal`; OS/browser launch requires it, and HTTP(S) falls back to an internal Browser tab without it. Keep existing permissions false. Explicitly intercept preview links so relative/fragment URLs cannot navigate the board frame; allow only supported safe destinations and give a useful notice for unsupported links.
- Review corrections: dependencies are already vendored under `boards/notebook/lib/`; do not download anything. av-grid 2.14.0 is documented by `_test/av-grid-api.md`, replacing the previously inspected unverified local copy. Preserve CodeMirror version entries and append every library version, source and license reference. Adding a column to `[]` also creates its first blank row. Mixed-type columns use majority primitive type; edits convert to that type and conversion failures are rejected, while untouched cells preserve their values. Malformed `editorSettings:grid-json` disables width persistence for that note with no fallback key.
- Reviewed av-grid API: use `_test/av-grid-api.md`, the matching 2.14.0 reference. It documents callback timing, including `onEdit` before the write and `onColumnResize` after a user resize.

## Implementation Plan

- [x] Use the already-vendored marked, DOMPurify, highlight.js and av-grid assets; do not download dependencies. Preserve all CodeMirror entries and record each version, source and license reference in `lib/VERSION.txt` and individual `lib/LICENSE-*` files. In `index.html`, load local CSS in this order: `board-base.css` → av-grid CSS → Markdown skin → board CSS; load classic globals before the module app. No separate highlight.js theme: the skin supplies it. Pass `injectStyles: false`; av-grid consumes `--p-*` without JS retheming.
- [x] In `cards.js` and `model.js`, expose Code | Preview only for Markdown language and Code | Grid only for JSON with a successfully parsed array whose every element is a non-null, non-array object; `[]` qualifies. Hide the toggle otherwise. An explicit switch sets `content.editor` to `monaco`, `md-view` or `grid-json`, flushes pending edits first, and follows existing update/timestamp handling. Loading, filtering, expansion, scrolling, fallback and host reconciliation never rewrite the saved editor value. Keep legacy unsupported values as Code until a user switches. If a saved grid is invalid, non-array, or contains non-object rows, show Code with an actionable notice; do not overwrite content or preference. A saved preview with an incompatible language also displays Code without rewriting it.
- [x] Implement a card-owned preview adapter: `marked.parse` with GFM, sanitize the output with DOMPurify before insertion, prohibit scripts, event handlers and unsafe URL schemes, and prevent remote resource loads. Render in `.markdown-body`, then highlight fenced `pre code` via highlight.js; handle unknown languages safely. Use a delegated link handler with `preventDefault`, validate the original URL, and route allowed absolute links through `persephone.openRawLink` (handle failure without requiring promise support from older bridges). No frame navigation, including fragments and relative links. Double-click on non-link preview content or choose Code to edit; links must remain usable. Mark case-insensitive literal search words in preview text nodes without breaking links, code highlighting or injecting query HTML; update marks on query/content changes.
- [x] Implement a card-owned grid adapter in `grid.js`: parse once per changed content, derive union of keys and majority primitive type; leave nested values, nulls, missing properties and untouched mixed-type values intact. Convert edited values to the column type and reject conversion failures. Use external stable per-row keys (including duplicate/missing user IDs). Enable add/delete rows and columns with unique names; adding a column to `[]` also adds one row. Serialize actual live rows with four-space JSON after each user data change. Column deletion removes its properties; row operations and paste preserve unrelated properties. Route edits through the existing pending/debounce, flush and error handling, including Ctrl+S and view transitions.
- [x] Read stringified `editorSettings:grid-json` defensively. On **user resize only**, merge the changed width into its `columns` array by key, preserving other settings, unknown fields, other note state and root fields; create minimal stringified `{columns:[...]}` if absent. Never persist default/inferred widths, reorder, filter, sort, focus, scroll, mount or theme changes. Preserve malformed legacy settings and disable width persistence for that note. Ignore stale keys on rendering and preserve them on disk.
- [x] Give the grid host a definite pixel height measured from its rows and chrome, growing automatically up to 400px in a card; expanded uses the available full body height. Recompute after row count, resize, expand/collapse and layout changes. If `filterBar: true`, `.avg-grid-wrap` needs `height: 100%`; a zero viewport yields a blank grid. Ensure empty grid controls remain visible. Reconcile host changes like CodeMirror: reapply pending local edits by note and field, update changed rows/columns without user callbacks or file writes, and avoid rebuilding an unchanged instance. Destroy adapters and listeners on view change, card removal/filtering and frame teardown; retain instances through reorder and expansion. Avoid losing focus/selection on unrelated host updates.
- [x] Add localized labels and notices in `lang/en.json`; follow BT-078 release/changelog conventions and integrate with the finished BT-079 sources. Do not edit generated catalog/version manifests. Test from an ignored disposable fixture copy; leave the source fixture intact.

## Concerns / Open Questions

- The matching `_test/av-grid-api.md` documents callbacks' before/after timing and distinguishes user resize from programmatic column changes.
- Adding a column to an empty array creates its first blank row so the new property is represented and persists in JSON.

## Acceptance Criteria

- [x] Correct toggle eligibility, saved-view restoration, explicit view writes and clean read-only opening, including unsupported legacy values and invalid grid fallback.
- [ ] Sanitized GFM, fenced highlighting, safe bridge links, double-click editing and search marks work without frame navigation or executable document content. Verified in the current theme; light/dark theme switching remains untested.
- [ ] Typed grid edits, row/column insertion and deletion, empty arrays, resize gestures and four-space serialization work without losing unrelated JSON or state; only an explicit resize writes grid settings. (The resize callback and restore path were checked; a real drag gesture remains unverified. Paste was not exercised.)
- [ ] Grid and preview reconcile and tear down correctly; card and expanded sizing work, and runtime assets load offline. `pageErrors` and console errors were empty; the MCP pointer probes left `setPointerCapture` entries in `ui.log`.

### MCP test plan

- [x] Open a disposable fixture copy in a separate Persephone window; inspect with `pages`, `pages[id].editor.$help`, snapshots and board-only screenshots; reload to `frameReady: true`. Verified invalid saved-view fallbacks, 30/60-note paging, search, expansion and a pending grid edit rebased over a `pages[id].content` host update. The original fixture remained unchanged.
- [ ] Disposable preview and grid payloads passed GFM, known/unknown highlighting, malicious HTML/URL sanitation, text marks, safe link routing, numeric/boolean conversion, invalid numeric rejection, row/column add/delete, empty-array persistence and four-space serialization. Paste was not exercised because it would use the shared OS clipboard.
- [ ] Legacy numeric and percentage widths, unknown settings, resize-callback merge, reload restore and malformed-settings protection passed. A synthetic MCP pointer sequence could not create browser pointer capture, so a real resize gesture remains unverified. Used the matching `_test/av-grid-api.md`; no fallback key was written.

### Test Results and Deviations

- Preview: GFM table, known/unknown fences, search marks and bridge links worked. DOM inspection found no script, image, remote resource or `javascript:` href; relative, fragment and unsafe links left the frame in place and showed a notice.
- Grid: majority inference, number and boolean conversion, invalid numeric rejection, duplicate IDs, nested/unknown fields, add/delete rows and columns, empty-array column creation, four-space save, expanded sizing and host-update rebase passed. Legacy width settings preserved percentages and unknown fields; malformed settings remained unchanged.
- Runtime: `pageErrors` and error-level console messages were empty. `ui.log` contains two `setPointerCapture` errors from synthetic MCP pointer probes; trusted UI interactions passed.
- Deviations: paste was skipped to avoid touching the user's shared OS clipboard. Width callback persistence and reload restoration were checked, but an actual pointer resize gesture was not verified.

## Files Changed

| File | Planned change |
|------|----------------|
| `boards/notebook/cards.js`, `editor.js`, `model.js`, `app.js`, `preview.js`, `grid.js` | View selection, card-owned adapters, reconciliation and persistence integration |
| `boards/notebook/index.html`, `style.css`, `lang/en.json` | Local assets, sizing, accessible controls and messages |
| `boards/notebook/lib/` | Vendored libraries, skin, version and license records |
| `boards/notebook/WHATS-NEW.md`, `_test/` | Pending change note and test fixtures |

## Notes

Reviewed implementation plan for the finished BT-078 and BT-079 sources. This task stays active until paste and real pointer resizing are verified.
