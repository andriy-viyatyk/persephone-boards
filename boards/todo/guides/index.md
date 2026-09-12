---
title: "Todo"
audience: both
summary: "The Todo board: what it opens, how its .todo.json data is shaped, and where to find the user and agent guides."
---

# Todo

Todo is a Persephone board for `.todo.json` files. It shows undone and completed items,
supports lists, tags, comments and search, and writes changes back through the page's content
host. It has a main Todo view and a **Lists & Tags** secondary view for managing the vocabulary
used by items.

## What it opens

- **`*.todo.json` files** — Todo is the default editor for this file pattern.
- The board needs a content host supplied by an open file. If it is opened without one, open a
  `.todo.json` file.

The board writes the serialized document after each discrete change. Text edits are debounced;
`Ctrl+S` is supplied by the content host and saves the file.

## The guides

| Page | For | What it covers |
|---|---|---|
| [Using the Todo board](editor.md) | users | The main view, Lists & Tags, search, editing, confirmations and keyboard behavior |
| [Driving it as an agent](agent.md) | agents | The `pages[i].editor.app` model, named elements, indexed data and methods |

## The `.todo.json` shape

The board writes this canonical root shape, pretty-printed with four spaces:

```json
{
    "type": "todo-editor",
    "lists": [],
    "tags": [],
    "items": [],
    "state": {}
}
```

The root always writes `type: "todo-editor"`, even though the parser does not require an input
`type` or require it to match. `lists`, `tags` and `items` are arrays in the canonical output.
`state` is an object in canonical output. The five root keys are always serialized in the order
shown above.

### Lists and tags

`lists` is an array of list values. On read, each value is converted to a string and duplicate
names are discarded, preserving the first occurrence.

`tags` is an array of objects with this canonical shape:

```json
{ "name": "Work", "color": "dodgerblue" }
```

Tag names must be non-empty strings after trimming; invalid entries and duplicate names are
discarded, and surrounding whitespace is removed from accepted names. A non-string `color`
becomes `""`; a string color is retained when the file is read. The board's picker and agent
method use the named palette documented in [Using the Todo board](editor.md).

### Items

Each canonical item has all eight fields below:

| Field | Canonical value |
|---|---|
| `id` | A non-empty string identifier; a missing or invalid value is replaced with a generated id |
| `list` | A string, or `""` when the input is not a string |
| `title` | A string, or `""` when the input is not a string |
| `done` | `true` only when the input is exactly `true`; otherwise `false` |
| `createdDate` | A string, or the current ISO timestamp when the input is not a string |
| `doneDate` | A string, or `null` when the input is not a string |
| `comment` | Normally a string or `null`; `undefined` becomes `null`, while another input value is retained on read |
| `tag` | A truthy input value, or `null` when the input is falsy; board-created values are tag names or `null` |

No item field is required in input. Missing, malformed or partial items are normalized to the
shape above. A referenced non-empty list that is not declared is added to `lists`. A referenced
truthy tag that is not declared is added to `tags` with an empty color. Thus declarations do not
need to precede the references in the input.

The board-created and agent-written form uses string values for `comment` and `tag` (or
`null`), but the parser intentionally retains unusual non-string truthy values for those two
fields when reading an existing file.

### State and errors

`state` is not per-item UI layout. If the parsed value is a truthy object, it is retained;
otherwise it becomes `{}`. The board does not otherwise interpret or modify its contents. When an
item is deleted, only `state[item.id]` is removed before serialization.

Missing or non-array `lists`, `tags` or `items` become empty arrays. A parsed non-object becomes
empty Todo data. Invalid JSON sets an error state and keeps the last good data rather than
overwriting the file; fix the JSON in the text editor before continuing.

See [Using the Todo board](editor.md) for the controls and [Driving it as an agent](agent.md)
for the live model.
