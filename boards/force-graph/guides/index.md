---
title: "Force Graph"
audience: both
summary: "The Force Graph board: what it is, what it opens, and where its guides live."
---

# Force Graph

Force Graph is a Persephone **board** that draws node-link data as an interactive
force-directed graph on a canvas, with a live physics simulation. It is both a viewer and a
full editor: nodes, links, groups, levels, shapes and per-node properties can all be changed
from the board, and every change is written straight back to the file.

It replaces Persephone's former built-in Graph editor. The behaviour, the file format and the
named UI elements are the same; the differences are listed under
[What changed from the built-in editor](#what-changed-from-the-built-in-editor).

## What it opens

- **`*.fg.json` files** — the board is the default editor for them.
- **Any JSON page whose text contains `"type": "force-graph"`** — the board then appears as an
  editor-switch option, so a graph an agent generated into an untitled page can be rendered
  without saving it first.

The file is owned by Persephone (the board is a *content host*), so encoding, auto-save,
`Ctrl+S`, the dirty marker and the provider footer all behave exactly as they do in the text
editor, and you can switch the same page between Force Graph and Monaco without reloading.

## When to use it

Reach for a force graph when the *shape* of a relationship set is the thing you want to see:
module dependencies, a call graph, an entity model, an org chart, a mind map, the topology of a
system. It handles a few thousand nodes by hiding the distant ones behind expandable badges
rather than by drawing everything at once.

It is not a chart or a tree widget — for tabular data use the JSON grid, and for a fixed
hand-drawn diagram use Mermaid or the Drawing editor.

## An example graph

The board ships a sample file, **`examples/greek-gods.fg.json`** — 63 nodes and 87 links of Greek
mythology, with a root node, four shapes, four levels, per-node properties and a legend. It is
the graph the rest of these guides are written against.

Open it in one click from the board catalog:
[greek-gods.fg.json](https://raw.githubusercontent.com/andriy-viyatyk/persephone-boards/main/boards/force-graph/examples/greek-gods.fg.json).
Persephone fetches the file and draws it in this board, exactly as it would a local one.

The same file is already on disk inside the board's own folder, at `examples/greek-gods.fg.json`,
if you would rather work offline or keep an editable copy. The board's folder is shown on its
Board Info page — open **Boards** in the sidebar and select **Force Graph**.

## The guides

| Page | For | What it covers |
|---|---|---|
| [Using the board](editor.md) | users | Toolbar, canvas gestures, panels, the detail and legend panels, context menus, search, grouping, expansion, keyboard |
| [The `.fg.json` format](format.md) | everyone | The file schema: nodes, links, options, the legend block, and how to write a graph file by hand or from a script |
| [Driving it as an agent](agent.md) | agents | The `pages[i].editor.app` model — every property and method, the 33 named elements, and worked examples |

## What changed from the built-in editor

If you used the built-in Graph editor, four things behave differently here:

1. **The two image buttons — Open in Drawing and Copy image — are in the board's own toolbar**,
   at the right of the same row as the other graph controls. A board cannot contribute buttons
   to Persephone's page toolbar, which is where they used to live.
2. **The Grouping button is struck through while grouping is OFF** (the built-in struck it
   through while grouping was on).
3. **The detail panel resizes from a grip in its bottom-left corner, on both axes** — minimum
   200x200, maximum 90% of the canvas.
4. **Grouping is remembered per page**, not once for every graph you open.

The agent surface moved too: it is `pages[i].editor.app.*` now, not `page.editor.*`, and
`page.asGraph()` is gone. See [Driving it as an agent](agent.md) — the model also gained the
editing methods the old facade never had.
