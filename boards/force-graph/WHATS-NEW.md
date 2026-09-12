# What's new

## 1.0.0

- Selected-node detail panel with Info, Properties and Links tabs: edit a node's id, title, level and shape, and add, edit or delete its properties and links in a grid.
- Legend panel with Selection, Level and Shape tabs: highlight part of the graph, and write a description for each level and shape that is saved with the file.
- Physics panel to tune charge, link distance and collision, and an Expansion panel to pick the root node, the expand depth and how many nodes stay visible.
- Results panel listing every search match, with the matched text highlighted; the arrow keys and Enter walk it from the search box.
- Right-click menus for a node, a group, the empty canvas, and the selection - add, delete, group, ungroup, collapse, set as root, follow a link, and more.
- Hover a node for a card showing its title, id and properties, with Copy as Markdown and Open in new page.
- Open the selection as a Markdown page, as a JSON grid, or as a new graph with Extract / Extract with children.
- Copy the graph as an image, or open it as a new drawing in the Drawing editor.
- The board now publishes a full model for AI agents, so an assistant can read, analyse and edit the graph directly.
- The board now ships its own guides: open the About page (or press F1) for how to use it, the .fg.json file format, and the agent model.
- The board now ships an example graph, `examples/greek-gods.fg.json` - 63 nodes of Greek mythology - linked from the guides so it opens in one click.

## 0.1.0

- First release: force-directed graph rendering for `.fg.json` files on a canvas, with a live physics simulation.
- Six node shapes, five importance levels, group containers and a distinct root node.
- Pan, wheel zoom, node dragging, click and Ctrl+click selection, and Shift to highlight a selection's neighbours.
- Alt+click two nodes to add or remove the link between them.
- BFS visibility for large graphs: hidden-neighbour badges expand one level, Ctrl+click a badge to expand deeply, and Expand all reveals everything.
- Search nodes by label or property, with the matches highlighted on the canvas.
- Node count in the page footer, and the file is saved through Persephone with unknown keys preserved.
