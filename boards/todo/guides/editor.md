---
title: "Using the Todo board"
audience: user
summary: "Todo board guide: the main list, quick-add, search, item editing, Lists & Tags, confirmations and keyboard behavior."
editorId: "board"
---

# Using the Todo board

Todo opens `.todo.json` files as a list of tasks. The board has a main view for working with
items and a **Lists & Tags** secondary view for managing lists and tags. Changes are written to
the file through its content host; `Ctrl+S` saves the file.

## Opening a file

Open a `*.todo.json` file and Todo appears as its editor. The main view starts with the current
items. If the file has no items, the board explains that you should create a list in **Lists &
Tags** and then add items. If the board is opened without a content host, open a `.todo.json`
file.

## The main view

The top bar has two controls:

- **List: name** on the left opens a picker containing **All** and every declared list. Choosing
  a real list selects it and focuses quick-add. **All** shows items from every list.
- **Search** on the right searches item titles, comments, list names and tag names. The clear
  button removes the query.

Below the bar is **quick-add**. When a real list is selected, enter a non-empty title and submit
  it with the **+** button or `Enter`. The new item is undone, gets a generated id and the current
  `createdDate`, and starts with `doneDate: null`, `comment: null` and `tag: null`. With **All**
  selected, quick-add is read-only; clicking the field or its **+** opens the list picker.

The item list applies the selected list, selected tag and search query together. Search is
case-insensitive: every whitespace-separated query word must occur in the item's title,
comment, list name or tag name. Matching words are highlighted in titles and comments, and a
matching tag chip receives an accent highlight. The footer shows `N items`, or `N of M items`
when filters hide some items.

Items are shown undone first in their stable source order. Completed items appear below a **Done**
separator, newest completion first by `doneDate`. Each item has:

- a checkbox that toggles done/undone; completing it records the current ISO timestamp and
  undoing it clears `doneDate`;
- a title, shown read-only until clicked for inline editing;
- a comment, shown read-only when present, or **+ Add comment** when absent;
- a tag chip and menu;
- a displayed date (the creation date while undone, the completion date when done); and
- a delete button revealed on hover.

Press `Enter` while editing a title to blur and commit it. Title and comment text writes are
debounced by 300 milliseconds, and blurring flushes the pending write. An empty comment becomes
`null` on blur.

The tag menu offers **No tag** and every declared tag. Tags can use these exact colors in the
Lists & Tags view:

`dodgerblue`, `hotpink`, `olive`, `mediumpurple`, `orange`, `darkkhaki`, `deepskyblue`,
`tomato`, `limegreen`, `cornflowerblue`, `sienna`.

## Lists & Tags

Open the secondary **Lists & Tags** view to manage the board's vocabulary.

### Lists

The **Lists** section contains **All** plus every list, with each row showing its undone/total
counts. Select a row to filter the main view. Add a list with **New list…** and its **+** button;
pressing `Enter` in the field also adds it. A new list becomes the selected list.

Rename a list inline and commit with `Enter` or blur. `Escape` cancels the rename. Renaming also
updates the `list` value on its items. Delete asks for confirmation; confirmed deletion removes
the list and leaves its items in the file with an empty list value.

### Tags

The **Tags** section contains **All Tags** plus every tag. Each tag row shows its color dot,
selection, color, rename and delete actions. Add a tag with **New tag…** and its **+** button, or
press `Enter` in the field. Rename inline with `Enter` or blur; `Escape` cancels. Renaming updates
the tag value on its items.

Use the color action to choose **No color** or one of the eleven named colors above. Deleting a
tag asks for confirmation; confirmed deletion removes the tag and changes that tag to `null` on
its items.

Item deletion also uses an in-board **Cancel / Delete** confirmation overlay. Clicking outside
the confirmation box cancels. The board does not depend on a browser confirmation or prompt.

## Empty and error states

- No items: create a list in **Lists & Tags**, then add items.
- A filter with no results: **No items match the current filter.**
- Invalid JSON: the board displays an error and tells you to fix it in the text editor.

## Keyboard behavior

There is no global board keyboard shortcut handler. The controls handle `Enter` and `Escape` as
described above: `Enter` submits quick-add and new list/tag fields, commits title/list/tag
renames, and `Escape` cancels an inline list or tag rename. `Ctrl+S` is the content host's save
shortcut.

See [Todo](index.md) for the file format, or [Driving it as an agent](agent.md) for the agent
surface.
