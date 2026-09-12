---
title: "Todo for agents"
audience: agent
summary: "Drive the Todo board through pages[i].editor.app: inspect the filtered model, named controls and safe mutation methods."
---

# Todo for agents

The Todo board publishes its live model at **`pages[i].editor.app`**. Use the Todo board page's
`editor.app`; do not address item rows by their DOM position or by their title. Item ids are the
stable identifiers accepted by item methods.

## Finding the model

Find the page for the open `.todo.json` file in `pages`, then read:

```text
pages["<id>"].editor.app  → the Todo model
```

The model's seven top-level data properties are:

| Property | Value |
|---|---|
| `fileName` | The open file's name, or `""` when there is no file name |
| `items` | The filtered and ordered item collection |
| `lists` | Every declared list with counts |
| `tags` | Every declared tag with its color and item count |
| `selectedList` | Writable list filter; `""` means All |
| `selectedTag` | Writable tag filter; `""` means all tags |
| `searchText` | Writable free-text filter; stored as a string |

`selectedList` and `selectedTag` are restorable selection state. `searchText` is transient. Setting
an unknown non-empty list or tag throws an error. Setting either selection to `null` or `""`
clears it; other values are converted to strings. Setting `searchText` converts `null` to `""`
and other values to strings.

## Named elements

These are the seven names supplied to the board's element model:

| Name | View | Purpose |
|---|---|---|
| `quick-add-input` | main | Add an item to the selected list |
| `search` | main | Search titles, comments, lists and tags |
| `list-switch` | main | Choose All or a declared list |
| `add-list` | lists | Add a list in Lists & Tags |
| `add-tag` | lists | Add a tag in Lists & Tags |
| `lists` | lists | Declared lists and their undone/total counts |
| `tags` | lists | Declared tags and their colors |

The main and lists views share the selection and search state. The collections below are live
indexed models, so read them again after a collection changes from empty to non-empty or back.

## Reading items, lists and tags

### `items`

`items.count` is the number currently shown and `items.totalCount` is the number of items in the
file before filtering. Numeric indexes address the visible collection in its current order.
String indexes address an item by id, including an item that the current filters hide. A missing
index returns `undefined`.

Each item has exactly these published properties:

| Property | Meaning |
|---|---|
| `id` | Stable item id |
| `title` | Item title |
| `list` | Assigned list name, or `""` |
| `tag` | Tag name, or `null` |
| `done` | Completion boolean |
| `comment` | Comment, or `null` |
| `createdDate` | Creation ISO timestamp string |
| `doneDate` | Completion ISO timestamp string, or `null` |

Filtering is the AND of `selectedList`, `selectedTag` and the whitespace-separated words in
`searchText`. Search words are case-insensitive and match title, comment, list name or tag name.
The visible order is undone items in stable source order, followed by completed items sorted by
`doneDate` descending.

### `lists`

`lists.count` is the number of declared lists. Numeric indexes use declaration order; string
indexes use an exact list name. A list exposes `name`, `total` and `undone`, counting items
assigned to that list. An invalid index returns `undefined`.

### `tags`

`tags.count` is the number of declared tags. Numeric indexes use declaration order; string indexes
use an exact tag name. A tag exposes `name`, `color` and `count`, where `count` is the number of
items carrying that tag. An invalid index returns `undefined`.

## Methods

The model publishes exactly these thirteen methods. Every mutation writes the file immediately;
the content host supplies saving with `Ctrl+S`.

| Method | Arguments and return | Errors and effects |
|---|---|---|
| `addItem` | `addItem(title, list?)` → new item id | The title is converted to a string and trimmed; empty titles throw. An omitted list uses `selectedList`; a missing list selection or a list not already declared throws. |
| `toggleItem` | `toggleItem(id)` → new `done` boolean | An unknown id throws. The item is toggled and `doneDate` becomes the current ISO timestamp or `null`. |
| `setItemTitle` | `setItemTitle(id, title)` → stored title | An unknown id throws. `null` becomes `""`; other titles are stringified. |
| `setItemComment` | `setItemComment(id, comment)` → stored comment | An unknown id throws. `null` or `""` becomes `null`; other values are stringified. |
| `setItemTag` | `setItemTag(id, tag)` → stored tag | An unknown id throws. `null`, an empty string or whitespace-only value clears the tag. A new non-empty tag is created with color `""`. |
| `deleteItem` | `deleteItem(id)` → `true` | An unknown id throws. The item is removed and its `state[id]` entry is removed. |
| `addList` | `addList(name)` → trimmed list name | A null/empty name or duplicate throws. The new list is selected. |
| `renameList` | `renameList(from, to)` → trimmed new name | The source must exist; an empty or already-used target throws. Items assigned to the old name move to the new name. |
| `deleteList` | `deleteList(name)` → `true` | The list must exist or an error is thrown. It is removed and its items remain with `list: ""`. |
| `addTag` | `addTag(name)` → trimmed tag name | A null/empty name or duplicate throws. |
| `renameTag` | `renameTag(from, to)` → trimmed new name | The source must exist; an empty or already-used target throws. Items carrying the old tag are retagged. |
| `setTagColor` | `setTagColor(name, color)` → stored color | The tag must exist. Color is stringified; only `""` or one of the eleven palette names is accepted. |
| `deleteTag` | `deleteTag(name)` → `true` | The tag must exist. It is removed and its items receive `tag: null`. |

All item ids are converted to strings before lookup. List and tag names passed to the methods are
also converted as described in the table; names supplied to rename/add operations are trimmed
where stated. When a referenced item, list or tag is invalid, the method throws an error that
identifies the missing or conflicting value.

## Destructive calls

The exposed `deleteItem`, `deleteList` and `deleteTag` methods delete immediately. They bypass the
confirmation overlay that the user-facing UI shows, and they do not provide an undo. Read the
target model entry first and treat these operations as final. The internal core path is not
published as a method.

`deleteList` deliberately keeps affected items in the file with an empty `list`; `deleteTag`
keeps affected items and clears only their tag. Deleting an item also removes its matching entry
from `state`.

## Example calls

```text
pages["<id>"].editor.app.lists[0]                         → { name, total, undone }
pages["<id>"].editor.app.selectedList = "Work"           → filter to Work
pages["<id>"].editor.app.searchText = "urgent client"    → apply an AND search
pages["<id>"].editor.app.addItem("Send invoice", "Work") → the new item id
pages["<id>"].editor.app.setItemTag("<item-id>", "Finance")
pages["<id>"].editor.app.toggleItem("<item-id>")         → true or false
```

See [Todo](index.md) for the canonical file format, or [Using the Todo board](editor.md) for
what the user sees.
