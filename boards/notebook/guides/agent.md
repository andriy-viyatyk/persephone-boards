---
title: "Driving Notebook as an agent"
audience: agent
summary: "The live Notebook model and actions."
---

# Driving Notebook as an agent

Use `pages[id].editor.app` on a trusted Notebook page. Read `.$help` for the live signatures and `elements` for named controls. Notes are snapshots indexed by position or stable ID; all editing methods take that ID. Edits go through the page content host and mark it modified; save the page to write its file.

```js
const nb = pages[0].editor.app;
const note = await nb.addNote();
await nb.updateNoteTitle(note.id, "API example");
await nb.updateNoteLanguage(note.id, "json");
await nb.updateNoteContent(note.id, '[{"environment":"dev","enabled":true}]');
await nb.setNoteView(note.id, "grid");
await nb.addNoteTag(note.id, "example");
```

Read `notes`, `filteredNotes`, `categories`, `tags`, `notesCount`, `filteredCount`, `searchText`, `selectedCategory`, `selectedTag`, `expandedNoteId`, `renderedCount` and `remainingCount`. `setSearchText`, `clearSearch`, `setSelectedCategory` and `setSelectedTag` change filters. Empty category/tag selects all. `loadMore()` renders the next page and `showAll()` renders all filtered notes; `expandNote(id)` and `collapseNote()` control the expanded view.

`updateNoteTitle`, `updateNoteContent`, `updateNoteCategory`, `updateNoteLanguage`, `updateNoteComment`, `addComment` and `removeComment` edit a note. `addNoteTag(id, tag)`, `removeNoteTag(id, index)` and `updateNoteTag(id, index, tag)` manage tags. `setNoteView(id, view)` accepts `code`, `preview` or `grid`, subject to the same eligibility as the UI.

`renameCategory(path, name)` renames its last segment; `moveCategory(path, parent)` moves it below an existing parent (empty parent means root). Both affect descendants. `renameTag(from, to)` updates all matching notes. These operations may merge existing vocabulary. `deleteNote(id, true)` deletes immediately; the explicit `true` is required and there is no in-board confirmation on the agent path.
