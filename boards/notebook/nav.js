// Notebook navigation: category tree, tag vocabulary and format-preserving operations.

import * as model from "./model.js";
import { translate } from "./i18n.js";

/** Start the navigation frame and subscribe before loading hosted content. */
export function startNavigation(root, api) {
    let data = null;
    let selection = {};
    let dragPath = "";
    let editing = false;
    const panel = document.createElement("div");
    panel.className = "navigation";
    const error = document.createElement("div");
    error.className = "error-message";
    error.setAttribute("role", "alert");
    error.hidden = true;
    const content = document.createElement("div");
    const dialog = document.createElement("dialog");
    dialog.className = "delete-dialog";
    panel.append(error, content, dialog);
    root.replaceChildren(panel);

    api.state.onChange((state) => {
        const previousCategory = selection.selectedCategory;
        selection = state;
        if (data && state.activeFilter === "categories" && state.selectedCategory !== previousCategory) {
            const collapsed = state.collapsedCategories || [];
            const visible = collapsed.filter((path) => !state.selectedCategory?.startsWith(`${path}/`));
            if (visible.length !== collapsed.length) {
                api.state.merge({ collapsedCategories: visible });
            }
        }
        if (!editing) render();
    });
    api.host.onContentChange(receiveContent);
    api.host.getContent().then(receiveContent).catch(showError);

    function receiveContent(text) {
        const parsed = model.parseNotebook(text);
        data = parsed.data || null;
        if (parsed.error) {
            error.textContent = translate(parsed.error.key, parsed.error.parameters);
            error.hidden = false;
        } else {
            error.hidden = true;
        }
        if (!editing) render();
    }

    function showError(problem) {
        error.textContent = translate("notebook.saveError", { error: problem.message || String(problem) });
        error.hidden = false;
    }

    function selectCategory(path) {
        const collapsed = new Set(selection.collapsedCategories || []);
        const parts = path.split("/");
        for (let index = 1; index < parts.length; index += 1) collapsed.delete(parts.slice(0, index).join("/"));
        api.state.merge({ activeFilter: "categories", selectedCategory: path, selectedTag: "", collapsedCategories: [...collapsed] });
    }

    function selectTag(tag) {
        api.state.merge({ activeFilter: "tags", selectedCategory: "", selectedTag: tag });
    }

    function render() {
        const focused = document.activeElement;
        const focusKey = content.contains(focused) ? focused.dataset.focusKey : "";
        content.replaceChildren();
        if (!data) return;
        const vocabulary = model.vocabulary(data);
        const collapsed = new Set(selection.collapsedCategories || []);
        const categoryHeading = document.createElement("h2");
        categoryHeading.textContent = translate("notebook.categories");
        content.append(categoryHeading);
        content.append(categoryRow("", translate("notebook.allNotes"), 0, vocabulary, collapsed));
        for (const path of vocabulary.categories) {
            const parts = path.split("/");
            if (parts.some((part, index) => index < parts.length - 1 && collapsed.has(parts.slice(0, index + 1).join("/")))) continue;
            content.append(categoryRow(path, parts.at(-1), parts.length, vocabulary, collapsed));
        }
        const tagHeading = document.createElement("h2");
        tagHeading.textContent = translate("notebook.tags");
        content.append(tagHeading);
        const namespaces = new Set(vocabulary.tags.filter((tag) => tag.includes(":")).map((tag) => tag.slice(0, tag.indexOf(":") + 1)));
        const rows = [...new Set([...vocabulary.tags.filter((tag) => !tag.includes(":")), ...namespaces])].sort();
        for (const tag of rows) {
            if (namespaces.has(tag)) {
                content.append(tagRow(tag, tag, true, vocabulary.tags.includes(tag), 0));
                for (const child of vocabulary.tags.filter((item) => item.startsWith(tag) && item !== tag)) {
                    content.append(tagRow(child, child.slice(tag.length), false, true, 1));
                }
            } else content.append(tagRow(tag, tag, false, true, 0));
        }
        if (focusKey) {
            [...content.querySelectorAll("[data-focus-key]")].find((element) => element.dataset.focusKey === focusKey)?.focus();
        }
    }

    function makeRow(label, count, selected, depth, onSelect) {
        const row = document.createElement("div");
        row.className = "nav-row";
        row.style.paddingLeft = `${depth * 14}px`;
        row.classList.toggle("selected", selected);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "nav-label";
        button.textContent = label;
        button.addEventListener("click", onSelect);
        const counter = document.createElement("span");
        counter.className = "nav-count";
        counter.textContent = String(count);
        row.append(button, counter);
        return row;
    }

    function categoryRow(path, label, depth, vocabulary, collapsed) {
        const count = path ? data.notes.filter((note) => model.inCategory(note.category, path)).length : data.notes.length;
        const row = makeRow(label, count, selection.activeFilter === "categories" && (selection.selectedCategory || "") === path, depth, () => selectCategory(path));
        row.querySelector(".nav-label").dataset.focusKey = `category:${path}`;
        const hasChildren = path && vocabulary.categories.some((candidate) => candidate.startsWith(`${path}/`));
        if (!hasChildren) {
            // Keeps labels aligned with rows that have a chevron, like the file tree's stub.
            const stub = document.createElement("span");
            stub.className = "nav-toggle-stub";
            row.prepend(stub);
        } else {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "nav-toggle";
            toggle.dataset.focusKey = `toggle:${path}`;
            toggle.append(createNavIcon(collapsed.has(path) ? "chevronRight" : "chevronDown"));
            toggle.setAttribute("aria-label", translate(collapsed.has(path) ? "notebook.expandCategory" : "notebook.collapseCategory", { category: path }));
            toggle.setAttribute("aria-expanded", String(!collapsed.has(path)));
            toggle.addEventListener("click", () => {
                const next = new Set(selection.collapsedCategories || []);
                if (next.has(path)) next.delete(path); else next.add(path);
                api.state.merge({ collapsedCategories: [...next] });
            });
            row.prepend(toggle);
        }
        if (path) {
            row.draggable = true;
            row.addEventListener("dragstart", (event) => {
                dragPath = path;
                event.dataTransfer.setData("text/x-notebook-category", path);
                event.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragend", () => { dragPath = ""; });
            addRename(row, path.split("/").at(-1), (value) => {
                if (!value || value.includes("/") || value === path.split("/").at(-1)) return;
                const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
                changeCategory(path, parent + value, false);
            });
        }
        row.addEventListener("dragover", (event) => {
            if (dragPath && dragPath !== path && !model.inCategory(path, dragPath)) event.preventDefault();
        });
        row.addEventListener("drop", (event) => {
            if (!dragPath || !event.dataTransfer.types.includes("text/x-notebook-category")) return;
            event.preventDefault();
            const source = dragPath;
            dragPath = "";
            const destination = (path ? `${path}/` : "") + source.split("/").at(-1);
            if (source !== destination && source !== path && !model.inCategory(path, source)) changeCategory(source, destination, true);
        });
        return row;
    }

    function tagRow(tag, label, namespace, actual, depth) {
        const count = data.notes.filter((note) => namespace ? note.tags.some((item) => item.startsWith(tag)) : note.tags.includes(tag)).length;
        const row = makeRow(label, count, selection.activeFilter === "tags" && selection.selectedTag === tag, depth, () => selectTag(tag));
        row.querySelector(".nav-label").dataset.focusKey = `tag:${tag}`;
        // Tags have no children to toggle; the stub aligns them with the category rows.
        const stub = document.createElement("span");
        stub.className = "nav-toggle-stub";
        row.prepend(stub);
        if (actual) addRename(row, tag, (value) => {
            if (value && value !== tag) changeTag(tag, value);
        });
        return row;
    }

    function addRename(row, initial, commit) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "nav-action";
        button.append(createNavIcon("edit"));
        button.setAttribute("aria-label", translate("notebook.renameNamed", { name: initial }));
        button.addEventListener("click", () => {
            editing = true;
            const label = row.querySelector(".nav-label");
            const input = document.createElement("input");
            input.className = "p-input nav-input";
            input.value = initial;
            input.setAttribute("aria-label", translate("notebook.renameNamed", { name: initial }));
            label.replaceWith(input);
            input.focus();
            input.select();
            let finished = false;
            function finish(accept) {
                if (finished) return;
                finished = true;
                editing = false;
                if (accept) commit(input.value.trim());
                render();
            }
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); finish(true); }
                if (event.key === "Escape") { event.preventDefault(); finish(false); }
            });
            input.addEventListener("blur", () => finish(true));
        });
        // Before the count, so the count column stays aligned whether or not a row is editable.
        row.insertBefore(button, row.querySelector(".nav-count"));
    }

    async function latest() {
        const parsed = model.parseNotebook(await api.host.getContent());
        if (parsed.error) throw new Error(translate(parsed.error.key, parsed.error.parameters));
        return parsed.data;
    }

    async function changeCategory(from, destination, moving) {
        try {
            let current = await latest();
            let count = current.notes.filter((note) => model.inCategory(note.category, from)).length;
            if (!count) return;
            const collision = model.vocabulary(current).categories.includes(destination);
            if (moving || collision) {
                const message = translate(collision ? "notebook.confirmMerge" : "notebook.moveNote", { count, fromCategory: from, newCategory: destination });
                if (!await confirmChange(message)) return;
            }
            current = await latest();
            count = current.notes.filter((note) => model.inCategory(note.category, from)).length;
            if (!count) return;
            const updated = model.renameCategory(current, from, destination);
            await api.host.setContent(model.serializeNotebook(updated));
            data = updated;
            const patch = {};
            if (selection.activeFilter === "categories" && model.inCategory(selection.selectedCategory || "", from)) {
                patch.selectedCategory = destination + selection.selectedCategory.slice(from.length);
            }
            const collapsed = (selection.collapsedCategories || []).map((path) => model.inCategory(path, from) ? destination + path.slice(from.length) : path);
            const selectedPath = patch.selectedCategory || "";
            patch.collapsedCategories = collapsed.filter((path) => !selectedPath.startsWith(`${path}/`));
            api.state.merge(patch);
            render();
        } catch (problem) { showError(problem); }
    }

    async function changeTag(from, destination) {
        try {
            const current = await latest();
            const updated = model.renameTag(current, from, destination);
            if (updated === current) return;
            await api.host.setContent(model.serializeNotebook(updated));
            data = updated;
            render();
            if (selection.activeFilter === "tags" && selection.selectedTag === from) api.state.merge({ selectedTag: destination });
        } catch (problem) { showError(problem); }
    }

    function confirmChange(message) {
        return new Promise((resolve) => {
            dialog.replaceChildren();
            const text = document.createElement("p");
            text.textContent = message;
            const actions = document.createElement("div");
            actions.className = "dialog-actions";
            for (const [label, value] of [["notebook.cancel", "cancel"], ["notebook.confirm", "confirm"]]) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "p-btn";
                button.textContent = translate(label);
                button.addEventListener("click", () => dialog.close(value));
                actions.append(button);
            }
            dialog.append(text, actions);
            dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
            dialog.returnValue = "cancel";
            dialog.showModal();
        });
    }
}

// Persephone's own glyphs (theme/icons.ts): the file tree's chevrons and the edit pencil.
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const NAV_ICONS = {
    chevronRight: {
        viewBox: "0 0 16 16",
        markup: '<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M5.17574 12.8373C4.94142 12.6203 4.94142 12.2686 5.17574 12.0516L9.55147 8L5.17574 3.94839C4.94142 3.73143 4.94142 3.37968 5.17574 3.16272C5.41005 2.94576 5.78995 2.94576 6.02426 3.16272L10.8243 7.60716C11.0586 7.82412 11.0586 8.17588 10.8243 8.39284L6.02426 12.8373C5.78995 13.0542 5.41005 13.0542 5.17574 12.8373Z"/>',
    },
    chevronDown: {
        viewBox: "0 0 16 16",
        markup: '<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M3.16272 5.17574C3.37968 4.94142 3.73143 4.94142 3.94839 5.17574L8 9.55147L12.0516 5.17574C12.2686 4.94142 12.6203 4.94142 12.8373 5.17574C13.0542 5.41005 13.0542 5.78995 12.8373 6.02426L8.39284 10.8243C8.17588 11.0586 7.82412 11.0586 7.60716 10.8243L3.16272 6.02426C2.94576 5.78995 2.94576 5.41005 3.16272 5.17574Z"/>',
    },
    edit: {
        viewBox: "0 0 24 24",
        markup: '<path d="M12 20h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    },
};

function createNavIcon(name) {
    const icon = NAV_ICONS[name];
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", icon.viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    // Static markup from the constants above, never from user data.
    svg.innerHTML = icon.markup;
    return svg;
}

