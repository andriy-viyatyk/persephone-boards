# BT-015: Force Graph board — panels, grids, menus, dialogs, AiVision surface (v2)

## Status

**Status:** Implemented (awaiting BT-016 parity verification)
**Priority:** High
**Board id:** `force-graph`
**Epic:** [EPIC-100](../../../../persephone/doc/epics/EPIC-100.md)
**Started:** 2026-09-12

## Goal

Complete the Force Graph board to full parity with the built-in `graph-view` editor, over the
§1.3 checklist in `EPIC-100-investigation-notes.md`: the detail panel and its two editable grids,
the legend panel, the Physics / Expansion / Results panel tabs, the four context menus plus the
selection menu, the remaining dialogs, the hover tooltip, the two image-export buttons, the five
cross-editor page-creation features, and the full AiVision agent surface at `pages[i].editor.app`.

## Background

- **v1 (BT-014)** delivered the pure model layer, `ForceGraphRenderer`, the d3 simulation, the
  content host and a minimal toolbar, and left explicit seams: `#panel-slot`, `#legend-slot`,
  `#detail-slot`, the four null renderer callbacks, and `window.FG.app`.
- **Sources reproduced:** `GraphDetailPanelView.ts`, `GraphLegendPanelView.ts`,
  `GraphContextMenu.ts`, `GraphTooltipView.ts`/`GraphTooltipModel.ts`,
  `GraphExpansionSettingsView.ts`, `GraphTuningSlidersView.ts`, `GraphMutationModel.ts`,
  `GraphGroupActionsModel.ts`, `GraphIcons.ts`, the Results panel from `GraphBodyView.ts`, the
  image actions from `graph/index.ts`, and `GraphEditorFacade.ts` for the agent surface.
- **Decisions honoured:** D2 (menus and dialogs in-frame), D3 (`*Core` split for every
  destructive action), D4 (image buttons in the board's own toolbar).

## Implementation plan

- [x] Vendor `av-grid` 2.6.1 into `lib/` with `LICENSE` + `VERSION.txt`
- [x] `graph-actions.js` — mutation + group-action models (ports, with `*Core` splits)
- [x] `graph-ui.js` — icons, context menus, dialogs, hover tooltip
- [x] `graph-panels.js` — legend panel, detail panel (2 grids), Physics / Expansion / Results
- [x] `graph-aivision.js` — the `pages[i].editor.app` model
- [x] `app.js` — wire everything, image export, cross-editor features
- [x] `screenshot.png` (1120×700), manifest version bump, `WHATS-NEW.md`
- [x] Verify live against `greek-gods.fg.json`, side by side with the built-in editor

## Two v1 bugs found and fixed

1. **The link force was never installed, so the graph drew as a cloud of nodes with no
   edges.** `ForceGraphRenderer.initializeForces` bails out while the canvas still measures
   0×0, which is the *normal* case in a board frame — the content host delivers the file
   before the frame's first layout. The later `handleResize` only calls
   `updatePositionForces`, which installs charge / collide / center but deliberately leaves
   the link force alone, so it never got installed at all. `handleResize` now re-runs
   `initializeForces` on the first non-zero resize when the link force is missing. BT-014
   recorded the renderer as verified; the graph it screenshotted had settled into a layout
   that made the missing edges easy to miss.
2. **A `persephone.state` feedback loop.** `wireState`'s `onChange` subscriber called
   `setGrouping`, which writes back with `state.merge` — so two conflicting snapshots in
   flight flipped `groupingEnabled` forever (measured at ~180 changes/second), re-running
   the whole rebuild pipeline and calling `renderer.selectNode("")` each pass. That silently
   cleared any selection a moment after it was made and corrupted BFS visibility. Split into
   `applyGrouping` (no write — what the subscriber calls) and `setGrouping` (apply + persist).

## Verification (live, against `greek-gods.fg.json` and a 22-node / 3-group fixture)

| Check | Result |
|---|---|
| Board renders side by side with the built-in `graph-view` | same layout, shapes, levels, labels, links |
| Detail panel — Info tab | ID / Title inputs, Level + Shape icon rows, duplicate-id error "ID already exists" |
| Detail panel — Properties grid | `av-grid` 2.6.1 mounts, Name/Value rows, `+ add property` |
| Detail panel — Links grid | ID / Title / Level / Shape + custom columns, `+ add link`, focus → external hover |
| Legend panel | Selection / Level / Shape tabs, Root + Group rows, editable descriptions persisted to `options.legend` |
| Physics panel | three sliders with live readouts, Reset |
| Expansion panel | filterable Root Node combo, Expand Depth, Max Visible, the note |
| Results panel | highlighted match spans, `11 visible [+7 hidden] [select all]`, both buttons work |
| Node context menu | `Open wiki` · Add Child · Set as Root · Collapse *(disabled)* · Select children · Delete Node · Delete Link to… *(submenu)* |
| Group / empty-area / selection menus | all built, with separators, disabled and invisible items |
| Group Options dialog | three buttons — Add to Group / Create New Group / Cancel |
| Group-title input dialog | creates `group-4: "BT-015 test group"` |
| Ungroup dialog | `Ungroup "Team 3"? 7 member(s) will become top-level nodes.` Yes/No |
| Hover tooltip | title, id, properties, clickable markdown link, Copy + Open buttons |
| Open (markdown) / Open in grid / Extract with children | `md-view`, `grid-json` (`2 nodes.grid.json`), `graph-view` (`Extract with children.fg.json`) |
| Open in Drawing Editor | `greek-gods.excalidraw` opens in `draw-view` with the graph image embedded |
| Copy Image | PNG blob produced (174 KB); `clipboard.write` needs a focused window — see below |
| Badges / expand / collapse / expand all | `12 → 16 → 10 → 22 of 22 nodes` |
| Grouping toggle | group nodes dropped and restored |
| Ctrl+F, Ctrl+A, double-click | focus search, select all 63, expand the detail panel |
| Save path | 4-space JSON, `type` preserved, no `x`/`vx`/`fx`/`index`/`_$`, `save()` clears dirty |
| AiVision model | `pages[i].editor.app` resolves with every member and all 33 elements |
| `ui.log` | one `[info] board loaded` line |
| `greek-gods.fg.json` | unmodified by the whole session |

**Not reachable in this environment:** `navigator.clipboard.write` throws *"Document is not
focused"* when the Copy Image button is clicked over MCP with the app in the background. The
`canvas.toBlob` half was verified separately and the rejection is caught and toasted. This is
the documented browser constraint ("still need a user gesture + focused window"), not a board
defect — a human clicking the button in a focused window is the untested path.

## Deviations from the built-in editor

1. **`av-grid`'s own `showMenu` backs the context menus.** §5.3 budgeted ~200 LOC of hand-rolled
   popup menu; `av-grid` — already vendored for the two grids — exports `showMenu(...)` taking
   exactly Persephone's `MenuItem` shape (nested `items`, `startGroup`, `disabled`, `invisible`,
   `icon`), themed from `--p-*`. It is in-frame and vendored, so D2 holds; hand-rolling a second
   menu implementation beside it would have been the worse call. The board still
   `preventDefault()`s the native menu.
2. **Detail and legend panels are docked flex columns, not floating overlays.** The built-in draws
   them absolutely over the canvas corners; the board mounts them into `#detail-slot` /
   `#legend-slot`, so the canvas shrinks instead of being covered. The panel resizer is a width
   drag on the detail panel.
3. **The image buttons live in the board's own `.p-toolbar`** (D4) — a board cannot contribute to
   the page toolbar.
4. **`groupingEnabled` is page-scoped, not host-scoped** (§5.11) — `persephone.state`
   `restorableKeys` rather than `host.editorSettings["graph-view"]`.
5. **Open in Drawing Editor builds the Excalidraw document itself** (a board cannot reach
   `editors/draw/drawExport`) and opens it with `openContent({ editor: "draw-view", … })` so the
   page keeps the `<file>.excalidraw` title; it falls back to the documented
   `openRawLink(pngDataUrl, { editor: "draw-view" })` recipe if `openContent` rejects.

## Acceptance criteria

- [x] Detail panel: Info / Properties / Links tabs, both grids editable with add/delete rows
- [x] Legend panel: Selection / Level / Shape tabs with editable, persisted descriptions
- [x] Physics / Expansion / Results panel tabs, with a filterable Root Node combo
- [x] Four context menus + the selection menu, with submenus, separators and disabled items
- [x] Five confirmations (one three-button) and the group-title input dialog, in-frame
- [x] Hover tooltip card with Copy as Markdown and Open in new page
- [x] Copy Image and Open in Drawing Editor in the board toolbar
- [x] Five cross-editor features through `persephone.openContent`, rejection handled
- [x] AiVision model at `pages[i].editor.app` with every facade member and named element
- [x] Every agent-facing destructive action has a non-blocking `*Core` path
- [x] No hardcoded colors; `getTheme().graph` + `--p-*` only
- [x] `ui.log` clean, fully offline

## Files changed

| File | Change |
|------|--------|
| `boards/force-graph/graph-ui.js` | New — icons, markdown, dialogs, menu builders, hover tooltip |
| `boards/force-graph/graph-actions.js` | New — mutation + group actions with the `*Core` split |
| `boards/force-graph/graph-panels.js` | New — legend, detail (2 grids), Physics / Expansion / Results |
| `boards/force-graph/graph-aivision.js` | New — the `pages[i].editor.app` model |
| `boards/force-graph/app.js` | Rewritten controller — menus, panels, image export, cross-editor, AiVision |
| `boards/force-graph/index.html` | Toolbar gains Physics + the two image buttons; av-grid linked; new scripts |
| `boards/force-graph/style.css` | Panels, grids, menus, tooltip, dialogs |
| `boards/force-graph/graph-renderer.js` | Link-force recovery in `handleResize` (bug 1) |
| `boards/force-graph/board-manifest.json` | `version` 0.1.0 → 1.0.0 |
| `boards/force-graph/WHATS-NEW.md` | `## 1.0.0` entry |
| `boards/force-graph/CLAUDE.md` | Rewritten for the finished board |
| `boards/force-graph/screenshot.png` | New — 1120×700, 154 KB |
| `boards/force-graph/lib/av-grid.umd.js`, `lib/av-grid.css` | New — vendored av-grid 2.6.1 |
| `boards/force-graph/lib/LICENSE`, `lib/VERSION.txt` | av-grid MIT text + entry added beside d3 |
| `doc/active-work.md` | BT-015 moved to Active |

## Open questions

1. **`editorPriority: 200` still makes the board the default for `.fg.json`** while the
   built-in editor exists. Wanted for testing; US-1405 removes the built-in.
2. **The theme fallback in `graph-theme.js`** can be deleted once `minAppVersion` guarantees
   bridge 1.5.0. Kept for now.
3. **`totalNodeCount` is 0 when no visibility filter is active** — that is the built-in
   facade's behaviour (it reads `visibilityModel.totalNodeCount`), reproduced deliberately.
4. **Extract falls back to a plain JSON page** if `openContent({ editor: "graph-view" })`
   rejects (i.e. after US-1405 removes the built-in). The board's `contentMasks` then make
   Force Graph a switch option on that page, so the result is one click away. Worth
   revisiting in US-1405 — a board editor id cannot be passed to `openContent`.
