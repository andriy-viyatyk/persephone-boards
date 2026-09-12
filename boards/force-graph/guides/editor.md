---
title: "Using the Force Graph board"
audience: user
summary: "Force Graph board guide: toolbar, canvas gestures, panels, detail and legend, context menus, search, grouping, expansion and keyboard."
editorId: "board"
---

# Using the Force Graph board

Force Graph draws a `.fg.json` file as a force-directed graph on a canvas. Nodes and links are
drawn, not laid out in HTML, so everything you do to the graph itself is a mouse gesture or a
right-click; everything you do *about* the graph is in the floating chrome around it.

## Opening a graph

- Open any `*.fg.json` file — Force Graph is its default editor.
- Or put JSON containing `"type": "force-graph"` in any page and pick **Force Graph** from the
  editor switch. That is how a graph an assistant just generated can be rendered without being
  saved first.

An empty or new file shows **"Right-click → Add Node to start building the graph"**. A file that
is not valid JSON shows a parse-error panel instead of the canvas; fix it in the text editor
(switch back with the editor switch) and the graph reappears.

The board is a content host: `Ctrl+S` saves, the tab shows the usual modified marker, and the
footer shows the provider and encoding just like a text page. Every edit you make is written into
the file immediately — saving only flushes it to disk.

## Layout

All of the chrome floats over a full-bleed canvas at half opacity and comes to full opacity when
you hover it, focus it, or open one of its panels.

```
+---------------------------------------------------------------------+
| [Physics][Grouping][Reset][Expand all] [Search] [x] 3/1/4  2 sel ▾   |
| | [Open in Drawing] [Copy image]                                     |  toolbar card, top-left
| +-----------------------------------+                               |
| | [Physics][Expansion][Results]     |                               |  panel strip, under the toolbar
| | ...panel body...                  |                               |
| +-----------------------------------+       +---------------------+ |
|                                             | node title       ▲  | |  detail panel, top-right
|                      [ canvas ]             | [Info][Props][Links]| |
|                                             | ...                 | |
| +---------------------+                     +---------------------+ |
| | Legend           ▲  |                                             |  legend panel, bottom-left
| | [Selection][Level][Shape]                                         |
| +---------------------+                                             |
+---------------------------------------------------------------------+
```

## The toolbar

Left to right:

| Control | What it does |
|---|---|
| **Force tuning** | Opens or closes the Physics panel |
| **Grouping** | Draws group containers, or hides them and shows their members as plain nodes. Disabled when the file has no groups. It is **struck through while grouping is off**, and the setting is remembered per page |
| **Reset view** | Rebuilds the layout from scratch and restarts the simulation from the current root and visibility settings |
| **Expand all** | Reveals every node hidden by the visibility filter. Enabled only while something is hidden; over 1,000 nodes it asks first ("Expand All Nodes") |
| **Search** | Filters the graph by node title and property text. The **x** at its right clears it |
| *match counts* | `N visible / N hidden / N total` for the running search |
| **N selected ▾** | Appears once nodes are selected; opens the selection menu |
| **Open in Drawing** | Opens a picture of the current graph as a new, editable drawing |
| **Copy image** | Copies a PNG of the current graph to the clipboard |

The last two buttons live in the board's own toolbar. The built-in editor put them in
Persephone's page toolbar; a board cannot add buttons there.

## Canvas gestures

| Gesture | Result |
|---|---|
| Click a node | Select it (clicking empty space deselects) |
| **Ctrl+click** a node | Add it to, or remove it from, the selection |
| **Alt+click** a second node | Toggle the link between it and the single selected node. If either node is a group, this adds or removes group membership instead. The footer spells out what the click will do before you make it |
| Drag a node | Move it; the simulation settles around it |
| Drag empty space | Pan |
| Wheel | Zoom (0.1x to 12x) |
| Double-click | Expand the detail panel for the selection |
| Hover a node | After a moment, a card with its title, id and properties |
| Click a **+N** badge | Reveal one more level of that node's hidden neighbours |
| **Ctrl+click** a **+N** badge | Reveal that node's whole hidden subtree |
| Hold **Shift** | Highlight the selection together with its neighbours |

### The hover card

The card shows the node's title, its id, a **Root Node** or **Group** badge where it applies, and
every custom property. Markdown links inside property values are clickable. Two buttons in its
header **copy the node as Markdown** and **open it as a Markdown page**.

## Selecting and acting on nodes

Right-clicking anywhere opens a menu, and the **N selected ▾** button opens the same actions for
the whole selection.

**Empty canvas** — *Add Node*.

**A node** — *Open &lt;property&gt;* for each Markdown link the node carries, *Add Child*, *Set as
Root*, *Collapse*, *Select children*, *Delete Node* (or *Delete N Nodes*), *Delete Link to…*,
*Group Selected* (two or more selected) and *Remove from Group*.

**A group node** — *Edit Title*, *Collapse*, *Select members*, *Select members deep*,
*Delete (Ungroup)* — which dissolves the group and keeps its members — and *Delete with
Children*, which removes the group and the members drawn inside it. Both ask first.

**The selection menu** — *Select children*, *Select members*, *Select members deep*,
*Highlight*, *Copy (markdown)*, *Open (markdown)*, *Open in grid*, *Group Selected*, *Extract*,
*Extract with children*, and *Delete N Nodes*.

*Extract* opens the selected nodes, and the links between them, as a **new graph page**;
*Extract with children* pulls in their linked neighbours first. *Open in grid* opens the
selection as a JSON grid, one row per node.

## The detail panel

The panel at the top right follows the selection. Its header shows the selected node's label,
or `N nodes selected`; click the header — or double-click the canvas — to expand it.

Drag the **grip in its bottom-left corner** to resize it in both directions, from 200x200 up to
90% of the canvas. The grids are the reason to make it bigger.

**Info** — edit the node's **ID** (every link to it is repointed; a clash reports *ID already
exists*), its **Title**, its **Level** 1-5 and its **Shape**. With several nodes selected, the
level and shape rows batch-edit all of them and mark values that differ.

**Properties** — a grid of the node's custom properties, `Name` and `Value`. Add rows, delete
rows, edit cells, then **Apply** (or **Cancel**). Reserved names — `id`, `title`, `level`,
`shape`, `isGroup` — are flagged and block Apply. With several nodes selected the grid edits
them all, and the line under it tells you whether they share a value.

**Links** — the nodes this one is linked to, as an editable grid: change an id to repoint a
link, add a row to create one, delete a row to remove one, then **Apply**. While the tab is open
the node and its neighbours are highlighted on the canvas, and any hidden neighbours are
revealed.

While a grid has unapplied edits the panel holds focus: tabs are disabled, and canvas clicks and
right-clicks are ignored until you Apply or Cancel.

## The legend

The panel at the bottom left explains and highlights parts of the graph. Click its header to
expand it.

- **Selection** — highlight *Selected*, *Selected with children*, or *Not selected*.
- **Level** and **Shape** — tick any combination of levels, shapes, *Root* and *Group* to light
  those nodes and dim the rest. Each row also has a **description** box: what you type there is
  saved into the file, so the legend explains what level 2 or a diamond means *in this graph*.

Only levels and shapes actually present in the graph get a row. While a search is running the
legend shows a notice and a **Clear search** button instead, because search owns the highlight.

## Search, results and expansion

Typing in the search box matches every word against node titles and property values, highlights
the matches and opens the **Results** panel. Each result row shows the matched text highlighted,
and rows for nodes currently hidden are marked as such; clicking one reveals and selects it.
The status line offers **[+N hidden]** to reveal the hidden matches and **[select all]** /
**[add to selection]** for the whole result set. The first 100 results are listed.

From the search box, **arrow keys** walk the result list and **Enter** picks the highlighted one
(or reveals the hidden matches when there is no list selection).

### Physics

The Physics panel tunes the simulation live and saves the values in the file:

| Slider | Range | Meaning |
|---|---|---|
| **Charge** | -200 to 0 | Repulsion between nodes — more negative spreads the graph out |
| **Distance** | 10 to 200 | The link force's preferred link length, in pixels |
| **Collide** | 0 to 1 | How hard nodes refuse to overlap |

**Reset** restores the defaults (-70, 40, 0.7) and removes the saved values from the file.

### Expansion

A large graph is not drawn all at once: the board picks a root, walks outward, and hides the
rest behind **+N** badges. The Expansion panel controls that:

- **Root Node** — the node it expands from; type to filter, or pick *(auto — lowest level)*.
- **Expand Depth** — how many steps out from the root are visible. Blank means unlimited.
- **Max Visible** — the cap on visible nodes. Blank means 500.

Depth and Max Visible apply **when the file is next opened**; the panel says so.

## Keyboard

| Key | Action |
|---|---|
| `Ctrl+F` | Focus and select the search box |
| `Ctrl+A` | Select every visible node |
| `Escape` | Close the open panel, then collapse the detail panel; in the search box, clear the search |
| `Shift` (held) | Highlight the selection and its neighbours |
| `Arrow Up` / `Arrow Down`, `Enter` | Walk and pick search results, from the search box |
| `Ctrl+S` | Save the file |

## The footer

The page footer shows `N nodes`, or `N of M nodes` while nodes are hidden. While you hover a
node with exactly one other node selected, it is replaced by the Alt+click hint — for example
*Alt+Click to link with "Zeus"* or *Alt+Click to add to "Olympians"*.

## User-facing label → element name

Agents and automation address the board's controls by these names.

| Label | `elements` name |
|---|---|
| Force tuning | `graph-settings` |
| Grouping | `graph-toggle-grouping` |
| Reset view | `graph-reset-view` |
| Expand all | `graph-expand-all` |
| Search | `graph-search` |
| Search clear | `graph-search-clear` |
| N selected ▾ | `graph-selection-menu` |
| Open in Drawing | `graph-open-in-draw` |
| Copy image | `graph-copy-image` |
| Physics tab | `graph-panel-physics` |
| Expansion tab | `graph-panel-expansion` |
| Results tab | `graph-panel-results` |
| Charge | `tuning-charge` |
| Distance | `tuning-link-distance` |
| Collide | `tuning-collide` |
| Reset (physics) | `tuning-reset` |
| Root Node | `graph-expansion-root` |
| Expand Depth | `graph-expansion-depth` |
| Max Visible | `graph-expansion-max` |
| Detail panel | `graph-detail-panel` |
| Detail header (expand/collapse) | `graph-detail-toggle` |
| Info / Properties / Links tabs | `graph-detail-tab-info`, `graph-detail-tab-properties`, `graph-detail-tab-links` |
| ID | `graph-detail-id` |
| Title | `graph-detail-title` |
| Properties grid | `graph-properties-grid` |
| Links grid | `graph-links-grid` |
| Legend panel | `graph-legend-panel` |
| Legend header | `graph-legend-toggle` |
| Selection / Level / Shape tabs | `graph-legend-tab-selection`, `graph-legend-tab-level`, `graph-legend-tab-shape` |

The canvas itself has no named elements — nodes, links and labels are painted, not DOM elements.
Drive the graph through the [agent model](agent.md) instead.

## See also

- [The `.fg.json` format](format.md) — what the file contains.
- [Driving it as an agent](agent.md) — the `pages[i].editor.app` model.
