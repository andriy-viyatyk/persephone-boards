---
title: "Using Notebook"
audience: user
summary: "Notes, navigation, search and views."
---

# Using Notebook

Persephone's page toolbar shows the breadcrumb (click a parent to go up), the search box and Add Note. Each card has a title, language, category, tags, optional comment and content. Edit these fields directly; use the expand button for a full-height note and Escape to return. Deleting a note asks for confirmation.

Open the Categories & Tags panel to filter by category or tag. Categories use `/` for nesting; tags can use `:` for namespaces. Rename categories and tags in the panel, or drag a category to move its subtree. A category field on each note assigns that note.

Search matches all entered words across titles, categories, tags, comments and content. Clearing search restores the current category or tag selection. Notes load 30 at a time; scroll or choose Load more to see the next page.

Code view edits text with syntax highlighting. Markdown offers Preview. JSON arrays of objects offer Grid, where rows, columns and typed cells can be edited. Invalid grid content falls back to Code without changing the saved preference.

Unlike the old built-in Notebook, this board does not run scripts or preview HTML, Mermaid or SVG. It does not provide a CSV grid or detect notebooks by JSON content alone: the file name must end in `.note.json`. Monaco-specific features and dragging files or links into categories are also unavailable.
