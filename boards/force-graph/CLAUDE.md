# Force Graph board — author notes

A **content-host** board that renders and edits `.fg.json` force-directed graphs on a
`<canvas>` with a live `d3-force` simulation. It is the board port of Persephone's
built-in `graph-view` editor (`src/renderer/editors/graph/`, 29 files / 8,569 LOC),
tracked as **EPIC-100** in the app repo.

> The generic board-authoring reference is not here — read it from the running app with
> the `guides.agents.boards` MCP path (or the `persephone://guides/boards` resource).
> This file documents only what is specific to this board.

## Status

**Feature-complete at 1.0.0** (BT-014 built the models/renderer/host, BT-015 the rest of
the UI and the agent surface). The parity checklist is §1.3 of
`persephone/doc/epics/EPIC-100-investigation-notes.md`; BT-016 verifies it end to end.

## Files

| File | Role |
|---|---|
| `board-manifest.json` | Identity + `.fg.json` association (`editorKind: content-host`, `editorPriority: 200`, `contentMasks` for `"type":"force-graph"` JSON) |
| `index.html` | One shell: toolbar, panel strip, legend slot, canvas host, detail slot |
| `style.css` | Layout, panels, dialogs, tooltip, menus. All `--p-*` driven |
| `graph-core.js` | **Pure model layer** — verbatim port of `types`, `shapeGeometry`, `constants`, `GraphHighlightModel`, `GraphGroupModel`, `GraphConnectivityModel`, `GraphVisibilityModel`, `GraphDataModel`, `GraphSearchModel`. No DOM, no `persephone`, no d3 |
| `graph-renderer.js` | `ForceGraphRenderer` — canvas drawing, the d3 simulation, zoom/pan/drag, hit-testing |
| `graph-theme.js` | Canvas palette adapter (`persephone.getTheme().graph` → 14 concrete colors, with a fallback) |
| `graph-ui.js` | DOM helpers, level/shape icons, markdown builder, the in-frame dialogs, the context-menu builders, the hover tooltip |
| `graph-actions.js` | Mutation + group actions (ports of `GraphMutationModel` / `GraphGroupActionsModel`) with the `*Core` agent-safe split |
| `graph-panels.js` | Legend panel, detail panel (the two `av-grid` grids), Physics / Expansion / Results |
| `graph-aivision.js` | The `pages[i].editor.app` model — the `GraphEditorFacade` reproduction |
| `guides/` | The board's own documentation (`guides` manifest field): `index.md`, `editor.md`, `format.md`, `agent.md`. Mounted into Persephone's guide index under `boards/force-graph/` |
| `app.js` | Controller — content-host I/O, rebuild pipeline, toolbar, keyboard, menus, image export |
| `lib/d3-graph.min.js` | Vendored D3 v7 UMD subset |
| `lib/av-grid.umd.js`, `lib/av-grid.css` | Vendored `av-grid` 2.6.1 — the two grids **and** the context menus (`AVGrid.showMenu`) |

Everything hangs off one `window.FG` namespace; each file is a classic-script IIFE
(a board has no bundler and no modules). Load order is fixed in `index.html`:
d3 → av-grid → core → renderer → theme → ui → actions → panels → aivision → app.

## The things that differ from the built-in editor

1. **Colors are injected, not resolved.** A canvas cannot read `var(--p-…)`, so
   `graph-theme.js` reads `persephone.getTheme().graph` (14 semantic keys, bridge 1.5.0)
   and pushes them into `renderer.setColors()` on every `onThemeChange`. Check
   `window.FG.paletteFromContract` to see whether the contract or the fallback is live.
2. **`av-grid`'s `showMenu` backs all five menus.** It takes exactly Persephone's own
   `MenuItem` shape (nested `items`, `startGroup`, `disabled`, `invisible`, `icon`) and is
   themed from `--p-*`. It is vendored and in-frame, so EPIC-100 D2 holds.
3. **The chrome floats over a full-bleed canvas** at 50% opacity - toolbar + panel strip
   top-left, legend bottom-left, detail top-right - matching the built-in. The detail panel
   resizes from a **bottom-left grip on both axes** (min 200x200, max 90% of the canvas).
4. **The two image buttons live in the board's own `.p-toolbar`** (D4) — a board cannot
   contribute to Persephone's page toolbar.
5. **`groupingEnabled` is page-scoped** (`persephone.state` `restorableKeys`) rather than
   host-scoped (`host.editorSettings["graph-view"]`).
6. **Open in Drawing builds its own Excalidraw document** — `editors/draw/drawExport` is
   unreachable from a board — and opens it with `openContent({ editor: "draw-view" })`,
   falling back to the documented `openRawLink(pngDataUrl, { editor: "draw-view" })`.

## Data flow

```
persephone.host.getContent() ──┐
persephone.host.onContentChange ┴→ parseContent() → dataModel.sourceData
                                         │
                                         ▼
   rebuildAndRender():  grouping filter → groupModel.rebuild → groupModel.preprocess
                        → connectivityModel.rebuild → visibilityModel (BFS)
                        → renderer.updateData / updateVisibleData
                                         │
   any mutation → writeNow() → serialize() → persephone.host.setContent()
```

`serialize()` spreads `originalJson`, so **`type` and every unknown top-level key survive a
save**, and writes 4-space JSON — byte-compatible with the built-in editor. `lastWritten` is
the echo guard. Simulation fields (`x`/`y`/`vx`/`vy`/`fx`/`fy`/`index`) and `_$` runtime
fields never reach the file, because `rebuildAndRender` hands the renderer **copies**.

## The agent surface

`persephone.aiVision.expose(...)` publishes the board's model at `pages[i].editor.app` —
the `GraphEditorFacade` members plus the editing methods the facade never had (the built-in
told agents to edit `page.content`, which a board cannot offer). Two rules hold there:

- **No agent method blocks on an overlay.** Every confirmation has a `*Core` half —
  `deleteNodesCore`, `ungroupNodeCore`, `deleteGroupCore`, `groupSelectedCore`,
  `setGroupTitleCore`, `expandAllCore` — and the model calls only those.
- **No implicit "selection first".** `addChild(parentId)`, `groupSelected(ids)`,
  `selectChildren(ids?)` all take explicit ids.

## Testing it

`C:\projects\persephone\assets\guides\examples\greek-gods.fg.json` (63 nodes, six shapes,
five levels, a root, legend descriptions, markdown links) is the primary fixture. For
groups + BFS visibility + badges you need a graph with group nodes and a small
`options.maxVisible`.

```
edit files → pages[pageId].editor.reload() → pages[pageId].editor.screenshot()
          → read this folder's ui.log BEFORE declaring anything working
```

`board-manifest.json` is **not** covered by `reload()`.

Canvas gestures cannot be driven with `editor.click` (a canvas has no snapshot refs).
Dispatch synthetic `MouseEvent` / `WheelEvent` through `editor.evaluate` instead.

## Gotchas found while building this

- **`[hidden]` loses to any class that sets `display`** — `style.css` needs the explicit
  `[hidden] { display: none !important; }`.
- **The vendored d3 must load in dependency order** — see `lib/VERSION.txt`.
- **`initializeForces` bails out while the canvas measures 0×0**, which is the normal case
  in a board frame (content arrives before the first layout). Without the recovery in
  `handleResize` the graph renders as a cloud of nodes with **no links**: charge, collide
  and center get installed by the later resize, but the link force never does.
- **Never write `persephone.state` from inside its own `onChange`.** Two conflicting
  snapshots in flight then flip the value forever — here that re-simulated the graph and
  cleared the selection ~180×/s. `setGrouping` persists; `applyGrouping` is what the
  subscriber calls.
- **An inactive page's canvas measures 0×0**, so hit-testing and synthetic coordinates only
  work on the active tab.
- **`navigator.clipboard.write` needs a focused window** — Copy Image fails with "Document
  is not focused" when driven over MCP while the app is in the background. It is handled
  and toasted; it is not a board bug.
- **av-grid menus dismiss on a real gesture**, not a synthetic `mousedown` — use
  `editor.pressKey("Escape")` when testing, or menus stack up invisibly.
- **`recordsCount()` counts `sourceData.nodes` as the total**, group nodes included, even
  while grouping is off. That is the built-in's behavior and is deliberate.
