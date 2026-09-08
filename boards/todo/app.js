// Persephone Boards — Todo board (loaded via board:///app.js).
//
// A content-host board that reimplements the built-in Todo editor. ONE file serves
// both frames, branched on `persephone.view`:
//   • "main"  — the todo list (quick-add, items, search, filter).
//   • "lists" — the "Lists & Tags" sidebar panel (list/tag CRUD + selection).
//
// Content (the .todo.json file) flows through `persephone.host.*` ONLY — never
// readFile/writeFile. Cross-frame UI coupling (which list/tag is selected, the
// search text) flows through `persephone.state.*`. The main view owns the
// authoritative state.init(); every frame reads via onChange and computes its own
// view from the shared parsed data + shared selection.
(() => {
    const P = window.persephone;
    const role = (P && P.view) || "main"; // "main" | "lists"

    // ── Data model ──────────────────────────────────────────────────────
    // On disk: { type: "todo-editor", lists, tags, items, state }, 4-space JSON.
    function emptyTodoData() {
        return { lists: [], tags: [], items: [], state: {} };
    }

    let data = emptyTodoData();
    let parseError = false;

    // The last content we wrote to (or read from) the host, so writeNow() can skip a no-op write —
    // e.g. clicking into an item field and out again without typing must NOT mark the page modified.
    let lastWritten = null;

    // Selection/search mirror — updated from persephone.state.onChange (source of truth).
    let sel = { selectedList: "", selectedTag: "", searchText: "" };

    // Inline-edit state for the lists panel: { kind: "list"|"tag", name } | null.
    let editing = null;

    // Which item field (in the main view) is currently being edited: an item title/comment
    // renders as a highlighted read-only view by default and swaps to a <textarea> only while
    // edited. Tracked here (not just in the DOM) so a cross-frame re-render keeps it editable.
    // { itemId, field: "title" | "comment" } | null.
    let editingField = null;

    const uuid = () =>
        (crypto && crypto.randomUUID && crypto.randomUUID()) ||
        "id-" + Math.abs(Date.now() ^ (performance.now() * 1000)).toString(36);

    function normalizeItem(raw) {
        const it = raw && typeof raw === "object" ? raw : {};
        return {
            id: typeof it.id === "string" && it.id ? it.id : uuid(),
            list: typeof it.list === "string" ? it.list : "",
            title: typeof it.title === "string" ? it.title : "",
            done: it.done === true,
            createdDate: typeof it.createdDate === "string" ? it.createdDate : new Date().toISOString(),
            doneDate: typeof it.doneDate === "string" ? it.doneDate : null,
            comment: it.comment === undefined ? null : it.comment,
            tag: it.tag || null,
        };
    }

    // Parse raw file content into TodoData, applying the built-in's normalization rules.
    // Never throws — on invalid JSON it flags parseError and keeps the last good data.
    function parse(text) {
        parseError = false;
        if (!text || !text.trim()) return emptyTodoData();
        let obj;
        try {
            obj = JSON.parse(text);
        } catch {
            parseError = true;
            return data; // keep last good — never clobber a hand-broken file
        }
        if (!obj || typeof obj !== "object") return emptyTodoData();

        const lists = [];
        if (Array.isArray(obj.lists)) {
            for (const l of obj.lists) {
                const name = String(l);
                if (!lists.includes(name)) lists.push(name);
            }
        }
        const tags = [];
        const tagSeen = new Set();
        if (Array.isArray(obj.tags)) {
            for (const t of obj.tags) {
                if (!t || typeof t !== "object") continue;
                const name = typeof t.name === "string" ? t.name.trim() : "";
                if (!name || tagSeen.has(name)) continue;
                tagSeen.add(name);
                tags.push({ name, color: typeof t.color === "string" ? t.color : "" });
            }
        }
        const items = Array.isArray(obj.items) ? obj.items.map(normalizeItem) : [];

        // Orphan auto-add: any referenced list/tag missing from the declarations is added.
        for (const it of items) {
            if (it.list && !lists.includes(it.list)) lists.push(it.list);
            if (it.tag && !tagSeen.has(it.tag)) {
                tagSeen.add(it.tag);
                tags.push({ name: it.tag, color: "" });
            }
        }

        const state = obj.state && typeof obj.state === "object" ? obj.state : {};
        return { lists, tags, items, state };
    }

    function serialize(d) {
        return JSON.stringify(
            { type: "todo-editor", lists: d.lists, tags: d.tags, items: d.items, state: d.state },
            null,
            4,
        );
    }

    // ── Content host wiring ─────────────────────────────────────────────
    let writeTimer = null;

    // Debounced write for free-text edits (title/comment) so a keystroke doesn't
    // round-trip per character. Discrete actions call writeNow() directly.
    function writeSoon() {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(writeNow, 300);
    }
    function writeNow() {
        if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
        }
        const text = serialize(data);
        // Nothing actually changed (e.g. focus + blur with no edit) — don't touch the host, so the
        // page's modified flag stays clean.
        if (text === lastWritten) return;
        try {
            P.host.setContent(text);
            lastWritten = text;
        } catch (e) {
            P.notify("Todo board: failed to save — " + (e && e.message ? e.message : e), "error");
        }
    }

    // ── Shared state (selection + search) ───────────────────────────────
    function wireState() {
        if (role === "main") {
            // Only the main view declares the authoritative defaults + restorable keys.
            // selectedList/selectedTag persist across restart/reload; searchText is transient.
            P.state.init(
                { selectedList: "", selectedTag: "", searchText: "" },
                { restorableKeys: ["selectedList", "selectedTag"] },
            );
        }
        P.state.onChange((s) => {
            sel = {
                selectedList: typeof s.selectedList === "string" ? s.selectedList : "",
                selectedTag: typeof s.selectedTag === "string" ? s.selectedTag : "",
                searchText: typeof s.searchText === "string" ? s.searchText : "",
            };
            render();
        });
    }
    const setSelectedList = (name) => P.state.merge({ selectedList: name });
    const setSelectedTag = (name) => P.state.merge({ selectedTag: name });
    const setSearchText = (v) => P.state.merge({ searchText: v });

    // ── Derived (pure) ──────────────────────────────────────────────────
    function filteredItems() {
        let items = data.items.slice();
        if (sel.selectedList) items = items.filter((i) => i.list === sel.selectedList);
        if (sel.selectedTag) items = items.filter((i) => i.tag === sel.selectedTag);
        const q = (sel.searchText || "").trim().toLowerCase();
        if (q) {
            const words = q.split(/\s+/);
            items = items.filter((i) => {
                const hay = `${i.title} ${i.comment || ""} ${i.list} ${i.tag || ""}`.toLowerCase();
                return words.every((w) => hay.includes(w));
            });
        }
        // Undone first (stable), then done by doneDate descending.
        const undone = items.filter((i) => !i.done);
        const done = items
            .filter((i) => i.done)
            .sort((a, b) => String(b.doneDate || "").localeCompare(String(a.doneDate || "")));
        return { undone, done };
    }

    function listCounts() {
        const counts = { "": { undone: 0, total: 0 } };
        for (const l of data.lists) counts[l] = { undone: 0, total: 0 };
        for (const i of data.items) {
            counts[""].total++;
            if (!i.done) counts[""].undone++;
            const c = counts[i.list];
            if (c) {
                c.total++;
                if (!i.done) c.undone++;
            }
        }
        return counts;
    }

    // ── Mutations ───────────────────────────────────────────────────────
    const item = (id) => data.items.find((i) => i.id === id);

    function addItem(title, listName = sel.selectedList) {
        const t = title.trim();
        if (!t || !listName) return null;
        const created = {
            id: uuid(),
            list: listName,
            title: t,
            done: false,
            createdDate: new Date().toISOString(),
            doneDate: null,
            comment: null,
            tag: null,
        };
        data.items.push(created);
        writeNow();
        render();
        return created;
    }
    function toggleItem(id) {
        const it = item(id);
        if (!it) return;
        it.done = !it.done;
        it.doneDate = it.done ? new Date().toISOString() : null;
        writeNow();
        render();
    }
    function updateItemTitle(id, v) {
        const it = item(id);
        if (!it) return;
        it.title = v;
        writeSoon(); // debounced; no local re-render (the field already shows the value)
    }
    function setItemComment(id, v) {
        const it = item(id);
        if (!it) return;
        it.comment = v;
        writeSoon();
    }
    function addComment(id) {
        const it = item(id);
        if (!it) return;
        it.comment = "";
        editingField = { itemId: id, field: "comment" }; // open the new comment straight in edit mode
        writeNow();
        render();
        const ta = document.querySelector(`textarea.item-comment[data-item-id="${id}"][data-field="comment"]`);
        if (ta) ta.focus();
    }
    function setItemTag(id, name) {
        const it = item(id);
        if (!it) return;
        it.tag = name || null;
        writeNow();
        render();
    }
    // The core lets the AiVision method delete immediately without blocking on the in-board dialog.
    function deleteItemCore(id) {
        data.items = data.items.filter((i) => i.id !== id);
        if (data.state) delete data.state[id];
        writeNow();
        render();
    }
    async function deleteItem(id) {
        const it = item(id);
        if (!it) return;
        if (!(await confirmAction(`Delete "${it.title || "this item"}"?`))) return;
        deleteItemCore(id);
    }

    function addList(name) {
        const n = name.trim();
        if (!n || data.lists.includes(n)) return;
        data.lists.push(n);
        writeNow();
        setSelectedList(n); // auto-select the new list (triggers render via onChange)
        render();
    }
    function renameList(oldName, newName) {
        const n = newName.trim();
        if (!n || n === oldName) return;
        if (!data.lists.includes(oldName) || data.lists.includes(n)) return;
        data.lists = data.lists.map((l) => (l === oldName ? n : l));
        for (const i of data.items) if (i.list === oldName) i.list = n;
        writeNow();
        if (sel.selectedList === oldName) setSelectedList(n);
        render();
    }
    // The core lets the AiVision method delete immediately without blocking on the in-board dialog.
    function deleteListCore(name) {
        data.lists = data.lists.filter((l) => l !== name);
        for (const i of data.items) if (i.list === name) i.list = "";
        writeNow();
        if (sel.selectedList === name) setSelectedList("");
        render();
    }
    async function deleteList(name) {
        if (!(await confirmAction(`Delete list "${name}"? Its items become unassigned.`))) return;
        deleteListCore(name);
    }

    function addTag(name) {
        const n = name.trim();
        if (!n || data.tags.some((t) => t.name === n)) return;
        data.tags.push({ name: n, color: "" });
        writeNow();
        render();
    }
    function renameTag(oldName, newName) {
        const n = newName.trim();
        if (!n || n === oldName) return;
        if (!data.tags.some((t) => t.name === oldName) || data.tags.some((t) => t.name === n)) return;
        data.tags = data.tags.map((t) => (t.name === oldName ? { ...t, name: n } : t));
        for (const i of data.items) if (i.tag === oldName) i.tag = n;
        writeNow();
        if (sel.selectedTag === oldName) setSelectedTag(n);
        render();
    }
    function setTagColor(name, color) {
        const t = data.tags.find((x) => x.name === name);
        if (!t) return;
        t.color = color;
        writeNow();
        render();
    }
    // The core lets the AiVision method delete immediately without blocking on the in-board dialog.
    function deleteTagCore(name) {
        data.tags = data.tags.filter((t) => t.name !== name);
        for (const i of data.items) if (i.tag === name) i.tag = null;
        writeNow();
        if (sel.selectedTag === name) setSelectedTag("");
        render();
    }
    async function deleteTag(name) {
        if (!(await confirmAction(`Delete tag "${name}"?`))) return;
        deleteTagCore(name);
    }

    // ── AiVision surface ────────────────────────────────────────────────────────────────────────
    // This is kept behind the host check so the board remains usable when opened standalone.
    let registerAiVision = () => {};
    let refreshAiVision = () => {};
    let remoteAiVision = null;
    let aiVisionShape = null;
    const aiVision = P && P.aiVision;
    if (aiVision) {
        const elementDeclarations = [
            {
                name: "quick-add-input", view: "main",
                purpose: "The box that adds an item to the selected list: type a title and press Enter.",
                where: "Under the header in the main todo list.",
            },
            {
                name: "search", view: "main",
                purpose: "Free-text search over item titles, comments, list names and tag names.",
                where: "Right-hand side of the main header.",
            },
            {
                name: "list-switch", view: "main",
                purpose: "The \"List:\" button that chooses which list the main view shows.",
                where: "Left-hand side of the main header.",
            },
            {
                name: "add-list", view: "lists",
                purpose: "The \"New list\u2026\" box and its + button, for creating a list by hand.",
                where: "Top of the \"Lists & Tags\" sidebar panel.",
            },
            {
                name: "add-tag", view: "lists",
                purpose: "The \"New tag\u2026\" box and its + button, for creating a tag by hand.",
                where: "Bottom of the \"Lists & Tags\" sidebar panel.",
            },
            {
                name: "lists", view: "lists",
                purpose: "Every list with its undone/total counts; clicking one filters the main view.",
                where: "\"Lists\" section of the \"Lists & Tags\" sidebar panel.",
            },
            {
                name: "tags", view: "lists",
                purpose: "Every tag with its colour; clicking one filters the main view.",
                where: "\"Tags\" section of the \"Lists & Tags\" sidebar panel.",
            },
        ];
        const elementParts = aiVision.createElements(elementDeclarations);

        const itemSummary = (it) => ({
            kind: "TodoItem", id: it.id, title: it.title, list: it.list, tag: it.tag,
            done: it.done, comment: it.comment,
        });
        const makeTodoItem = (id) => ({
            aiVision: {
                kind: "TodoItem",
                summary: "One todo item. Its id is the stable identifier every ...Item method takes.",
                members: [
                    { name: "id", kind: "property", summary: "Stable item id; pass this to every ...Item method." },
                    { name: "title", kind: "property", summary: "The item's title." },
                    { name: "list", kind: "property", summary: "The list containing the item, or an empty string." },
                    { name: "tag", kind: "property", summary: "The item's tag name, or null." },
                    { name: "done", kind: "property", summary: "Whether the item is complete." },
                    { name: "comment", kind: "property", summary: "The item's comment, or null." },
                    { name: "createdDate", kind: "property", summary: "ISO timestamp when the item was created." },
                    { name: "doneDate", kind: "property", summary: "ISO timestamp when completed, or null." },
                ],
                summarize: () => {
                    const it = item(id);
                    return it ? itemSummary(it) : undefined;
                },
            },
            get id() { return item(id)?.id; },
            get title() { return item(id)?.title; },
            get list() { return item(id)?.list; },
            get tag() { return item(id)?.tag; },
            get done() { return item(id)?.done; },
            get comment() { return item(id)?.comment; },
            get createdDate() { return item(id)?.createdDate; },
            get doneDate() { return item(id)?.doneDate; },
        });
        const shownItems = () => {
            const shown = filteredItems();
            return shown.undone.concat(shown.done);
        };
        const itemsNode = {
            aiVision: {
                kind: "TodoItems",
                summary: "The filtered, ordered items. The filter comes from selectedList, selectedTag and searchText; clear those to show everything.",
                members: [
                    { name: "count", kind: "property", summary: "Number of items currently shown." },
                    { name: "totalCount", kind: "property", summary: "Number of all items in the file, before filtering." },
                ],
                index: (key) => {
                    const all = shownItems();
                    if (typeof key === "number") return all[key] ? makeTodoItem(all[key].id) : undefined;
                    if (typeof key === "string") return item(key) ? makeTodoItem(key) : undefined;
                    return undefined;
                },
                summarize: () => shownItems().map(itemSummary),
            },
            get count() { return shownItems().length; },
            get totalCount() { return data.items.length; },
        };
        const listSummary = (name) => {
            const counts = listCounts()[name] || { total: 0, undone: 0 };
            return { kind: "TodoList", name, total: counts.total, undone: counts.undone };
        };
        const makeTodoList = (name) => ({
            aiVision: {
                kind: "TodoList",
                summary: "One list and its item counts.",
                members: [
                    { name: "name", kind: "property", summary: "The list name." },
                    { name: "total", kind: "property", summary: "Total items assigned to this list." },
                    { name: "undone", kind: "property", summary: "Incomplete items assigned to this list." },
                ],
                summarize: () => listSummary(name),
            },
            get name() { return data.lists.includes(name) ? name : undefined; },
            get total() { return listCounts()[name]?.total || 0; },
            get undone() { return listCounts()[name]?.undone || 0; },
        });
        const listsNode = {
            aiVision: {
                kind: "TodoLists",
                summary: "Every list in the file, with total and undone item counts.",
                members: [{ name: "count", kind: "property", summary: "Number of lists." }],
                index: (key) => {
                    if (typeof key === "number") {
                        const name = data.lists[key];
                        return name === undefined ? undefined : makeTodoList(name);
                    }
                    if (typeof key === "string") return data.lists.includes(key) ? makeTodoList(key) : undefined;
                    return undefined;
                },
                summarize: () => data.lists.map(listSummary),
            },
            get count() { return data.lists.length; },
        };
        const tagSummary = (name) => {
            const tag = data.tags.find((t) => t.name === name);
            return {
                kind: "TodoTag", name, color: tag ? tag.color : "",
                count: data.items.filter((it) => it.tag === name).length,
            };
        };
        const makeTodoTag = (name) => ({
            aiVision: {
                kind: "TodoTag",
                summary: "One tag, its colour, and the number of items carrying it.",
                members: [
                    { name: "name", kind: "property", summary: "The tag name." },
                    { name: "color", kind: "property", summary: "The tag colour, or an empty string." },
                    { name: "count", kind: "property", summary: "Number of items carrying this tag." },
                ],
                summarize: () => tagSummary(name),
            },
            get name() { return data.tags.some((t) => t.name === name) ? name : undefined; },
            get color() { return data.tags.find((t) => t.name === name)?.color || ""; },
            get count() { return data.items.filter((it) => it.tag === name).length; },
        });
        const tagsNode = {
            aiVision: {
                kind: "TodoTags",
                summary: "Every tag in the file, with its colour and item count.",
                members: [{ name: "count", kind: "property", summary: "Number of tags." }],
                index: (key) => {
                    if (typeof key === "number") {
                        const tag = data.tags[key];
                        return tag === undefined ? undefined : makeTodoTag(tag.name);
                    }
                    if (typeof key === "string") return data.tags.some((t) => t.name === key) ? makeTodoTag(key) : undefined;
                    return undefined;
                },
                summarize: () => data.tags.map((t) => tagSummary(t.name)),
            },
            get count() { return data.tags.length; },
        };
        const quotedNames = (names) => names.map((name) => `"${name}"`).join(", ") || "(none)";
        const unknownItem = (id) => new Error(`No item with id "${id}". Read items[n].id for the ids currently shown.`);
        const unknownList = (name) => new Error(`No list named "${name}". Lists: ${quotedNames(data.lists)}. Add it with addList("${name}").`);
        const unknownTag = (name) => new Error(`No tag named "${name}". Tags: ${quotedNames(data.tags)}. Add it with addTag("${name}").`);
        const exposedItem = (id) => {
            const itemId = String(id);
            const it = item(itemId);
            if (!it) throw unknownItem(itemId);
            return it;
        };
        const exposedAddItem = (title, list) => {
            const titleText = title == null ? "" : String(title);
            if (!titleText.trim()) throw new Error('addItem needs a non-empty title, for example addItem("Buy milk", "Groceries").');
            const listName = list === undefined ? sel.selectedList : String(list);
            if (!listName) throw new Error('No list to add to. Pass a list name \u2014 addItem("\u2026", "Groceries") \u2014 or set selectedList first.');
            if (!data.lists.includes(listName)) throw new Error(`No list named "${listName}". Create it with addList("${listName}") first.`);
            return addItem(titleText, listName).id;
        };
        const exposedToggleItem = (id) => {
            const it = exposedItem(id);
            toggleItem(it.id);
            return it.done;
        };
        const exposedSetItemTitle = (id, title) => {
            const it = exposedItem(id);
            it.title = title == null ? "" : String(title);
            writeNow();
            render();
            return it.title;
        };
        const exposedSetItemComment = (id, comment) => {
            const it = exposedItem(id);
            it.comment = comment == null || comment === "" ? null : String(comment);
            writeNow();
            render();
            return it.comment;
        };
        const exposedSetItemTag = (id, tag) => {
            const it = exposedItem(id);
            const tagName = tag == null ? null : String(tag).trim() || null;
            if (tagName && !data.tags.some((t) => t.name === tagName)) data.tags.push({ name: tagName, color: "" });
            setItemTag(it.id, tagName);
            return it.tag;
        };
        const exposedDeleteItem = (id) => {
            const it = exposedItem(id);
            deleteItemCore(it.id);
            return true;
        };
        const exposedAddList = (name) => {
            const listName = name == null ? "" : String(name).trim();
            if (!listName) throw new Error("addList needs a non-empty name.");
            if (data.lists.includes(listName)) throw new Error(`List "${listName}" already exists. Choose another name or use renameList.`);
            addList(listName);
            return listName;
        };
        const exposedRenameList = (from, to) => {
            const fromName = String(from);
            const toName = to == null ? "" : String(to).trim();
            if (!data.lists.includes(fromName)) throw unknownList(fromName);
            if (!toName || data.lists.includes(toName)) throw new Error(`Cannot rename list "${fromName}" to "${toName}". Choose a new name with renameList.`);
            renameList(fromName, toName);
            return toName;
        };
        const exposedDeleteList = (name) => {
            const listName = String(name);
            if (!data.lists.includes(listName)) throw unknownList(listName);
            deleteListCore(listName);
            return true;
        };
        const exposedAddTag = (name) => {
            const tagName = name == null ? "" : String(name).trim();
            if (!tagName) throw new Error("addTag needs a non-empty name.");
            if (data.tags.some((t) => t.name === tagName)) throw new Error(`Tag "${tagName}" already exists. Choose another name or use renameTag.`);
            addTag(tagName);
            return tagName;
        };
        const exposedRenameTag = (from, to) => {
            const fromName = String(from);
            const toName = to == null ? "" : String(to).trim();
            if (!data.tags.some((t) => t.name === fromName)) throw unknownTag(fromName);
            if (!toName || data.tags.some((t) => t.name === toName)) throw new Error(`Cannot rename tag "${fromName}" to "${toName}". Choose a new name with renameTag.`);
            renameTag(fromName, toName);
            return toName;
        };
        const exposedSetTagColor = (name, color) => {
            const tagName = String(name);
            if (!data.tags.some((t) => t.name === tagName)) throw unknownTag(tagName);
            const value = color == null ? "" : String(color);
            if (value !== "" && !TAG_COLORS.includes(value)) {
                throw new Error(`Invalid color "${value}". Use setTagColor with "" or one of: ${TAG_COLORS.join(", ")}.`);
            }
            setTagColor(tagName, value);
            return value;
        };
        const exposedDeleteTag = (name) => {
            const tagName = String(name);
            if (!data.tags.some((t) => t.name === tagName)) throw unknownTag(tagName);
            deleteTagCore(tagName);
            return true;
        };
        const app = {
            aiVision: {
                kind: "TodoApp",
                summary: "The Todo board's live object model for the open .todo.json file.",
                overview: "Read items for the filtered view.\nRead lists/tags for vocabulary.\nSet selectedList, selectedTag or searchText to change items; call addItem, toggleItem or setItemTag to change the file.",
                help: "This is a .todo.json file open in the Todo board. items is the filtered view; clear selectedList, selectedTag and searchText to widen it to everything. Every ...Item method takes the item id from items[n].id, not its title or position. addItem takes an optional list name, and that list must exist first. Deletes are immediate and unconfirmed. The Lists & Tags sidebar controls live in a secondary view; highlighting one opens that panel. The board writes the file on every change, and Ctrl+S saves it.",
                members: [
                    { name: "fileName", kind: "property", summary: "Name of the open .todo.json file, or an empty string if none is open." },
                    { name: "items", kind: "property", node: true, indexable: true, summary: "The filtered, ordered items currently shown." },
                    { name: "lists", kind: "property", node: true, indexable: true, summary: "Every list with total and undone counts." },
                    { name: "tags", kind: "property", node: true, indexable: true, summary: "Every tag with its colour and item count." },
                    { name: "selectedList", kind: "property", writable: true, summary: "The selected list name; empty string means All. Must be an existing list." },
                    { name: "selectedTag", kind: "property", writable: true, summary: "The selected tag name; empty string means all tags. Must be an existing tag." },
                    { name: "searchText", kind: "property", writable: true, summary: "Free-text filter over titles, comments, lists and tags." },
                    { name: "addItem", kind: "method", signature: "addItem(title: string, list?: string)", summary: "Add a new todo item to a list and return its id. The optional list must already exist; without it the item goes to selectedList." },
                    { name: "toggleItem", kind: "method", signature: "toggleItem(id: string)", summary: "Mark a todo item done, or undo it: toggles the item with this id and returns its new done value." },
                    { name: "setItemTitle", kind: "method", signature: "setItemTitle(id: string, title: string)", summary: "Rename a todo item: replace the title of the item with this id and return it." },
                    { name: "setItemComment", kind: "method", signature: "setItemComment(id: string, comment: string | null)", summary: "Add or replace the comment (the note) on a todo item; null or an empty string clears it." },
                    { name: "setItemTag", kind: "method", signature: "setItemTag(id: string, tag: string | null)", summary: "Put a tag on a todo item, or null to take it off. A tag name that does not exist yet is created with no colour." },
                    { name: "deleteItem", kind: "method", signature: "deleteItem(id: string)", summary: "Remove a todo item from the list, by id.", caution: "Deletes the item immediately \u2014 no confirmation dialog and no undo." },
                    { name: "addList", kind: "method", signature: "addList(name: string)", summary: "Create a list and return its name; the new list also becomes selectedList." },
                    { name: "renameList", kind: "method", signature: "renameList(from: string, to: string)", summary: "Rename a list and return its new name; the list's items move with it." },
                    { name: "deleteList", kind: "method", signature: "deleteList(name: string)", summary: "Delete a list; its items remain in the file but become unassigned.", caution: "Deletes the list immediately \u2014 no confirmation and no undo. Its items stay in the file but become unassigned." },
                    { name: "addTag", kind: "method", signature: "addTag(name: string)", summary: "Create a tag and return its name." },
                    { name: "renameTag", kind: "method", signature: "renameTag(from: string, to: string)", summary: "Rename a tag and return its new name; items are retagged." },
                    { name: "setTagColor", kind: "method", signature: "setTagColor(name: string, color: string)", summary: "Set a tag colour; pass an empty string for no colour." },
                    { name: "deleteTag", kind: "method", signature: "deleteTag(name: string)", summary: "Delete a tag; items carrying it lose the tag.", caution: "Deletes the tag immediately \u2014 no confirmation and no undo." },
                ].concat(elementParts.members),
                elements: elementDeclarations,
                provide: elementParts.provide,
                summarize: () => ({
                    kind: "TodoApp", fileName, lists: data.lists.length, tags: data.tags.length,
                    items: data.items.length, shown: shownItems().length,
                    selectedList: sel.selectedList, selectedTag: sel.selectedTag, searchText: sel.searchText,
                }),
            },
            get fileName() { return fileName; },
            get items() { return itemsNode; },
            get lists() { return listsNode; },
            get tags() { return tagsNode; },
            get selectedList() { return sel.selectedList; },
            set selectedList(value) {
                const name = value === null || value === "" ? "" : String(value);
                if (name && !data.lists.includes(name)) throw unknownList(name);
                setSelectedList(name);
            },
            get selectedTag() { return sel.selectedTag; },
            set selectedTag(value) {
                const name = value === null || value === "" ? "" : String(value);
                if (name && !data.tags.some((t) => t.name === name)) throw unknownTag(name);
                setSelectedTag(name);
            },
            get searchText() { return sel.searchText; },
            set searchText(value) { setSearchText(value == null ? "" : String(value)); },
            addItem: exposedAddItem,
            toggleItem: exposedToggleItem,
            setItemTitle: exposedSetItemTitle,
            setItemComment: exposedSetItemComment,
            setItemTag: exposedSetItemTag,
            deleteItem: exposedDeleteItem,
            addList: exposedAddList,
            renameList: exposedRenameList,
            deleteList: exposedDeleteList,
            addTag: exposedAddTag,
            renameTag: exposedRenameTag,
            setTagColor: exposedSetTagColor,
            deleteTag: exposedDeleteTag,
        };
        const collectionShape = () => [data.lists.length > 0, data.tags.length > 0, data.items.length > 0].join();
        // expose() derives indexed item shapes once. Refresh only when a collection changes
        // empty/non-empty state, so a board author copying this surface does not lose the shape
        // after the async load or after the first item/list/tag is created or removed.
        refreshAiVision = () => {
            if (role !== "main" || !remoteAiVision || typeof remoteAiVision.refresh !== "function") return;
            const next = collectionShape();
            if (next !== aiVisionShape) {
                aiVisionShape = next;
                remoteAiVision.refresh();
            }
        };
        registerAiVision = () => {
            remoteAiVision = aiVision.expose(app);
            aiVisionShape = collectionShape();
        };
    }

    // ── Tag color palette (mirrors src/renderer/theme/palette-colors.ts) ──
    const TAG_COLORS = [
        "dodgerblue", "hotpink", "olive", "mediumpurple", "orange", "darkkhaki",
        "deepskyblue", "tomato", "limegreen", "cornflowerblue", "sienna",
    ];

    // ── DOM helpers ─────────────────────────────────────────────────────
    function el(tag, props, ...children) {
        const node = document.createElement(tag);
        if (props) {
            for (const [k, v] of Object.entries(props)) {
                if (k === "class") node.className = v;
                else if (k === "text") node.textContent = v;
                else if (k === "html") node.innerHTML = v;
                else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
                else if (v === true) node.setAttribute(k, "");
                else if (v !== false && v != null) node.setAttribute(k, v);
            }
        }
        for (const c of children) {
            if (c == null) continue;
            node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        }
        return node;
    }
    const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

    function formatDate(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        return sameDay
            ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString();
    }

    // Preserve focus + caret across a list rebuild (a cross-frame content change can
    // re-render while the user is mid-edit in a title/comment field).
    function captureFocus() {
        const a = document.activeElement;
        if (!a || !a.getAttribute) return null;
        const itemId = a.getAttribute("data-item-id");
        const field = a.getAttribute("data-field");
        if (!itemId || !field) return null;
        return { itemId, field, start: a.selectionStart, end: a.selectionEnd };
    }
    function restoreFocus(f) {
        if (!f) return;
        const node = document.querySelector(`[data-item-id="${f.itemId}"][data-field="${f.field}"]`);
        if (!node) return;
        node.focus();
        try { node.setSelectionRange(f.start, f.end); } catch { /* not a text field */ }
    }

    // ── In-board confirm (CSP-safe, no window.confirm dependency) ────────
    function confirmAction(message) {
        return new Promise((resolve) => {
            const overlay = el("div", { class: "confirm-overlay" });
            const box = el("div", { class: "confirm-box" });
            const done = (v) => { overlay.remove(); resolve(v); };
            box.appendChild(el("div", { class: "confirm-msg", text: message }));
            const row = el("div", { class: "confirm-actions" });
            row.appendChild(el("button", { class: "btn", text: "Cancel", onclick: () => done(false) }));
            row.appendChild(el("button", { class: "btn danger", text: "Delete", onclick: () => done(true) }));
            box.appendChild(row);
            overlay.appendChild(box);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
            document.body.appendChild(overlay);
        });
    }

    // ── Render: main list view ──────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    let fileNameSet = false;
    let fileName = "";
    function setFileNameLabel() {
        if (fileNameSet) return;
        fileNameSet = true;
        Promise.resolve(P.getFilePath && P.getFilePath())
            .then((fp) => {
                fileName = fp ? fp.replace(/^.*[\\/]/, "") : "";
                if (fileName) $("file-name").textContent = fileName;
            })
            .catch(() => {});
    }

    function renderMain() {
        setFileNameLabel();
        // Chrome (static nodes — update in place, don't rebuild).
        const search = $("search");
        if (document.activeElement !== search) search.value = sel.searchText || "";
        $("search-clear").hidden = !(sel.searchText || "");

        // Header list switch — always shows the current list ("All" when none selected). Clicking
        // it opens the list picker (see wireMainChrome/openListSwitch).
        $("list-name").textContent = sel.selectedList || "All";

        const qa = $("quick-add-input");
        const locked = !sel.selectedList;
        // Locked (list "All"): readOnly rather than disabled, so it stays clickable — a click
        // (like the header "List:" switch) opens the list picker. This is a board-only affordance;
        // the built-in editor just disables the input, which hides where to pick a list.
        qa.readOnly = locked;
        qa.classList.toggle("locked", locked);
        qa.placeholder = locked ? "Select a list to add items…" : "Add an item…";

        const { undone, done } = filteredItems();
        const totalAll = data.items.length;
        const shown = undone.length + done.length;
        // Item count → the host footer via persephone.setStatusText (mirrors the built-in Todo,
        // which shows the count in its footer). Optional-call: on an app build without the method
        // the count simply doesn't show (minAppVersion 4.0.17 guarantees it), never throws.
        P.setStatusText?.(shown === totalAll ? `${totalAll} items` : `${shown} of ${totalAll} items`);

        const empty = $("main-empty");
        const list = $("todo-list");
        if (parseError) {
            list.hidden = true;
            empty.hidden = false;
            empty.textContent = "This file isn't valid JSON — fix it in Monaco to edit here.";
            return;
        }
        if (totalAll === 0) {
            list.hidden = true;
            empty.hidden = false;
            empty.textContent = "No items yet. Create a list in the Lists & Tags panel, then add items.";
            return;
        }
        if (shown === 0) {
            list.hidden = true;
            empty.hidden = false;
            empty.textContent = "No items match the current filter.";
            return;
        }
        empty.hidden = true;
        list.hidden = false;

        const focus = captureFocus();
        clear(list);
        for (const it of undone) list.appendChild(renderItemRow(it));
        if (done.length) {
            list.appendChild(el("div", { class: "done-separator", text: "Done" }));
            for (const it of done) list.appendChild(renderItemRow(it));
        }
        restoreFocus(focus);
    }

    function renderItemRow(it) {
        const row = el("div", { class: "todo-item" + (it.done ? " done" : "") });

        // Checkbox — native input, styled to the Persephone checkbox look via board-base.css
        const checkbox = el("input", {
            class: "checkbox",
            type: "checkbox",
            title: it.done ? "Mark not done" : "Mark done",
            onchange: () => toggleItem(it.id),
        });
        checkbox.checked = it.done;
        row.appendChild(checkbox);

        // Main column: title + comment + meta
        const col = el("div", { class: "item-col" });

        // Title: a highlighted read-only view by default; click swaps in a textarea to edit.
        col.appendChild(
            editingField && editingField.itemId === it.id && editingField.field === "title"
                ? buildTitleEditor(it)
                : buildTitleView(it),
        );

        // Comment: `null` = no comment (show the add button); otherwise the same view/edit swap.
        if (it.comment === null) {
            col.appendChild(
                el("button", { class: "add-comment", text: "+ Add comment", onclick: () => addComment(it.id) }),
            );
        } else if (editingField && editingField.itemId === it.id && editingField.field === "comment") {
            col.appendChild(buildCommentEditor(it));
        } else {
            col.appendChild(buildCommentView(it));
        }

        row.appendChild(col);

        // Right column: tag chip · date · delete (delete shows on hover) — mirrors the
        // built-in Todo, which puts the tag on the right of the item's first line.
        const right = el("div", { class: "item-right" });
        right.appendChild(renderTagChip(it));
        right.appendChild(
            el("span", {
                class: "item-date",
                title: `Created ${formatDate(it.createdDate)}${it.doneDate ? " · Done " + formatDate(it.doneDate) : ""}`,
                text: it.done ? formatDate(it.doneDate) : formatDate(it.createdDate),
            }),
        );
        right.appendChild(
            el("button", { class: "icon-btn delete", title: "Delete item", text: "✕", onclick: () => deleteItem(it.id) }),
        );
        row.appendChild(right);
        return row;
    }

    // ── Title / comment view↔edit swap + search-word highlighting ────────
    // A <textarea> can't style individual words, so matched search words are only shown while
    // the field is a read-only view. Clicking it swaps in the textarea for editing; on blur it
    // swaps back to the (re-highlighted) view. Editors keep data-item-id/data-field so the
    // existing captureFocus/restoreFocus keeps the caret across a cross-frame re-render.

    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    // Append `text` to `node`, wrapping every occurrence of a current search word in <mark>.
    // Uses the SAME word split as filteredItems(), so what's highlighted is exactly why the
    // item matched.
    function appendHighlighted(node, text, query) {
        if (!text) return;
        const q = (query || "").trim().toLowerCase();
        const words = q ? q.split(/\s+/).filter(Boolean).map(escapeRegExp) : [];
        if (!words.length) { node.appendChild(document.createTextNode(text)); return; }
        const re = new RegExp("(" + words.join("|") + ")", "gi");
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
            node.appendChild(el("mark", { class: "hl", text: m[0] }));
            last = m.index + m[0].length;
            if (re.lastIndex === m.index) re.lastIndex++; // guard against a zero-width match loop
        }
        if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
    }

    // Does any current search word appear in `text`? (Used to tint a matching tag chip.)
    function matchesSearch(text) {
        const q = (sel.searchText || "").trim().toLowerCase();
        if (!q || !text) return false;
        const t = String(text).toLowerCase();
        return q.split(/\s+/).filter(Boolean).some((w) => t.includes(w));
    }

    // Best-effort: map a click position to a character offset in the view's text, so the swapped
    // textarea drops the caret where the user clicked. Falls back to end-of-text (null → caller).
    function caretOffsetFromClick(container, e) {
        try {
            let range = null;
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
            }
            if (!range) return null;
            let offset = 0;
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = walker.nextNode())) {
                if (n === range.startContainer) return offset + range.startOffset;
                offset += n.textContent.length;
            }
            return null;
        } catch { return null; }
    }

    function buildTitleView(it) {
        const view = el("div", { class: "item-title item-view" });
        appendHighlighted(view, it.title || "", sel.searchText);
        view.addEventListener("mousedown", (e) => {
            e.preventDefault(); // suppress the view's own text-selection so we control the caret
            beginEdit(view, it, "title", caretOffsetFromClick(view, e));
        });
        return view;
    }

    function buildTitleEditor(it) {
        const title = el("textarea", {
            class: "item-title", rows: "1", "data-item-id": it.id, "data-field": "title",
        });
        title.value = it.title;
        title.addEventListener("input", () => updateItemTitle(it.id, title.value));
        title.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); title.blur(); }
        });
        title.addEventListener("blur", () => endEdit(it.id, "title"));
        return title;
    }

    function buildCommentView(it) {
        const view = el("div", { class: "item-comment item-view" });
        if (it.comment) appendHighlighted(view, it.comment, sel.searchText);
        else { view.classList.add("placeholder"); view.textContent = "Comment…"; }
        view.addEventListener("mousedown", (e) => {
            e.preventDefault();
            beginEdit(view, it, "comment", caretOffsetFromClick(view, e));
        });
        return view;
    }

    function buildCommentEditor(it) {
        const comment = el("textarea", {
            class: "item-comment", rows: "1", placeholder: "Comment…",
            "data-item-id": it.id, "data-field": "comment",
        });
        comment.value = it.comment;
        comment.addEventListener("input", () => setItemComment(it.id, comment.value));
        comment.addEventListener("blur", () => endEditComment(it.id));
        return comment;
    }

    // Swap a view node for its editor, focus it, and drop the caret at `offset` (or the end).
    function beginEdit(viewNode, it, field, offset) {
        editingField = { itemId: it.id, field };
        const editor = field === "title" ? buildTitleEditor(it) : buildCommentEditor(it);
        viewNode.replaceWith(editor);
        editor.focus();
        const pos = offset == null ? editor.value.length : Math.max(0, Math.min(offset, editor.value.length));
        try { editor.setSelectionRange(pos, pos); } catch { /* no-op */ }
    }

    // Leave edit mode for a title: flush the debounced write and swap back to the view in place
    // (in place — not a full render() — so a click on a sibling button that caused the blur isn't
    // cancelled by a list rebuild).
    function endEdit(id, field) {
        if (!editingField || editingField.itemId !== id || editingField.field !== field) return;
        editingField = null;
        writeNow();
        const it = item(id);
        const ta = document.querySelector(`textarea[data-item-id="${id}"][data-field="${field}"]`);
        if (ta && it) ta.replaceWith(field === "title" ? buildTitleView(it) : buildCommentView(it));
    }

    // Leave edit mode for a comment: an empty comment collapses back to null (the "+ Add comment"
    // button), which needs a structural rebuild; a non-empty one swaps to the view in place.
    function endEditComment(id) {
        if (!editingField || editingField.itemId !== id || editingField.field !== "comment") return;
        const it = item(id);
        editingField = null;
        if (it && (it.comment === null || String(it.comment).trim() === "")) {
            it.comment = null;
            writeNow();
            render();
            return;
        }
        writeNow();
        const ta = document.querySelector(`textarea.item-comment[data-item-id="${id}"][data-field="comment"]`);
        if (ta && it) ta.replaceWith(buildCommentView(it));
    }

    function renderTagChip(it) {
        const wrap = el("div", { class: "tag-chip-wrap" });
        const current = it.tag ? data.tags.find((t) => t.name === it.tag) : null;
        const chip = el("button", { class: "tag-chip", title: "Set tag" });
        if (current) {
            if (current.color) chip.appendChild(el("span", { class: "dot", style: `background:${current.color}` }));
            chip.appendChild(document.createTextNode(current.name));
            if (matchesSearch(current.name)) chip.classList.add("hl-chip");
        } else {
            chip.textContent = "＋ tag";
            chip.classList.add("muted");
        }
        chip.addEventListener("click", () => openTagMenu(wrap, it));
        wrap.appendChild(chip);
        return wrap;
    }

    function openTagMenu(anchor, it) {
        const existing = anchor.querySelector(".tag-menu");
        if (existing) { existing.remove(); return; }
        const menu = el("div", { class: "tag-menu" });
        const add = (label, name, color) => {
            const opt = el("button", { class: "tag-menu-item" });
            if (color) opt.appendChild(el("span", { class: "dot", style: `background:${color}` }));
            opt.appendChild(document.createTextNode(label));
            opt.addEventListener("click", () => { setItemTag(it.id, name); menu.remove(); });
            menu.appendChild(opt);
        };
        add("No tag", null, "");
        for (const t of data.tags) add(t.name, t.name, t.color);
        anchor.appendChild(menu);
        setTimeout(() => {
            const off = (e) => {
                if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", off); }
            };
            document.addEventListener("click", off);
        }, 0);
    }

    // ── Render: Lists & Tags panel ──────────────────────────────────────
    function renderLists() {
        const counts = listCounts();
        const body = $("lists-body");
        clear(body);

        body.appendChild(
            selectableRow({
                label: "All",
                selected: sel.selectedList === "",
                count: counts[""],
                onclick: () => setSelectedList(""),
            }),
        );
        for (const name of data.lists) {
            if (editing && editing.kind === "list" && editing.name === name) {
                body.appendChild(editRow(name, (v) => renameList(name, v)));
                continue;
            }
            body.appendChild(
                selectableRow({
                    label: name,
                    selected: sel.selectedList === name,
                    count: counts[name],
                    onclick: () => setSelectedList(name),
                    onRename: () => { editing = { kind: "list", name }; render(); },
                    onDelete: () => deleteList(name),
                }),
            );
        }
    }

    function renderTags() {
        const body = $("tags-body");
        clear(body);

        body.appendChild(
            selectableRow({
                label: "All Tags",
                selected: sel.selectedTag === "",
                onclick: () => setSelectedTag(""),
            }),
        );
        for (const t of data.tags) {
            if (editing && editing.kind === "tag" && editing.name === t.name) {
                body.appendChild(editRow(t.name, (v) => renameTag(t.name, v)));
                continue;
            }
            const row = selectableRow({
                label: t.name,
                selected: sel.selectedTag === t.name,
                dot: t.color,
                onclick: () => setSelectedTag(t.name),
                onColor: (anchor) => openColorMenu(anchor, t.name),
                onRename: () => { editing = { kind: "tag", name: t.name }; render(); },
                onDelete: () => deleteTag(t.name),
            });
            body.appendChild(row);
        }
    }

    function selectableRow(opts) {
        const row = el("div", { class: "sel-row" + (opts.selected ? " selected" : "") });
        if (opts.dot !== undefined) {
            row.appendChild(el("span", { class: "dot" + (opts.dot ? "" : " no-color"), style: opts.dot ? `background:${opts.dot}` : "" }));
        }
        const label = el("span", { class: "sel-label", text: opts.label });
        label.addEventListener("click", opts.onclick);
        row.appendChild(label);
        if (opts.count) {
            row.appendChild(
                el("span", { class: "sel-count", html: `<b>${opts.count.undone}</b>/${opts.count.total}` }),
            );
        }
        const actions = el("div", { class: "row-actions" });
        if (opts.onColor) {
            const btn = el("button", { class: "icon-btn tiny", title: "Set color", text: "🎨" });
            btn.addEventListener("click", (e) => { e.stopPropagation(); opts.onColor(row); });
            actions.appendChild(btn);
        }
        if (opts.onRename) {
            const btn = el("button", { class: "icon-btn tiny", title: "Rename", text: "✎" });
            btn.addEventListener("click", (e) => { e.stopPropagation(); opts.onRename(); });
            actions.appendChild(btn);
        }
        if (opts.onDelete) {
            const btn = el("button", { class: "icon-btn tiny", title: "Delete", text: "✕" });
            btn.addEventListener("click", (e) => { e.stopPropagation(); opts.onDelete(); });
            actions.appendChild(btn);
        }
        row.appendChild(actions);
        return row;
    }

    function editRow(value, commit) {
        const row = el("div", { class: "sel-row editing" });
        const input = el("input", { type: "text", class: "edit-input" });
        input.value = value;
        const finish = (save) => { editing = null; if (save) commit(input.value); render(); };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") finish(true);
            else if (e.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        row.appendChild(input);
        setTimeout(() => { input.focus(); input.select(); }, 0);
        return row;
    }

    function openColorMenu(anchor, tagName) {
        const existing = anchor.querySelector(".tag-menu");
        if (existing) { existing.remove(); return; }
        const menu = el("div", { class: "tag-menu color-menu" });
        const add = (label, color) => {
            const opt = el("button", { class: "tag-menu-item" });
            opt.appendChild(el("span", { class: "dot" + (color ? "" : " no-color"), style: color ? `background:${color}` : "" }));
            opt.appendChild(document.createTextNode(label));
            opt.addEventListener("click", () => { setTagColor(tagName, color); menu.remove(); });
            menu.appendChild(opt);
        };
        add("No color", "");
        for (const c of TAG_COLORS) add(c, c);
        anchor.appendChild(menu);
        setTimeout(() => {
            const off = (e) => {
                if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", off); }
            };
            document.addEventListener("click", off);
        }, 0);
    }

    // Popup list picker anchored to the header "List:" switch. Offers "All" plus every list, marks
    // the current one, and lets a list be chosen without opening the Lists & Tags panel. Also
    // reached from the (locked) quick-add input/＋ so the whole disabled add-row still switches.
    function openListSwitch() {
        const host = $("list-switch");
        const existing = host.querySelector(".tag-menu");
        if (existing) { existing.remove(); return; }
        const menu = el("div", { class: "tag-menu list-switch-menu" });
        const addOpt = (label, name) => {
            const opt = el("button", { class: "tag-menu-item" + (sel.selectedList === name ? " active" : "") });
            opt.appendChild(document.createTextNode(label));
            opt.addEventListener("click", () => {
                menu.remove();
                setSelectedList(name);
                // Focus the quick-add once a real list is picked (it becomes typable).
                if (name) setTimeout(() => { const qa = $("quick-add-input"); if (qa) qa.focus(); }, 0);
            });
            menu.appendChild(opt);
        };
        addOpt("All", "");
        if (data.lists.length) {
            for (const name of data.lists) addOpt(name, name);
        } else {
            menu.appendChild(el("div", { class: "tag-menu-empty", text: "No lists yet — add one in the Lists & Tags panel." }));
        }
        host.appendChild(menu);
        setTimeout(() => {
            const off = (e) => {
                if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", off); }
            };
            document.addEventListener("click", off);
        }, 0);
    }

    // ── Render dispatch ─────────────────────────────────────────────────
    function render() {
        if (role === "main") renderMain();
        else { renderLists(); renderTags(); }
        refreshAiVision();
    }

    // ── Boot ────────────────────────────────────────────────────────────
    async function load() {
        // Wait for the board handshake to land before touching persephone.host.* — the
        // handshake is what sets hostEnabled, and host.getContent()/onContentChange reject
        // (or no-op) if called earlier. getFilePath() resolves exactly when the handshake
        // arrives, so awaiting it is the ready-gate (it also gives us the file-name label).
        await P.getFilePath();
        // Subscribe FIRST so a content update arriving while getContent() is in flight is
        // never missed. Cross-frame writes from the other view arrive here too.
        P.host.onContentChange((text) => {
            data = parse(text);
            lastWritten = serialize(data); // external edit is now our baseline — don't echo it back
            render();
        });
        try {
            data = parse(await P.host.getContent());
            lastWritten = serialize(data); // baseline the loaded content so a no-op blur won't write
        } catch {
            // Opened plainly (no content host) — show an empty state and stop.
            if (role === "main") {
                $("todo-list").hidden = true;
                const empty = $("main-empty");
                empty.hidden = false;
                empty.textContent = "Open a .todo.json file to edit it here.";
            }
            return;
        }
        render();
    }

    function wireMainChrome() {
        const qa = $("quick-add-input");
        const addNow = () => { addItem(qa.value); qa.value = ""; };
        // The header "List:" switch is the primary list picker. While locked (list "All"), the
        // disabled input and its ＋ redirect to the same picker so clicking anywhere in the add-row
        // still switches lists. mousedown only blocks focus (no caret behind the popup); the picker
        // opens on the click that follows — so the opening click isn't swallowed by the
        // outside-click dismissal, which openListSwitch registers a tick later.
        // Listener on the inner button (not the #list-switch wrapper) so an option click — which
        // bubbles up through the wrapper the menu lives in — doesn't re-trigger and reopen it.
        $("list-switch-btn").addEventListener("click", openListSwitch);
        qa.addEventListener("mousedown", (e) => { if (qa.readOnly) e.preventDefault(); });
        qa.addEventListener("click", () => { if (qa.readOnly) openListSwitch(); });
        $("quick-add-btn").addEventListener("click", () => {
            if (qa.readOnly) openListSwitch();
            else addNow();
        });
        qa.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addNow(); } });

        const search = $("search");
        search.addEventListener("input", () => setSearchText(search.value));
        $("search-clear").addEventListener("click", () => setSearchText(""));
    }

    function wireListsChrome() {
        const nl = $("new-list");
        const addL = () => { addList(nl.value); nl.value = ""; };
        $("add-list").addEventListener("click", addL);
        nl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addL(); } });

        const nt = $("new-tag");
        const addT = () => { addTag(nt.value); nt.value = ""; };
        $("add-tag").addEventListener("click", addT);
        nt.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addT(); } });
    }

    function start() {
        // Show the container for this role; hide the other.
        if (role === "main") {
            $("lists-root").hidden = true;
            $("main-root").hidden = false;
            document.body.classList.add("main-frame");
            wireMainChrome();
        } else {
            $("main-root").hidden = true;
            $("lists-root").hidden = false;
            document.body.classList.add("secondary-frame");
            wireListsChrome();
        }
        wireState();
        registerAiVision();
        load();
    }

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
