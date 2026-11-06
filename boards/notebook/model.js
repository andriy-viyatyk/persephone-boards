// Notebook data model: validates raw files and makes format-preserving note updates.

const NOTEBOOK_TYPE = "note-editor";
const JSON_INDENT = 4;
const CATEGORY_SEPARATOR = "/";

/** Parse and validate notebook JSON without normalizing or discarding fields. */
export function parseNotebook(text) {
    try {
        const data = text.trim()
            ? JSON.parse(text)
            : { type: NOTEBOOK_TYPE, notes: [], state: {} };

        validateNotebook(data);
        return { data };
    } catch (error) {
        return {
            error: error instanceof NotebookValidationError
                ? { key: error.key, parameters: error.parameters }
                : { key: "notebook.validation.invalidJson", parameters: {} },
        };
    }
}

function validateNotebook(data) {
    if (!isRecord(data) || !Array.isArray(data.notes) || !isRecord(data.state)) {
        throw new NotebookValidationError("notebook.validation.root");
    }

    const noteIds = new Set();
    data.notes.forEach((note, index) => {
        const position = index + 1;
        if (!isRecord(note) || typeof note.id !== "string" || note.id.length === 0) {
            throw new NotebookValidationError("notebook.validation.noteId", { position });
        }
        if (noteIds.has(note.id)) {
            throw new NotebookValidationError("notebook.validation.duplicateId", {
                position,
                noteId: note.id,
            });
        }
        noteIds.add(note.id);

        for (const fieldName of ["title", "category", "createdDate", "updatedDate"]) {
            if (typeof note[fieldName] !== "string") {
                throw new NotebookValidationError("notebook.validation.stringField", {
                    position,
                    field: fieldName,
                });
            }
        }
        if (!Array.isArray(note.tags) || note.tags.some((tagName) => typeof tagName !== "string")) {
            throw new NotebookValidationError("notebook.validation.tags", { position });
        }
        if (!isRecord(note.content)
            || typeof note.content.language !== "string"
            || typeof note.content.content !== "string"
            || ("editor" in note.content && typeof note.content.editor !== "string")) {
            throw new NotebookValidationError("notebook.validation.content", { position });
        }
        if ("comment" in note && typeof note.comment !== "string") {
            throw new NotebookValidationError("notebook.validation.comment", { position });
        }
    });
}

/** Serialize a notebook in the built-in editor's four-space JSON format. */
export function serializeNotebook(data) {
    return JSON.stringify(data, null, JSON_INDENT);
}

/** Return one note by stable ID, or undefined when it is absent. */
export function getNote(data, noteId) {
    return data.notes.find((note) => note.id === noteId);
}

/** Create a note from search and active navigation context. */
export function addNote(data, context) {
    const timestamp = new Date().toISOString();
    const note = {
        id: createId(),
        title: String(context.searchText || "").trim(),
        category: context.activeFilter === "categories" ? context.selectedCategory || "" : "",
        createdDate: timestamp,
        updatedDate: timestamp,
        tags: context.activeFilter === "tags" && context.selectedTag ? [context.selectedTag] : [],
        content: { language: "plaintext", content: "", editor: "monaco" },
    };
    return { ...data, notes: [note, ...data.notes] };
}

/** Delete a note and its own view state, preserving all other state entries. */
export function deleteNote(data, noteId) {
    if (!getNote(data, noteId)) {
        return data;
    }
    const state = { ...data.state };
    delete state[noteId];
    return {
        ...data,
        notes: data.notes.filter((note) => note.id !== noteId),
        state,
    };
}

/** Update note-owned fields and set updatedDate only when values actually change. */
export function updateNote(data, noteId, patch) {
    const note = getNote(data, noteId);
    const changedEntries = Object.entries(patch).filter(([fieldName, fieldValue]) => (
        !sameValue(note?.[fieldName], fieldValue)
    ));
    if (!note || changedEntries.length === 0) {
        return data;
    }
    const updatedNote = {
        ...note,
        ...Object.fromEntries(changedEntries),
        updatedDate: new Date().toISOString(),
    };
    return replaceNote(data, noteId, updatedNote);
}

/** Update nested content fields without losing unknown content properties. */
export function updateContent(data, noteId, patch) {
    const note = getNote(data, noteId);
    if (!note) {
        return data;
    }
    const updatedContent = { ...note.content, ...patch };
    if (sameValue(note.content, updatedContent)) {
        return data;
    }
    return updateNote(data, noteId, { content: updatedContent });
}

/** Add a tag to a note unless that exact tag already exists. */
export function addTag(data, noteId, tagValue) {
    const note = getNote(data, noteId);
    const normalizedTag = String(tagValue).trim();
    if (!note || !normalizedTag || note.tags.includes(normalizedTag)) {
        return data;
    }
    return updateNote(data, noteId, { tags: [...note.tags, normalizedTag] });
}

/** Remove one exact tag from a note. */
export function removeTag(data, noteId, tagValue) {
    const note = getNote(data, noteId);
    if (!note || !note.tags.includes(tagValue)) {
        return data;
    }
    return updateNote(data, noteId, { tags: note.tags.filter((item) => item !== tagValue) });
}

/** Remove the optional comment field entirely. */
export function removeComment(data, noteId) {
    const note = getNote(data, noteId);
    if (!note || !("comment" in note)) {
        return data;
    }
    const updatedNote = { ...note, updatedDate: new Date().toISOString() };
    delete updatedNote.comment;
    return replaceNote(data, noteId, updatedNote);
}

/** Filter notes in their original order using category, tag and all-word search rules. */
export function filterNotes(data, selection) {
    const searchWords = String(selection.searchText || "").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return data.notes.filter((note) => {
        if (!matchesCategory(note, selection) || !matchesTag(note, selection)) {
            return false;
        }
        const searchableText = [
            note.title,
            note.category,
            ...note.tags,
            note.comment || "",
            note.content.content,
        ].join(" ").toLocaleLowerCase();
        return searchWords.every((word) => searchableText.includes(word));
    });
}

/** Map legacy editor identifiers to the current board view. */
export function viewForEditor(value) {
    if (value === "grid-json") {
        return "Grid";
    }
    if (value === "md-view") {
        return "Preview";
    }
    return "Code";
}

/** Describe the safe, available content views for one note without changing its saved value. */
export function viewStateForNote(note) {
    const editorValue = note.content.editor;
    if (note.content.language === "markdown") {
        return {
            options: ["monaco", "md-view"],
            selected: editorValue === "md-view" ? "md-view" : "monaco",
            noticeKey: editorValue === "grid-json" ? "notebook.gridInvalidContent" : "",
        };
    }
    if (note.content.language === "json") {
        let parsedRows = null;
        try {
            const value = JSON.parse(note.content.content);
            if (Array.isArray(value) && value.every(isRecord)) {
                parsedRows = value;
            }
        } catch {
            parsedRows = null;
        }
        if (parsedRows) {
            return {
                options: ["monaco", "grid-json"],
                selected: editorValue === "grid-json" ? "grid-json" : "monaco",
                noticeKey: "",
            };
        }
        return {
            options: [],
            selected: "monaco",
            noticeKey: editorValue === "grid-json" ? "notebook.gridInvalidContent" : "",
        };
    }
    return {
        options: [],
        selected: "monaco",
        noticeKey: editorValue === "grid-json"
            ? "notebook.gridInvalidContent"
            : "",
    };
}

function matchesCategory(note, selection) {
    const category = selection.activeFilter === "categories" ? selection.selectedCategory : "";
    return !category
        || note.category === category
        || note.category.startsWith(`${category}${CATEGORY_SEPARATOR}`);
}

function matchesTag(note, selection) {
    const selectedTag = selection.activeFilter === "tags" ? selection.selectedTag : "";
    if (!selectedTag) {
        return true;
    }
    return selectedTag.endsWith(":")
        ? note.tags.some((tagName) => tagName.startsWith(selectedTag))
        : note.tags.includes(selectedTag);
}

function replaceNote(data, noteId, replacement) {
    return {
        ...data,
        notes: data.notes.map((note) => note.id === noteId ? replacement : note),
    };
}

function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    throw new NotebookValidationError("notebook.validation.idGeneration");
}

class NotebookValidationError extends Error {
    constructor(messageKey, parameters = {}) {
        super(messageKey);
        this.key = messageKey;
        this.parameters = parameters;
    }
}

/** Return sorted category paths and exact tags from the entire notebook. */
export function vocabulary(data) {
    const categories = new Set();
    const tags = new Set();
    for (const note of data.notes) {
        const parts = note.category.split("/");
        for (let index = 1; index <= parts.length; index += 1) {
            const path = parts.slice(0, index).join("/");
            if (path) categories.add(path);
        }
        note.tags.forEach((tag) => tags.add(tag));
    }
    return { categories: [...categories].sort(), tags: [...tags].sort() };
}

/** Test whether a category belongs to a subtree at a segment boundary. */
export function inCategory(category, path) {
    return category === path || category.startsWith(`${path}/`);
}

/** Rewrite a category subtree without changing unrelated fields. */
export function renameCategory(data, from, destination) {
    let result = data;
    for (const note of data.notes) {
        if (inCategory(note.category, from)) {
            result = updateNote(result, note.id, { category: destination + note.category.slice(from.length) });
        }
    }
    return result;
}

/** Rename an exact tag and avoid introducing a duplicate destination. */
export function renameTag(data, from, destination) {
    let result = data;
    for (const note of data.notes) {
        if (!note.tags.includes(from)) continue;
        const hasDestination = note.tags.includes(destination);
        let inserted = hasDestination;
        const tags = [];
        for (const tag of note.tags) {
            if (tag !== from) tags.push(tag);
            else if (!inserted) {
                tags.push(destination);
                inserted = true;
            }
        }
        result = updateNote(result, note.id, { tags });
    }
    return result;
}
