---
title: "The .fg.json force-graph format"
audience: both
summary: "Force-graph file reference: the nodes, links and options schema, group membership, indexed and linked properties, and how the board saves a file."
---

# The `.fg.json` force-graph format

A force-graph file is plain JSON. It describes node-link data and a few display settings, and it
is meaningful on its own — you can write one by hand, generate one from a script, or commit one
to a repository without the Force Graph board installed. Without the board Persephone opens it
as JSON in the text editor; with the board installed it is drawn as a graph.

## The shape

```json
{
  "type": "force-graph",
  "nodes": [
    { "id": "node-1", "title": "My Node", "level": 1, "shape": "circle" },
    { "id": "node-2", "title": "Another", "level": 3, "owner": "platform" },
    { "id": "group-1", "title": "My Group", "isGroup": true }
  ],
  "links": [
    { "source": "node-1", "target": "node-2" },
    { "source": "group-1", "target": "node-1" }
  ],
  "options": {
    "rootNode": "node-1",
    "expandDepth": 3,
    "maxVisible": 500,
    "charge": -70,
    "linkDistance": 40,
    "collide": 0.7,
    "legend": {
      "levels": { "1": "Core modules", "root": "Entry point" },
      "shapes": { "circle": "TypeScript", "diamond": "React" }
    }
  }
}
```

`type`, `nodes` and `links` are the whole contract. `options` is optional, and so is every key
inside it.

For a real file rather than a sketch, read the example the board ships:
`examples/greek-gods.fg.json`, in the board's own folder, also openable straight from the catalog
as [greek-gods.fg.json](https://raw.githubusercontent.com/andriy-viyatyk/persephone-boards/main/boards/force-graph/examples/greek-gods.fg.json).
Its 63 nodes carry custom properties (`domain`, `parents`, `spouse`, `wiki`, `description`) next
to `title`, `level` and `shape`, and its `options` block sets a root node, an expand depth, the
three force values and a legend. See [An example graph](index.md#an-example-graph).

Keep `"type": "force-graph"` at the root. It is what lets Persephone offer the graph editor for
a page that is not named `*.fg.json` — an untitled JSON page, for instance.

## Nodes

| Property | Type | Description |
|---|---|---|
| `id` | string (required) | Unique node identifier. Every link and every API call addresses a node by this |
| `title` | string | Display label. Falls back to `id` when omitted |
| `level` | number 1-5 | Visual importance: 1 is largest, 5 smallest. A missing or invalid level is drawn as level 5 |
| `shape` | string | `circle` (default), `square`, `diamond`, `triangle`, `star`, `hexagon` |
| `isGroup` | boolean | `true` makes this node a group container rather than data |
| *anything else* | any | A custom property: shown in the hover card and in the detail panel, and searched |

The root node and group nodes are always drawn at the largest size, whatever their `level`.

### Custom properties

Any key that is not `id`, `title`, `level`, `shape` or `isGroup` is a custom property. Non-string
values are stringified for display (long JSON is truncated); the file keeps whatever you wrote.

**Indexed properties.** A `#N` suffix lets one logical key carry several values —
`function#1`, `function#2` — and the suffix is stripped for display, so both rows show as
`function`.

**Links inside a property.** A Markdown link in a property value (`[label](target)`) becomes a
clickable link in the hover card and an *Open &lt;property&gt;* entry in the node's context menu.
`http(s)`, `file` and `mailto` targets are used as written; anything else is treated as a local
path and opened as a `file://` URL.

Keys starting with `_$` are reserved for the board's own runtime state and are never written to
the file.

## Links

```json
{ "source": "nodeId", "target": "nodeId" }
```

Both ends are node ids, as strings.

**A link whose source is a group node means membership**, not a relationship: the target is a
member of that group. That is the only way membership is expressed, and it is why a node can be
drawn connected to something it has no data link with — see `getNeighborIds` versus
`getVisualNeighborIds` in the [agent guide](agent.md).

A link pointing at an id no node has is not an error the file reports; it simply draws nothing
useful. Validate both ends before writing a file.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `rootNode` | string | — | The node the graph expands from. Omitted means "pick automatically" |
| `expandDepth` | number | — | How many steps out from the root are visible on open. Omitted means unlimited |
| `maxVisible` | number | 500 | Cap on visible nodes; the rest hide behind `+N` badges |
| `charge` | number | -70 | Repulsion between nodes — more negative spreads them out |
| `linkDistance` | number | 40 | Preferred link length, in pixels |
| `collide` | number | 0.7 | Collision strength, 0 to 1 |
| `legend` | object | — | Descriptions shown in the legend panel |

`legend` has two maps, `levels` and `shapes`. Their keys are `"1"`–`"5"` and the six shape names,
plus `"root"` and `"group"` in either map. Values are free text, written by whoever uses the
legend panel.

## How the board saves

Everything you change in the board is serialized back into the page immediately; `Ctrl+S` flushes
it to disk. Three properties of that write are worth relying on:

- **Unknown top-level keys survive.** The file is re-serialized from the object it was parsed
  from, so anything you added beside `type`, `nodes`, `links` and `options` comes back unchanged.
- **Simulation state never lands in the file.** The physics fields d3 attaches to a node
  (`x`, `y`, `vx`, `vy`, `fx`, `fy`, `index`) and the board's own `_$` fields are stripped.
- **It is written as 4-space-indented JSON**, byte-compatible with what Persephone's built-in
  Graph editor used to write.

## Writing a graph from a script

```javascript
const graph = {
    type: "force-graph",
    nodes: [
        { id: "app", title: "app.ts", level: 1 },
        { id: "util", title: "util.ts", level: 3, shape: "diamond" },
    ],
    links: [{ source: "app", target: "util" }],
    options: { rootNode: "app", maxVisible: 300 },
};
await app.pages.addEditorPage("monaco", "json", "deps.fg.json", JSON.stringify(graph, null, 4));
```

The page then offers **Force Graph** in the editor switch, because its content carries
`"type": "force-graph"`.

## Errors and verification

- **Broken JSON is accepted silently by whatever wrote it** — the failure shows up in the board,
  not in the tool result. Unparseable text renders a *"This file is not valid JSON."* panel;
  structurally wrong JSON renders a partial or empty graph.
- **Validate before writing**: `JSON.parse` your own output, keep `"type": "force-graph"`, and
  check that every link's `source` and `target` matches a node `id`.
- **Never round-trip a live graph through the file text.** Read nodes from the board's model
  (`pages[i].editor.app.nodes`, `getNode(id)`), which returns cleaned data, rather than parsing
  the page content of a graph that is currently simulating.
- **Duplicate ids are preserved, not merged.** The file is written back as it was read; the
  board addresses the first node with a given id.

## See also

- [Using the board](editor.md) — the UI these settings drive.
- [Driving it as an agent](agent.md) — reading and editing a graph without touching the file text.
