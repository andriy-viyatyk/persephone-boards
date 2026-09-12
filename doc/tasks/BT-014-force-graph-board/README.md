# BT-014: Force Graph board — models, renderer, canvas, content host (v1)

## Status

**Status:** Done (v1 scope)
**Priority:** High
**Board id:** `force-graph`
**Epic:** [EPIC-100](../../../../persephone/doc/epics/EPIC-100.md) — move the Force Graph editor
out of the app into a board
**Started:** 2026-09-12
**Completed:** 2026-09-12

## Goal

Build v1 of a Force Graph board that reimplements the app's built-in `graph-view` editor for
`.fg.json` files: the pure model layer, the canvas renderer, the d3-force simulation and the
content-host file I/O. v1 is both the feasibility spike (can a continuous physics simulation
run inside a board iframe?) and the foundation BT-015 builds the remaining UI on.

## Background

- **Source to port:** `C:\projects\persephone\src\renderer\editors\graph\` — 29 files, 8,569
  LOC. The investigation (`doc/epics/EPIC-100-investigation-notes.md` §5.14) identified
  ~2,800 of those lines as framework-free and portable almost verbatim: the six model classes
  plus `shapeGeometry`, `types` and `ForceGraphRenderer`.
- **Precedent:** `boards/todo/` — the canonical content-host migration (single IIFE,
  `persephone.host.*` I/O, `.confirm-overlay`, 4-space JSON round-trip).
- **Specification:** `EPIC-100-investigation-notes.md` — §1.3 the feature inventory,
  §2 the `.fg.json` format, §4 the boards system, §5 the gap analysis, §7 the process rules.
- **Bridge contract (US-1404, bridge 1.5.0, landed in parallel):** `getTheme().graph` with 14
  semantic camelCase keys, `persephone.openContent(...)`, and `contentMasks` in the manifest.

## Implementation Plan

- [x] Scaffold with the `create_board` MCP tool (auto-trusted) into `boards/`
- [x] Vendor D3 into `lib/` with `LICENSE` + `VERSION.txt`
- [x] Port the pure model layer → `graph-core.js`
- [x] Port `ForceGraphRenderer` → `graph-renderer.js`
- [x] Canvas palette adapter → `graph-theme.js`
- [x] Controller (content host, rebuild pipeline, toolbar, keyboard, theme) → `app.js`
- [x] Shell + styles → `index.html`, `style.css`, `icon.svg`
- [x] Manifest, `WHATS-NEW.md`, board `CLAUDE.md`
- [x] Verify live in the running app against `greek-gods.fg.json` and a generated
      groups + visibility fixture

## What v1 delivers

**Model layer (`graph-core.js`, verbatim ports).** `types` (link ids, node labels, custom
properties, indexed-suffix stripping, markdown-link extraction, level radii),
`shapeGeometry` (the six shapes + compass + group), `constants` (`forceProperties`),
`GraphHighlightModel` (four highlight layers with AND-intersection dimming, selection/hover,
link colouring), `GraphGroupModel` (membership index, cycle detection, link pre-processing
with LCA routing and synthetic-link dedup), `GraphConnectivityModel` (real vs processed
adjacency, visual link keys, group analysis), `GraphVisibilityModel` (BFS visibility,
component roots, expand / expandDeep / collapse / expandAll / revealPaths),
`GraphDataModel` (node & link CRUD, legend descriptions, `cleanNode`, legend filters),
`GraphSearchModel` (multi-word AND search over label + custom properties, hidden-match reveal).

**Renderer (`graph-renderer.js`).** Canvas drawing of links, six node shapes, five level
radii, group double-circles, root compass, `+N` hidden-neighbour badges, labels (always for
highlighted nodes, "important" ones above zoom 0.8), the four highlight layers with 0.15
dimming. d3-force simulation (link / charge / collide / center, `forceX`/`forceY` available
but off), per-link distance scaling for collapsed synthetic group links, d3-zoom pan + wheel
zoom with built-in dblclick-zoom disabled, d3-drag node dragging, circular hit-testing for
nodes and badges, DPR-aware resize.

**Controller (`app.js`).** Content-host load/save with unknown-key preservation and 4-space
JSON; the `rebuildAndRender` pipeline; reset view; grouping toggle (persisted via
`persephone.state` `restorableKeys`); expand all behind an in-board confirm overlay
(with an `expandAllCore()` agent-safe half, per EPIC-098's `*Core` split); search box with
clear, match highlighting and the `N visible / N hidden / N total` label; selection count;
Ctrl+F, Ctrl+A, Shift-hold neighbour highlight, Escape; badge click / Ctrl+click expand;
Alt+click link toggle with the group cycle guard; `setStatusText` footer; `notify` alerts;
loading / empty / parse-error states.

**Theme (`graph-theme.js`).** Reads `persephone.getTheme().graph` (verified live:
`FG.paletteFromContract === true` against bridge 1.5.0) and re-applies on `onThemeChange`,
with the built-in editor's default-dark / light-modern values as the fallback for older app
builds.

## Verification (live, in the running app)

| Check | Result |
|---|---|
| `greek-gods.fg.json` opens in the board (association + `editorPriority` 200) | editor id `board-editor:…\force-graph` |
| Graph renders, simulation settles | 63 nodes, all six shapes, five levels, root compass |
| Wheel zoom | `transform.k` 1 → 1.52 |
| Node drag | `subject` picked up, `fx`/`fy` tracked, unpinned on release |
| Click / hit-testing | click on Zeus → `selectedIds = ["zeus"]` |
| Search | `1 visible / 0 hidden / 63 total`, dim layer active, clear button |
| Footer | `63 nodes`, and `12 of 22 nodes` while filtering |
| Groups (22-node / 3-group fixture) | 3 groups, 6 synthetic links, membership links hidden |
| BFS visibility + badges | `maxVisible: 12` → badges `+3 / +3 / +4`; badge click 12 → 15 |
| Expand all | confirm overlay, then `22 of 22 nodes` |
| Grouping toggle | group nodes dropped / restored, struck-through when off |
| Save path (Alt+click adds a link) | page dirty, `type` and `customTopLevelKey` preserved, 4-space JSON, `host.save()` clears dirty |
| No simulation/system keys leak into the file | `x`/`y`/`vx`/`vy`/`fx`/`fy`/`index` and `_$` all absent |
| Theme contract | `FG.paletteFromContract === true` |
| `ui.log` | one `[info] board loaded` line, nothing else |

## Deliberately left to BT-015

The 3-tab detail panel and its two `av-grid` grids; the 3-tab legend panel; the four context
menus and the selection menu; the remaining dialogs (delete, ungroup, delete-with-children,
the 3-button Group Options, the group-title input); the Physics / Expansion / Results panel
tabs; the hover tooltip; the two image-export buttons (D4); the full AiVision model at
`pages[i].editor.app`; `screenshot.png`.

Seams left for it: `#panel-slot`, `#legend-slot`, `#detail-slot` in `index.html` (empty =
zero width, so no layout change is needed later); the null renderer callbacks
`onContextMenuAction`, `onHoverChanged`, `onDoubleClick`, `onBeforeClick`; and `window.FG.app`,
which exposes every model, the rebuild pipeline, `confirmAction`, `writeNow`/`writeSoon` and
the search state.

## Concerns / Open Questions

1. **Version is `0.1.0`, deliberately.** The board is not publishable until BT-015 lands the
   rest of the UI. `WHATS-NEW.md`'s top heading matches. Bump both at publish time.
2. **`screenshot.png` is declared in the manifest but not yet present.** Producing it now
   would only be thrown away when BT-015 changes the layout, and a catalog screenshot must
   contain no personal data (the fixture used here lives under a user-profile temp path).
   BT-015 or BT-016 should capture it against `greek-gods.fg.json`.
3. **`editorPriority: 200` makes the board the default for `.fg.json` while the built-in
   editor still exists.** That is wanted for testing; the built-in stays reachable through
   the editor Switch widget until US-1405 removes it.
4. **Alt+click implements the plain link toggle plus the group cycle guard**, not the full
   `GraphGroupActionsModel` behaviour (add/remove group membership with the "different
   groups" and "different parents" warnings). BT-015 owns that model.
5. **The theme fallback in `graph-theme.js` is a stopgap.** Once the board's `minAppVersion`
   guarantees bridge 1.5.0 it can be deleted; it is kept for now so the board still renders
   on an older build.

## Acceptance Criteria

- [x] Board scaffolded with `create_board`, never hand-created
- [x] `d3-force` / `-selection` / `-zoom` / `-drag` (+ transitive deps) vendored in `lib/` with `LICENSE` and `VERSION.txt`
- [x] The eight pure model files and `ForceGraphRenderer` ported faithfully — algorithms unchanged
- [x] Canvas renders the six shapes, five levels, groups, badges, the four highlight layers
- [x] Zoom, pan, node drag, click / Ctrl+click / Alt+click / Shift and badge gestures work
- [x] `.fg.json` loads and saves through `persephone.host.*`, preserving unknown keys, 4-space JSON
- [x] Footer shows the `N of M nodes` count via `setStatusText`
- [x] Canvas palette comes from `getTheme()` + `onThemeChange`, with a working fallback
- [x] Board chrome uses `board-base.css`'s `.p-*` classes
- [x] `ui.log` is clean (no CSP violations, no errors)
- [x] Fully offline (no CDN / network)
- [x] Task document + dashboard entry exist

## Files Changed

| File | Change |
|------|--------|
| `boards/force-graph/board-manifest.json` | New — identity, `*.fg.json` + `contentMasks`, content-host, priority 200 |
| `boards/force-graph/index.html` | New — shell, toolbar, canvas host, BT-015 mount slots |
| `boards/force-graph/style.css` | New — layout, overlays, confirm overlay, `--p-*` only |
| `boards/force-graph/graph-core.js` | New — the pure model layer (verbatim port) |
| `boards/force-graph/graph-renderer.js` | New — `ForceGraphRenderer` (verbatim port, 3 recorded deviations) |
| `boards/force-graph/graph-theme.js` | New — `getTheme().graph` adapter + fallback palette |
| `boards/force-graph/app.js` | New — controller: content host, rebuild pipeline, toolbar, keyboard |
| `boards/force-graph/icon.svg` | New — board icon |
| `boards/force-graph/CLAUDE.md` | New — board-specific author notes (replaces the generic scaffold copy) |
| `boards/force-graph/WHATS-NEW.md` | New — `## 0.1.0` changelog |
| `boards/force-graph/lib/d3-graph.min.js` | New — vendored D3 v7 UMD subset (11 modules, ~77 KB) |
| `boards/force-graph/lib/LICENSE`, `lib/VERSION.txt` | New — ISC licence + module/version manifest |
| `boards/force-graph/board-base.css` | Unchanged scaffold copy |
| `doc/active-work.md` | Entry added under **Active** |

## Notes

- `create_board` produced a `scripts/hello.js` sample; it was deleted — this board runs no
  backend process.
- The vendored bundle is the official npm `dist/*.min.js` of 11 D3 modules concatenated in
  dependency order (only four are used directly; the rest are transitive). Each UMD build
  merges into the shared `window.d3` global, so the order is load-bearing.
- `[hidden]` loses to any class rule that sets `display`; `style.css` needed an explicit
  `[hidden] { display: none !important; }` for the state overlays.
- A canvas has no accessibility refs, so `editor.click` cannot drive graph gestures. They
  were verified by dispatching synthetic `MouseEvent` / `WheelEvent` through
  `editor.evaluate`, which d3-zoom and d3-drag accept.
