---
title: "Notebook file format"
audience: agent
summary: "The .note.json document structure."
---

# Notebook file format

A `.note.json` document contains a `notes` array and a `state` object. A new document may also have `type: "note-editor"`. The board preserves unknown root, note, content and state fields.

```json
{
    "type": "note-editor",
    "notes": [{
        "id": "note-1",
        "title": "Example",
        "category": "Work/Projects",
        "tags": ["status:active"],
        "content": {"language": "markdown", "content": "# Hello", "editor": "md-view"},
        "createdDate": "2026-03-20T10:00:00.000Z",
        "updatedDate": "2026-03-20T10:00:00.000Z"
    }],
    "state": {}
}
```

Each note needs a unique nonempty string `id`, string `title`, `category`, `createdDate` and `updatedDate`, an array of string `tags`, and a `content` object with string `language` and `content`. `comment` and `content.editor` are optional strings. Categories use `/`; tags may use `:`. Dates are conventionally ISO 8601.

`content.editor` values `monaco`, `md-view` and `grid-json` select Code, Markdown Preview and JSON Grid respectively. Grid requires an array of objects. Unsupported legacy values are retained and shown as Code until explicitly changed. Grid column settings can be stored as a JSON string in `state[id]["editorSettings:grid-json"]`. Invalid files display an error without being overwritten; repair them in a text editor.
