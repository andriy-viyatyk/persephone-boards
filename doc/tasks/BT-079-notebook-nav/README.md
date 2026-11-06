# BT-079: Notebook board — Categories & Tags navigation and autocomplete

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `notebook`

## Goal

Complete the Notebook board's combined Categories & Tags secondary view, main-view breadcrumb, and card category/tag autocomplete. EPIC-137 is binding; BT-078 supplies the existing main view. This task does not publish the board.

## Background

- `boards/notebook/app.js` initializes shared state with `activeFilter: "categories"`, `selectedCategory: ""`, `selectedTag: ""`, `searchText: ""`; the first three are restorable. The nav frame currently only subscribes and renders a placeholder. The main frame filters and resets pagination on selection changes, and its breadcrumb is plain text. `model.js` matches a category at a `/` boundary including descendants, exact tags, or a tag prefix ending in `:`. New notes inherit the active category or tag. Preserve these contracts.
- The built-in `NotebookCategoriesSecondaryView.ts` and `category-tree.ts` construct sorted intermediate nodes under an All root, show descendant counts, expand all by default, and use focus-selection styling. `NotebookEditor.ts` counts all notes at the root, and moves a subtree by replacing only an exact category or `from + "/"` prefix; it rejects self/descendant moves, confirms with the affected note count, and makes a selected descendant follow. Its old category filter used a raw prefix; retain BT-078's boundary-correct behavior instead. The built-in counts tag occurrences, including namespace occurrences; this task uses distinct matching note counts so counts match the displayed filtered results even if one note has several tags in a namespace.
- `NotebookTagsSecondaryView.ts` uses `CategoryListView`: the first `:` creates a namespace parent such as `env:` and children such as `env:dev`; selecting the parent filters by prefix. Standalone tags remain selectable. The built-in breadcrumb (`notebook/index.ts`) reflects the active category or tag. The board adds rename controls; these are not existing built-in category/tag management operations.
- Todo's `boards/todo/app.js`, `index.html` and `style.css` show a single scrollable secondary frame with two sections, shared-state selection, inline rename (Enter/blur commits; Escape cancels), compact counts/actions and a subtle `--p-accent` selection tint. Its row labels are click-oriented spans, so provide actual keyboard access and visible focus as well. Use `--p-*` theme tokens and board i18n. The live `guides.agents.boards` documents the host and shared-state bridge; no new permissions, remote assets or libraries are needed.
- Each frame uses `persephone.host` for hosted content and `persephone.state` for selection/view state. BT-078 subscribes to host changes before loading and reapplies pending main-frame edits by note ID and field; the nav must likewise load and subscribe, validate before writing, and avoid overwriting edits from another frame. The file preserves unknown root, note and nested fields and existing `data.state`.

## Implementation Plan

- [x] In `boards/notebook/model.js`, derive sorted category paths, including implicit ancestors, and tag vocabulary from all notes, independently of search and selection. Root count is all notes; category count includes descendants at slash boundaries; tag and namespace counts are distinct notes matching the exact tag or `prefix:` filter. Group on the first colon only, retaining full exact tag values, including standalone tags. Refresh projections on host changes and card edits; do not create file records for empty categories or tags.
- [ ] Replace `boards/notebook/nav.js` placeholder and wire its lifecycle in `app.js`: one scrollable panel, Categories tree with an All notes root, disclosure controls and counts, then Tags with standalone rows and selectable namespace groups/children with counts. Default category branches expanded as in the built-in. Root selects `{ activeFilter: "categories", selectedCategory: "", selectedTag: "" }`; category selection sets `activeFilter: "categories"` and clears `selectedTag`; tag/namespace selection sets `activeFilter: "tags"` and clears `selectedCategory`. Use a single `state.merge` per selection, preserving search. Indicate only the active selection. Keep focus, keyboard activation and expand/collapse usable with accessible labels and visible focus; do not require hover to reach actions. Use Todo's compact layout and selection tint with live `--p-*` theme values.
- [ ] Add a restorable shared-state key for expanded/collapsed category paths, with a deterministic default of expanded branches. Initialize it consistently with the main frame's existing `state.init` contract, merge changes rather than replacing state, restore on reload, and reconcile paths when categories disappear, rename or move. Expand ancestors needed to reveal a selected path. Collapsing, selecting and restoring never writes notebook content or `data.state`.
- [ ] Offer inline category rename on non-root rows via an accessible small menu or icon. Rename a single nonempty path segment, preserving its parent and descendant suffixes; reject separators, empty names and unchanged names without writing. Move a category by dragging it onto another category or All notes root inside the nav frame; preserve its leaf name, rewrite the complete subtree, and reject root as source, self, descendants and no-op destinations. Confirm a move with affected note count in an in-board dialog, as the built-in does. Do not accept external file/link/note drops and do not provide category deletion. If a destination already exists, explicitly confirm the merge and show the destination and affected count before writing; cancellation is a no-op. Apply the same collision rule to rename.
- [ ] On category rename/move, change only matching `note.category` values, preserving suffixes and all unrelated data. Update `updatedDate` on actually changed notes, consistent with BT-078 edits. If the selected category is the source or a descendant, follow it to the corresponding destination; update expanded paths similarly. Preserve unrelated selection and data. Make each operation a single content update, and refresh counts, cards, breadcrumb and suggestions across frames. Handle malformed input and host write errors visibly without clearing edits or claiming success.
- [ ] Add inline exact-tag rename across all notes, entered through a row action; Enter/blur commits and Escape cancels. Trim and reject empty/unchanged values; if the destination tag exists on a note, avoid introducing duplicates while preserving other tag order and fields. Rename actual tags only, not a synthetic namespace group; a real tag ending in `:` remains an exact tag. Update affected `updatedDate` values and follow an exactly selected renamed tag. Selecting a synthetic namespace continues to filter the prefix; moving an individual tag to a different namespace does not silently rename other tags.
- [ ] Coordinate host updates in `app.js`: subscribe before initial `getContent`, parse/validate and disable mutations on error; base each rename/move on the latest host data at commit time, never a stale render snapshot. Account for BT-078's debounced card edits and host echo behavior: rebase pending edits on incoming updates, rely on the main frame reapplying pending debounced edits on host changes, and surface failures. Selection/expanded-state changes occur only after a successful content operation; reconcile focus if the affected row moves. Verify the actual bridge ordering and test overlapping edits rather than assuming a cross-frame atomic transaction.
- [x] Replace the main toolbar breadcrumb in `app.js` with clickable, keyboard-accessible segments: All notes root clears both selections; category `A/B/C` segments select `A`, `A/B`, `A/B/C`; a namespaced tag offers its `prefix:` segment and exact tag segment, while a standalone tag has its exact segment. Use the same shared selection rules as nav and preserve search. Changes reset pagination through the existing selection handler, never write the file.
- [ ] Add autocomplete to the current inline category and tag inputs in `cards.js` using existing full category paths and actual tags from all notes, including updates from the other frame. A local `<datalist>` is acceptable if it works with the redesigned inputs; otherwise implement an accessible in-board popup with keyboard selection and dismissal. Preserve free text, existing tag add/remove semantics, focus, pending edits, and stable card/CodeMirror instances. Coordinate with the concurrent card/style redesign before editing these files. Add localized labels/messages to `lang/en.json` and theme styles in `style.css`; adjust `index.html` only if needed. No CDN.
- [x] Add a terse pending changelog line in `boards/notebook/WHATS-NEW.md` under the existing development version. Follow repo release rules when this change is eventually shipped; do not edit generated manifests. BT-081 owns publication.

## Concerns / Open Questions

- Nav operations read the latest host content at commit time and write once. The main frame reapplies pending debounced card edits on host changes; test one overlap case. No write serialization or compare-and-swap infrastructure is required.
- Existing data may contain unusual category segments, `:` tags, duplicate tags, or names colliding after a move. Preserve existing values unless explicitly changed; synthetic namespace rows must not be mistaken for stored tags. Counts represent notes, not tag occurrences.

## Acceptance Criteria

- [ ] The combined nav, counts, filtering, keyboard selection, focus, tree expansion/restoration, and breadcrumb meet the behavior above; selecting or expanding leaves the host clean.
- [ ] Category rename/move and exact tag rename update all and only intended notes, handle collisions and cancellation, follow selection, preserve unknown fields and file state, and survive simultaneous main-frame edits.
- [ ] Card suggestions track current content and still allow new values; focus, pending changes, pagination and CodeMirror instances behave as in BT-078.
- [ ] MCP test plan below passes, `ui.log` is clean (including CSP), and the board works offline.

## MCP Test Plan

Use the running Persephone MCP (`guides.agents.boards`, `boards.openBoard`, `pages`, `pages[id].editor.$help`, `window.screen.*`). Work on a disposable copy of `_test/notebook-80.note.json` so the fixture remains unchanged; open the copy in the Notebook board, activate its page, and use snapshots and screenshots for both frames in light and dark themes. Inspect actual fixture values first and add test data only to the copy.

- [ ] Record host content and dirty status; select a nested category, ancestor, root, exact tag and namespace, check displayed notes/counts and mutual exclusion, breadcrumb segments, keyboard focus/activation and page reset. Collapse/expand, reload or restore the page and verify expansion persists without content or dirty-state changes.
- [ ] On a controlled subtree with a similarly prefixed sibling (e.g. `Work` and `Workshop`), rename a parent and move it beneath another category and then root. Check every descendant suffix, selected-descendant follow, counts, breadcrumb, expanded paths, unrelated notes and preserved unknown fields/state. Test self/descendant/no-op rejection, destination collision confirmation and cancel; verify no file write on cancel. Check drag remains within nav and category deletion is absent.
- [ ] Rename an exact tag used on multiple notes, including a `prefix:value` tag and a destination already present on one note; verify deduplication, selected-tag follow, namespace/exact counts and unaffected tags. Test cancel/invalid/no-op and namespace group behavior.
- [ ] Type and choose category/tag suggestions on cards, create new free-text values, then rename/move in nav and verify suggestions update. Exercise Enter/Escape/blur and focus. Start a debounced card edit while performing a nav operation and verify both edits survive; test invalid host content and surfaced write errors without destructive rewrites.
- [ ] Save with Ctrl+S and reopen the copy to check persisted content; compare unknown root/note/content fields and `data.state` to the baseline except deliberately edited fields. Check the active board's `ui.log` for errors and CSP violations. Do not modify the original fixture.

## Files Changed

| File | Planned change |
|------|----------------|
| `boards/notebook/nav.js` | Categories and Tags panel, interactions and focus |
| `boards/notebook/app.js` | Frame/host coordination, restorable state and breadcrumb |
| `boards/notebook/model.js` | Projections and format-preserving category/tag operations |
| `boards/notebook/cards.js` | Inline category/tag suggestions |
| `boards/notebook/style.css` | Themed navigation, breadcrumb and suggestions |
| `boards/notebook/lang/en.json` | UI and accessible text |
| `boards/notebook/index.html` | Shell support if needed |
| `boards/notebook/WHATS-NEW.md` | Pending human changelog entry |

## Notes

BT-078 is implemented; card presentation is being restyled concurrently. Inspect the current files again at implementation time and integrate with that work. BT-080 handles preview/grid and BT-081 handles aiVision, remaining language packs, screenshot and publication.

- Review corrections: use `--p-font-family` for chrome and monospace only for CodeMirror; retain readable four-space modules, descriptive names, named constants, and JSDoc on exports.

### Implementation and MCP verification (2026-11-05)

- Implemented projections, navigation, category/tag operations, breadcrumb, suggestions, chrome font, and pending changelog. The existing frame applies pending debounced edits after host changes; no serialization or compare-and-swap was added.
- Disposable fixture copy: category `Work/Projects` selected 20 notes; root 80, `Work` 40, `Workshop` 20, namespace `topic:` 80. Collapse survived reload without dirtying content; category and tag selections updated breadcrumb without dirtying content.
- Renamed `Work` to `Office`, moved it to `Home/Office` using synthetic drag events, and renamed `topic:example` to `topic:renamed`. Confirmed 40 moved notes, 80 renamed tags, selected descendant following, and a collision confirmation/cancel. A pending title edit survived a concurrent `Workshop` rename.
- Ctrl+S and reload retained those changes; unknown root, note, content fields and `data.state` matched the original. Main and nav frame screenshots inspected in dark and temporary light themes. `ui.log` had no errors or CSP violations.
- MCP native drag helper failed with ?Drag interception session does not match the selected target?; real pointer drag remains unverified. The full checklist remains open: move back to root, invalid/no-op/self/descendant cases, tag deduplication and cancellation, suggestion keyboard/free-text behavior, write-error/invalid-content handling, and offline behavior require verification. No claim of complete acceptance is made.
