# BT-016: Force Graph board — parity verification against the built-in editor

## Status

**Status:** Implemented (awaiting owner testing)
**Priority:** High
**Board id:** `force-graph`
**Epic:** [EPIC-100](../../../../persephone/doc/epics/EPIC-100.md)
**Started:** 2026-09-12

## Goal

Drive the Force Graph board and the built-in `graph-view` editor side by side in the running app,
walk the §1.3 feature inventory in `EPIC-100-investigation-notes.md` item by item, and fix every
discrepancy in the board. This is the gate before the owner tests the board personally and before
US-1405 deletes the built-in editor.

## Background

- **Checklist:** `C:\projects\persephone\doc\epics\EPIC-100-investigation-notes.md` §1.3 (feature
  inventory) and §2 (the `.fg.json` format).
- **Decisions under test:** EPIC-100 **D3** (the `*Core` split — no agent-facing method may block
  on an overlay) and **D4** (the two image buttons move into the board's own toolbar).
- **Prior work:** BT-014 (models, renderer, content host) and BT-015 (panels, grids, menus,
  dialogs, AiVision), whose recorded deviations were each re-judged here.

## Method

Both editors were driven live, not read and inferred:

- `greek-gods.fg.json` copied twice into a scratch folder and opened twice — once in the board,
  once in `graph-view` via the editor Switch.
- A purpose-built edge-case fixture (`edge.fg.json`): two groups, `maxVisible: 12` truncation,
  hidden-neighbour badges, **duplicate ids**, two markdown-link string properties, `#N` indexed
  keys, a 130-character property, an orphan node, an 8-node chain, two unknown top-level keys.
- `mcp__persephone__call` for state and the facades, `pages[i].editor.{click,type,pressKey,
  evaluate,screenshot}` for the board frame, `window.screen.*` for the app window, and
  screenshots of both editors at every step.
- Three themes exercised (`default-dark`, `quiet-light`, `abyss`), comparing the board's live
  canvas palette against the app's `--color-graph-*` values.
- `boards/force-graph/ui.log` read after every significant interaction.

## What was fixed

### 1. The whole chrome was docked; the built-in floats it over the canvas (layout)

The built-in draws its body toolbar **and** the Physics / Expansion / Results panel as one
floating card at `top: 8px; left: 8px` (`GraphBody.css .graph-body-toolbar`, `width: fit-content`,
`opacity: 0.5` until hovered/focused, accent border while a panel is open), the legend as a 260px
card at `bottom: 8px; left: 8px` (`GraphLegendPanel.css`), and the detail panel at
`top: 8px; right: 8px` (`GraphDetailPanel.css`). The canvas owns the entire body.

The board had a full-width 30px `.p-toolbar`, a full-width panel strip that pushed the canvas
down, and legend/detail as docked flex **columns** that squeezed the canvas from both sides
(BT-015 deviation 2, which covered only the two panels and never recorded the toolbar and panel
strip). Judged a parity failure, not a design choice: canvas area is the whole point of a force
graph, and the difference is the first thing the owner sees.

**Fixed** in `index.html` + `style.css`: `#root` is the positioning context, `.canvas-host` is
`position: absolute; inset: 0`, and `.fg-chrome` / `#legend-slot` / `#detail-slot` float over it
at the built-in's coordinates with the same 50% idle opacity and the same accent border on
`.fg-chrome[data-active]` (set from `refreshChrome`).

### 2. Body-toolbar buttons were text labels in the wrong order

The built-in uses five `IconButton`s — `settings`, `graph-group`, `refresh`, `expand-all`,
`close` — in the order **Physics · Grouping · Reset view · Expand all**. The board used text
buttons in the order **Physics · Reset view · Expand all · Grouping**, which also made its own
AiVision `where` prose ("Reset view, after Grouping") wrong.

**Fixed:** new `graph-icons.js` carries verbatim copies of the app's SVG for those four icons plus
the two page-toolbar icons the board adopts under D4 (`DrawIcon`, `copy`); `app.js` injects them
over the buttons' fallback text at boot. Buttons reordered to the built-in's order, so the
existing `where` prose is now accurate.

### 3. Grouping strikethrough

The board struck the label through with `text-decoration`. Replaced with the same diagonal rule
Persephone's `IconButton[data-strikethrough]` draws, and the `title` now flips between
"Enable grouping" and "Disable grouping" like the built-in's.

### 4. The two detail-panel grids showed only their first row (real defect, pre-existing)

`av-grid` sets an inline `height: 100%` on its root. A percentage height only resolves against a
parent with a **definite** height, and `.fg-grid` is a flex item whose computed height is `auto` —
so the grid collapsed to header + one row with the rest scrolled out of reach. A node with five
links showed one. **Fixed:** `.fg-grid` is now `position: relative` and `.fg-grid > .avg-grid` is
absolutely positioned `inset: 0`. Both grids now list every row plus the `+ add link` /
`+ add property` row, matching the built-in exactly.

### 5. The two grids were the only proportional text in the board

`board-base.css` falls back to a **mono** stack; av-grid's `--avg-font-family` falls back to a
**sans** stack; this app build injects no `--p-font-family`, so the two fallbacks diverged and the
grids alone rendered in a different face from the rest of the board and from the built-in's grids.
**Fixed** with `--avg-font-family: inherit` on the grid roots.

### 6. Escape left stale text in the focused search box (real defect, pre-existing)

`refreshChrome` wrote the search input only `if (document.activeElement !== searchInput)`. So
Escape (and `setSearchQuery("")` from the agent surface, and the clear button) emptied the model
while the focused box still displayed the old query — the built-in clears it. **Fixed:** the box
is written whenever it differs from the model (during typing the two already agree, so the caret
is never disturbed), with the caret moved to the end when it is focused.

## Verified equal to the built-in

| Area | Evidence |
|---|---|
| Canvas rendering | `edge.fg.json` renders pixel-comparably in both: same six shapes, five level radii, group double-circles, root compass, `+N` badges, `13 of 20 nodes` |
| Graph palette | `renderer.colors` compared against the app's `--color-graph-*` in `default-dark`, `quiet-light` and `abyss` — **all 14 tokens identical in every theme**, re-delivered live on theme switch |
| Footer counts | `13 of 20` / `19 of 20` / `63 nodes` identical, including the duplicate-id dedup (`19 of 20`) |
| Round trip | after `updateForceParams` both editors emit a **byte-identical** document: unknown top-level keys in order, duplicate ids preserved, 4-space JSON, `type` intact, no `x`/`y`/`vx`/`vy`/`fx`/`fy`/`index`/`_$` |
| Save to disk | after `setNodeProps` + `save()` the file on disk keeps 4-space, unknown keys and property order |
| Node context menu | same items, order, separators, disabled `Set as Root`, `Delete Link to…` submenu, `Open link…` submenu with the open-link icon, `Remove from Group` |
| Group / empty-area / selection menus | group menu: the built-in's seven items; empty area: `Add Node`; selection: all eleven with `Delete 2 Nodes` and the right separators |
| Detail panel | Info (ID / Title / 5 level icons / 6 shape icons), Properties and Links grids side-by-side indistinguishable, `#N` keys shown raw in both |
| Legend panel | Selection radios (default `Selected with children`), Level and Shape tabs, `Root` + `Group` rows conditional, all levels/shapes always listed (matching `itemsForTab`), descriptions persisted to `options.legend` |
| Results panel | same rows, highlighted match spans, and the same status row — `N visible` + `[+N hidden]` + `[select all]` flipping to `[add to selection]` when something is selected |
| Tooltip | same badge/title/id/properties, `#N` suffix stripped, markdown links clickable, Copy + Open buttons; neither editor truncates a 130-char value |
| Keyboard | Ctrl+F focuses search; Ctrl+A selects all 63; Escape closes the panel then clears the search; ↑/↓/Enter walk the Results panel |
| Search | `4 visible / 4 hidden / 11 total` label, clear button, reveal-hidden and select-all links |
| AiVision surface | all **33** element names identical to the built-in's; the model is a **superset** of `GraphEditorFacade`'s ~30 members (adds `selectChildren`, `setRootNode`, node/link/group mutation and the cross-editor openers) |
| D3 `*Core` split | `expandAll`, `deleteNodes`, `ungroup`, `deleteGroup`, `groupSelected`, `renameNode`, `setNodeProps` all driven through `pages[i].editor.app` — every one returned without opening a confirm overlay |
| Copy Image | **works.** With the window focused, `copyImageToClipboard()` replaced a clipboard text sentinel with a 48 KB `image/png`. The BT-015 "Document is not focused" failure was the backgrounded app, not the board |
| Link-force fix | link force present and correct after board reload, after reload **while the page was in the background** (installed on first show), across tab switches and across a maximize/restore resize |
| `ui.log` | one `[info] board loaded` line across the whole session |

## Differences judged acceptable

1. **The two image buttons live in the board's toolbar** (EPIC-100 D4) rather than the page
   toolbar. They now use the built-in's own icons in the same order, so only the location differs.
2. **Grouping strikethrough is inverted relative to the built-in.** `GraphBodyView.ts:566` passes
   `strikethrough: groupingEnabled`, i.e. the built-in strikes the icon through when grouping is
   **on**. §1.3 documents the opposite ("struck-through when disabled") and the board follows the
   documented intent. Replicating an obvious inversion was rejected.
3. **The detail panel resizes by a left-edge width drag**; the built-in uses a bottom-left
   `sw-resize` corner that changes width and height. Same capability, different grip.
4. **`groupingEnabled` is page-scoped** (`persephone.state` `restorableKeys`) rather than
   host-scoped (`host.editorSettings["graph-view"]`) — §5.11, unchanged from BT-015.
5. **Sliders are native `input[type=range]` tinted with `accent-color`**; the built-in uses the
   UIKit Slider (grey track, blue thumb). Same metrics and readouts.
6. **Tooltip chrome**: the built-in's kind badge is uppercase, unboxed and link-coloured; the
   board's is a title-case chip on `--p-bg-dark`, and its links use `--p-accent`. Content identical.
7. **Menus are `av-grid`'s `showMenu`** (BT-015 deviation 1). Verified in-frame: nested submenus,
   `startGroup` separators, `disabled` items, `invisible` items filtered out, and item icons all
   behave as the built-in's do, and a second right-click closes the first menu.
8. **The Extract fallback** (a plain JSON page if `openContent({ editor: "graph-view" })` rejects)
   stays as BT-015 left it; it only matters after US-1405, and `contentMasks` makes Force Graph a
   switch option on the resulting page.

## Could not be verified without a human at the keyboard

- **Real pointer gestures.** Canvas hit-testing, drag, zoom, Alt+click, double-click and
  hover were driven with synthetic `PointerEvent`/`MouseEvent`, which is how BT-014/015 tested
  them too. Two things looked like defects and were traced to the synthetic input, not the board:
  a `d3` "Cannot read properties of null (reading 'document')" in `ui.log` from events dispatched
  without `view: window`, and stacked context menus from events dispatched without `pointerdown`.
  Both disappear with correctly shaped events; a human clicking is the untested path.
- **Ctrl+S from a real keypress** (the shim's own handler) — `save()` was driven through the model
  instead.
- **Drag-resizing the detail panel** by hand.

## Files changed

| File | Change |
|------|--------|
| `boards/force-graph/index.html` | Canvas-first layout; floating `.fg-chrome` card; toolbar reordered to the built-in's order with icon buttons |
| `boards/force-graph/graph-icons.js` | **New** — the built-in editor's six toolbar SVGs, injected at boot |
| `boards/force-graph/style.css` | Floating toolbar / legend / detail cards, panel strip sized to content, av-grid height + font fixes, IconButton-style strikethrough, selection-info colour |
| `boards/force-graph/app.js` | Injects the toolbar icons; `data-active` on the chrome card; grouping `title` flip; search-box value sync fix |
| `boards/force-graph/graph-aivision.js` | `where` prose corrected to "graph body toolbar" and to the panels' new floating corners |
| `doc/tasks/BT-016-parity-verification/README.md` | **New** — this document |
| `doc/active-work.md` | BT-016 moved to **Active** |

## Acceptance criteria

- [x] Every §1.3 item walked against both editors in the running app
- [x] An edge-case fixture exercised (groups, `maxVisible`, badges, duplicate ids, custom props, markdown links, `#N` keys, unknown top-level keys)
- [x] Colors compared across more than one theme
- [x] Round-trip output diffed between the two editors — byte-identical
- [x] Every discrepancy found either fixed in the board or recorded as an accepted difference
- [x] `ui.log` clean after the session
- [x] Task document + dashboard entry exist
