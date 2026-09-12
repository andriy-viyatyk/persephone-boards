// Force Graph board — shared UI primitives (BT-015).
//
// The board has no UIKit (§5.5) and no app dialog / popup-menu API (§5.2, §5.3), so this file
// carries the small pieces every panel needs: DOM helpers, the level/shape SVG icons
// (GraphIcons.ts), the markdown builder and link renderer (GraphTooltipView.ts), the in-frame
// dialog overlays, the context-menu adapter, and the hover tooltip card.
//
// Menus ride `AVGrid.showMenu` — vendored beside the two data grids, taking exactly Persephone's
// own `MenuItem` shape (nested `items`, `startGroup`, `disabled`, `invisible`, `icon`) and themed
// from `--p-*`. That keeps EPIC-100 D2 (in-frame, no bridge surface) without a second menu
// implementation living next to the one already in `lib/`.
(() => {
    const FG = (window.FG = window.FG || {});
    const SVG_NS = "http://www.w3.org/2000/svg";

    // =====================================================================
    // DOM helpers
    // =====================================================================

    function el(tag, props, ...children) {
        const node = document.createElement(tag);
        if (props) {
            for (const [key, value] of Object.entries(props)) {
                if (key === "class") node.className = value;
                else if (key === "text") node.textContent = value;
                else if (key === "style") Object.assign(node.style, value);
                else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
                else if (value === true) node.setAttribute(key, "");
                else if (value !== false && value != null) node.setAttribute(key, value);
            }
        }
        for (const child of children) {
            if (child == null || child === false) continue;
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return node;
    }

    /** Escape-free highlight: rebuild `host` as text runs with <mark> around each matched word. */
    function highlightInto(host, text, query) {
        host.replaceChildren();
        const value = String(text == null ? "" : text);
        const words = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) { host.append(document.createTextNode(value)); return; }

        const lower = value.toLowerCase();
        const marks = [];
        for (const word of words) {
            let from = 0;
            for (;;) {
                const at = lower.indexOf(word, from);
                if (at < 0) break;
                marks.push([at, at + word.length]);
                from = at + word.length;
            }
        }
        if (marks.length === 0) { host.append(document.createTextNode(value)); return; }
        marks.sort((a, b) => a[0] - b[0]);

        let cursor = 0;
        for (const [start, end] of marks) {
            if (end <= cursor) continue;
            const from = Math.max(start, cursor);
            if (from > cursor) host.append(document.createTextNode(value.slice(cursor, from)));
            host.append(el("mark", { class: "fg-match", text: value.slice(from, end) }));
            cursor = end;
        }
        if (cursor < value.length) host.append(document.createTextNode(value.slice(cursor)));
    }

    // =====================================================================
    // Icons (port of GraphIcons.ts)
    // =====================================================================

    function createSvg(size, className) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", className || "fg-shape-icon");
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.setAttribute("viewBox", "0 0 " + size + " " + size);
        return svg;
    }

    function appendSvgChild(parent, tagName, attributes) {
        const child = document.createElementNS(SVG_NS, tagName);
        for (const [name, value] of Object.entries(attributes)) child.setAttribute(name, String(value));
        parent.append(child);
        return child;
    }

    /** The group icon needs the live group-border colour; the palette is pushed in by app.js. */
    let groupBorderColor = "currentColor";
    function setIconGroupBorder(color) { groupBorderColor = color || "currentColor"; }

    function createShapeIconElement(shape, size) {
        size = size || 16;
        const c = size / 2;
        const r = size * 0.375;
        const svg = createSvg(size);

        if (shape === "root") {
            appendSvgChild(svg, "polygon", { points: FG.pointsToSvgString(FG.compassPoints(c, c, r * 1.1, r * 0.35)), fill: "currentColor" });
            return svg;
        }
        if (shape === "group") {
            appendSvgChild(svg, "circle", { cx: c, cy: c, r: r * 0.65, fill: "currentColor" });
            appendSvgChild(svg, "circle", { cx: c, cy: c, r, fill: "none", stroke: groupBorderColor, "stroke-width": 1.5 });
            return svg;
        }
        if (shape === "circle") appendSvgChild(svg, "circle", { cx: c, cy: c, r, fill: "currentColor" });
        if (shape === "square") appendSvgChild(svg, "rect", { x: c - r, y: c - r, width: r * 2, height: r * 2, fill: "currentColor" });
        if (shape === "diamond") appendSvgChild(svg, "polygon", { points: FG.pointsToSvgString(FG.diamondPoints(c, c, r)), fill: "currentColor" });
        if (shape === "triangle") appendSvgChild(svg, "polygon", { points: FG.pointsToSvgString(FG.trianglePoints(c, c, r)), fill: "currentColor" });
        if (shape === "star") appendSvgChild(svg, "polygon", { points: FG.pointsToSvgString(FG.starPoints(c, c, r * 1.1, r * 0.5, 5)), fill: "currentColor" });
        if (shape === "hexagon") appendSvgChild(svg, "polygon", { points: FG.pointsToSvgString(FG.hexagonPoints(c, c, r)), fill: "currentColor" });
        return svg;
    }

    function createLevelIconElement(level, size) {
        size = size || 16;
        const c = size / 2;
        const svg = createSvg(size);
        if (level === "root") {
            const r = size * 0.375;
            appendSvgChild(svg, "polygon", { points: FG.pointsToSvgString(FG.compassPoints(c, c, r * 1.1, r * 0.35)), fill: "currentColor" });
            return svg;
        }
        appendSvgChild(svg, "circle", { cx: c, cy: c, r: (size / 2) - level, fill: "currentColor" });
        return svg;
    }

    /** Open-link icon, matching the built-in node context menu. */
    function createOpenLinkIconElement() {
        const svg = createSvg(16, "fg-menu-icon");
        svg.setAttribute("viewBox", "0 0 24 24");
        appendSvgChild(svg, "path", { d: "M14 4l6 5-6 5V10c-5 0-9 2-11 7 1-7 5-11 11-12V4z", fill: "currentColor" });
        return svg;
    }

    function createGlyph(strokeWidth) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "12");
        svg.setAttribute("height", "12");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", strokeWidth);
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        return svg;
    }

    function createCopyIconElement() {
        const svg = createGlyph("1.5");
        appendSvgChild(svg, "rect", { x: 5.5, y: 5.5, width: 9, height: 9, rx: 1 });
        appendSvgChild(svg, "path", { d: "M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" });
        return svg;
    }

    function createCheckIconElement() {
        const svg = createGlyph("2");
        appendSvgChild(svg, "polyline", { points: "3 8 7 12 13 4" });
        return svg;
    }

    // =====================================================================
    // Markdown (port of GraphTooltipView.buildMarkdown / appendWithLinks)
    // =====================================================================

    function buildMarkdown(node, isRoot) {
        const lines = [];
        const title = node.title || node.id;
        if (isRoot) lines.push("**Root Node**");
        if (node.isGroup) lines.push("**Group**");
        lines.push("## " + title);
        if (node.title) lines.push("`" + node.id + "`");

        const customProps = FG.getCustomProperties(node);
        if (customProps.length > 0) {
            lines.push("");
            lines.push("| Property | Value |");
            lines.push("|----------|-------|");
            for (const [key, value] of customProps) {
                lines.push("| " + key + " | " + value.replace(/\|/g, "\\|") + " |");
            }
        }
        return lines.join("\n");
    }

    /** Append `text` to `parent`, turning markdown links into clickable anchors. */
    function appendWithLinks(parent, text) {
        const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (match.index > lastIndex) parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
            const link = el("a", { class: "fg-tooltip-link", href: FG.toNavigableHref(match[2]), title: match[2], text: match[1] });
            parent.append(link);
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex === 0) parent.append(document.createTextNode(text));
        else if (lastIndex < text.length) parent.append(document.createTextNode(text.slice(lastIndex)));
    }

    // =====================================================================
    // Dialogs — in-frame overlays (EPIC-100 D2; a board frame has no window.confirm/prompt)
    // =====================================================================

    let openOverlays = 0;
    const isOverlayOpen = () => openOverlays > 0;

    function overlayShell(build) {
        return new Promise((resolve) => {
            openOverlays++;
            const overlay = el("div", { class: "confirm-overlay" });
            const box = el("div", { class: "confirm-box" });
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                openOverlays--;
                document.removeEventListener("keydown", onKey, true);
                overlay.remove();
                resolve(value);
            };
            const onKey = (event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                done(undefined);
            };
            document.addEventListener("keydown", onKey, true);
            overlay.append(box);
            overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) done(undefined); });
            build(box, done);
            document.body.append(overlay);
        });
    }

    /**
     * Confirmation dialog. `buttons` defaults to ["Yes", "No"] — matching the app's
     * showConfirmationDialog — and the three-button Group Options dialog passes its own.
     * Resolves with the pressed button's label, or undefined when dismissed.
     */
    function showConfirmationDialog(params) {
        const buttons = params.buttons && params.buttons.length ? params.buttons : ["Yes", "No"];
        return overlayShell((box, done) => {
            box.dataset.name = "graph-confirm-dialog";
            if (params.title) box.append(el("div", { class: "confirm-title", text: params.title }));
            box.append(el("div", { class: "confirm-msg", text: params.message || "" }));
            const row = el("div", { class: "confirm-actions" });
            let primary = null;
            buttons.forEach((label, index) => {
                const isPrimary = index === 0 && label !== "Cancel" && label !== "No";
                const button = el("button", {
                    class: "p-btn md" + (isPrimary ? " primary" : ""),
                    text: label,
                    onclick: () => done(label),
                });
                if (isPrimary) primary = button;
                row.append(button);
            });
            box.append(row);
            setTimeout(() => (primary || row.firstChild).focus(), 0);
        });
    }

    /** Input dialog (the group title). Resolves { button: "OK", value } or undefined. */
    function showInputDialog(params) {
        return overlayShell((box, done) => {
            box.dataset.name = "graph-input-dialog";
            if (params.title) box.append(el("div", { class: "confirm-title", text: params.title }));
            box.append(el("div", { class: "confirm-msg", text: params.message || "" }));
            const input = el("input", { class: "p-input md fg-dialog-input", type: "text", spellcheck: "false" });
            input.value = params.value == null ? "" : String(params.value);
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); done({ button: "OK", value: input.value }); }
            });
            box.append(input);
            box.append(el("div", { class: "confirm-actions" },
                el("button", { class: "p-btn md", text: "Cancel", onclick: () => done(undefined) }),
                el("button", { class: "p-btn md primary", text: "OK", onclick: () => done({ button: "OK", value: input.value }) }),
            ));
            setTimeout(() => { input.focus(); input.select(); }, 0);
        });
    }

    // =====================================================================
    // Popup menus
    // =====================================================================

    let popupOpen = false;
    const isPopupOpen = () => popupOpen;

    /** Open a menu at a viewport point, or anchored to an element. Resolves when it closes. */
    async function showPopupMenu(anchor, items) {
        const AVG = window.AVGrid;
        if (!AVG || typeof AVG.showMenu !== "function") return undefined;
        const visible = items.filter((item) => !item.invisible);
        if (visible.length === 0) return undefined;
        popupOpen = true;
        try {
            return await AVG.showMenu({ anchor, items: visible, className: "fg-menu" });
        } finally {
            // Let the click that closed the menu land before the canvas treats it as a selection.
            setTimeout(() => { popupOpen = false; }, 0);
        }
    }

    // =====================================================================
    // Menu builders (port of GraphContextMenu.ts)
    // =====================================================================

    function buildNodeContextMenu(o) {
        const items = [];
        const links = o.nodeLinks && o.nodeLinks.links ? o.nodeLinks.links : [];
        if (links.length === 1) {
            items.push({ label: "Open " + links[0].propertyKey, icon: createOpenLinkIconElement(), onClick: () => o.nodeLinks.onOpen(links[0].href) });
        } else if (links.length > 1) {
            items.push({
                label: "Open link...",
                icon: createOpenLinkIconElement(),
                items: links.map((link) => ({
                    label: "Open " + link.propertyKey,
                    icon: createOpenLinkIconElement(),
                    onClick: () => o.nodeLinks.onOpen(link.href),
                })),
            });
        }

        const hasLinks = links.length > 0;
        items.push(
            { label: "Add Child", onClick: () => o.actions.addChild(o.nodeId), startGroup: hasLinks || undefined },
            { label: "Set as Root", onClick: () => o.actions.setRootNode(o.nodeId), disabled: o.isRoot },
            { label: "Collapse", onClick: () => o.actions.collapseNode(o.nodeId), disabled: !o.hasVisibilityFilter },
            { label: "Select children", onClick: () => o.actions.selectChildren(), startGroup: true },
        );

        const isMultiSelected = o.multiSelectedCount !== undefined && o.multiSelectedCount > 1;
        items.push({
            label: isMultiSelected ? "Delete " + o.multiSelectedCount + " Nodes" : "Delete Node",
            onClick: () => (isMultiSelected ? o.actions.deleteSelected() : o.actions.deleteNode(o.nodeId)),
            startGroup: true,
        });

        if (o.neighborIds.length > 0) {
            items.push({
                label: "Delete Link to...",
                startGroup: true,
                items: o.neighborIds.map((id) => ({
                    label: o.getNodeLabel(id),
                    onClick: () => o.actions.deleteLink(o.nodeId, id),
                })),
            });
        }

        const hideGroup = o.groupingEnabled === false;
        if (o.multiSelectedCount !== undefined && o.multiSelectedCount >= 2) {
            items.push({ label: "Group Selected", onClick: () => o.actions.groupSelected(), startGroup: true, invisible: hideGroup });
        }
        if (o.isInGroup) {
            items.push({ label: "Remove from Group", onClick: () => o.actions.removeFromGroup(o.nodeId), invisible: hideGroup });
        }
        return items;
    }

    function buildGroupNodeContextMenu(o) {
        const items = [
            { label: "Edit Title", onClick: () => o.actions.editGroupTitle(o.groupId) },
            { label: "Collapse", onClick: () => o.actions.collapseNode(o.groupId), disabled: !o.hasVisibilityFilter },
            { label: "Select members", onClick: () => o.actions.selectMembers(), startGroup: true },
            { label: "Select members deep", onClick: () => o.actions.selectMembersDeep() },
            { label: "Delete (Ungroup)", onClick: () => o.actions.ungroupNode(o.groupId), startGroup: true },
            { label: "Delete with Children", onClick: () => o.actions.deleteGroup(o.groupId) },
        ];
        if (o.multiSelectedCount !== undefined && o.multiSelectedCount >= 2) {
            items.push({ label: "Group Selected", onClick: () => o.actions.groupSelected(), startGroup: true, invisible: o.groupingEnabled === false });
        }
        return items;
    }

    function buildEmptyAreaContextMenu(worldX, worldY, actions) {
        return [{ label: "Add Node", onClick: () => actions.addNode(worldX, worldY) }];
    }

    function buildSelectionMenu(info, actions, groupingEnabled) {
        const items = [
            { label: "Select children", onClick: actions.selectChildren, disabled: !info.hasNonGroups },
            { label: "Select members", onClick: actions.selectMembers, disabled: !info.hasGroups, invisible: groupingEnabled === false },
            { label: "Select members deep", onClick: actions.selectMembersDeep, disabled: !info.hasGroups, invisible: groupingEnabled === false },
            { label: "Highlight", onClick: actions.highlight },
            { label: "Copy (markdown)", onClick: actions.copyMarkdown, startGroup: true },
            { label: "Open (markdown)", onClick: actions.openMarkdown },
            { label: "Open in grid", onClick: actions.openGrid },
        ];
        if (info.count >= 2) {
            items.push({ label: "Group Selected", onClick: actions.groupSelected, startGroup: true, invisible: groupingEnabled === false });
        }
        items.push(
            { label: "Extract", onClick: actions.extract, startGroup: true },
            { label: "Extract with children", onClick: actions.extractWithChildren },
            { label: "Delete " + info.count + " Node" + (info.count > 1 ? "s" : ""), onClick: actions.deleteNodes, startGroup: true },
        );
        return items;
    }

    // =====================================================================
    // Hover tooltip card (port of GraphTooltipModel.ts + GraphTooltipView.ts)
    // =====================================================================

    const TOOLTIP_OFFSET = 12;

    function createTooltip(ctx) {
        let showTimer, hideTimer, copyTimer;
        let hovered = false;
        let current = null;
        let root = null;

        function remove() {
            if (copyTimer) { clearTimeout(copyTimer); copyTimer = undefined; }
            if (root) { root.remove(); root = null; }
            current = null;
        }

        function clear() {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);
            hovered = false;
            remove();
        }

        function clearDelayed() {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { if (!hovered) clear(); }, 150);
        }

        function position(x, y) {
            const rect = root.getBoundingClientRect();
            let left = x + TOOLTIP_OFFSET;
            let top = y + TOOLTIP_OFFSET;
            let maxHeight;
            if (left + rect.width > window.innerWidth - TOOLTIP_OFFSET) left = x - rect.width - TOOLTIP_OFFSET;
            if (top + rect.height > window.innerHeight - TOOLTIP_OFFSET) top = y - rect.height - TOOLTIP_OFFSET;
            if (top < TOOLTIP_OFFSET) {
                top = TOOLTIP_OFFSET;
                maxHeight = window.innerHeight - TOOLTIP_OFFSET * 2;
            } else if (top + rect.height > window.innerHeight - TOOLTIP_OFFSET) {
                maxHeight = window.innerHeight - top - TOOLTIP_OFFSET;
            }
            root.style.left = Math.max(0, left) + "px";
            root.style.top = Math.max(0, top) + "px";
            root.style.maxHeight = maxHeight === undefined ? "" : maxHeight + "px";
            root.style.overflowY = maxHeight === undefined ? "" : "auto";
        }

        function render(node, x, y, isRoot) {
            remove();
            current = { node, isRoot };
            root = el("div", { class: "fg-tooltip", role: "tooltip", "data-name": "graph-tooltip" });
            root.addEventListener("mouseenter", () => { hovered = true; clearTimeout(hideTimer); });
            root.addEventListener("mouseleave", () => { hovered = false; clearDelayed(); });

            const headerContent = el("div", { class: "fg-tooltip-header-content" });
            if (isRoot) headerContent.append(el("div", { class: "fg-tooltip-badge", text: "Root Node" }));
            if (node.isGroup) headerContent.append(el("div", { class: "fg-tooltip-badge", text: "Group" }));
            const titleEl = el("div", { class: "fg-tooltip-title" });
            appendWithLinks(titleEl, node.title || node.id);
            headerContent.append(titleEl);
            if (node.title) headerContent.append(el("div", { class: "fg-tooltip-id", text: node.id }));

            const copyButton = el("button", { class: "p-btn icon sm", title: "Copy as Markdown", "data-name": "graph-tooltip-copy" }, createCopyIconElement());
            copyButton.addEventListener("click", () => {
                const markdown = buildMarkdown(node, isRoot);
                void Promise.resolve(navigator.clipboard.writeText(markdown)).then(() => {
                    copyButton.replaceChildren(createCheckIconElement());
                    clearTimeout(copyTimer);
                    copyTimer = setTimeout(() => {
                        copyTimer = undefined;
                        if (copyButton.isConnected) copyButton.replaceChildren(createCopyIconElement());
                    }, 1500);
                }).catch(() => { /* clipboard denial is not worth a toast */ });
            });

            const openButton = el("button", { class: "p-btn icon sm", title: "Open in new page", "data-name": "graph-tooltip-open" }, createOpenLinkIconElement());
            openButton.addEventListener("click", () => {
                void ctx.openContent({
                    editor: "md-view", language: "markdown",
                    title: node.title || node.id, content: buildMarkdown(node, isRoot),
                });
                clear();
            });

            root.append(el("div", { class: "fg-tooltip-header" }, headerContent, copyButton, openButton));

            const customProperties = FG.getCustomProperties(node);
            if (customProperties.length > 0) {
                const properties = el("div", { class: "fg-tooltip-properties" });
                for (const [key, value] of customProperties) {
                    properties.append(el("span", { class: "fg-tooltip-property-key", text: key }));
                    const valueEl = el("span", { class: "fg-tooltip-property-value", title: value });
                    appendWithLinks(valueEl, value);
                    properties.append(valueEl);
                }
                root.append(properties);
            }

            document.body.append(root);
            position(x, y);
        }

        function handleHoverChanged(nodeId, clientX, clientY) {
            clearTimeout(showTimer);
            if (!nodeId || ctx.renderer.isDragging || isPopupOpen() || isOverlayOpen()) {
                clearDelayed();
                ctx.setStatusHint("");
                return;
            }
            clearTimeout(hideTimer);
            hovered = false;
            if (current && current.node.id !== nodeId) remove();
            ctx.setStatusHint(linkStatusHint(nodeId));

            showTimer = setTimeout(() => {
                const node = ctx.renderer.getNodes().find((n) => n.id === nodeId);
                if (!node) return;
                const rootNode = ctx.getRootNodeId();
                render(Object.assign({}, node), clientX, clientY, rootNode === node.id || undefined);
            }, 500);
        }

        /** The "Alt+Click to …" footer hint (port of GraphTooltipModel.updateLinkStatusHint). */
        function linkStatusHint(nodeId) {
            const renderer = ctx.renderer;
            const selectedId = renderer.selectedId;
            const source = ctx.getSourceNodes();
            if (!selectedId || renderer.selectedIds.size !== 1 || nodeId === selectedId || !source) return "";

            const selectedNode = source.find((n) => n.id === selectedId);
            const hoveredNode = source.find((n) => n.id === nodeId);
            const groupModel = ctx.groupModel;

            if (selectedNode && selectedNode.isGroup && hoveredNode && hoveredNode.isGroup) {
                const hoveredLabel = FG.nodeLabel(hoveredNode);
                const selectedLabel = FG.nodeLabel(selectedNode);
                if (groupModel.getGroupOf(nodeId) === selectedId) return 'Alt+Click to remove "' + hoveredLabel + '" from "' + selectedLabel + '"';
                if (groupModel.getGroupOf(selectedId) === nodeId) return 'Alt+Click to remove "' + selectedLabel + '" from "' + hoveredLabel + '"';
                return 'Alt+Click to add "' + hoveredLabel + '" into "' + selectedLabel + '"';
            }
            if (selectedNode && selectedNode.isGroup) {
                const label = FG.nodeLabel(selectedNode);
                return groupModel.getGroupOf(nodeId) === selectedId
                    ? 'Alt+Click to remove from "' + label + '"'
                    : 'Alt+Click to add to "' + label + '"';
            }
            if (hoveredNode && hoveredNode.isGroup) {
                const groupLabel = FG.nodeLabel(hoveredNode);
                return groupModel.getGroupOf(selectedId) === nodeId
                    ? 'Alt+Click to remove from "' + groupLabel + '"'
                    : 'Alt+Click to add to "' + groupLabel + '"';
            }
            const label = FG.nodeLabel(selectedNode || { id: selectedId });
            return ctx.dataModel.linkExists(selectedId, nodeId)
                ? 'Alt+Click to unlink from "' + label + '"'
                : 'Alt+Click to link with "' + label + '"';
        }

        return { handleHoverChanged, clear, get visible() { return !!root; } };
    }

    /** Bottom-left resize grip for the detail panel. The three diagonal strokes and the 12x12
     *  box are copied from the built-in editor's `createResizeElement` so the affordance looks
     *  identical; the panel is anchored top-right, so this corner grows it on both axes. */
    function createResizeGripElement() {
        const svg = createSvg(12, "fg-resize-grip");
        for (const [x1, y1, x2, y2] of [[2, 10, 0, 12], [6, 10, 0, 4], [10, 10, 0, 0]]) {
            appendSvgChild(svg, "line", { x1, y1, x2, y2 });
        }
        return svg;
    }

    Object.assign(FG, {
        el, highlightInto,
        createShapeIconElement, createLevelIconElement, createOpenLinkIconElement,
        createCopyIconElement, createCheckIconElement, setIconGroupBorder,
        createResizeGripElement,
        buildMarkdown, appendWithLinks,
        showConfirmationDialog, showInputDialog, isOverlayOpen,
        showPopupMenu, isPopupOpen,
        buildNodeContextMenu, buildGroupNodeContextMenu, buildEmptyAreaContextMenu, buildSelectionMenu,
        createTooltip,
    });
})();
