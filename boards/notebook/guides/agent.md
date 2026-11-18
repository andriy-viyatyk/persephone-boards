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

## Example results

The note snapshot contains the note fields, with `content` represented as a string and `tags` as a copied array. Mutation methods with no explicit result return `undefined`.

```text
addNote() -> { id: "note-1", title: "", content: "", language: "javascript", editor: "monaco", category: "", tags: [], createdDate: "...", updatedDate: "..." }
deleteNote("note-1", true) -> true
updateNoteTitle("note-1", "Draft") / updateNoteContent("note-1", "...") -> undefined
updateNoteCategory("note-1", "Work") / updateNoteLanguage("note-1", "javascript") / updateNoteComment("note-1", "Review") -> undefined
addComment("note-1") / removeComment("note-1") -> undefined
addNoteTag("note-1", "draft") / removeNoteTag("note-1", 0) / updateNoteTag("note-1", 0, "final") -> undefined
setSearchText("draft") / clearSearch() / setSelectedCategory("Work") / setSelectedTag("draft") -> undefined
expandNote("note-1") / collapseNote() / setNoteView("note-1", "preview") -> undefined
renameCategory("Work", "Projects") / moveCategory("Projects", "Archive") / renameTag("draft", "review") -> undefined
loadMore() / showAll() -> undefined
```
