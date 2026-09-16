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
        activeTab: "agent",
        tabSelectionPath: null,
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
        shell: $("app-shell"), tree: $("tree"), treePane: document.querySelector(".tree-pane"), memberOps: $("member-ops"), memberOpsBody: $("member-ops-body"), agentHint: $("agent-hint"), hintPanel: $("hint-panel"), explorerNote: $("explorer-note"), readSelected: $("read-selected"),
        selectedPath: $("selected-path"), selectedKind: $("selected-kind"), selectedSummary: $("selected-summary"),
        operation: $("operation-status"), returned: $("returned-value"), members: $("members"), memberCount: $("member-count"),
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

    /** The `$help` path of a node — the prose an agent reads with `<path>.$help`. */
    function helpPath(parentPath) {
        return parentPath ? parentPath + ".$help" : "$help";
    }

    /**
     * Name order for the two places a person SCANS a member list — the tree and the Members tab.
     *
     * Deliberately not applied to the Hint block, which is a faithful rebuild of what the agent is
     * handed and must keep the descriptor's own order: a host lists its members by importance
     * (`pages` before `boardVars`), and the first lines of a hint are the ones an agent weighs most.
     * Live children keep descriptor order too — they are often indexed (`[0]`, `[1]`, `[10]`), which
     * sorts as text into nonsense.
     */
    function byName(left, right) {
        return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    }

    function sortedMembers(descriptor) {
        const members = Array.isArray(descriptor && descriptor.members) ? descriptor.members : [];
        return members.slice().sort((left, right) => byName(left && left.name, right && right.name));
    }

    function descriptorRows(descriptor, parentPath) {
        const rows = [];
        const seen = new Set();
        // `$help` is a real resolvable path, so it is a real row: selecting it reads the same
        // prose the agent gets. It leads because it describes the node it hangs under.
        const help = helpPath(parentPath);
        seen.add(help);
        rows.push({
            path: help, label: "$help", memberKind: "help", expandable: false, special: true,
            summary: "The prose an agent reads at this path.", source: "help", parentPath,
        });
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
        sortedMembers(descriptor).forEach((member) => {
            if (!member) return;
            const path = memberPath(parentPath, member.name);
            if (seen.has(path)) return;
            seen.add(path);
            rows.push({
                path,
                label: member.name,
                special: Object.prototype.hasOwnProperty.call(SPECIAL_TABS, path),
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
        // The header's operation status already reports loading and errors; the tree pane
        // itself carries no prose.
        if (!rootDescriptor) return;
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
            const glyph = node("span", "tree-kind" + (row.special ? " special" : ""), row.memberKind === "method" ? "ƒ" : "◆");
            if (row.special) glyph.title = "AiVision-wide — opens its own tab";
            button.append(glyph);
            button.append(node("span", "tree-label", text(row.label)));
            if (row.restricted || (cached && cached.restricted)) button.append(node("span", "restricted-label", "restricted"));
            if (row.summary) button.title = text(row.summary);
            wrapper.append(button);
            refs.tree.append(wrapper);
            if (expanded && cached) {
                descriptorRows(cached, row.path).forEach((child) => addRow(child, depth + 1));
            }
        }

        // Built exactly like every other row — same caret glyphs, same order — so the root does
        // not read as a different kind of thing when collapsed.
        const rootExpanded = state.expanded.has(state.rootPath);
        const rootButton = node("button", "tree-row" + (state.selectedPath === state.rootPath ? " selected" : ""));
        rootButton.type = "button";
        rootButton.dataset.path = state.rootPath;
        rootButton.dataset.expandable = "true";
        rootButton.style.paddingLeft = "7px";
        rootButton.title = text(rootDescriptor.summary);
        rootButton.append(node("span", "tree-caret", rootExpanded ? "▾" : "›"));
        rootButton.append(node("span", "tree-kind", "◆"));
        rootButton.append(node("span", "tree-label", "Persephone root"));
        refs.tree.append(rootButton);
        renderedPaths.add(state.rootPath);
        state.treeRows.set(state.rootPath, { path: state.rootPath, label: "Persephone root", expandable: true, source: "root", parentPath: "" });
        if (state.expanded.has(state.rootPath)) {
            descriptorRows(rootDescriptor, state.rootPath).forEach((row) => addRow(row, 1));
        }
    }

    /**
     * The Explorer's own aside — deliberately NOT part of the agent envelope above it.
     *
     * Everything a `call` actually returns is the result and the hint; the descriptor's other
     * `$describe` fields are already inside the hint (`overview` at the root, `restricted` on
     * its second line) or are never declared in Persephone (`identity`). The one thing worth
     * saying that no agent channel carries is that a page has published no model yet.
     */
    function renderExplorerNote(descriptor) {
        const members = descriptor && Array.isArray(descriptor.members) ? descriptor.members : [];
        const editorWithoutModel = descriptor
            && (descriptor.kind === "BoardEditor" || descriptor.kind === "BrowserEditor")
            && !members.some((member) => member && member.name === "app");
        refs.explorerNote.hidden = !editorWithoutModel;
        refs.explorerNote.textContent = editorWithoutModel
            ? "This page has published no model — activate its tab once, then refresh. Until then it has no app member."
            : "";
    }


    /**
     * Re-render the hint the agent is handed with a result.
     *
     * The board bridge deliberately drops it — board-call-command hardcodes hints: "never" and
     * returns the bare result — so the Explorer rebuilds it from the same `$describe` payload the
     * host builds it from, in ai-vision's own `buildHint` format. Unlike a real session this is
     * never deduplicated: a host stops repeating a kind's member list once an agent has seen it,
     * and here the whole point is to see it every time.
     */
    function formatHintMember(member) {
        const name = member.kind === "method" ? (member.signature || member.name + "()") : member.name;
        const flags = [];
        if (member.writable) flags.push("writable");
        if (member.caution) flags.push("CAUTION: " + member.caution);
        return "  " + name + " — " + member.summary + (flags.length ? " [" + flags.join("; ") + "]" : "");
    }

    function buildAgentHint(descriptor) {
        if (!descriptor) return "No descriptor — this path resolves to a value, so the agent is given the value alone.";
        const parts = [descriptor.kind + " — " + descriptor.summary];
        if (descriptor.restricted) parts.push("restricted: " + descriptor.restricted);
        const children = Array.isArray(descriptor.children) ? descriptor.children : [];
        if (children.length) {
            parts.push("children (live):\n" + children.map((child) => {
                const line = "  " + child.path + " — " + child.kind + ": " + child.summary;
                return child.restricted ? line + " [restricted: " + child.restricted + "]" : line;
            }).join("\n"));
        }
        if (!descriptor.path && descriptor.overview) parts.push(descriptor.overview);
        const members = Array.isArray(descriptor.members) ? descriptor.members : [];
        if (members.length) parts.push("members:\n" + members.map(formatHintMember).join("\n"));
        parts.push('Details: call with path "' + (descriptor.path ? descriptor.path + ".$help" : "$help") + '".');
        return parts.join("\n");
    }

    /**
     * A `$help` row is the one selection with no hint to show. The resolver answers the help
     * segment ahead of everything else and returns the prose ALONE — its branch returns
     * `{ path, result }` with no `hint` — and the prose already contains what a hint would
     * repeat. Rendering one here would be the Explorer inventing something the agent never sees.
     */
    function renderAgentHint(descriptor, isHelpRow) {
        refs.hintPanel.hidden = Boolean(isHelpRow);
        if (isHelpRow) return;
        refs.agentHint.textContent = buildAgentHint(descriptor);
    }

    /** The Read control is the fallback for a value the Explorer will not fetch on its own —
     *  in practice only a cautioned member, since everything else reads on selection. */
    function updateReadControl() {
        refs.readSelected.hidden = !state.selectedPath || state.values.has(state.selectedPath);
    }

    // Strings, numbers, true/false/null, and object keys. Written as one pass over the already
    // formatted text so the highlighter cannot disagree with what JSON.stringify produced, and
    // built as DOM nodes rather than markup — no innerHTML, so a value containing "<script>"
    // stays a value.
    const JSON_TOKEN = /"(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

    function paintJson(target, source) {
        target.replaceChildren();
        let last = 0;
        let match;
        JSON_TOKEN.lastIndex = 0;
        while ((match = JSON_TOKEN.exec(source)) !== null) {
            if (match.index > last) target.append(document.createTextNode(source.slice(last, match.index)));
            const token = match[0];
            if (token[0] === '"' && match[1] !== undefined) {
                const colon = token.lastIndexOf(":");
                target.append(node("span", "json-key", token.slice(0, colon)));
                target.append(document.createTextNode(token.slice(colon)));
            } else if (token[0] === '"') {
                target.append(node("span", "json-string", token));
            } else if (token === "true" || token === "false") {
                target.append(node("span", "json-boolean", token));
            } else if (token === "null") {
                target.append(node("span", "json-null", token));
            } else {
                target.append(node("span", "json-number", token));
            }
            last = match.index + token.length;
        }
        if (last < source.length) target.append(document.createTextNode(source.slice(last)));
    }

    function showReturned(value) {
        // A string result is prose ($help, a file's text) — formatJson returns it verbatim and
        // it is not JSON to colour.
        if (typeof value === "string" || value === undefined) refs.returned.textContent = formatJson(value);
        else paintJson(refs.returned, formatJson(value));
        updateReadControl();
    }

    /** No value yet: say why in the block itself, since the header no longer carries a state. */
    function showPending(message) {
        refs.returned.textContent = message;
        updateReadControl();
    }

    function renderResultForSelection() {
        if (!state.selectedPath) {
            showPending("The Persephone root has no leaf value; use the tree and the member controls below.");
            return;
        }
        if (state.values.has(state.selectedPath)) {
            showReturned(state.values.get(state.selectedPath));
            return;
        }
        const caution = state.selectedRow && state.selectedRow.caution;
        showPending(caution ? "Not read — " + caution : "Not read yet.");
    }

    function renderMember(member, parentPath, origin) {
        const name = text(member.name);
        const path = memberPath(parentPath, name);
        const card = node("article", "member-card");
        const top = node("div", "member-top");
        top.append(node("span", "member-name", name));
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
            invoke.addEventListener("click", () => runMemberAction(member, path, "invoke", args.value, card, origin));
            actions.append(args, invoke);
        } else {
            const read = node("button", "p-btn md", "Read");
            read.type = "button";
            read.addEventListener("click", () => readMember(path, origin));
            actions.append(read);
            // A read-only property has no assignment at all, rather than a disabled box claiming
            // one: the descriptor already says `writable` is absent, and a permanently dead control
            // is noise on every row that has it.
            if (member.writable === true) {
                const assignment = node("input", "p-input md");
                assignment.type = "text";
                assignment.placeholder = "JSON value to assign";
                assignment.setAttribute("aria-label", name + " value");
                const assign = node("button", "p-btn md" + (member.caution ? " danger" : " primary"), "Assign");
                assign.type = "button";
                assign.addEventListener("click", () => runMemberAction(member, path, "assign", assignment.value, card, origin));
                actions.append(assignment, assign);
            }
        }
        card.append(actions);
        return card;
    }

    /** The Agent tab's operation panel: the controls for the selected leaf member only.
     *  A node selection has nothing to operate on itself — its operations are its members. */
    function renderMemberOps() {
        refs.memberOpsBody.replaceChildren();
        const member = state.selectedMember;
        refs.memberOps.hidden = !member;
        if (!member) return;
        refs.memberOpsBody.append(renderMember(member, state.selectedRow.parentPath, "agent"));
    }

    /**
     * The Members tab: the SELECTED node's member list, and nothing when the selection is not a
     * node. A leaf (`version`, a method, a `$help` row) owns no descriptor, and showing its
     * parent's members there made the tab look like it belonged to the selection when it did not —
     * the count in particular. The leaf's own controls live on the Agent tab.
     */
    function ownsDescriptor() {
        return !state.selectedRow || state.selectedRow.expandable === true;
    }

    function renderMembers(descriptor) {
        refs.members.replaceChildren();
        const members = ownsDescriptor() ? sortedMembers(descriptor) : [];
        refs.memberCount.textContent = " [" + members.length + "]";
        if (!members.length) {
            refs.members.append(node("div", "empty-state", ownsDescriptor()
                ? "No members are declared on this descriptor."
                : "This path is not a node, so it has no members. Its own controls are on the Agent tab."));
            return;
        }
        members.forEach((member) => refs.members.append(renderMember(member, state.selectedPath, "members")));
    }

    function renderDescriptor() {
        const descriptor = state.selectedDescriptor;
        // The toolbar carries the selected path; a long one ellipsises and keeps the full
        // value in its tooltip.
        const shown = state.selectedPath || "\"\" · Persephone root";
        refs.selectedPath.textContent = shown;
        refs.selectedPath.title = shown;
        refs.selectedKind.textContent = state.selectedMember
            ? text(state.selectedMember.kind || "member")
            : (descriptor ? text(descriptor.kind || "Node") : "Search result");
        refs.selectedSummary.textContent = state.selectedMember
            ? text(state.selectedMember.summary || "No summary supplied.")
            : (descriptor ? text(descriptor.summary || "No summary supplied.") : "Descriptor unavailable for this leaf path.");
        renderAgentHint(state.selectedMember ? null : descriptor, state.selectedRow && state.selectedRow.source === "help");
        renderExplorerNote(state.selectedMember ? null : descriptor);
        renderResultForSelection();
        renderMemberOps();
        renderMembers(descriptor);
        syncTabs();
        renderTree();
    }

    async function readMember(path, origin) {
        setOperation("Reading " + path + "…");
        try {
            const result = await bridgeCall(path);
            state.values.set(path, result);
            deliverResult(origin, "Returned value", path, result, false);
            setOperation("Read " + path, "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            deliverResult(origin, "Read failed", path, errorMessage(error), true);
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

    /**
     * The Members tab shows its own results HERE, not in the Agent tab's "Returned value"
     * panel. Those two tabs describe different things — the Agent tab is about the SELECTED
     * node, the Members tab is a list of that node's members — and writing a member's
     * result into the Agent panel made an invoke on one tab silently rewrite the other,
     * where the user could not even see it happen.
     */
    function showResultDialog(title, path, value, isError) {
        const overlay = node("div", "confirm-overlay");
        const box = node("div", "confirm-box result-box" + (isError ? " error" : ""));
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.append(node("div", "confirm-title", title));
        box.append(node("div", "confirm-context", path));

        const body = node("pre", "code-block result-code");
        // Same rule as showReturned: a string result is prose ($help, a file's text), not JSON
        // to colour.
        if (typeof value === "string" || value === undefined) body.textContent = formatJson(value);
        else paintJson(body, formatJson(value));
        box.append(body);

        const actions = node("div", "confirm-actions");
        const copy = node("button", "p-btn md", "Copy");
        const close = node("button", "p-btn md primary", "Close");
        copy.type = close.type = "button";
        copy.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(formatJson(value));
                copy.textContent = "Copied";
                window.setTimeout(() => { copy.textContent = "Copy"; }, 1400);
            } catch (error) {
                notifyInFrame(errorMessage(error), "error");
            }
        });

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
        };
        const onKey = (event) => {
            if (event.key === "Escape") { event.preventDefault(); finish(); }
        };
        close.addEventListener("click", finish);
        overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) finish(); });
        actions.append(copy, close);
        box.append(actions);
        overlay.append(box);
        refs.dialogMount.append(overlay);
        document.addEventListener("keydown", onKey, true);
        window.setTimeout(() => close.focus(), 0);
    }

    /** Where a member action's result goes: the Members tab pops a dialog, the Agent tab's own
     *  operation panel keeps writing into the panel the user is already looking at. */
    function deliverResult(origin, title, path, value, isError) {
        if (origin === "members") showResultDialog(title, path, value, isError);
        else showReturned(isError ? "Error: " + value : value);
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

    async function runMemberAction(member, path, action, raw, card, origin) {
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
            deliverResult(origin, action === "invoke" ? "Returned value" : "Assigned value", path, result, false);
            setOperation((action === "invoke" ? "Invoked " : "Assigned ") + path, "success");
        } catch (error) {
            if (isTrustFailure(error)) return showTrustRequired(error);
            deliverResult(origin, action === "invoke" ? "Invocation failed" : "Assignment failed",
                path, errorMessage(error), true);
            reportError(error);
        }
    }

    async function readSelectedValue(token) {
        const path = state.selectedPath;
        if (!path) return;
        try {
            const value = await bridgeCall(path);
            if (token !== state.selectionToken) return;
            state.values.set(path, value);
            showReturned(value);
            setOperation("Read " + path, "success");
        } catch (error) {
            if (token !== state.selectionToken) return;
            if (isTrustFailure(error)) return showTrustRequired(error);
            showReturned("Error: " + errorMessage(error));
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
            // A leaf reads on selection under the same rule as a node: reading is an ordinary
            // resolve, and reading a METHOD path returns its descriptor rather than calling it.
            // `caution` is the one thing that withholds the read.
            if (autoRead || row.source === "help") return readSelectedValue(token);
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
        // Reading never assigns and never invokes, so every row reads on selection — except one
        // that declares a caution, because a caution on a property is exactly the statement that
        // reading it acts (pages[i].grouped CREATES a grouped page). Those wait for Read.
        await selectPath(path, { autoRead: !row.caution }, row);
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

    /** "Live" is the expected state and says nothing; anything else is worth showing. */
    function setEventsState(label) {
        refs.eventsState.textContent = label;
        refs.eventsState.hidden = label === "Live";
    }

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
        setEventsState("Live");
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
            setEventsState("Paused — the feed stopped; refresh the board to resume.");
        } finally {
            if (generation === state.events.generation) state.events.waiting = false;
        }
    }

    async function loadEvents() {
        const generation = ++state.events.generation;
        state.events.waiting = false;
        refs.eventError.hidden = true;
        setEventsState("Loading…");
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
            setEventsState("Unavailable — the event feed could not be reached.");
            renderEvents();
        }
    }

    $("refresh").addEventListener("click", async () => {
        state.descriptors.clear();
        state.values.clear();
        state.expanded.clear();
        await boot();
    });

    // Views over one selection: what the agent sees at this path, and the node's whole member
    // list. Switching tabs makes no bridge call.
    const TAB_IDS = ["agent", "members", "search", "events"];

    /**
     * Two root members do not describe the selection — they ARE AiVision-wide facilities, so
     * their UI is not repeated under every node. Selecting one reveals its own tab; the tree
     * marks both rows to say they behave this way.
     */
    const SPECIAL_TABS = { helpSearch: "search", events: "events" };
    const CONTEXTUAL_TABS = ["search", "events"];

    function showTab(name) {
        const wanted = TAB_IDS.indexOf(name) >= 0 ? name : "agent";
        const active = $("tab-btn-" + wanted).hidden ? "agent" : wanted;
        state.activeTab = active;
        TAB_IDS.forEach((id) => {
            const button = $("tab-btn-" + id);
            const panel = $("tab-" + id);
            const selected = id === active;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-selected", selected ? "true" : "false");
            panel.hidden = !selected;
        });
    }

    /** Reveal the selected member's own tab, and open it the first time that selection lands.
     *  A later click on Agent or Members stays put — only a new selection re-opens it. */
    function syncTabs() {
        const special = SPECIAL_TABS[state.selectedPath] || null;
        CONTEXTUAL_TABS.forEach((id) => { $("tab-btn-" + id).hidden = special !== id; });
        const changed = state.tabSelectionPath !== state.selectedPath;
        state.tabSelectionPath = state.selectedPath;
        showTab(changed && special ? special : state.activeTab);
    }

    // A node the auto-read rule refuses (any row carrying `caution`) is still readable on
    // request — that explicit read is what an agent's own call to the path does.
    $("read-selected").addEventListener("click", async () => {
        const row = state.selectedRow;
        const caution = row && row.caution;
        if (caution && !(await confirmCaution({ caution }, state.selectedPath, "read"))) {
            setOperation("Cancelled — no bridge call was made.");
            return;
        }
        await readSelectedValue(++state.selectionToken);
    });

    // Tree pane width: dragged, keyboard-adjustable, and remembered per viewer. localStorage
    // can throw outright (private windows, blocked site data), so every access is guarded and
    // the default width is always a working fallback.
    const PANE_MIN = 180;
    const PANE_MAX = 720;
    const PANE_KEY = "aivision-explorer.treeWidth";

    function applyPaneWidth(width, persist) {
        const clamped = Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(width)));
        refs.treePane.style.flexBasis = clamped + "px";
        if (persist) {
            try { window.localStorage.setItem(PANE_KEY, String(clamped)); } catch (_) { /* not available */ }
        }
        return clamped;
    }

    (function restorePaneWidth() {
        let stored = null;
        try { stored = window.localStorage.getItem(PANE_KEY); } catch (_) { stored = null; }
        const width = Number(stored);
        if (Number.isFinite(width) && width > 0) applyPaneWidth(width, false);
    })();

    (function enablePaneResize() {
        const handle = $("pane-resizer");
        handle.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            handle.classList.add("dragging");
            document.body.classList.add("resizing");
            const origin = refs.treePane.getBoundingClientRect().left;
            const onMove = (move) => applyPaneWidth(move.clientX - origin, false);
            const onUp = () => {
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
                handle.removeEventListener("pointercancel", onUp);
                handle.classList.remove("dragging");
                document.body.classList.remove("resizing");
                applyPaneWidth(refs.treePane.getBoundingClientRect().width, true);
            };
            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
            handle.addEventListener("pointercancel", onUp);
        });
        handle.addEventListener("keydown", (event) => {
            const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
            if (!step) return;
            event.preventDefault();
            applyPaneWidth(refs.treePane.getBoundingClientRect().width + step, true);
        });
    })();

    TAB_IDS.forEach((id) => $("tab-btn-" + id).addEventListener("click", () => showTab(id)));

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
