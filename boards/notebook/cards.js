// Notebook card view: renders compact note cards and manages paging and expansion.

import { createEditor } from "./editor.js";
import { createGrid } from "./grid.js";
import { createPreview } from "./preview.js";
import { attachSuggestions } from "./suggest.js";
import { translate } from "./i18n.js";
import * as model from "./model.js";

const PAGE_SIZE = 30;
const MAX_COMMENT_HEIGHT = 120;
const LANGUAGE_OPTIONS = [
    "plaintext",
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
    "json",
    "markdown",
    "html",
    "css",
    "xml",
    "yaml",
    "sql",
];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ICON_PATHS = {
    expand: "M4 9V4h5M4 4l6 6M20 15v5h-5m5 0-6-6",
    collapse: "M9 4v5H4m0-5 6 6m10 5v5h-5m5 0-6-6",
    delete: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
    add: "M12 5v14M5 12h14",
    comment: "M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.7-.8L4 20l1.3-3.3A7.2 7.2 0 0 1 4 12c0-4.4 3.6-8 8-8s8 3.1 8 7.5Z",
};

/** Create the keyed card list, paging controls, and expanded note view. */
export function createCards(listElement, expandedElement, appApi) {
    const cardsById = new Map();
    const loadMoreButton = document.createElement("button");
    const sentinel = document.createElement("div");
    let renderedLimit = PAGE_SIZE;
    let expandedNoteId = null;
    let savedScrollTop = 0;
    // Category and tag inputs read suggestions from the live vocabulary when they open.
    const getCategoryValues = () => appApi.getVocabulary().categories;
    const getTagValues = () => appApi.getVocabulary().tags;

    loadMoreButton.className = "p-btn more-button";
    loadMoreButton.type = "button";
    loadMoreButton.addEventListener("click", addNextPage);
    listElement.append(loadMoreButton);
    sentinel.className = "pagination-sentinel";
    sentinel.setAttribute("aria-hidden", "true");

    const observer = "IntersectionObserver" in window
        ? new IntersectionObserver(onIntersection, { root: listElement })
        : null;

    document.addEventListener("keydown", collapseOnEscape);

    // Chromium only re-evaluates :hover when the mouse moves, so wheel-scrolling a new card
    // under a still pointer leaves the old card highlighted. Track the hovered card in JS
    // and re-hit-test it after scrolling; the CSS keys card highlights off .card-hovered.
    let pointerX = -1;
    let pointerY = -1;
    let hoveredCard = null;
    let hoverFrame = 0;

    function setHoveredCard(card) {
        if (card === hoveredCard) {
            return;
        }
        hoveredCard?.classList.remove("card-hovered");
        hoveredCard = card;
        hoveredCard?.classList.add("card-hovered");
    }

    function updateHoverFromPoint() {
        hoverFrame = 0;
        if (pointerX < 0) {
            setHoveredCard(null);
            return;
        }
        const target = document.elementFromPoint(pointerX, pointerY);
        setHoveredCard(target?.closest(".note-card") || null);
    }

    function scheduleHoverUpdate() {
        if (!hoverFrame) {
            hoverFrame = requestAnimationFrame(updateHoverFromPoint);
        }
    }

    function onPointerMove(event) {
        pointerX = event.clientX;
        pointerY = event.clientY;
        setHoveredCard(event.target.closest?.(".note-card") || null);
    }

    function onPointerLeave() {
        pointerX = -1;
        pointerY = -1;
        setHoveredCard(null);
    }

    for (const container of [listElement, expandedElement]) {
        container.addEventListener("pointermove", onPointerMove);
        container.addEventListener("pointerleave", onPointerLeave);
        // Capture also catches scrolls inside nested scrollers (code editor, preview, grid).
        container.addEventListener("scroll", scheduleHoverUpdate, { capture: true, passive: true });
    }

    /** Reconcile cards against the filtered notes without remounting retained editors. */
    function render() {
        refreshSuggestions();
        const filteredNotes = appApi.getFilteredNotes();
        const visibleNotes = filteredNotes.slice(0, renderedLimit);
        const visibleIds = new Set(visibleNotes.map((note) => note.id));
        const visibleCards = [];

        removeFilteredCards(visibleIds);
        for (const note of visibleNotes) {
            const cardRecord = getOrCreateCard(note);
            updateCard(cardRecord, note, appApi.getSearchText());
            if (note.id !== expandedNoteId) {
                visibleCards.push(cardRecord);
            }
        }
        reorderVisibleCards(visibleCards);
        updatePagination(filteredNotes.length);
        if (expandedNoteId) {
            updateExpandedCard();
        }
        // Cards may have moved or been replaced under a still pointer.
        scheduleHoverUpdate();
    }

    /** Kept for app.js callers: suggestions now read the vocabulary when a list opens. */
    function refreshSuggestions() {}

    /** Reset pagination after a filter or search change. */
    function reset() {
        renderedLimit = PAGE_SIZE;
        if (expandedNoteId && !appApi.getFilteredNotes().some((note) => note.id === expandedNoteId)) {
            collapseExpandedNote();
        }
        render();
    }

    /** Release observer and editor resources when the board frame is torn down. */
    function destroy() {
        observer?.disconnect();
        document.removeEventListener("keydown", collapseOnEscape);
        if (hoverFrame) {
            cancelAnimationFrame(hoverFrame);
        }
        for (const cardRecord of cardsById.values()) {
            cardRecord.editor.destroy();
            cardRecord.adapter?.destroy();
        }
        cardsById.clear();
    }

    function addNextPage() {
        renderedLimit += PAGE_SIZE;
        render();
    }

    function onIntersection(entries) {
        if (entries.some((entry) => entry.isIntersecting) && !loadMoreButton.hidden) {
            addNextPage();
        }
    }

    function removeFilteredCards(visibleIds) {
        for (const [noteId, cardRecord] of cardsById) {
            if (!visibleIds.has(noteId) && noteId !== expandedNoteId) {
                cardRecord.editor.destroy();
                cardRecord.adapter?.destroy();
                cardRecord.element.remove();
                cardsById.delete(noteId);
            }
        }
    }

    function reorderVisibleCards(visibleCards) {
        let nextElement = loadMoreButton;
        for (let index = visibleCards.length - 1; index >= 0; index -= 1) {
            const cardElement = visibleCards[index].element;
            if (cardElement.parentElement !== listElement || cardElement.nextElementSibling !== nextElement) {
                listElement.insertBefore(cardElement, nextElement);
            }
            nextElement = cardElement;
        }
    }

    function getOrCreateCard(note) {
        let cardRecord = cardsById.get(note.id);
        if (!cardRecord) {
            cardRecord = createCard(note);
            cardsById.set(note.id, cardRecord);
        }
        return cardRecord;
    }

    function createCard(note) {
        const cardElement = document.createElement("article");
        cardElement.className = "note-card";
        cardElement.dataset.noteId = note.id;

        // Row 1: title, then the date and card actions on the same line.
        const heading = document.createElement("div");
        heading.className = "card-heading";
        cardElement.append(heading);

        const titleInput = createTextInput("notebook.noteTitlePlaceholder", "note-title");
        titleInput.addEventListener("input", () => appApi.editField(note.id, "title", titleInput.value));
        heading.append(titleInput);

        const updatedDate = document.createElement("time");
        updatedDate.className = "updated-date";
        heading.append(updatedDate);

        const commentArea = createCommentArea(note.id);
        const expandButton = createIconButton("notebook.expand", "expand-button", "expand", () => {
            toggleExpanded(note.id);
        });
        const deleteButton = createIconButton("notebook.delete", "delete-button", "delete", () => {
            appApi.confirmDelete(note.id);
        });
        heading.append(commentArea.addButton, expandButton, deleteButton);

        // Row 2: category and tags on the left, view switch and language on the right.
        const metadata = document.createElement("div");
        metadata.className = "card-metadata";
        cardElement.append(metadata);

        const categoryControl = createCategoryControl(note);
        metadata.append(categoryControl.element);
        const tagArea = createTagArea(note.id);
        metadata.append(tagArea.element);

        const metadataSpacer = document.createElement("span");
        metadataSpacer.className = "meta-spacer";
        metadata.append(metadataSpacer);

        const languageSelect = document.createElement("select");
        languageSelect.className = "p-select language-select";
        languageSelect.setAttribute("aria-label", translate("notebook.language"));
        for (const language of LANGUAGE_OPTIONS) {
            languageSelect.append(createOption(language, translate(`notebook.language.${language}`)));
        }
        languageSelect.addEventListener("change", () => {
            appApi.updateContent(note.id, { language: languageSelect.value });
        });
        const viewControls = document.createElement("div");
        viewControls.className = "view-controls";
        viewControls.setAttribute("role", "group");
        viewControls.setAttribute("aria-label", translate("notebook.viewLabel"));
        const viewButtons = new Map();
        for (const [editorValue, labelKey] of [["monaco", "notebook.viewCode"], ["md-view", "notebook.viewPreview"], ["grid-json", "notebook.viewGrid"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "p-btn view-button";
            button.textContent = translate(labelKey);
            button.dataset.editor = editorValue;
            button.addEventListener("click", () => appApi.switchView(note.id, editorValue));
            viewButtons.set(editorValue, button);
            viewControls.append(button);
        }
        metadata.append(viewControls, languageSelect);

        // Row 3: the note content. Row 4 (appended below): the comment.
        const viewNotice = document.createElement("div");
        viewNotice.className = "view-notice";
        viewNotice.setAttribute("role", "status");
        viewNotice.hidden = true;
        const editorElement = document.createElement("div");
        editorElement.className = "note-editor";
        const contentHost = document.createElement("div");
        contentHost.className = "note-content";
        contentHost.append(editorElement);
        cardElement.append(viewNotice, contentHost, commentArea.element);
        const editor = createEditor(editorElement, note, (value) => {
            appApi.editField(note.id, "content.content", value);
        });

        const titleHighlight = document.createElement("div");
        titleHighlight.className = "search-highlight title-highlight";
        const commentHighlight = document.createElement("div");
        commentHighlight.className = "search-highlight comment-highlight";
        cardElement.append(titleHighlight, commentHighlight);

        return {
            element: cardElement,
            titleInput,
            categoryControl,
            languageSelect,
            viewControls,
            viewButtons,
            viewNotice,
            contentHost,
            tagArea,
            commentArea,
            updatedDate,
            editor,
            adapter: null,
            adapterView: "",
            expandButton,
            titleHighlight,
            commentHighlight,
        };
    }

    function createCategoryControl(note) {
        const control = document.createElement("div");
        control.className = "category-control";
        const label = document.createElement("button");
        label.type = "button";
        label.className = "category-chip";
        label.setAttribute("aria-label", translate("notebook.editCategory"));
        control.append(label);

        function showInput(currentValue) {
            const input = createTextInput("notebook.categoryPlaceholder", "category-input");
            attachSuggestions(input, getCategoryValues, () => closeInput(true));
            input.value = currentValue;
            input.setAttribute("aria-label", translate("notebook.category"));
            label.hidden = true;
            control.append(input);
            input.focus();
            input.select();

            let finished = false;
            function closeInput(commit) {
                if (finished) {
                    return;
                }
                finished = true;
                const nextValue = input.value.trim();
                input.remove();
                label.hidden = false;
                if (commit && nextValue !== currentValue) {
                    appApi.editField(note.id, "category", nextValue);
                    appApi.flush();
                    currentValue = nextValue;
                    updateCategoryLabel(label, currentValue);
                } else {
                    input.value = currentValue;
                }
            }

            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    closeInput(true);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeInput(false);
                }
            });
            input.addEventListener("blur", () => closeInput(true));
        }

        label.addEventListener("click", () => showInput(label.dataset.category || ""));
        updateCategoryLabel(label, note.category);
        return { element: control, label };
    }

    function createTagArea(noteId) {
        const area = document.createElement("div");
        area.className = "tag-area";
        const tagList = document.createElement("div");
        tagList.className = "tag-list";
        area.append(tagList);

        const addTagButton = createIconButton("notebook.addTag", "add-tag-button", "add", () => {
            tagInput.hidden = false;
            addTagButton.hidden = true;
            tagInput.value = "";
            tagInput.focus();
        });
        area.append(addTagButton);

        const tagInput = createTextInput("notebook.tagPlaceholder", "tag-input");
        tagInput.hidden = true;
        attachSuggestions(tagInput, getTagValues, () => {
            addTagFromInput(noteId, tagInput);
            closeTagInput();
        });
        tagInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addTagFromInput(noteId, tagInput);
                closeTagInput();
            } else if (event.key === "Escape") {
                event.preventDefault();
                closeTagInput();
            }
        });
        // Clicking away keeps what was typed or picked; Escape clears the value first.
        tagInput.addEventListener("blur", () => {
            addTagFromInput(noteId, tagInput);
            closeTagInput();
        });
        area.append(tagInput);

        function closeTagInput() {
            tagInput.hidden = true;
            addTagButton.hidden = false;
            tagInput.value = "";
        }

        return { element: area, list: tagList, input: tagInput, addButton: addTagButton };
    }

    function createCommentArea(noteId) {
        const area = document.createElement("div");
        area.className = "comment-area";
        const commentInput = document.createElement("textarea");
        commentInput.className = "p-input comment-input";
        commentInput.placeholder = translate("notebook.addCommentPlaceholder");
        commentInput.setAttribute("aria-label", translate("notebook.comment"));
        commentInput.rows = 1;
        commentInput.addEventListener("input", () => {
            appApi.editField(noteId, "comment", commentInput.value);
            resizeComment(commentInput);
        });
        commentInput.addEventListener("blur", () => {
            appApi.flush();
            if (!commentInput.value.trim()) {
                appApi.removeComment(noteId);
            }
        });
        area.append(commentInput);

        const removeCommentButton = createIconButton("notebook.removeComment", "remove-comment-button", null, () => {
            appApi.removeComment(noteId);
        });
        removeCommentButton.textContent = "×";
        area.append(removeCommentButton);
        const addCommentButton = createIconButton("notebook.addComment", "add-comment-button", "comment", () => {
            appApi.updateNote(noteId, { comment: "" });
            commentInput.hidden = false;
            removeCommentButton.hidden = false;
            addCommentButton.hidden = true;
            commentInput.focus();
        });
        return { element: area, input: commentInput, addButton: addCommentButton, removeButton: removeCommentButton };
    }

    function updateCard(cardRecord, note, searchText) {
        setInputValue(cardRecord.titleInput, note.title);
        updateCategoryLabel(cardRecord.categoryControl.label, note.category);
        updateLanguageOptions(cardRecord.languageSelect, note.content.language);
        updateTagList(cardRecord.tagArea.list, note);
        updateCommentArea(cardRecord.commentArea, note);
        updateDate(cardRecord.updatedDate, note.updatedDate);
        const viewState = model.viewStateForNote(note);
        const activeView = viewState.options.includes(viewState.selected) ? viewState.selected : "monaco";
        const hasPendingContentEdit = appApi.hasPendingEdit(note.id, "content.content");
        cardRecord.editor.update(note, searchText, hasPendingContentEdit);
        updateViewControls(cardRecord, note, viewState, activeView, searchText, hasPendingContentEdit);
        renderHighlight(cardRecord.titleHighlight, note.title, searchText);
        renderHighlight(cardRecord.commentHighlight, note.comment || "", searchText);
        cardRecord.expandButton.setAttribute("aria-expanded", String(note.id === expandedNoteId));
        updateIconButton(cardRecord.expandButton, note.id === expandedNoteId ? "notebook.collapse" : "notebook.expand", note.id === expandedNoteId ? "collapse" : "expand");
    }

    /**
     * Re-check which views (Code / Preview / Grid) a note offers after its content was edited in
     * place. Typed edits do not re-render cards (the host does not echo the board's own writes),
     * so without this a note that just became a JSON array would never show its Grid button.
     * Only the switch and notice change; the mounted editor, preview or grid is left alone.
     */
    function refreshViewOptions(noteId) {
        const cardRecord = cardsById.get(noteId);
        const note = appApi.getFilteredNotes().find((candidate) => candidate.id === noteId);
        if (!cardRecord || !note) {
            return;
        }
        const viewState = model.viewStateForNote(note);
        const activeView = viewState.options.includes(viewState.selected) ? viewState.selected : "monaco";
        // Never pull the user out of the view they are editing in.
        if (activeView !== (cardRecord.adapterView || "monaco")) {
            return;
        }
        updateViewSwitch(cardRecord, viewState, activeView);
    }

    function updateViewSwitch(cardRecord, viewState, activeView) {
        const availableViews = new Set(viewState.options);
        for (const [editorValue, button] of cardRecord.viewButtons) {
            button.hidden = !availableViews.has(editorValue);
            button.setAttribute("aria-pressed", String(editorValue === activeView));
            button.classList.toggle("selected", editorValue === activeView);
        }
        cardRecord.viewControls.hidden = availableViews.size === 0;
        cardRecord.viewNotice.textContent = viewState.noticeKey ? translate(viewState.noticeKey) : "";
        cardRecord.viewNotice.hidden = !viewState.noticeKey;
    }

    function updateViewControls(cardRecord, note, viewState, activeView, searchText, hasPendingContentEdit) {
        updateViewSwitch(cardRecord, viewState, activeView);
        cardRecord.element.classList.toggle("expanded-card", note.id === expandedNoteId);

        cardRecord.editor.view.dom.parentElement.hidden = activeView !== "monaco";
        if (cardRecord.adapterView !== activeView) {
            cardRecord.adapter?.destroy();
            cardRecord.adapter = null;
            cardRecord.adapterView = "";
            if (activeView === "md-view") {
                cardRecord.adapter = createPreview(cardRecord.contentHost, note.id, {
                    translate,
                    switchView: appApi.switchView,
                    showViewNotice: (message) => showViewNotice(cardRecord, message),
                });
                cardRecord.adapterView = activeView;
            } else if (activeView === "grid-json") {
                cardRecord.adapter = createGrid(
                    cardRecord.contentHost,
                    note,
                    note.id === expandedNoteId,
                    createGridApi(cardRecord),
                );
                cardRecord.adapterView = activeView;
            }
        }
        if (cardRecord.adapter && cardRecord.adapterView === activeView) {
            cardRecord.adapter.root.hidden = activeView === "monaco";
            if (activeView === "grid-json") {
                cardRecord.adapter.update(
                    note,
                    hasPendingContentEdit,
                    note.id === expandedNoteId,
                );
            } else {
                cardRecord.adapter.update(note.content.content, searchText);
            }
        }
    }

    function createGridApi(cardRecord) {
        return {
            ...appApi,
            showViewNotice: (message) => showViewNotice(cardRecord, message),
        };
    }

    function showViewNotice(cardRecord, message) {
        cardRecord.viewNotice.textContent = message;
        cardRecord.viewNotice.hidden = !message;
    }

    function updateCategoryLabel(label, category) {
        const categoryPath = String(category || "").split("/").map((part) => part.trim()).filter(Boolean).join(" / ");
        label.dataset.category = category || "";
        label.textContent = categoryPath || translate("notebook.noCategory");
        label.classList.toggle("category-empty", !categoryPath);
    }

    function updateDate(dateElement, value) {
        dateElement.dateTime = value || "";
        if (!value) {
            dateElement.textContent = "";
            return;
        }
        const parsedDate = new Date(value);
        const locale = window.persephone?.locale?.code || navigator.language;
        dateElement.textContent = Number.isNaN(parsedDate.getTime())
            ? value
            : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(parsedDate);
    }

    function updateLanguageOptions(select, currentLanguage) {
        if (![...select.options].some((option) => option.value === currentLanguage)) {
            select.append(createOption(currentLanguage, currentLanguage));
        }
        select.value = currentLanguage;
    }

    function updateTagList(tagList, note) {
        tagList.replaceChildren();
        for (const tagName of note.tags) {
            const chip = document.createElement("span");
            chip.className = "tag-chip";
            const label = document.createElement("button");
            label.type = "button";
            label.className = "tag-label";
            label.textContent = tagName;
            label.setAttribute("aria-label", translate("notebook.editTagNamed", { tag: tagName }));
            label.addEventListener("click", () => editTagLabel(note.id, tagName, label));
            chip.append(label);

            const removeButton = createIconButton("notebook.removeTag", "remove-tag-button", null, () => {
                appApi.removeTag(note.id, tagName);
            });
            removeButton.textContent = "×";
            removeButton.setAttribute("aria-label", translate("notebook.removeTagNamed", { tag: tagName }));
            chip.append(removeButton);
            tagList.append(chip);
        }
    }

    function editTagLabel(noteId, tagName, label) {
        const input = createTextInput("notebook.tagPlaceholder", "tag-input");
        attachSuggestions(input, getTagValues, () => finishEdit(true));
        input.value = tagName;
        input.setAttribute("aria-label", translate("notebook.editTagNamed", { tag: tagName }));
        label.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        function finishEdit(commit) {
            if (finished) {
                return;
            }
            finished = true;
            const nextTag = input.value.trim();
            if (commit && nextTag && nextTag !== tagName) {
                appApi.removeTag(noteId, tagName);
                appApi.addTag(noteId, nextTag);
            }
            input.replaceWith(label);
        }

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                finishEdit(true);
            } else if (event.key === "Escape") {
                event.preventDefault();
                finishEdit(false);
            }
        });
        input.addEventListener("blur", () => finishEdit(true));
    }

    function updateCommentArea(commentArea, note) {
        const hasComment = Object.prototype.hasOwnProperty.call(note, "comment");
        commentArea.input.hidden = !hasComment;
        commentArea.addButton.hidden = hasComment;
        commentArea.removeButton.hidden = !hasComment;
        if (hasComment) {
            setInputValue(commentArea.input, note.comment);
            resizeComment(commentArea.input);
        }
    }

    function updatePagination(totalCount) {
        const remainingCount = Math.max(0, totalCount - renderedLimit);
        loadMoreButton.textContent = translate("notebook.loadMore", { count: remainingCount });
        loadMoreButton.hidden = remainingCount === 0;
        listElement.append(loadMoreButton, sentinel);
        observer?.disconnect();
        if (remainingCount > 0) {
            observer?.observe(sentinel);
        }
    }

    function toggleExpanded(noteId) {
        appApi.flush();
        if (expandedNoteId === noteId) {
            collapseExpandedNote();
            return;
        }
        if (expandedNoteId) {
            collapseExpandedNote();
        }
        savedScrollTop = listElement.scrollTop;
        expandedNoteId = noteId;
        listElement.hidden = true;
        expandedElement.hidden = false;
        updateExpandedCard();
        cardsById.get(noteId)?.element.querySelector(".expand-button")?.focus();
    }

    function updateExpandedCard() {
        const cardRecord = cardsById.get(expandedNoteId);
        const note = appApi.getFilteredNotes().find((item) => item.id === expandedNoteId);
        if (cardRecord && cardRecord.element.parentElement !== expandedElement) {
            expandedElement.replaceChildren(cardRecord.element);
        }
        if (cardRecord && note) {
            updateCard(cardRecord, note, appApi.getSearchText());
        }
    }

    function collapseExpandedNote() {
        if (!expandedNoteId) {
            return;
        }
        const cardRecord = cardsById.get(expandedNoteId);
        cardRecord?.element.classList.remove("expanded-card");
        expandedNoteId = null;
        expandedElement.hidden = true;
        listElement.hidden = false;
        render();
        window.requestAnimationFrame(() => {
            listElement.scrollTop = savedScrollTop;
        });
    }

    function collapseOnEscape(event) {
        if (event.key === "Escape" && expandedNoteId) {
            event.preventDefault();
            collapseExpandedNote();
        }
    }

    function addTagFromInput(noteId, input) {
        const tagValue = input.value.trim();
        if (tagValue) {
            appApi.addTag(noteId, tagValue);
        }
    }

    return {
        render, reset, destroy, refreshSuggestions, refreshViewOptions,
        get expandedNoteId() { return expandedNoteId; },
        get renderedCount() { return Math.min(renderedLimit, appApi.getFilteredNotes().length); },
        loadMore: addNextPage,
        showAll() { renderedLimit = appApi.getFilteredNotes().length; render(); },
        expand(noteId) {
            const index = appApi.getFilteredNotes().findIndex((note) => note.id === noteId);
            if (index < 0) throw new Error("Note is not in the current filtered view.");
            renderedLimit = Math.max(renderedLimit, index + 1);
            render();
            if (expandedNoteId !== noteId) toggleExpanded(noteId);
        },
        collapse: collapseExpandedNote,
    };
}

function createTextInput(placeholderKey, className) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = `p-input ${className}`;
    input.placeholder = translate(placeholderKey);
    input.setAttribute("aria-label", translate(placeholderKey));
    return input;
}

function createIconButton(labelKey, className, iconName, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `p-btn icon-button ${className}`;
    button.addEventListener("click", onClick);
    if (iconName) {
        button.append(createIcon(iconName));
    }
    updateIconButton(button, labelKey, iconName);
    return button;
}

function updateIconButton(button, labelKey, iconName) {
    const label = translate(labelKey);
    button.title = label;
    button.setAttribute("aria-label", label);
    if (iconName) {
        button.replaceChildren(createIcon(iconName));
    }
}

function createIcon(iconName) {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.7");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", ICON_PATHS[iconName]);
    icon.append(path);
    return icon;
}

function createOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
}

function setInputValue(input, value) {
    if (document.activeElement !== input) {
        input.value = value || "";
    }
}

function resizeComment(textarea) {
    textarea.style.height = "auto";
    const contentHeight = Math.min(textarea.scrollHeight, MAX_COMMENT_HEIGHT);
    textarea.style.height = `${contentHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_COMMENT_HEIGHT ? "auto" : "hidden";
}

function renderHighlight(container, text, query) {
    container.replaceChildren();
    const searchWords = String(query || "").trim().split(/\s+/).filter(Boolean);
    const escapedWords = searchWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (escapedWords.length === 0) {
        container.hidden = true;
        return;
    }

    const matcher = new RegExp(`(${escapedWords.join("|")})`, "gi");
    let lastIndex = 0;
    for (const match of text.matchAll(matcher)) {
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
            container.append(document.createTextNode(text.slice(lastIndex, matchIndex)));
        }
        const mark = document.createElement("mark");
        mark.textContent = match[0];
        container.append(mark);
        lastIndex = matchIndex + match[0].length;
    }
    if (lastIndex < text.length) {
        container.append(document.createTextNode(text.slice(lastIndex)));
    }
    container.hidden = text.length === 0;
}

