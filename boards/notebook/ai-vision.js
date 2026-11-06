// Notebook's agent model. Both frames register the same curated elements.
import * as model from "./model.js";

const ELEMENTS = [
    { name: "notes", view: "main", selector: "#note-list", purpose: "Paged note cards.", where: "Main view." },
    { name: "navigation", view: "nav", selector: ".navigation", purpose: "Select and manage categories and tags.", where: "Categories & Tags panel." },
];

/** Register the same element providers in each frame and expose the main model. */
export function createNotebookVision(api) {
    const vision = api?.aiVision;
    if (!vision) return { expose() {}, refresh() {} };
    const elements = vision.createElements(ELEMENTS);
    let remote = null;
    let shape = "";
    return { refresh(counts) {
        const next = counts.join(",");
        if (remote && next !== shape) { shape = next; remote.refresh(); }
    }, expose: (actions) => {
        if (api.view !== "main") return;
        const data = () => {
            const value = actions.getData();
            if (!value) throw new Error("No valid notebook is open.");
            return value;
        };
        const note = (id) => {
            const value = model.getNote(data(), id);
            if (!value) throw new Error(`Unknown note: ${id}`);
            return value;
        };
        const string = (value, name) => {
            if (typeof value !== "string") throw new Error(`${name} must be a string.`);
            return value;
        };
        const snapshot = (item) => ({ ...item, content: item.content.content, language: item.content.language, editor: item.content.editor, tags: [...item.tags] });
        const getFiltered = () => model.filterNotes(data(), actions.getSelection());
        const getTag = (id, index) => {
            const tags = note(id).tags;
            if (!Number.isInteger(index) || index < 0 || index >= tags.length) throw new Error("Invalid tag index.");
            return tags[index];
        };
        const methods = {
            addNote: () => snapshot(actions.add()),
            deleteNote(id, confirm) { note(id); if (confirm !== true) throw new Error("Pass true as the second argument to confirm deletion."); actions.delete(id); return true; },
            updateNoteTitle(id, value) { note(id); actions.updateNote(id, { title: string(value, "title") }); },
            updateNoteContent(id, value) { note(id); actions.updateContent(id, { content: string(value, "content") }); },
            updateNoteCategory(id, value) { note(id); actions.updateNote(id, { category: string(value, "category") }); },
            updateNoteLanguage(id, value) { note(id); actions.updateContent(id, { language: string(value, "language") }); },
            updateNoteComment(id, value) { note(id); actions.updateNote(id, { comment: string(value, "comment") }); },
            addComment(id) { const item = note(id); if (!("comment" in item)) actions.updateNote(id, { comment: "" }); },
            removeComment(id) { note(id); actions.removeComment(id); },
            addNoteTag(id, value) { note(id); string(value, "tag"); actions.changeData((d) => model.addTag(d, id, value)); },
            removeNoteTag(id, index) { const tag = getTag(id, index); actions.changeData((d) => model.removeTag(d, id, tag)); },
            updateNoteTag(id, index, value) {
                const tag = getTag(id, index); string(value, "tag");
                if (!value.trim()) throw new Error("Tag must not be empty.");
                actions.changeData((d) => model.addTag(model.removeTag(d, id, tag), id, value));
            },
            setSearchText(value) { actions.select({ searchText: string(value, "search text") }); },
            clearSearch() { actions.select({ searchText: "" }); },
            setSelectedCategory(value) { string(value, "category"); if (value && !model.vocabulary(data()).categories.includes(value)) throw new Error("Unknown category."); actions.select({ activeFilter: "categories", selectedCategory: value, selectedTag: "" }); },
            setSelectedTag(value) { string(value, "tag"); if (value && !model.vocabulary(data()).tags.some((tag) => tag === value || (value.endsWith(":") && tag.startsWith(value)))) throw new Error("Unknown tag."); actions.select({ activeFilter: "tags", selectedCategory: "", selectedTag: value }); },
            expandNote(id) { note(id); actions.getCards().expand(id); },
            collapseNote() { actions.getCards().collapse(); },
            setNoteView(id, view) {
                const item = note(id);
                const editor = { code: "monaco", preview: "md-view", grid: "grid-json" }[view];
                if (!editor || (editor !== "monaco" && !model.viewStateForNote(item).options.includes(editor))) throw new Error("View is unavailable for this note; use code, preview or grid when eligible.");
                actions.updateContent(id, { editor });
            },
            renameCategory(from, name) {
                string(from, "category"); string(name, "name");
                if (!model.vocabulary(data()).categories.includes(from) || !name.trim() || name.includes("/")) throw new Error("Use an existing category and a nonempty single-segment name.");
                const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
                changeCategory(from, parent + name.trim());
            },
            moveCategory(from, parent) {
                string(from, "category"); string(parent, "parent");
                const cats = model.vocabulary(data()).categories;
                if (!cats.includes(from) || (parent && !cats.includes(parent)) || parent === from || (parent && model.inCategory(parent, from))) throw new Error("Invalid source or destination category.");
                changeCategory(from, (parent ? parent + "/" : "") + from.split("/").at(-1));
            },
            renameTag(from, to) {
                string(from, "tag"); string(to, "tag");
                if (!model.vocabulary(data()).tags.includes(from) || !to.trim()) throw new Error("Use an existing tag and a nonempty destination.");
                actions.changeData((d) => model.renameTag(d, from, to.trim()));
                if (actions.getSelection().activeFilter === "tags" && actions.getSelection().selectedTag === from) actions.select({ selectedTag: to.trim() });
            },
            loadMore() { actions.getCards().loadMore(); },
            showAll() { actions.getCards().showAll(); },
        };
        function changeCategory(from, to) {
            if (from === to) return;
            actions.changeData((d) => model.renameCategory(d, from, to));
            const selection = actions.getSelection();
            const patch = { collapsedCategories: (selection.collapsedCategories || []).map((path) => model.inCategory(path, from) ? to + path.slice(from.length) : path) };
            if (selection.activeFilter === "categories" && model.inCategory(selection.selectedCategory || "", from)) patch.selectedCategory = to + selection.selectedCategory.slice(from.length);
            actions.select(patch);
        }
        const noteFields = ["id", "title", "content", "language", "editor", "category", "tags", "comment", "createdDate", "updatedDate"];
        function collection(getItems, kind) {
            return { aiVision: {
                kind, summary: "Notes in file order; index by position or note ID.", members: [],
                summarize: () => getItems().map(snapshot),
                index: (key) => {
                    const item = typeof key === "number" ? getItems()[key] : getItems().find((entry) => entry.id === key);
                    if (!item) return undefined;
                    const result = {};
                    for (const field of noteFields) Object.defineProperty(result, field, { get: () => snapshot(note(item.id))[field] });
                    result.aiVision = { kind: "NotebookNote", summary: "A note identified by its stable ID.",
                        members: noteFields.map((name) => ({ name, kind: "property", summary: `Note ${name}.` })),
                        summarize: () => snapshot(note(item.id)) };
                    return result;
                },
            } };
        }
        const allNotes = collection(() => actions.getData()?.notes || [], "NotebookNotes");
        const filteredNotes = collection(() => actions.getData() ? getFiltered() : [], "FilteredNotebookNotes");
        const properties = {
            notes: () => allNotes, filteredNotes: () => filteredNotes,
            categories: () => model.vocabulary(data()).categories, tags: () => model.vocabulary(data()).tags,
            error: () => actions.getError(),
            notesCount: () => data().notes.length, filteredCount: () => getFiltered().length,
            searchText: () => actions.getSelection().searchText, selectedCategory: () => actions.getSelection().selectedCategory,
            selectedTag: () => actions.getSelection().selectedTag, expandedPanel: () => actions.getSelection().activeFilter,
            expandedNoteId: () => actions.getCards().expandedNoteId, renderedCount: () => actions.getCards().renderedCount,
            remainingCount: () => Math.max(0, getFiltered().length - actions.getCards().renderedCount),
        };
        const signatures = {
            addNote: "addNote()", deleteNote: "deleteNote(id: string, confirm: boolean)",
            updateNoteTitle: "updateNoteTitle(id: string, title: string)", updateNoteContent: "updateNoteContent(id: string, content: string)",
            updateNoteCategory: "updateNoteCategory(id: string, category: string)", updateNoteLanguage: "updateNoteLanguage(id: string, language: string)",
            updateNoteComment: "updateNoteComment(id: string, comment: string)", addComment: "addComment(id: string)", removeComment: "removeComment(id: string)",
            addNoteTag: "addNoteTag(id: string, tag: string)", removeNoteTag: "removeNoteTag(id: string, index: number)", updateNoteTag: "updateNoteTag(id: string, index: number, tag: string)",
            setSearchText: "setSearchText(text: string)", clearSearch: "clearSearch()", setSelectedCategory: "setSelectedCategory(category: string)",
            setSelectedTag: "setSelectedTag(tag: string)", expandNote: "expandNote(id: string)", collapseNote: "collapseNote()",
            setNoteView: "setNoteView(id: string, view: 'code' | 'preview' | 'grid')", renameCategory: "renameCategory(path: string, name: string)",
            moveCategory: "moveCategory(path: string, parent: string)", renameTag: "renameTag(from: string, to: string)", loadMore: "loadMore()", showAll: "showAll()",
        };
        const app = { ...methods };
        for (const [name, getter] of Object.entries(properties)) Object.defineProperty(app, name, { get: getter });
        app.aiVision = {
            kind: "NotebookApp", summary: "Notebook notes, filters and editing actions.",
            help: "Notes are snapshots; use note IDs for edits. deleteNote requires true as its second argument. Changes go through the content host; save the page to write the file.",
            members: [
                ...Object.keys(properties).map((name) => ({ name, kind: "property", summary: `Current ${name}.`, ...(["notes", "filteredNotes"].includes(name) ? { node: true, indexable: true } : {}) })),
                ...Object.keys(methods).map((name) => ({ name, kind: "method", signature: signatures[name], summary: `Notebook ${name} action.`, ...(name === "deleteNote" ? { caution: "Deletes immediately when confirm is true." } : {}) })),
                ...elements.members,
            ],
            elements: ELEMENTS, provide: elements.provide,
            summarize: () => ({ kind: "NotebookApp", notesCount: actions.getData()?.notes.length ?? 0 }),
        };
        remote = vision.expose(app);
        shape = [Boolean(actions.getData()?.notes.length), Boolean(actions.getData() && getFiltered().length)].join(",");
    } };
}
