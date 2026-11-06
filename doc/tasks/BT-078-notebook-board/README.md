# BT-078: Notebook board — scaffold, format-preserving model, paged card list, CodeMirror, search, add/delete/expand

## Status

**Status:** Completed  
**Priority:** High  
**Board id:** `notebook`  
**Started:** 2026-11-05  
**Completed:** 2026-11-05

## Goal

Build the main view of the published Notebook content-host board for existing `.note.json` files, preserving their data and avoiding file writes for view state. EPIC-137 is the binding design; this task does not publish the board.

## Background

The built-in `src/renderer/editors/notebook/notebookTypes.ts` defines `notes` and per-note `state`; `NotebookEditor.ts` writes `{ type: "note-editor", notes, state }` with four-space JSON. Older valid files may omit `type`. A note has required string `id`, `title`, `category`, `createdDate`, `updatedDate`, string-array `tags`, and `content: { language: string, content: string, editor?: string }`; optional `comment` is a string, absent when removed. Categories are `/`-separated paths and tags can use `:` namespaces. `state` maps note IDs to objects including optional `contentHeight` and arbitrary editor-specific keys. Preserve unknown root, note, and nested content fields and existing state entries, except that deleting a note also deletes its `state[id]`; never add or update height or scroll data.

The old editor filters in existing array order (it does not sort); new notes are prepended. Add initializes a UUID, empty title (or trimmed active search), category or tag from the active navigation context, plaintext empty content with `editor: "monaco"`, and matching ISO creation/update timestamps. Edits update `updatedDate`. Search is case-insensitive, splits on whitespace and requires every word somewhere across title, category, tags, comment and content. Category filtering matches `note.category === selectedCategory || note.category.startsWith(selectedCategory + "/")`, correcting the old raw-prefix behavior that matched `Work` to `Workshop`; tag namespaces ending in `:` use prefix matching, otherwise exact tags. Only the active category or tag context filters. For `grid-json` with JSON array content, the old search extracts string/number cell values rather than raw JSON; BT-078 searches the raw content as requested, so keys and other JSON text can also match.

Old view mapping: `grid-json` → Grid, `md-view` → Preview, `grid-csv`, `monaco`, `html-view`, `mermaid-view`, `svg-view` and unknown/absent → Code. Preserve the original `content.editor` until an explicit view change. BT-078 renders Code for all of them without rewriting the saved preference; BT-080 adds the other views.

The live Persephone board guide reports bridge 1.48.0 and app 5.0.18. Set `minAppVersion: "5.0.10"` and `minBridgeVersion: "1.36.0"`, matching Todo's released baseline for this feature set; bridge 1.36.0 supplies board-pack i18n and exceeds the 1.30.0 object-permissions floor. If implementation needs a newer feature, name it and its introduction version and raise the minimums accordingly. The guide documents content-host load/write, echo-guarded `onContentChange`, automatic Ctrl+S, shared state, secondary frames and `--p-*` live theme injection; aiVision belongs to BT-081. Todo uses `persephone.view` and one shared host/state; its `i18n.js`, `lang/`, `board-base.css` and in-board confirmation are precedents. CSP requires local assets and disallows direct remote requests.

## Implementation Plan

- [x] Scaffold later with `boards.createBoard("notebook", "C:/projects/persephone-boards/boards")`, as required by the repo guide; do not register or open a board during planning. Set the manifest to `editorKind: "content-host"`, `fileMasks: ["*.note.json"]`, `editorPriority: 200`, `editorName: "Notebook"`, `secondaryViews: [{ "id": "nav", "title": "Categories & Tags" }]`, all object permissions false, versions above, and English board-pack language configuration. Add the mandatory changelog with a matching development version; BT-081 handles the screenshot, breaking-change note and release version. Do not edit generated catalog/version manifests.
- [x] Implement `model.js` as pure functions: `parseNotebook(text)` returns a validated raw object or an error (empty input gets a new `{type, notes, state}`); `serializeNotebook(data)` uses four-space JSON; `getNote(data, id)`; `addNote(data, context)`; `deleteNote(data, id)`; `updateNote(data, id, patch)`; `updateContent(data, id, patch)`; `addTag`, `removeTag`, `removeComment`; `filterNotes(data, selection)`; `viewForEditor(value)`. Mutations copy or patch only owned fields, including nested content, preserving unknown values and state exactly except that `deleteNote` removes `state[id]` as part of the user-initiated deletion. Do not silently normalize malformed existing data or overwrite parse errors: show an error and disable writes until valid content arrives. Detect duplicate/missing IDs and invalid required fields and report an actionable error rather than risk editing the wrong note. Writes only follow actual edits; unchanged load, focus, filtering, scrolling, expansion and theme changes leave the host clean.
- [x] `app.js` branches on `persephone.view`: main renders toolbar and cards; `nav` renders an accessible placeholder. Main initializes `persephone.state.init({ activeFilter: "categories", selectedCategory: "", selectedTag: "", searchText: "" }, { restorableKeys: ["activeFilter", "selectedCategory", "selectedTag"] })`; both frames subscribe with `onChange`, using `merge` for changes. This is the BT-079 contract. Show the current category/tag in the breadcrumb placeholder. Subscribe to host changes before loading; baseline the raw host content and suppress no-op writes. `host.setContent` updates the shared file, its own frame receives no echo, and Ctrl+S is host-owned. Handle a plain board without a host with an explanatory empty state.
- [x] Provide title edit, category input, tag chips with add/remove, language picker, optional comment add/edit/remove, expand and delete. Use an accessible in-board `<dialog>` for delete confirmation (never `window.confirm`, which wedges boards). Seed selection from shared state; use free-text fields for category/tag now, with autocomplete added in BT-079. Preserve unsupported language strings; do not coerce them when displaying or editing. Set `updatedDate` on actual note changes. Debounce text and CodeMirror edits (300 ms); flush on blur, discrete actions and before transitions where possible. Ensure a pending edit reaches the host before Ctrl+S (for example, intercept its key event in capture phase and flush synchronously without suppressing the shim's save). Surface host errors without discarding pending changes.
- [x] Render the first 30 filtered notes; a sentinel with `IntersectionObserver` appends 30 and a visible `Load more (N left)` button provides fallback and agent access. Disconnect observers on teardown. Reset to 30 when search or active category/tag changes. Scrolling never unmounts rendered cards. Each card owns one CodeMirror instance, auto-sized to content up to 400px inline height with internal overflow thereafter; an expanded note uses the full body height. Measure first-paint responsiveness with 30 instances; defer a lazy editor strategy unless measurement shows a problem.
- [x] Reconcile by stable note ID: keep a map of card DOM and CodeMirror instances, reorder/move existing nodes, update metadata in place, mount newly visible IDs, and destroy only removed/filtered-out cards or on teardown. On `onContentChange`, re-parse incoming data and re-apply still-pending debounced local edits by note ID and field; the pending local edit wins for that field. Then reconcile cards in place. When an existing CodeMirror document differs from incoming content, apply a replace transaction annotated as external only if that card has no pending local edit; never treat that transaction as a user edit. Preserve focus, selection and undo history where applicable. Filter changes may remove cards, but host updates must not destroy an editor whose card remains rendered. The board's frames are the host writers: main edits notes, BT-079 nav renames/moves categories, and BT-081 agents act through the main frame's aiVision model.
- [x] Expand by moving the same card/editor into a body-filling container, recording list scroll position and page count in memory; collapse or Escape returns it and restores position without writing file state. Highlight each case-insensitive search word in title/comment using text nodes and `<mark>`; use CodeMirror decorations for content matches, updated on query/document changes without touching the document. Treat input as literal text, not HTML or regex syntax.
- [x] Build CodeMirror 6 locally, following the REST client ESM pattern and this repo's `boards/audio-player` board-local package/build script convention. Pin exact `esbuild`, `@codemirror/state`, `view`, `commands`, `language`, `search`, language packages `lang-javascript`, `lang-json`, `lang-markdown`, `lang-html`, `lang-css`, `lang-xml`, `lang-yaml`, `lang-sql`, and `@lezer/highlight` in `boards/notebook/package.json` with a committed lockfile. `npm ci` then `npm run build:codemirror` runs `scripts/build-codemirror.mjs`: esbuild bundle, browser platform, ESM, minified, ES2022, from `src/codemirror-entry.js` to `lib/codemirror.js`. Export the state/view, transaction, decoration, search and language APIs needed by the board. Commit the generated bundle, `lib/VERSION.txt` with exact resolved versions, sources and build command, and `lib/LICENSE` with all applicable bundled dependency license texts/attributions; verify transitive licenses from the lockfile. Load it as a local ESM import, as REST client's `src/request-builder.js` does. No CDN or runtime npm install. The root `.gitignore` already ignores `node_modules/`; verify it remains ignored and do not commit it. `scripts/publish-board.mjs` recursively excludes `node_modules` from the release ZIP, but `src/`, `scripts/`, `package.json` and `package-lock.json` ship in it; accept this, following audio-player's board-local build precedent.
- [x] Map `javascript`, `typescript`, `javascriptreact`/`jsx`, `typescriptreact`/`tsx` to the appropriate JS parser options; map JSON, Markdown, HTML, CSS, XML, YAML and SQL to their language packages. All other values use plain text without changing the stored language. Theme editor chrome and syntax through `--p-*` CSS variables, adapting REST's `persephoneHighlightStyle` (`--p-accent`, `--p-success`, `--p-warning`, `--p-link`, `--p-text-muted`, `--p-error`); use CSS variables rather than cached resolved colors so live theme switching updates existing editors. Use `board-base.css`, no hard-coded theme colors.

### File layout and later tasks

| File under `boards/notebook/` | Responsibility |
|---|---|
| `board-manifest.json` | Identity, association, versions, permissions and `nav` view |
| `CLAUDE.md` | Scaffold's board authoring reference, updated with Notebook-specific notes |
| `WHATS-NEW.md` | Pending version changelog |
| `index.html` | Main/nav shells, dialog, stylesheet and local module entry |
| `board-base.css`, `style.css` | Scaffold base and theme-variable layout/card/editor styles |
| `i18n.js`, `lang/en.json` | Todo-style bridge translation helper and English source seeded from core notebook catalog; later packs in BT-081 |
| `app.js` | Frame bootstrap, host/state wiring, debounce and view coordination |
| `model.js` | Format-preserving parsing, mutations, filtering and view mapping |
| `cards.js` | Keyed card reconciliation, list pagination, expansion and search markup |
| `editor.js` | CodeMirror lifecycle, language selection, decorations and theme |
| `nav.js` | Placeholder; BT-079 implements categories/tags, counts and navigation here, plus card autocomplete in `cards.js` |
| `src/codemirror-entry.js`, `scripts/build-codemirror.mjs` | Bundle entry and reproducible build |
| `package.json`, `package-lock.json` | Pinned build dependencies and command |
| `lib/codemirror.js`, `lib/VERSION.txt`, `lib/LICENSE` | Committed offline bundle, provenance and licenses |

BT-080 adds preview/grid modules and view controls connected to `viewForEditor` and the card/editor boundary; it alone adds deliberate grid column settings to existing `state`. BT-081 adds `ai-vision.js`, `guides/`, remaining `lang/` packs, `screenshot.png`, release notes and publication. Keep these extensions out of BT-078.

## Test Plan

- [x] During implementation use `boards.createBoard` and open the trusted scaffold through Persephone MCP, then open a disposable `C:/projects/persephone-boards/_test/notebook-80.note.json` fixture through `pages.openFile`. Generate ~80 distinct ordered notes with nested categories, namespaced tags, comments, search words in each field, every supported language and an unknown language, all old editor values in the mapping including absent and unknown, unknown root/note/content fields, and populated `state` including `contentHeight` and grid settings. Keep this fixture in `_test/`, outside the board ZIP; avoid personal data. Check the editor switch can still reach the built-in editor.
- [x] Use `pages`, `pages[id].editor.$help`, `window.screen.snapshot()` and screen actions to check first 30, sentinel and button pagination to 80, stable ordering, filter reset, all search fields and literal highlighting, context-aware add, metadata and content edits, language preservation, confirmation cancel/delete, expand/Escape/collapse and scroll restoration. Check current category/tag via shared state even while nav is a placeholder.
- [x] While typing in a card, inject a different note's change through the shared content host or another frame; verify the same editor node, selection, focus and undo survive and both changes remain. Exercise a pending edit on the same field as an incoming change and verify the local pending value wins; also test pending-debounce/Ctrl+S. Switch to raw editor and inspect saved JSON: unknown fields and original editor values survive; `state[id]` is removed on delete and all other state entries remain unchanged after delete, scroll and expand. Invalid JSON and invalid IDs must never be overwritten.
- [x] Compare before/after host content and modified flag during load, scrolling, filtering, expansion and theme changes; test live light/dark switch on existing editors. Save, reload with `pages[id].editor.reload()`, reopen the fixture and verify persisted edits. Capture `window.screen.screenshot()` and inspect `ui.log` for errors/CSP violations. Verify offline local bundle loading and test initial 30-card responsiveness.

## Concerns / Open Questions

- Deleting a note also removes its `state[id]`, matching the old editor; this is deliberate cleanup from a user action, not a view-state write. Preserve every other state entry.
- Verify that pending local field edits are reapplied to incoming host content before serialization so updates from the other frame survive.
- Existing `grid-json`/`md-view` files temporarily display Code without changing their persisted preference; their full view returns in BT-080. The documented values are possible editor IDs selected by the old editor; unknown values remain untouched.
- The minimum is Persephone 5.0.10 and bridge 1.36.0 for the planned features. If a newer feature is required, document the feature and its introduction version, then raise the relevant minimums. A bridge gap becomes a separate core task per EPIC-137.

## Acceptance Criteria

- [x] Manifest, minimal permissions and English localization match the plan; `nav` opens a placeholder.
- [x] Existing notebooks round-trip with unknown fields, content editor values and existing state intact except the deleted note's state entry; view-only actions never dirty the file.
- [x] Add/delete/edit, filtering, literal match highlighting, paging and expand/collapse behave as specified; no virtualization.
- [x] External changes preserve live editor instances and reapply pending local fields; debounced edits save through Ctrl+S.
- [x] Offline CodeMirror supports the listed languages and preserves all other language values; theme switches live.
- [x] MCP test plan passes, screenshot is visually checked, and `ui.log` is clean (including CSP).

## Files Changed

| File | Change |
|---|---|
| `boards/notebook/` | New scaffold and files in the layout above |
| `_test/notebook-80.note.json` | Disposable local MCP test fixture, outside the board |
| `doc/tasks/BT-078-notebook-board/README.md` | This plan and implementation findings |
| `doc/active-work.md`, `doc/tasks/completed.md` | EPIC-137 dashboard lifecycle and completion record |

## Notes

Implementation completed 2026-11-05. The superseded initial attempt notes were removed; the verified build deviation and full MCP results follow below. The board remains unpublished for BT-081.

## MCP Test Results (2026-11-05)

| Test-plan item | Result |
|---|---|
| Fixture and content-host setup | **PASS.** Opened the trusted 80-note fixture as a content host; verified the built-in Notebook switch and returned to the board. The fixture was restored byte-for-byte from a temporary backup and remains open and unmodified. |
| Main and nav UI | **PASS.** Initial 30 and 30→60→80 button and sentinel pagination, stable ordering, filter reset, `Work` boundary filtering, exact/namespaced tags, every search field, literal `<sample>` matching, title/comment and CodeMirror highlights, context-aware add, title/category/content/language/comment/tag edits and removals, delete cancel/confirm, expand/Escape/collapse, and 900px scroll restoration passed. |
| Host concurrency and persistence | **PASS.** A nav-frame update preserved the same CodeMirror node, pending local content, focus, caret position and undo while another note's incoming title survived. The pending local value won the overlapping host change after debounce. Ctrl+S flushed edits; save/reload retained them. Unknown root/note/content fields, 80 state entries and original editor IDs survived; delete removed only its own state entry. Invalid JSON, missing IDs and duplicate IDs showed translated errors, disabled editing and did not overwrite the invalid host content. |
| View-only, theme and offline checks | **PASS.** On a clean fixture, filtering, search, scroll, pagination, expansion and light-theme preview left the serialized host hash and modified flag unchanged; dark theme restored. Short editors measured 72px, a 60-line editor capped at 400px with internal scrolling, and all 30 editors remained mounted. Local CodeMirror loaded with no network requests. Screenshot was visually inspected; `ui.log`, console errors and page errors were empty. |
| Source checks | **PASS.** JavaScript syntax and manifest/English-pack JSON parsed successfully; no `window.confirm`, `alert` or `prompt` usage was found. No unit tests, test harnesses or commits were made. |

Build deviation from the prior build: `npm run build:codemirror` and direct `node scripts/build-codemirror.mjs` failed with `spawn EPERM`. The local `node_modules/.bin/esbuild.cmd` rebuilt the bundle successfully; `lib/LICENSE` and `lib/VERSION.txt` were regenerated from its metafile and the lockfile. This pass did not change `src/codemirror-entry.js`, so no bundle rebuild was needed; no `npm install` was run.

The built-in Notebook switch marked the disposable fixture modified during its legacy-editor check. The fixture was restored from the temporary backup and verified at its original 80-note content, with all 80 state entries and unknown fields intact. It remains open in the trusted board with the page unmodified. No BT-077 lines in `doc/` were changed in this pass.
