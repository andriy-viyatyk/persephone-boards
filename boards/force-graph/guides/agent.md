---
title: "Force Graph for agents"
audience: agent
summary: "Drive the Force Graph board through pages[i].editor.app: read, analyse and edit a graph, and the 33 named elements of its UI."
---

# Force Graph for agents

The board publishes a live model of the open graph at **`pages[i].editor.app`**. It carries
everything the app's old `graph-view` facade had — queries, traversal, analysis, selection —
plus the editing methods the facade never had, because a board's content is not writable from an
agent the way `page.content` was.

There is no `page.asGraph()` and no `page.editor.<graph member>`. Everything below hangs off
`.editor.app`.

## Finding the page

A graph page reports an editor id of `board-editor:<board root>`:

```
call path: pages
  → { id: "…", title: "deps.fg.json", editor: "board-editor:C:\\…\\boards\\force-graph", … }

call path: pages["<id>"].editor.app            → the model summary
call path: pages["<id>"].editor.app.$help      → the long-form help
call path: pages["<id>"].editor.app.helpSearch, args: ["group"]
```

`boards.list()` also reports the board's `openPageIds`.

The canvas is a single `<canvas>`: nodes, links and labels are **not** DOM elements and cannot be
clicked, highlighted or found by ref. `elements` covers only the toolbar, panels, detail and
legend; everything about the graph itself goes through the model.

## Reading the graph

| Member | Returns | Notes |
|---|---|---|
| `fileName` | string | The open file's name, or `""` |
| `nodes` | indexed collection | `nodes.count`, `nodes.ids`, `nodes[3]`, `nodes["zeus"]` |
| `nodes[key]` | node | `id`, `title`, `level`, `shape`, `isGroup`, `group`, `neighbors`, `properties` |
| `links` | `{source, target}[]` | Every link as a pair of node ids |
| `nodeCount` / `linkCount` | number | Totals for the file |
| `getNode(id)` | node or `undefined` | Cleaned — no simulation fields |
| `loading` | boolean | The file is still being parsed |
| `error` | string | The JSON parse error, or `""` |
| `isEmpty` | boolean | The graph has no nodes |
| `hasGroups` | boolean | The file contains group nodes |
| `hasVisibilityFilter` | boolean | Nodes are hidden because the graph is large |
| `recordsCount` | string | The footer text, e.g. `"120 of 4,000 nodes"` |
| `totalNodeCount` | number | Total including hidden nodes |

Node ids, not titles, address every node. Read `nodes.ids` or `nodes[n].id` first.

## Selection

| Member | Signature | Notes |
|---|---|---|
| `selectedIds` | property | Ids currently selected on the canvas |
| `selectedNodes` | property | The selected nodes, cleaned |
| `select(ids)` | `string[]` | Replaces the selection |
| `addToSelection(ids)` | `string[]` | Adds to it |
| `clearSelection()` | — | Deselects everything |
| `selectChildren(ids?)` | `string[]?` | Adds the linked neighbours; defaults to the current selection |
| `selectMembers(ids?)` | `string[]?` | Adds the direct members of these groups |
| `selectMembersDeep(ids?)` | `string[]?` | Adds members of these groups and their sub-groups |

All of these change what the user sees.

## Relationships and groups

| Member | Returns |
|---|---|
| `getNeighborIds(nodeId)` | Ids linked by **real data links**, ignoring group membership |
| `getVisualNeighborIds(nodeId)` | Ids this node is **drawn** connected to; with grouping on a link can route through a group |
| `getGroupOf(nodeId)` | The containing group's id, or `undefined` |
| `getGroupMembers(groupId)` | Direct members |
| `getGroupMembersDeep(groupId)` | Members including sub-groups |
| `getGroupChain(nodeId)` | Groups from this node outward |
| `isGroup(nodeId)` | Whether the node is a container |

Groups are nodes with `isGroup: true`, and a link touching a group node means *membership*. That
is why the two neighbour calls can disagree.

## Analysis

| Member | Signature | Notes |
|---|---|---|
| `search(query, includeHidden = true)` | | Multi-word AND over titles and property values. **Pure query — changes nothing on screen.** Rows are `{ nodeId, label, visible, matchedProps }` |
| `bfs(startId, maxDepth?, visual = false)` | | Breadth-first walk; returns `{ id, depth }[]`. `visual: true` follows drawn links instead of data links |
| `getComponents()` | | Disconnected sub-graphs, largest first: `{ nodeCount, rootId, nodeIds }`. Group nodes are excluded, and `rootId` is the graph's root when it belongs to that component, otherwise its most connected node |

## Root, grouping, view and visibility

| Member | Signature | Notes |
|---|---|---|
| `rootNodeId` | property | `""` when the root is picked automatically |
| `setRootNode(nodeId?)` | | Pass nothing to go back to automatic. Saves |
| `groupingEnabled` | property | Whether group containers are drawn |
| `toggleGrouping()` | | Clears the selection and re-simulates. The setting is **page-scoped** |
| `resetView()` | | Rebuild the layout and restart the simulation |
| `resetVisibility()` | | Undo every manual expand/collapse |
| `expandAll()` | | Reveal everything. **No confirmation** — the UI asks over 1,000 nodes, this does not. Can be slow |
| `expandNode(nodeId)` | | One more level — what clicking the node's `+N` badge does |
| `expandNodeDeep(nodeId)` | | The node's whole hidden subtree |
| `collapseNode(nodeId)` | | Fold that subtree away |

The expand/collapse calls return the new `recordsCount`.

## The visible search box

`search()` above is the silent query. These drive the UI instead:

| Member | Notes |
|---|---|
| `searchQuery` | Readable and writable; setting it re-runs the on-screen search |
| `setSearchQuery(query)` | The same, returning `searchInfo` |
| `searchInfo` | `{ visible, hidden, total }` for the running search |
| `searchResults` | The rows shown in the Results panel |
| `revealHiddenMatches()` | Show the matches the visibility filter is hiding |
| `revealAndSelectNode(nodeId)` | Bring one hidden node into view and select it |
| `selectSearchResults()` | Reveal every match and add them all to the selection |

## Physics, expansion and legend

| Member | Signature | Notes |
|---|---|---|
| `forceParams` | property | `{ charge, linkDistance, collide }` |
| `updateForceParams(params)` | `{ charge?, linkDistance?, collide? }` | Saves into `options` |
| `resetForceParams()` | | Back to -70 / 40 / 0.7, and drops the saved values |
| `expansionOptions` | property | `{ rootNode, expandDepth, maxVisible }` |
| `updateExpansionOptions(patch)` | `{ expandDepth?, maxVisible? }` | Applies **when the file is next opened** |
| `legendDescriptions` | property | `{ levels, shapes }` |
| `setLegendDescription(tab, key, value)` | `"levels" \| "shapes"` | e.g. `("levels", "1", "Core modules")` |

## Editing

Every call here re-serializes the whole document through Persephone's content host — the page is
modified immediately, and `Ctrl+S` (or `save()`) writes it to disk.

| Member | Signature | Notes |
|---|---|---|
| `addNode(props?)` | | Creates a node, returns its id. `props` may carry `title`, `level`, `shape` or custom properties |
| `addChild(parentId, props?)` | | Creates a node linked to `parentId`, returns its id |
| `setNodeProps(nodeId, props)` | | Change title/level/shape/custom properties; an empty value removes a property |
| `renameNode(oldId, newId)` | | Repoints every link. Throws when `newId` is taken |
| `deleteNodes(ids)` | | **Immediate — no confirmation, no undo.** Removes the nodes and every link touching them |
| `addLink(sourceId, targetId)` | | |
| `deleteLink(sourceId, targetId)` | | |
| `groupSelected(ids, title?)` | | Puts the nodes in a group and returns its id. With exactly one group among `ids` and no `title`, the rest are added to that group instead |
| `setGroupTitle(groupId, title)` | | |
| `ungroup(groupId)` | | Dissolves the group, keeping its members. **Immediate** |
| `deleteGroup(groupId)` | | Deletes the group and the members inside it; unconnected members are moved up instead. **Immediate** |
| `removeFromGroup(nodeId)` | | Takes a node out of its group |
| `save()` | | The same as `Ctrl+S` |

Two rules hold across the whole model, and are the reason it is safe to call from an agent:

- **Nothing waits on a dialog.** The interactive UI confirms deletes and asks for a group title;
  these methods take the direct path and return.
- **Nothing depends on "select something first."** `addChild(parentId)` and `groupSelected(ids)`
  take explicit ids.

## Export and hand-off

| Member | Notes |
|---|---|
| `extract(withChildren = false)` | Opens the selection as a **new graph page**; `true` pulls in linked children |
| `openMarkdown()` | Opens the selection as a Markdown page |
| `openGrid()` | Opens the selection as a JSON grid, one row per node |
| `copyMarkdown()` | Copies the selection to the clipboard as Markdown |
| `openInDrawingEditor()` | Opens a picture of the graph as a new editable drawing |
| `copyImageToClipboard()` | Copies a PNG of the graph to the clipboard |

`copyMarkdown` and `copyImageToClipboard` need the Persephone window focused; with the app in
the background the browser refuses with *"Document is not focused"*. That is a platform rule,
not a board failure.

## Named elements

33 controls carry stable names for `elements`, `highlight(...)` and snapshot-driven clicks.

| Name | Where |
|---|---|
| `graph-settings` | Toolbar — Force tuning |
| `graph-toggle-grouping` | Toolbar — Grouping |
| `graph-reset-view` | Toolbar — Reset view |
| `graph-expand-all` | Toolbar — Expand all |
| `graph-search` | Toolbar — the search field |
| `graph-search-clear` | Right edge of the search field, when it has text |
| `graph-selection-menu` | Toolbar — `N selected ▾`, when nodes are selected |
| `graph-open-in-draw` | Toolbar, right — Open in Drawing |
| `graph-copy-image` | Toolbar, right — Copy image |
| `graph-panel-physics` | Panel strip — Physics tab |
| `graph-panel-expansion` | Panel strip — Expansion tab |
| `graph-panel-results` | Panel strip — Results tab |
| `tuning-charge` | Physics panel, first row |
| `tuning-link-distance` | Physics panel, second row |
| `tuning-collide` | Physics panel, third row |
| `tuning-reset` | Physics panel, bottom right |
| `graph-expansion-root` | Expansion panel — Root field |
| `graph-expansion-depth` | Expansion panel — Depth field |
| `graph-expansion-max` | Expansion panel — Max Visible field |
| `graph-detail-panel` | The detail panel, floating top-right |
| `graph-detail-toggle` | Its header — expand / collapse |
| `graph-detail-tab-info` | Detail — Info tab |
| `graph-detail-tab-properties` | Detail — Properties tab |
| `graph-detail-tab-links` | Detail — Links tab |
| `graph-detail-id` | Detail, Info tab — ID |
| `graph-detail-title` | Detail, Info tab — Title |
| `graph-properties-grid` | Detail, Properties tab |
| `graph-links-grid` | Detail, Links tab |
| `graph-legend-panel` | The legend panel, floating bottom-left |
| `graph-legend-toggle` | Its header — expand / collapse |
| `graph-legend-tab-selection` | Legend — Selection tab |
| `graph-legend-tab-level` | Legend — Level tab |
| `graph-legend-tab-shape` | Legend — Shape tab |

The two image buttons are in the board's own toolbar. A board cannot contribute to Persephone's
page toolbar, which is where the built-in editor kept them.

## Examples

**What is in this graph?**

```
pages["<id>"].editor.app                       → summary: counts, root, grouping, search state
pages["<id>"].editor.app.nodes                 → every node with its properties
```

**Find something and show it to the user**

```
pages["<id>"].editor.app.search           args: ["auth"]        → the matches, nothing moves
pages["<id>"].editor.app.setSearchQuery   args: ["auth"]        → the same, on screen
pages["<id>"].editor.app.selectSearchResults args: []           → reveal and select them all
```

**Walk out from the root**

```
pages["<id>"].editor.app.rootNodeId
pages["<id>"].editor.app.bfs   args: ["app", 3]                 → [{ id, depth }, …]
```

**Find the orphans**

```
pages["<id>"].editor.app.getComponents   args: []
// components[0] is the main graph; small ones are usually worth a look
```

**Build a graph**

```
pages["<id>"].editor.app.addNode    args: [{ "title": "Gateway", "level": 1 }]   → "node-1"
pages["<id>"].editor.app.addChild   args: ["node-1", { "title": "Auth" }]        → "node-2"
pages["<id>"].editor.app.addLink    args: ["node-2", "node-3"]
pages["<id>"].editor.app.setNodeProps args: ["node-2", { "shape": "diamond", "owner": "platform" }]
pages["<id>"].editor.app.save       args: []
```

**Group a subsystem**

```
pages["<id>"].editor.app.groupSelected args: [["auth", "token", "session"], "Identity"]  → "group-1"
```

## Gotchas

- **An inactive page's canvas measures 0x0.** Hit-testing, screenshots and anything positional
  only work on the active tab — activate it first.
- **The shape of the model changes with the data.** The board republishes it when the graph goes
  from empty to non-empty; if `nodes[0]` does not resolve on a graph you just created, read
  `pages[i].editor.app` again after the *board shape changed* event.
- **Deletes are final.** `deleteNodes`, `ungroup` and `deleteGroup` do not confirm and there is
  no undo. Read what you are about to remove first.
- **`expandAll()` on a very large graph is slow** and the model will not warn you; check
  `totalNodeCount` first.
- **`recordsCount` counts group nodes in its total**, even while grouping is off. That matches
  the built-in editor and is deliberate.
- **Writing the page text directly is not the way to edit.** The board owns the content; use the
  editing methods above, which keep unknown keys, strip simulation fields and save correctly.

## See also

- [The `.fg.json` format](format.md) — the file you are reading and writing.
- [Using the board](editor.md) — what the user sees and the gestures they have.
