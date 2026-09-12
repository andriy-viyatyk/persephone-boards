# BT-020: Todo board — backfill its documentation

## Status

**Status:** In Progress  
**Priority:** High  
**Board id:** todo  
**Started:** 2026-09-12  
**Completed:**

## Goal

Ship documentation with the Todo board so users can discover and operate the current board,
authors can write a valid .todo.json file, and agents can use the board's current AiVision
model. The documentation must describe the board implementation that replaced the deleted
built-in editor, not the historical todo-view editor.

## Background

The built-in Todo editor and its 157-line guide were removed in Persephone commit a2692189.
The historical guide is recoverable with:

~~~text
git -C C:\projects\persephone show a2692189^:assets/mcp-res-todo.md
~~~

That file is useful for the old data-format prose, but its API is obsolete: it documents
todo-view, create_page, and page.asTodo(). The current board is a content-host board
(editorKind: "content-host") and exposes its live model at pages[i].editor.app.

The board-guide mechanism is available from Persephone 5.0.2. The implementation will declare
"guides": "guides"; trusted-board Markdown pages will mount below
installed-boards/todo/. Relative links may target only other Markdown guide pages. The
user-facing editor page must carry editorId: "board" so it claims F1; no shipped guide can
write the machine-specific absolute board editor id.

boards/force-graph/guides/ is the reference for page front matter and tone. Todo is smaller,
so the proposed set is three pages rather than four:

| Page | Audience | Responsibility |
|---|---|---|
| index.md | both | What the board opens and does, links to the other pages, and the complete compact .todo.json format |
| editor.md | user | The main toolbar/list, item editing, search, Lists & Tags view, confirmations, and keyboard handling; carries editorId: "board" |
| agent.md | agent | The exact pages[i].editor.app model and seven named elements, filtered model, and agent-safe destructive actions |

There is no separate format.md: the Todo file schema is small enough to keep with the board
overview, while the user-facing behavior and agent surface remain separate. This avoids adding
a fourth page merely to copy the Force Graph structure.

## Verified board surface

The findings below were checked against boards/todo/app.js (1,350 lines),
boards/todo/index.html, boards/todo/style.css, and boards/todo/board-manifest.json. They are
the facts the guides must preserve.

### Manifest and hosting

- The board is the default editor for *.todo.json (fileMasks, editorPriority: 200,
  editorName: "Todo") and is a content-host board with one secondary view:
  { "id": "lists", "title": "Lists & Tags" }.
- index.html provides a main frame and a Lists & Tags frame. app.js branches on
  persephone.view: main shows the todo list, while lists shows list/tag management.
- Content is read through P.host.getContent() and P.host.onContentChange(), and every
  mutation writes serialized content through P.host.setContent(). Ctrl+S is not a board
  key handler; saving is supplied by the content-host shim.
- Shared selection state is selectedList, selectedTag, and searchText. The main frame
  initializes it with empty strings; selectedList and selectedTag are restorable, while
  searchText is transient.

### User-facing behavior to document

- The main top bar has the List: <name> switch on the left and the search field with a clear
  button on the right. The switch offers All and every declared list; choosing a real list
  makes quick-add available and focuses it.
- Quick-add is below the bar. With a selected list, a non-empty trimmed title can be submitted
  by the + button or Enter; the new item starts undone with a generated id, current
  createdDate, doneDate: null, comment: null, and tag: null. With All selected, the
  input is read-only and clicking it or its + opens the list picker.
- The item list filters by selected list, selected tag, and an AND query whose words are matched
  case-insensitively against title, comment, list name, and tag name. Titles and comments show
  matching words with <mark> highlighting; a matching tag chip gets an accent highlight.
  The clear button removes the query. The footer shows N items or N of M items.
- Items render undone first in stable source order, then completed items under a Done
  separator ordered by doneDate descending. Each row has a checkbox, inline title editing,
  an optional inline comment, a tag chip/menu, a displayed date, and a hover-revealed delete
  button. Toggling sets doneDate to the current ISO timestamp or clears it when undone.
- A title or existing comment is a read-only view until clicked, then becomes a textarea; title
  Enter blurs/commits it. + Add comment creates an edit field; an empty comment collapses
  back to null on blur. Text edits write after a 300 ms debounce and blur flushes the write.
- The item tag menu offers No tag and all declared tags. The Lists & Tags tag rows can assign
  one of these exact colors: dodgerblue, hotpink, olive, mediumpurple, orange,
  darkkhaki, deepskyblue, tomato, limegreen, cornflowerblue, and sienna.
- Item deletion uses an in-board Cancel/Delete confirmation overlay. Clicking the overlay outside
  the box also cancels. There is no browser window.confirm or prompt dependency.
- The Lists & Tags secondary view has a Lists section and a Tags section. List rows include
  All plus every list and show undone/total counts; selecting a row filters the main view.
  Lists can be added, renamed inline, and deleted. Deleting a list confirms and leaves its items
  in the file with an empty list value. Rename commits on Enter or blur and cancels on
  Escape.
- Tag rows show a color dot, selection, color, rename, and delete actions. Tags can be added,
  renamed, recolored, and deleted; deleting a tag confirms and changes that tag to null on
  its items. Adding a tag and adding a list also accept Enter in their input fields.
- The board has no global application-level keyboard shortcut handler. The keyboard behavior to
  document is the per-control Enter/Escape behavior above plus host-provided Ctrl+S.
- Empty and error states are user-visible: no items directs the user to create a list, a filter
  with no matches says no items match, invalid JSON says to fix it in Monaco, and a board opened
  without a content host says to open a .todo.json file.

### File format verified from app.js

The board writes this root shape, pretty-printed with four spaces:

~~~json
{
    "type": "todo-editor",
    "lists": [],
    "tags": [],
    "items": [],
    "state": {}
}
~~~

type is always written as "todo-editor"; the parser does not require the input type to
match. Missing/non-array lists, tags, or items become empty arrays. Lists are stringified
and deduplicated. Declared tag entries must have a non-empty string name after trimming;
duplicate names are discarded, and a non-string color becomes "". A tag color is otherwise
retained as any string on file read, although the UI's picker writes the named palette above.

Each item is normalized to these written fields:

| Field | Written value and behavior |
|---|---|
| id | Non-empty string from input, otherwise a generated UUID/fallback id |
| list | Input string, otherwise ""; a referenced non-empty list missing from lists is auto-added |
| title | Input string, otherwise "" |
| done | true only when input is exactly true; otherwise false |
| createdDate | Input string, otherwise the current ISO timestamp at parse time |
| doneDate | Input string, otherwise null; toggling done writes the current ISO timestamp and undoing writes null |
| comment | null only when the input property is undefined; otherwise the input value is retained, while board-created/edited comments are strings or null |
| tag | Input value when truthy, otherwise null; a referenced tag missing from tags is auto-added with an empty color |

Thus no item field is required for parsing: malformed or partial input is normalized. A
canonical item written by the board has all eight fields above. The UI and agent add operation
add only to an existing list; deleting a list deliberately leaves affected items unassigned.

state is not interpreted as item UI state by this board. If the parsed value is a truthy
object, it is retained and written back; otherwise it becomes {}. The only special handling is
that deleting an item removes state[item.id] before serialization. The board does not otherwise
read or modify the state object's contents.

Invalid JSON sets the parse-error state and keeps the last good data rather than overwriting the
file. A parsed non-object becomes empty data. Serialization always emits the five root keys in
the order shown above.

### AiVision surface verified from app.js

When P.aiVision exists, the board calls aiVision.createElements(...) with exactly these seven
element names:

~~~text
quick-add-input   (main)
search            (main)
list-switch       (main)
add-list          (lists)
add-tag           (lists)
lists             (lists)
tags              (lists)
~~~

The main-frame app passed to aiVision.expose(app) publishes these properties:
fileName, items, lists, tags, selectedList, selectedTag, and searchText. The writable selection
properties reject unknown list/tag names; searchText is writable as a string. Its methods are
exactly:

~~~text
addItem(title, list?)
toggleItem(id)
setItemTitle(id, title)
setItemComment(id, comment)
setItemTag(id, tag)
deleteItem(id)
addList(name)
renameList(from, to)
deleteList(name)
addTag(name)
renameTag(from, to)
setTagColor(name, color)
deleteTag(name)
~~~

The exposed methods use the deleteItemCore, deleteListCore, and deleteTagCore paths for
destructive operations. They delete immediately and do not await the UI confirmation overlay;
the user-facing UI functions with the same public names do confirm. No *Core name is itself
published. The agent guide must document this distinction and must not promise an undo.

The nested indexed models are also part of the app surface: items exposes filtered/ordered
items with count and totalCount; each item exposes id, title, list, tag, done, comment,
createdDate, and doneDate. lists exposes indexed lists with name, total, and undone; tags
exposes indexed tags with name, color, and count. These exact properties are declared in the
corresponding AiVision shapes and belong in agent.md.

## Implementation Plan

1. **Add the guide pages under boards/todo/guides/.**

   - Create index.md with Force Graph-style front matter (title, audience, summary), audience
     both, a concise board overview, what the board opens, links to editor.md and agent.md, and
     the complete root/item/tag/state format verified above.
   - Create editor.md with title, audience: user, summary, and editorId: "board". Describe only
     the implemented main and secondary views, including every user-facing control, filter/
     highlight rule, item/list/tag mutation, confirmation, empty/error state, status count, and
     keyboard behavior listed above.
   - Create agent.md with title, audience: agent, and summary. Describe the
     pages[i].editor.app location, all seven element names exactly, all seven top-level
     properties, all thirteen methods with their actual argument/return/error behavior, the
     indexed item/list/tag shapes, filtered ordering, and the confirmation-free *Core path.
     Use pages[i].editor.app, never todo-view, create_page, page.asTodo(), or a
     page.editor.<todo member> facade.
   - Keep all cross-links relative and Markdown-only. Do not link to a sample data file from a
     guide; there is no Markdown guide page for such a file and the board-guide resolver cannot
     resolve a non-Markdown board asset.

2. **Update boards/todo/board-manifest.json for the guide-bearing release.**

   - Add "guides": "guides".
   - Bump "version" from 1.1.0 to 1.2.0.
   - Raise "minAppVersion" from 5.0.1 to 5.0.2, the release that provides board-guide
     mounting.

3. **Record the release note in boards/todo/WHATS-NEW.md.**

   Add a new top section headed exactly ## 1.2.0, with a terse line that the board now ships
   its own user, format, and agent guides. The heading must equal the manifest version.

4. **Leave generated manifests alone.**

   Do not edit boards-manifest.json or any boards/todo/versions-manifest.json; the publish
   workflow owns those files.

5. **Owner-run acceptance verification after the guides exist.**

   The owner will install/trust the updated board in Persephone 5.0.2 and verify the three pages
   mount under installed-boards/todo/, the pages are searchable through guides.search(), and
   F1 on a Todo board page opens installed-boards/todo/editor. This task does not add an
   MCP-dependent implementation step or claim to perform that live check.

## Concerns / Open Questions

- The old guide's examples use a root without type, say every item field is required, require
  list/tag references to be predeclared, describe tag colors as hex values, and describe
  state as per-item UI heights. Those statements must be corrected to the parser/serializer
  behavior above.
- The current parser preserves unusual truthy/non-string comment and tag values on read; the
  format guide should show the canonical string/null schema while explicitly documenting the
  normalization and orphan behavior, rather than implying strict validation.
- editorId: "board" belongs only on editor.md, the user-facing page. The other pages must not
  claim F1.
- No images or non-Markdown guide links are needed for this board, so the mounted-guide asset
  resolution question does not block the documentation.
- This task changes no files under C:\projects\persephone and does not implement the guides
  themselves; it produces the implementation-ready task document and dashboard entry.

## Acceptance Criteria

- [ ] boards/todo/guides/index.md, editor.md, and agent.md use the required
  title/audience/summary front matter; only editor.md has editorId: "board".
- [ ] The user guide describes the implemented toolbar, item list, lists, tags, search and
  highlighting, comments, Lists & Tags view, status/empty/error states, confirmations, and
  keyboard behavior without resurrecting built-in-editor APIs.
- [ ] The overview/format content documents the written root shape, all eight item fields,
  input normalization, orphan list/tag handling, and the actual state behavior.
- [ ] The agent guide names exactly the thirteen published methods and seven declared elements,
  and records that destructive agent methods bypass the UI confirmation overlay.
- [ ] boards/todo/board-manifest.json declares guides: "guides", version 1.2.0, and
  minAppVersion: "5.0.2".
- [ ] boards/todo/WHATS-NEW.md has a new top ## 1.2.0 section matching the manifest.
- [ ] boards-manifest.json and every versions-manifest.json remain untouched.
- [ ] Owner-run Persephone 5.0.2 verification confirms the mount, search results, and Todo F1
  routing described above.

## Files Changed

| File | Change |
|---|---|
| boards/todo/guides/index.md | New — board overview and compact .todo.json format |
| boards/todo/guides/editor.md | New — user-facing Todo board guide and F1 claim |
| boards/todo/guides/agent.md | New — AiVision model and named controls for agents |
| boards/todo/board-manifest.json | Planned — guide declaration and 1.2.0 / 5.0.2 release metadata |
| boards/todo/WHATS-NEW.md | Planned — 1.2.0 changelog entry |
| doc/active-work.md | Updated — link BT-020 and remove the obsolete blocked note |

## Notes

The repository is on develop, already ahead of the published main. This investigation makes no
board implementation changes and does not commit or merge anything. The task's source of truth
for board behavior is the current Todo board code; the historical guide is used only to identify
what was lost and which old claims require correction.
