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

    // Selection/search mirror — updated from persephone.state.onChange (source of truth).
    let sel = { selectedList: "", selectedTag: "", searchText: "" };

    // Inline-edit state for the lists panel: { kind: "list"|"tag", name } | null.
    let editing = null;

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
        try {
            P.host.setContent(serialize(data));
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

    function addItem(title) {
        const t = title.trim();
        if (!t || !sel.selectedList) return;
        data.items.push({
            id: uuid(),
            list: sel.selectedList,
            title: t,
            done: false,
            createdDate: new Date().toISOString(),
            doneDate: null,
            comment: null,
            tag: null,
        });
        writeNow();
        render();
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
        writeNow();
        render();
    }
    function removeComment(id) {
        const it = item(id);
        if (!it) return;
        if (it.comment === null || it.comment.trim() === "") {
            it.comment = null;
            writeNow();
            render();
        }
    }
    function setItemTag(id, name) {
        const it = item(id);
        if (!it) return;
        it.tag = name || null;
        writeNow();
        render();
    }
    async function deleteItem(id) {
        const it = item(id);
        if (!it) return;
        if (!(await confirmAction(`Delete "${it.title || "this item"}"?`))) return;
        data.items = data.items.filter((i) => i.id !== id);
        if (data.state) delete data.state[id];
        writeNow();
        render();
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
    async function deleteList(name) {
        if (!(await confirmAction(`Delete list "${name}"? Its items become unassigned.`))) return;
        data.lists = data.lists.filter((l) => l !== name);
        for (const i of data.items) if (i.list === name) i.list = "";
        writeNow();
        if (sel.selectedList === name) setSelectedList("");
        render();
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
    async function deleteTag(name) {
        if (!(await confirmAction(`Delete tag "${name}"?`))) return;
        data.tags = data.tags.filter((t) => t.name !== name);
        for (const i of data.items) if (i.tag === name) i.tag = null;
        writeNow();
        if (sel.selectedTag === name) setSelectedTag("");
        render();
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
    function setFileNameLabel() {
        if (fileNameSet) return;
        fileNameSet = true;
        Promise.resolve(P.getFilePath && P.getFilePath())
            .then((fp) => {
                if (fp) $("file-name").textContent = fp.replace(/^.*[\\/]/, "");
            })
            .catch(() => {});
    }

    function renderMain() {
        setFileNameLabel();
        // Chrome (static nodes — update in place, don't rebuild).
        const search = $("search");
        if (document.activeElement !== search) search.value = sel.searchText || "";
        $("search-clear").hidden = !(sel.searchText || "");

        const qa = $("quick-add-input");
        qa.disabled = !sel.selectedList;
        qa.placeholder = sel.selectedList ? "Add an item…" : "Select a list to add items…";

        const { undone, done } = filteredItems();
        const totalAll = data.items.length;
        const shown = undone.length + done.length;
        $("count").textContent =
            shown === totalAll ? `${totalAll} items` : `${shown} of ${totalAll} items`;

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

        // Checkbox
        row.appendChild(
            el("button", {
                class: "checkbox",
                title: it.done ? "Mark not done" : "Mark done",
                onclick: () => toggleItem(it.id),
                text: it.done ? "☑" : "☐",
            }),
        );

        // Main column: title + comment + meta
        const col = el("div", { class: "item-col" });

        const title = el("textarea", {
            class: "item-title",
            rows: "1",
            "data-item-id": it.id,
            "data-field": "title",
        });
        title.value = it.title;
        title.addEventListener("input", () => updateItemTitle(it.id, title.value));
        title.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); title.blur(); }
        });
        title.addEventListener("blur", writeNow);
        col.appendChild(title);

        // Comment
        if (it.comment === null) {
            col.appendChild(
                el("button", { class: "add-comment", text: "+ Add comment", onclick: () => addComment(it.id) }),
            );
        } else {
            const comment = el("textarea", {
                class: "item-comment",
                rows: "1",
                placeholder: "Comment…",
                "data-item-id": it.id,
                "data-field": "comment",
            });
            comment.value = it.comment;
            comment.addEventListener("input", () => setItemComment(it.id, comment.value));
            comment.addEventListener("blur", () => removeComment(it.id));
            col.appendChild(comment);
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

    function renderTagChip(it) {
        const wrap = el("div", { class: "tag-chip-wrap" });
        const current = it.tag ? data.tags.find((t) => t.name === it.tag) : null;
        const chip = el("button", { class: "tag-chip", title: "Set tag" });
        if (current) {
            if (current.color) chip.appendChild(el("span", { class: "dot", style: `background:${current.color}` }));
            chip.appendChild(document.createTextNode(current.name));
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
        const menu = el("div", { class: "tag-menu" });
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

    // ── Render dispatch ─────────────────────────────────────────────────
    function render() {
        if (role === "main") renderMain();
        else { renderLists(); renderTags(); }
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
            render();
        });
        try {
            data = parse(await P.host.getContent());
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
        $("quick-add-btn").addEventListener("click", addNow);
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
        load();
    }

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
