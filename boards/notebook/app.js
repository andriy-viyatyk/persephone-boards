// Notebook frame bootstrap: coordinates shared selection, host content and card rendering.

import * as model from "./model.js";
import { createCards } from "./cards.js";
import { translate } from "./i18n.js";
import { startNavigation } from "./nav.js";
import { createNotebookVision } from "./ai-vision.js";

const EDIT_DEBOUNCE_MS = 300;
// Host toolbar control ids (persephone.toolbar, bridge 1.49.0 for the breadcrumb).
const TOOLBAR_PATH = "path";
const TOOLBAR_SEARCH = "search";
const TOOLBAR_ADD = "add";
const DEFAULT_SELECTION = {
    activeFilter: "categories",
    selectedCategory: "",
    selectedTag: "",
    searchText: "",
    collapsedCategories: [],
};

const boardRoot = document.querySelector("#app");
const persephoneApi = window.persephone;
const isNavigationView = persephoneApi.view === "nav";
const vision = createNotebookVision(persephoneApi);

if (isNavigationView) {
    startNavigation(boardRoot, persephoneApi);
} else {
    startMainView();
}

async function startMainView() {
    renderMainShell();
    const errorMessage = boardRoot.querySelector("#error-message");
    const emptyMessage = boardRoot.querySelector("#empty-message");
    const noteList = boardRoot.querySelector("#note-list");
    const expandedPanel = boardRoot.querySelector("#expanded-note");
    const deleteDialog = boardRoot.querySelector("#delete-dialog");

    let selection = { ...DEFAULT_SELECTION };
    let notebookData = null;
    let lastSerializedNotebook = null;
    let hasValidNotebook = false;
    let debounceTimer = null;
    const pendingEdits = new Map();
    // Notes whose content changed since the last debounced save; their view switch is re-checked then.
    const contentEditedNoteIds = new Set();
    let cardController;
    // Last values sent to (or received from) the host toolbar, so state echoes are not re-sent.
    let toolbarSearch = "";
    let toolbarPath = { value: "", separators: "/" };
    let toolbarAddDisabled = true;

    cardController = createCards(noteList, expandedPanel, {
        getFilteredNotes: () => notebookData ? model.filterNotes(notebookData, selection) : [],
        getSearchText: () => selection.searchText,
        getVocabulary: () => notebookData ? model.vocabulary(notebookData) : { categories: [], tags: [] },
        editField,
        updateNote,
        updateContent,
        addTag,
        removeTag,
        removeComment,
        confirmDelete,
        flush,
        hasPendingEdit,
        translate,
        switchView,
        getNoteState,
        saveGridWidth,
    });
    window.notebookFlush = flush;

    wireToolbar();
    wireDeleteDialog();
    initializeSharedState();
    subscribeToHostChanges();
    wireSaveShortcut();
    vision.expose({
        getData: () => notebookData,
        getError: () => errorMessage.hidden ? undefined : errorMessage.textContent,
        getSelection: () => selection,
        getCards: () => cardController,
        select: (patch) => persephoneApi.state.merge(patch),
        add() {
            flush();
            if (!hasValidNotebook) throw new Error("No valid notebook is open.");
            notebookData = model.addNote(notebookData, selection);
            const note = notebookData.notes[0];
            persistNotebook();
            persephoneApi.state.merge({ searchText: "" });
            renderNotes();
            return note;
        },
        delete: deleteNote,
        updateNote,
        updateContent,
        removeComment,
        changeData(change) { runDiscreteEdit(() => change(notebookData)); },
    });
    window.addEventListener("beforeunload", onFrameTeardown, { once: true });

    try {
        await persephoneApi.getFilePath();
        const initialText = await persephoneApi.host.getContent();
        receiveHostContent(initialText);
    } catch (error) {
        hasValidNotebook = false;
        showError(translate("notebook.openFile"));
    }

    function wireToolbar() {
        persephoneApi.toolbar.set([
            {
                id: TOOLBAR_PATH,
                type: "breadcrumb",
                rootLabel: translate("notebook.allNotes"),
                value: toolbarPath.value,
                separators: toolbarPath.separators,
            },
            {
                id: TOOLBAR_SEARCH,
                type: "input",
                placeholder: translate("notebook.searchPlaceholder"),
                value: toolbarSearch,
            },
            {
                id: TOOLBAR_ADD,
                type: "button",
                label: translate("notebook.addNote"),
                icon: { name: "plus" },
                disabled: toolbarAddDisabled,
            },
        ]);
        persephoneApi.toolbar.onAction(({ id, value }) => {
            if (id === TOOLBAR_PATH) {
                navigateToPath(value ?? "");
            } else if (id === TOOLBAR_SEARCH) {
                toolbarSearch = value ?? "";
                persephoneApi.state.merge({ searchText: toolbarSearch });
            } else if (id === TOOLBAR_ADD) {
                addNoteFromToolbar();
            }
        });
    }

    function addNoteFromToolbar() {
        flush();
        if (!hasValidNotebook) {
            return;
        }
        notebookData = model.addNote(notebookData, selection);
        persistNotebook();
        cardController.reset();
        hideEmptyMessage();
        persephoneApi.state.merge({ searchText: "" });
    }

    /** Breadcrumb clicks send the path up to the clicked segment; "" is the root. */
    function navigateToPath(path) {
        if (!path) {
            persephoneApi.state.merge({ activeFilter: "categories", selectedCategory: "", selectedTag: "" });
        } else if (selection.activeFilter === "tags") {
            // Only ancestors are clickable, so a tag path is always a group: keep the
            // trailing ":" that marks a tag group in the selection.
            persephoneApi.state.merge({ activeFilter: "tags", selectedCategory: "", selectedTag: `${path}:` });
        } else {
            persephoneApi.state.merge({ activeFilter: "categories", selectedCategory: path, selectedTag: "" });
        }
    }

    /** Push selection changes to the host toolbar, skipping values it already shows. */
    function syncToolbar() {
        const patches = [];
        const path = selection.activeFilter === "tags" && selection.selectedTag
            ? { value: selection.selectedTag, separators: ":" }
            : { value: selection.activeFilter === "categories" ? selection.selectedCategory : "", separators: "/" };
        if (path.value !== toolbarPath.value || path.separators !== toolbarPath.separators) {
            toolbarPath = path;
            patches.push({ id: TOOLBAR_PATH, ...path });
        }
        if (selection.searchText !== toolbarSearch) {
            toolbarSearch = selection.searchText;
            patches.push({ id: TOOLBAR_SEARCH, value: toolbarSearch });
        }
        if (toolbarAddDisabled !== !hasValidNotebook) {
            toolbarAddDisabled = !hasValidNotebook;
            patches.push({ id: TOOLBAR_ADD, disabled: toolbarAddDisabled });
        }
        if (patches.length) {
            persephoneApi.toolbar.update(patches);
        }
    }

    function wireDeleteDialog() {
        deleteDialog.addEventListener("close", () => {
            const noteId = deleteDialog.dataset.noteId;
            if (deleteDialog.returnValue === "delete" && noteId) {
                deleteNote(noteId);
            }
            deleteDialog.dataset.noteId = "";
        });
    }

    function initializeSharedState() {
        persephoneApi.state.init(DEFAULT_SELECTION, {
            restorableKeys: ["activeFilter", "selectedCategory", "selectedTag", "collapsedCategories"],
        });
        persephoneApi.state.onChange((nextSelection) => {
            const previousFilterKey = getFilterKey(selection);
            selection = { ...DEFAULT_SELECTION, ...nextSelection };
            vision.refresh([Boolean(notebookData?.notes.length), Boolean(notebookData && model.filterNotes(notebookData, selection).length)]);
            syncToolbar();
            if (previousFilterKey !== getFilterKey(selection)) {
                flush();
                cardController.reset();
            } else {
                cardController.render();
            }
        });
    }

    function subscribeToHostChanges() {
        persephoneApi.host.onContentChange(receiveHostContent);
    }

    function receiveHostContent(text) {
        const parsed = model.parseNotebook(text);
        if (parsed.error) {
            hasValidNotebook = false;
            notebookData = null;
            lastSerializedNotebook = null;
            showError(translate(parsed.error.key, parsed.error.parameters));
            cardController.render();
            return;
        }

        hasValidNotebook = true;
        lastSerializedNotebook = model.serializeNotebook(parsed.data);
        notebookData = reapplyPendingEdits(parsed.data);
        showError("");
        renderNotes();
    }

    function reapplyPendingEdits(incomingData) {
        let rebasedData = incomingData;
        for (const [editKey, editValue] of pendingEdits) {
            const [noteId, fieldName] = editKey.split("\u0000");
            if (!model.getNote(rebasedData, noteId)) {
                pendingEdits.delete(editKey);
                continue;
            }
            rebasedData = applyFieldEdit(rebasedData, noteId, fieldName, editValue);
        }
        return rebasedData;
    }

    function editField(noteId, fieldName, value) {
        if (!hasValidNotebook) {
            return;
        }
        const note = model.getNote(notebookData, noteId);
        if (!note || getFieldValue(note, fieldName) === value) {
            return;
        }
        pendingEdits.set(makeEditKey(noteId, fieldName), value);
        notebookData = applyFieldEdit(notebookData, noteId, fieldName, value);
        if (fieldName === "category") cardController.refreshSuggestions();
        if (fieldName === "content.content") contentEditedNoteIds.add(noteId);
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(flush, EDIT_DEBOUNCE_MS);
    }

    function updateNote(noteId, patch) {
        runDiscreteEdit(() => model.updateNote(notebookData, noteId, patch));
    }

    function updateContent(noteId, patch) {
        runDiscreteEdit(() => model.updateContent(notebookData, noteId, patch));
    }

    function switchView(noteId, editorValue) {
        flush();
        if (!hasValidNotebook) {
            return;
        }
        updateContent(noteId, { editor: editorValue });
    }

    function getNoteState(noteId) {
        return notebookData?.state?.[noteId]?.["editorSettings:grid-json"];
    }

    function saveGridWidth(noteId, columnKey, width) {
        flush();
        if (!hasValidNotebook || !model.getNote(notebookData, noteId)) {
            return;
        }
        const stateForNote = notebookData.state[noteId] || {};
        const serializedSettings = stateForNote["editorSettings:grid-json"];
        let settings = { columns: [] };
        if (serializedSettings !== undefined) {
            if (typeof serializedSettings !== "string") {
                return;
            }
            try {
                settings = JSON.parse(serializedSettings);
            } catch {
                return;
            }
            if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
                return;
            }
        }
        const columns = Array.isArray(settings.columns) ? settings.columns.slice() : [];
        const existingIndex = columns.findIndex((column) => column?.key === columnKey);
        if (existingIndex >= 0) {
            columns[existingIndex] = { ...columns[existingIndex], width };
        } else {
            columns.push({ key: columnKey, width });
        }
        settings = { ...settings, columns };
        notebookData = {
            ...notebookData,
            state: {
                ...notebookData.state,
                [noteId]: {
                    ...stateForNote,
                    "editorSettings:grid-json": JSON.stringify(settings),
                },
            },
        };
        persistNotebook();
        cardController.render();
    }

    function addTag(noteId, tagValue) {
        runDiscreteEdit(() => model.addTag(notebookData, noteId, tagValue));
    }

    function removeTag(noteId, tagValue) {
        runDiscreteEdit(() => model.removeTag(notebookData, noteId, tagValue));
    }

    function removeComment(noteId) {
        runDiscreteEdit(() => model.removeComment(notebookData, noteId));
    }

    function deleteNote(noteId) {
        flush();
        if (!hasValidNotebook) {
            return;
        }
        notebookData = model.deleteNote(notebookData, noteId);
        for (const editKey of pendingEdits.keys()) {
            if (editKey.startsWith(`${noteId}\u0000`)) {
                pendingEdits.delete(editKey);
            }
        }
        persistNotebook();
        renderNotes();
    }

    function confirmDelete(noteId) {
        if (!hasValidNotebook) {
            return;
        }
        flush();
        const note = model.getNote(notebookData, noteId);
        if (!note) {
            return;
        }
        deleteDialog.querySelector("#delete-message").textContent = translate(
            "notebook.confirmDeleteNote",
            { noteTitle: note.title || translate("notebook.untitled") },
        );
        deleteDialog.dataset.noteId = noteId;
        deleteDialog.returnValue = "cancel";
        deleteDialog.showModal();
    }

    function runDiscreteEdit(createUpdatedData) {
        flush();
        if (!hasValidNotebook) {
            return;
        }
        const updatedData = createUpdatedData();
        if (updatedData !== notebookData) {
            notebookData = updatedData;
            persistNotebook();
            renderNotes();
        }
    }

    function flush() {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
        persistNotebook();
        for (const noteId of contentEditedNoteIds) {
            cardController.refreshViewOptions(noteId);
        }
        contentEditedNoteIds.clear();
    }

    function persistNotebook() {
        if (!hasValidNotebook || !notebookData) {
            return;
        }
        const serializedNotebook = model.serializeNotebook(notebookData);
        if (serializedNotebook === lastSerializedNotebook) {
            pendingEdits.clear();
            return;
        }
        const editsBeingWritten = new Map(pendingEdits);
        try {
            const writeResult = persephoneApi.host.setContent(serializedNotebook);
            Promise.resolve(writeResult)
                .then(() => completeWrite(serializedNotebook, editsBeingWritten))
                .catch((error) => {
                    showError(translate("notebook.saveError", { error: error.message || String(error) }));
                });
        } catch (error) {
            showError(translate("notebook.saveError", { error: error.message || String(error) }));
        }
    }

    function completeWrite(serializedNotebook, editsBeingWritten) {
        lastSerializedNotebook = serializedNotebook;
        for (const [editKey, editValue] of editsBeingWritten) {
            if (pendingEdits.get(editKey) === editValue) {
                pendingEdits.delete(editKey);
            }
        }
    }

    function hasPendingEdit(noteId, fieldName) {
        return pendingEdits.has(makeEditKey(noteId, fieldName));
    }

    function wireSaveShortcut() {
        document.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
                flush();
            }
        }, true);
    }

    function onFrameTeardown() {
        flush();
        cardController.destroy();
        delete window.notebookFlush;
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.hidden = !message;
        syncToolbar();
        noteList.hidden = !hasValidNotebook;
        if (!hasValidNotebook) {
            emptyMessage.hidden = true;
        }
    }

    function renderNotes() {
        vision.refresh([Boolean(notebookData?.notes.length), Boolean(notebookData && model.filterNotes(notebookData, selection).length)]);
        cardController.render();
        updateEmptyState();
    }

    function updateEmptyState() {
        if (!hasValidNotebook) {
            return;
        }
        const allNotes = notebookData.notes.length;
        const visibleNotes = model.filterNotes(notebookData, selection).length;
        const messageKey = allNotes === 0
            ? "notebook.noNotesYet"
            : visibleNotes === 0 ? "notebook.noNotesMatchFilter" : "";
        emptyMessage.textContent = messageKey ? translate(messageKey) : "";
        emptyMessage.hidden = !messageKey;
    }

    function hideEmptyMessage() {
        emptyMessage.hidden = true;
    }
}

function renderMainShell() {
    document.title = translate("notebook.notes");
    boardRoot.replaceChildren();

    const errorMessage = document.createElement("div");
    errorMessage.id = "error-message";
    errorMessage.className = "message error-message";
    errorMessage.setAttribute("role", "alert");
    errorMessage.hidden = true;
    const emptyMessage = document.createElement("div");
    emptyMessage.id = "empty-message";
    emptyMessage.className = "message empty-message";
    emptyMessage.hidden = true;
    const noteList = document.createElement("section");
    noteList.id = "note-list";
    noteList.className = "note-list";
    const expandedNote = document.createElement("section");
    expandedNote.id = "expanded-note";
    expandedNote.className = "expanded-note";
    expandedNote.hidden = true;
    boardRoot.append(errorMessage, emptyMessage, noteList, expandedNote, createDeleteDialog());
}

function createDeleteDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "delete-dialog";
    dialog.className = "delete-dialog";
    dialog.setAttribute("aria-labelledby", "delete-message");
    const message = document.createElement("p");
    message.id = "delete-message";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancelButton = document.createElement("button");
    cancelButton.className = "p-btn";
    cancelButton.type = "button";
    cancelButton.value = "cancel";
    cancelButton.textContent = translate("notebook.cancel");
    cancelButton.addEventListener("click", () => dialog.close("cancel"));
    const deleteButton = document.createElement("button");
    deleteButton.className = "p-btn danger";
    deleteButton.type = "button";
    deleteButton.value = "delete";
    deleteButton.textContent = translate("notebook.delete");
    deleteButton.addEventListener("click", () => dialog.close("delete"));
    actions.append(cancelButton, deleteButton);
    dialog.append(message, actions);
    return dialog;
}

function getFilterKey(selection) {
    return [
        selection.activeFilter,
        selection.selectedCategory,
        selection.selectedTag,
        selection.searchText,
    ].join("\u0000");
}

function makeEditKey(noteId, fieldName) {
    return `${noteId}\u0000${fieldName}`;
}

function getFieldValue(note, fieldName) {
    return fieldName === "content.content" ? note.content.content : note[fieldName];
}

function applyFieldEdit(data, noteId, fieldName, value) {
    return fieldName === "content.content"
        ? model.updateContent(data, noteId, { content: value })
        : model.updateNote(data, noteId, { [fieldName]: value });
}
