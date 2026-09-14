/* AiVision Explorer — descriptor-only discovery with explicit operations. */
(function () {
    "use strict";

    const P = window.persephone;
    const state = {
        rootPath: "",
        selectedPath: "",
        selectedDescriptor: null,
        selectedRow: null,
        selectedMember: null,
        treeRows: new Map(),
        autoReadSelection: false,
        descriptors: new Map(),
        expanded: new Set(),
        values: new Map(),
        selectionToken: 0,
        search: { query: "", limit: 20, results: [] },
        events: { items: [], generation: 0, waiting: false },
    };

    const $ = (id) => document.getElementById(id);
    const refs = {
        boot: $("boot"), bootTitle: $("boot-title"), bootMessage: $("boot-message"), retry: $("retry"),
        shell: $("app-shell"), rootPath: $("root-path"), tree: $("tree"), treeStatus: $("tree-status"),
        selectedPath: $("selected-path"), selectedKind: $("selected-kind"), selectedSummary: $("selected-summary"),
        operation: $("operation-status"), returned: $("returned-value"), valueState: $("value-state"),
        notes: $("descriptor-notes"), members: $("members"), memberCount: $("member-count"),
        searchForm: $("search-form"), searchQuery: $("search-query"), searchLimit: $("search-limit"),
        searchStatus: $("search-status"), searchResults: $("search-results"),
        events: $("events"), eventsState: $("events-state"), eventError: $("event-error"),
        dialogMount: $("dialog-mount"), notificationMount: $("notification-mount"),
    };

    function errorMessage(error) {
        return error && error.message ? error.message : String(error || "Unknown error");
    }

    function formatJson(value) {
        if (value === undefined) return "undefined";
        if (typeof value === "string") return value;
        try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }

    function text(value) {
        return value == null ? "" : String(value);
    }

    function node(tag, className, content) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (content !== undefined) element.textContent = content;
        return element;
    }

    function setOperation(message, kind) {
        refs.operation.textContent = message;
        refs.operation.className = "operation-status" + (kind ? " " + kind : "");
    }

    function notifyInFrame(message, kind) {
        const toast = node("div", "notification " + (kind || ""), message);
        refs.notificationMount.append(toast);
        window.setTimeout(() => toast.remove(), 4200);
    }

    function reportError(error) {
        const message = errorMessage(error);
        setOperation(message, "error");
        notifyInFrame(message, "error");
        if (P && typeof P.notify === "function") P.notify(message, "error");
    }

    function isTrustFailure(error) {
        const message = errorMessage(error).toLowerCase();
        return /untrusted|not trusted|trust (?:this )?board|board.*trust|trust gate|permission.*board/.test(message);
    }

    function memberPath(parentPath, memberName) {
        const name = text(memberName);
        if (/^[A-Za-z_$][\w$]*$/.test(name)) return parentPath ? parentPath + "." + name : name;
        return (parentPath ? parentPath : "") + "[" + JSON.stringify(name) + "]";
    }

    function describePath(path) {
        return path ? path + ".$describe" : "$describe";
    }

    /**
     * Make a path from an untrusted source safe to *describe* and to select.
     *
     * helpSearch returns call syntax — "pages.closePage()" — and parentheses in a path INVOKE the
     * method. It also returns "<path>.$help" hits, which cannot take a further ".$describe"
     * segment. Both must be reduced to a plain member path before the Explorer touches them: a
     * method path with no arguments only describes the method, which is what we want.
     */
    function sanitizePath(raw) {
        let path = text(raw).trim();
        path = path.replace(/\.\$(?:help|describe)$/, "");
        path = path.replace(/\([^)]*\)/g, "");
        return path;
    }

    function bridgeCall(path, options) {
        if (!P || typeof P.call !== "function") return Promise.reject(new Error("Persephone bridge is unavailable."));
        return options === undefined ? P.call(path) : P.call(path, options);
    }

    function applyTheme(theme) {
        if (!theme) return;
        if (theme.id) document.documentElement.dataset.theme = theme.id;
        const vars = theme.vars && typeof theme.vars === "object" ? theme.vars : {};
        Object.keys(vars).forEach((key) => {
            const cssKey = key.indexOf("--") === 0 ? key : "--p-" + key.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase());
            document.documentElement.style.setProperty(cssKey, text(vars[key]));
        });
    }

    function initializeTheme() {
        if (!P) return;
        if (typeof P.getTheme === "function") {
            try { Promise.resolve(P.getTheme()).then(applyTheme).catch(() => {}); } catch (_) { /* CSS injection remains the fallback. */ }
        }
        if (typeof P.onThemeChange === "function") {
            try { P.onThemeChange(applyTheme); } catch (_) { /* Older bridges use the injected CSS palette. */ }
        }
    }

    function showBoot(title, message, retry) {
        refs.shell.hidden = true;
        refs.boot.hidden = false;
        refs.bootTitle.textContent = title;
        refs.bootMessage.textContent = message;
        refs.retry.hidden = !retry;
    }

    function showTrustRequired(error) {
        state.events.generation++;
        showBoot("Trust this board to explore", "AiVision Explorer needs the host's board trust control before it can read the live model. Trust the board in Persephone, then retry.", true);
        setOperation(error ? errorMessage(error) : "Board trust is required.", "error");
    }

    async function loadDescriptor(path, force) {
        if (!force && state.descriptors.has(path)) return state.descriptors.get(path);
        const descriptor = await bridgeCall(describePath(path));
        if (!descriptor || typeof descriptor !== "object") throw new Error("The descriptor was not a JSON object.");
        state.descriptors.set(path, descriptor);
        return descriptor;
    }

    function descriptorRows(descriptor, parentPath) {
        const rows = [];
        const seen = new Set();
        (Array.isArray(descriptor && descriptor.children) ? descriptor.children : []).forEach((child) => {
            if (!child || typeof child.path !== "string" || seen.has(child.path)) return;
            seen.add(child.path);
            rows.push({
                path: child.path,
                label: child.segment || child.path,
                memberKind: undefined,
                expandable: true,
                writable: undefined,
                caution: undefined,
                restricted: child.restricted,
                summary: child.summary,
                signature: undefined,
                source: "child",
                parentPath,
            });
        });
        (Array.isArray(descriptor && descriptor.members) ? descriptor.members : []).forEach((member) => {
            if (!member) return;
            const path = memberPath(parentPath, member.name);
            if (seen.has(path)) return;
            seen.add(path);
            rows.push({
                path,
                label: member.name,
                memberKind: member.kind,
                expandable: member.node === true,
                writable: member.writable,
                caution: member.caution,
                restricted: member.restricted,
                summary: member.summary,
                signature: member.signature,
                source: "member",
                member,
                parentPath,
            });
        });
        return rows;
    }

    function renderTree() {
        refs.tree.replaceChildren();
        const rootDescriptor = state.descriptors.get(state.rootPath);
        if (!rootDescriptor) {
            refs.treeStatus.textContent = "Loading descriptor graph…";
            return;
        }
        refs.treeStatus.textContent = "Every member is listed; only expandable nodes show a caret.";
        const renderedPaths = new Set();
        state.treeRows.clear();

        function addRow(row, depth) {
            if (renderedPaths.has(row.path)) return;
            renderedPaths.add(row.path);
            state.treeRows.set(row.path, row);
            const wrapper = node("div", "tree-entry");
            const button = node("button", "tree-row" + (state.selectedPath === row.path ? " selected" : ""));
            button.type = "button";
            button.dataset.path = row.path;
            button.dataset.expandable = row.expandable ? "true" : "false";
            if (row.memberKind) button.dataset.memberKind = row.memberKind;
            if (row.caution) button.dataset.caution = row.caution;
            button.style.paddingLeft = (7 + depth * 15) + "px";
            const cached = state.descriptors.get(row.path);
            const expanded = state.expanded.has(row.path);
            // The caret slot is always rendered so leaf labels line up under their siblings;
            // it is empty for a leaf, which is also what marks the row as not expandable.
            button.append(node("span", "tree-caret", row.expandable ? (expanded ? "▾" : "›") : ""));
            button.append(node("span", "tree-kind", row.memberKind === "method" ? "ƒ" : "◆"));
            button.append(node("span", "tree-label", text(row.label)));
            if (row.restricted || (cached && cached.restricted)) button.append(node("span", "restricted-label", "restricted"));
            if (row.summary) button.title = text(row.summary);
            wrapper.append(button);
            refs.tree.append(wrapper);
            if (expanded && cached) {
                descriptorRows(cached, row.path).forEach((child) => addRow(child, depth + 1));
            }
        }

        const rootButton = node("button", "tree-row" + (state.selectedPath === state.rootPath ? " selected" : ""), "Persephone root");
        rootButton.type = "button";
        rootButton.dataset.path = state.rootPath;
        rootButton.dataset.expandable = "true";
        rootButton.style.paddingLeft = "7px";
        rootButton.title = text(rootDescriptor.summary);
        rootButton.prepend(node("span", "tree-caret", state.expanded.has(state.rootPath) ? "▾" : "⌄"));
        rootButton.prepend(node("span", "tree-kind", "◆"));
        refs.tree.append(rootButton);
        renderedPaths.add(state.rootPath);
        state.treeRows.set(state.rootPath, { path: state.rootPath, label: "Persephone root", expandable: true, source: "root", parentPath: "" });
        if (state.expanded.has(state.rootPath)) {
            descriptorRows(rootDescriptor, state.rootPath).forEach((row) => addRow(row, 1));
        }
    }

    function renderNotes(descriptor) {
        refs.notes.replaceChildren();
        if (!descriptor) return;
        const addNote = (label, value, extraClass) => {
            if (value === undefined || value === null || value === "") return;
            const block = node("div", "note-block" + (extraClass ? " " + extraClass : ""));
            block.append(node("div", "note-label", label));
            block.append(node("div", "note-value", typeof value === "string" ? value : formatJson(value)));
            refs.notes.append(block);
        };
        addNote("Overview", descriptor.overview);
        addNote("Resolved help", descriptor.help);
        addNote("Identity", descriptor.identity);
        addNote("Restricted", descriptor.restricted, "restricted-note");
        const members = Array.isArray(descriptor.members) ? descriptor.members : [];
        const editorWithoutModel = (descriptor.kind === "BoardEditor" || descriptor.kind === "BrowserEditor")
            && !members.some((member) => member && member.name === "app");
        if (editorWithoutModel) {
            addNote("Model state", "This page has no published model — activate its tab once, then refresh.", "unrendered-page-hint");
        }
        if (!refs.notes.childNodes.length) refs.notes.append(node("div", "empty-state", "This descriptor has no additional notes."));
    }

    function showReturned(value, status) {
        refs.returned.textContent = formatJson(value);
        refs.valueState.textContent = status || "Returned value";
    }

    function renderResultForSelection() {
        if (!state.selectedPath) {
            showReturned(undefined, "Descriptor only");
            refs.returned.textContent = "The Persephone root has no leaf value; use the descriptor and member controls below.";
            return;
        }
        if (state.values.has(state.selectedPath)) showReturned(state.values.get(state.selectedPath), "Returned value");
        else if (state.selectedMember && state.selectedMember.kind === "method") {
            showReturned(undefined, "Not invoked — use Invoke below");
        } else {
            showReturned(undefined, state.autoReadSelection ? "No value read" : "Not read — use Read below");
        }
    }

    function renderMember(member, parentPath) {
        const name = text(member.name);
        const path = memberPath(parentPath, name);
        const card = node("article", "member-card");
        const top = node("div", "member-top");
        top.append(node("span", "member-name", name));
        top.append(node("code", "member-path", path));
        top.append(node("span", "member-badge", text(member.kind || "member")));
        if (member.node === true) top.append(node("span", "member-badge", "node"));
        if (member.writable === true) top.append(node("span", "member-badge writable", "writable"));
        card.append(top);
        if (member.summary) card.append(node("div", "member-summary", member.summary));
        if (member.signature) card.append(node("div", "member-signature", member.signature));
        if (member.caution) card.append(node("div", "caution-box", "Caution: " + member.caution));

        const actions = node("div", "member-actions");
        if (member.kind === "method") {
            const args = node("input", "p-input md");
            args.type = "text";
            args.placeholder = "JSON array, e.g. []";
            args.setAttribute("aria-label", name + " arguments");
            const invoke = node("button", "p-btn md" + (member.caution ? " danger" : " primary"), "Invoke");
            invoke.type = "button";
            invoke.addEventListener("click", () => runMemberAction(member, path, "invoke", args.value, card));
            actions.append(args, invoke);
        } else {
            const read = node("button", "p-btn md", "Read");
            read.type = "button";
            read.addEventListener("click", () => readMember(path));
            actions.append(read);
            const assignment = node("input", "p-input md");
            assignment.type = "text";
            assignment.placeholder = member.writable === true ? "JSON value to assign" : "Read-only property";
            assignment.disabled = member.writable !== true;
            assignment.setAttribute("aria-label", name + " value");
            const assign = node("button", "p-btn md" + (member.caution ? " danger" : " primary"), "Assign");
            assign.type = "button";
            assign.disabled = member.writable !== true;
            assign.addEventListener("click", () => runMemberAction(member, path, "assign", assignment.value, card));
            actions.append(assignment, assign);
        }
        card.append(actions);
        return card;
    }

    function renderMembers(descriptor) {
        refs.members.replaceChildren();
        if (state.selectedMember) {
            refs.memberCount.textContent = "1";
            refs.members.append(renderMember(state.selectedMember, state.selectedRow.parentPath));
            return;
        }
        const members = descriptor && Array.isArray(descriptor.members) ? descriptor.members : [];
        refs.memberCount.textContent = String(members.length);
        if (!members.length) {
            refs.members.append(node("div", "empty-state", "No members are declared on this descriptor."));
            return;
        }
        members.forEach((member) => refs.members.append(renderMember(member, state.selectedPath)));
    }

    function renderDescriptor() {
        const descriptor = state.selectedDescriptor;
        refs.rootPath.textContent = state.rootPath || "Persephone";
        refs.selectedPath.textContent = state.selectedPath || "\"\" · Persephone root";
        refs.selectedKind.textContent = state.selectedMember
            ? text(state.selectedMember.kind || "member")
            : (descriptor ? text(descriptor.kind || "Node") : "Search result");
        refs.selectedSummary.textContent = state.selectedMember
            ? text(state.selectedMember.summary || "No summary supplied.")
            : (descriptor ? text(descriptor.summary || "No summary supplied.") : "Descriptor unavailable for this leaf path.");
        renderNotes(state.selectedMember ? null : descriptor);
        renderResultForSelection();
        renderMembers(descriptor);
        renderTree();
    }

    async function readMember(path) {
        setOperation("Reading " + path + "…");
        try {
            const result = await bridgeCall(path);
            state.values.set(path, result);
            showReturned(result, "Returned value");
            setOperation("Read " + path, "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            showReturned("Error: " + errorMessage(error), "Read failed");
            reportError(error);
        }
    }

    function formError(card, message) {
        let error = card.querySelector(".form-error");
        if (!error) { error = node("div", "form-error"); card.append(error); }
        error.textContent = message || "";
        if (!message) error.remove();
    }

    function parseJsonInput(raw, expectsArray) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { throw new Error("Enter valid JSON before continuing."); }
        if (expectsArray && !Array.isArray(parsed)) throw new Error("Method arguments must be a JSON array.");
        return parsed;
    }

    function confirmCaution(member, path, action) {
        return new Promise((resolve) => {
            const overlay = node("div", "confirm-overlay");
            const box = node("div", "confirm-box");
            box.setAttribute("role", "dialog");
            box.setAttribute("aria-modal", "true");
            box.append(node("div", "confirm-title", "Confirm " + action));
            box.append(node("div", "confirm-context", path));
            box.append(node("div", "confirm-caution", text(member.caution)));
            const actions = node("div", "confirm-actions");
            const cancel = node("button", "p-btn md", "Cancel");
            const proceed = node("button", "p-btn md danger", "Proceed once");
            cancel.type = proceed.type = "button";
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                document.removeEventListener("keydown", onKey, true);
                overlay.remove();
                resolve(value);
            };
            const onKey = (event) => {
                if (event.key === "Escape") { event.preventDefault(); finish(false); }
            };
            cancel.addEventListener("click", () => finish(false));
            proceed.addEventListener("click", () => finish(true));
            overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) finish(false); });
            actions.append(cancel, proceed);
            box.append(actions);
            overlay.append(box);
            refs.dialogMount.append(overlay);
            document.addEventListener("keydown", onKey, true);
            window.setTimeout(() => proceed.focus(), 0);
        });
    }

    async function runMemberAction(member, path, action, raw, card) {
        let payload;
        try { payload = parseJsonInput(raw, action === "invoke"); }
        catch (error) { formError(card, errorMessage(error)); return; }
        formError(card, "");
        if (member.caution) {
            const confirmed = await confirmCaution(member, path, action === "invoke" ? "method invocation" : "assignment");
            if (!confirmed) { setOperation("Cancelled — no bridge call was made."); return; }
        }
        setOperation((action === "invoke" ? "Invoking " : "Assigning ") + path + "…");
        try {
            const options = action === "invoke" ? { args: payload } : { value: payload };
            const result = await bridgeCall(path, options);
            state.values.set(path, result);
            showReturned(result, "Returned value");
            setOperation((action === "invoke" ? "Invoked " : "Assigned ") + path, "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            showReturned("Error: " + errorMessage(error), action === "invoke" ? "Invocation failed" : "Assignment failed");
            reportError(error);
        }
    }

    async function readSelectedValue(token) {
        const path = state.selectedPath;
        if (!path || !state.selectedDescriptor) return;
        refs.valueState.textContent = "Reading…";
        try {
            const value = await bridgeCall(path);
            if (token !== state.selectionToken) return;
            state.values.set(path, value);
            showReturned(value, "Returned value");
            setOperation("Read " + path, "success");
        } catch (error) {
            if (token !== state.selectionToken) return;
            if (isTrustFailure(error)) return showTrustRequired(error);
            showReturned("Error: " + errorMessage(error), "Read failed");
            setOperation("Read failed: " + errorMessage(error), "error");
        }
    }

    async function selectPath(path, options, row) {
        const autoRead = !!(options && options.autoRead);
        const token = ++state.selectionToken;
        state.selectedPath = path;
        state.selectedRow = row || null;
        state.selectedMember = row && row.source === "member" && !row.expandable ? row.member : null;
        state.autoReadSelection = autoRead;

        // Leaf rows are fully described by their parent's member record. Never append
        // .$describe to a leaf: descriptor-less values reject that call, and methods
        // must never be reached through a call-syntax path.
        if (row && !row.expandable) {
            state.selectedDescriptor = state.descriptors.get(row.parentPath) || null;
            renderDescriptor();
            setOperation("Ready", "success");
            return;
        }

        setOperation("Loading " + (path || "the Persephone root") + "…");
        try {
            state.selectedDescriptor = await loadDescriptor(path);
            renderDescriptor();
            if (autoRead) await readSelectedValue(token);
            if (state.selectedPath === path) setOperation("Ready", "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            state.selectedDescriptor = null;
            renderDescriptor();
            setOperation("Could not describe " + path + ": " + errorMessage(error), "error");
        }
    }

    async function togglePath(path, row) {
        if (!row || !row.expandable) return;
        if (state.expanded.has(path)) {
            state.expanded.delete(path);
            renderTree();
            return;
        }
        state.expanded.add(path);
        setOperation("Expanding " + (path || "root") + "…");
        try {
            // This is the only operation used to populate or expand a tree row.
            await loadDescriptor(path);
            renderTree();
            setOperation("Expanded " + (path || "root"), "success");
        } catch (error) {
            state.expanded.delete(path);
            if (isTrustFailure(error)) return showTrustRequired(error);
            setOperation("Expansion failed: " + errorMessage(error), "error");
        }
    }

    refs.tree.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-path]");
        if (!button) return;
        const path = button.dataset.path || "";
        const row = state.treeRows.get(path);
        if (!row) return;
        await selectPath(path, { autoRead: row.expandable && !row.caution }, row);
        await togglePath(path, row);
    });

    function renderSearch() {
        refs.searchResults.replaceChildren();
        if (!state.search.results.length) return;
        state.search.results.forEach((result) => {
            const button = node("button", "search-result");
            button.type = "button";
            const target = sanitizePath(result.path);
            button.dataset.path = target;
            button.append(node("code", "search-result-path", text(result.path)));
            const line = node("span", "search-result-line", text(result.matchedLine));
            line.title = text(result.matchedLine);
            button.append(line);
            button.addEventListener("click", () => selectPath(target, { autoRead: false }));
            refs.searchResults.append(button);
        });
    }

    refs.searchForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = refs.searchQuery.value.trim();
        if (!query) {
            refs.searchStatus.textContent = "Enter a non-empty query.";
            return;
        }
        const limit = Number(refs.searchLimit.value) || 20;
        refs.searchStatus.textContent = "Searching…";
        setOperation("Searching help…");
        try {
            const results = await bridgeCall("helpSearch", { args: [query, limit] });
            state.search = { query, limit, results: Array.isArray(results) ? results : [] };
            refs.searchStatus.textContent = state.search.results.length + " result" + (state.search.results.length === 1 ? "" : "s");
            renderSearch();
            setOperation("Search complete", "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            state.search.results = [];
            renderSearch();
            refs.searchStatus.textContent = "Search failed: " + errorMessage(error);
            setOperation("Search failed: " + errorMessage(error), "error");
        }
    });

    function renderEvents() {
        refs.events.replaceChildren();
        if (!state.events.items.length) {
            refs.events.append(node("div", "empty-state", "No retained events yet. New renderer changes will appear here."));
            return;
        }
        state.events.items.slice(0, 80).forEach((event) => {
            const item = node("article", "event-item");
            const meta = node("div", "event-meta");
            meta.append(node("span", "event-type", text(event && (event.kind || event.type || event.name || "event"))));
            if (event && event.seq !== undefined) meta.append(node("span", "event-seq", "#" + text(event.seq)));
            if (event && (event.time || event.timestamp)) meta.append(node("time", "event-time", text(event.time || event.timestamp)));
            item.append(meta);
            item.append(node("pre", "event-data", formatJson(event)));
            refs.events.append(item);
        });
    }

    function normalizeEvents(value) {
        if (Array.isArray(value)) return value;
        if (value && Array.isArray(value.events)) return value.events;
        if (value && value.event) return [value.event];
        return value ? [value] : [];
    }

    function eventKey(event) {
        if (event && event.seq !== undefined) return "seq:" + event.seq;
        return formatJson(event);
    }

    function appendNewEvents(incoming) {
        const known = new Set(state.events.items.map(eventKey));
        const fresh = incoming.filter((event) => {
            const key = eventKey(event);
            if (known.has(key)) return false;
            known.add(key);
            return true;
        });
        if (fresh.length) {
            state.events.items = fresh.concat(state.events.items).slice(0, 80);
            renderEvents();
        }
        return fresh.length;
    }

    async function eventLoop(generation) {
        if (state.events.waiting) return;
        state.events.waiting = true;
        refs.eventsState.textContent = "Live";
        try {
            while (generation === state.events.generation) {
                const result = await bridgeCall("events.wait", { args: [] });
                if (generation !== state.events.generation) return;
                if (result && result.pending === true) continue;
                const incoming = normalizeEvents(result);
                if (incoming.length && !appendNewEvents(incoming)) {
                    // Some bridge sessions can replay their current cursor. Keep the
                    // cancellable wait loop from spinning while retaining one copy.
                    await new Promise((resolve) => window.setTimeout(resolve, 250));
                }
            }
        } catch (error) {
            if (generation !== state.events.generation) return;
            refs.eventError.hidden = false;
            refs.eventError.textContent = "Live feed paused: " + errorMessage(error);
            refs.eventsState.textContent = "Paused";
        } finally {
            if (generation === state.events.generation) state.events.waiting = false;
        }
    }

    async function loadEvents() {
        const generation = ++state.events.generation;
        state.events.waiting = false;
        refs.eventError.hidden = true;
        refs.eventsState.textContent = "Loading…";
        try {
            const recent = await bridgeCall("events.recent", { args: [50] });
            if (generation !== state.events.generation) return;
            state.events.items = [];
            appendNewEvents(normalizeEvents(recent));
            renderEvents();
            void eventLoop(generation);
        } catch (error) {
            if (generation !== state.events.generation) return;
            refs.eventError.hidden = false;
            refs.eventError.textContent = "History unavailable: " + errorMessage(error);
            refs.eventsState.textContent = "Unavailable";
            renderEvents();
        }
    }

    $("refresh").addEventListener("click", async () => {
        state.descriptors.clear();
        state.values.clear();
        state.expanded.clear();
        await boot();
    });

    $("collapse-tree").addEventListener("click", () => {
        state.expanded.clear();
        renderTree();
        setOperation("Tree collapsed", "success");
    });

    refs.retry.addEventListener("click", () => boot());

    async function boot() {
        showBoot("Connecting to the live model…", "Reading the Persephone root descriptor.", false);
        state.events.generation++;
        try {
            // Trust-first preflight: do not render an empty tree before this succeeds.
            const root = await loadDescriptor(state.rootPath, true);
            state.selectedPath = state.rootPath;
            state.selectedRow = null;
            state.selectedMember = null;
            state.selectedDescriptor = root;
            state.expanded.add(state.rootPath);
            refs.boot.hidden = true;
            refs.shell.hidden = false;
            renderDescriptor();
            await loadEvents();
            setOperation("Ready", "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            showBoot("The live model could not be loaded", "AiVision Explorer could not preflight the Persephone root. Use Retry to try again; the tree stays hidden until a descriptor is available.", true);
            setOperation("Preflight failed: " + errorMessage(error), "error");
        }
    }

    initializeTheme();
    renderEvents();
    void boot();
})();
