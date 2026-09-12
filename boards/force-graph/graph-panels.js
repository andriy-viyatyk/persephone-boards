// Force Graph board — the three panel families (BT-015).
//
//   * the legend panel  (port of GraphLegendPanelView.ts)
//   * the selected-node detail panel and its two av-grid grids (GraphDetailPanelView.ts)
//   * the Physics / Expansion / Results toolbar panels (GraphTuningSlidersView.ts,
//     GraphExpansionSettingsView.ts and the Results branch of GraphBodyView.ts)
//
// Each factory returns `{ root, update() }`; `app.js` mounts the roots into the slots BT-014 left
// in index.html and calls `update()` from its single `refreshChrome()` pass. There is no reactive
// framework here on purpose — the graph's state lives in the models, and a full re-read on each
// refresh is cheap next to a canvas repaint.
(() => {
    const FG = (window.FG = window.FG || {});
    const el = (...args) => FG.el(...args);

    const SHAPES = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
    const LEVELS = [1, 2, 3, 4, 5];
    const MAX_DISPLAYED_RESULTS = 100;
    const AUTO_ROOT = "__auto__";
    const KNOWN_LINK_KEYS = new Set(["id", "title", "level", "shape"]);

    const grid = () => (window.AVGrid ? window.AVGrid.AVGrid : null);

    // =====================================================================
    // Legend panel
    // =====================================================================

    FG.createLegendPanel = function createLegendPanel(ctx) {
        const state = {
            expanded: false,
            activeTab: "selection",
            checkedLevels: [],
            checkedShapes: [],
            selectionFilter: "selected-with-children",
        };
        let descriptionTimers = new Map();
        let appliedSignature = "";

        const title = el("span", { class: "fg-panel-title", text: "Legend" });
        const chevron = el("span", { class: "fg-chevron", text: "▲" });
        const header = el("div", { class: "fg-panel-header", "data-name": "graph-legend-toggle" }, title, chevron);
        const body = el("div", { class: "fg-legend-body" });
        const root = el("div", { class: "fg-legend", "data-name": "graph-legend-panel" }, header, body);
        header.addEventListener("click", () => { state.expanded = !state.expanded; update(); });

        function scheduleDescription(tab, key, value) {
            const timerKey = tab + ":" + key;
            clearTimeout(descriptionTimers.get(timerKey));
            descriptionTimers.set(timerKey, setTimeout(() => ctx.setLegendDescription(tab, key, value), 300));
        }

        function tabStrip() {
            const strip = el("div", { class: "fg-tabs" });
            for (const tab of ["selection", "level", "shape"]) {
                const button = el("button", {
                    class: "fg-tab", type: "button", "data-name": "graph-legend-tab-" + tab,
                    text: tab.charAt(0).toUpperCase() + tab.slice(1),
                    onclick: () => { state.activeTab = tab; update(); },
                });
                if (state.activeTab === tab) button.dataset.active = "";
                strip.append(button);
            }
            return strip;
        }

        function selectionRows() {
            const rows = el("div", { class: "fg-legend-content" });
            const filters = [
                ["selected", "Selected"],
                ["selected-with-children", "Selected with children"],
                ["not-selected", "Not selected"],
            ];
            for (const [key, label] of filters) {
                const radio = el("input", { class: "fg-legend-check", type: "radio", name: "fg-legend-selection" });
                radio.checked = state.selectionFilter === key;
                radio.addEventListener("change", () => {
                    state.selectionFilter = state.selectionFilter === key ? "" : key;
                    update();
                });
                rows.append(el("div", { class: "fg-legend-row" }, radio, el("span", { class: "fg-legend-label", text: label })));
            }
            return rows;
        }

        function keyRows() {
            const present = ctx.getPresentLevelsAndShapes();
            const isLevel = state.activeTab === "level";
            const descriptions = (ctx.getLegendDescriptions()[isLevel ? "levels" : "shapes"]) || {};
            const checked = isLevel ? state.checkedLevels : state.checkedShapes;
            const keys = [];
            if (present.hasRoot) {
                keys.push({ key: "root", label: "Root", icon: () => (isLevel ? FG.createLevelIconElement("root", 14) : FG.createShapeIconElement("root", 14)) });
            }
            if (present.hasGroup) keys.push({ key: "group", label: "Group", icon: () => FG.createShapeIconElement("group", 14) });
            if (isLevel) {
                for (const level of LEVELS) keys.push({ key: String(level), label: "Level " + level, icon: () => FG.createLevelIconElement(level, 14) });
            } else {
                for (const shape of SHAPES) keys.push({ key: shape, label: shape.charAt(0).toUpperCase() + shape.slice(1), icon: () => FG.createShapeIconElement(shape, 14) });
            }

            const rows = el("div", { class: "fg-legend-content" });
            for (const item of keys) {
                const check = el("input", { class: "fg-legend-check", type: "checkbox" });
                check.checked = checked.includes(item.key);
                check.addEventListener("change", () => {
                    const list = isLevel ? state.checkedLevels : state.checkedShapes;
                    const next = list.includes(item.key) ? list.filter((v) => v !== item.key) : list.concat([item.key]);
                    if (isLevel) state.checkedLevels = next; else state.checkedShapes = next;
                    update();
                });
                const description = el("input", { class: "p-input sm fg-legend-description", type: "text", placeholder: "Description..." });
                description.value = descriptions[item.key] || "";
                description.addEventListener("input", () => scheduleDescription(isLevel ? "levels" : "shapes", item.key, description.value));
                rows.append(el("div", { class: "fg-legend-row" },
                    check,
                    el("span", { class: "fg-legend-icon" }, item.icon()),
                    el("span", { class: "fg-legend-label", text: item.label }),
                    description,
                ));
            }
            return rows;
        }

        /** Port of GraphLegendPanelView.applyLegendHighlight. */
        function applyHighlight() {
            const signature = [
                state.expanded, state.activeTab, state.selectionFilter,
                state.checkedLevels.join("|"), state.checkedShapes.join("|"),
                Array.from(ctx.renderer.selectedIds).join(","),
            ].join(";");
            if (signature === appliedSignature) return;
            appliedSignature = signature;

            if (!state.expanded) { ctx.setLegendHighlight(null); return; }

            if (state.activeTab === "selection") {
                const selectedIds = ctx.renderer.selectedIds;
                if (!state.selectionFilter || selectedIds.size === 0) { ctx.setLegendHighlight(null); return; }
                if (state.selectionFilter === "selected") {
                    ctx.setLegendHighlight(new Set(selectedIds));
                } else if (state.selectionFilter === "selected-with-children") {
                    const ids = new Set(selectedIds);
                    for (const nodeId of selectedIds) {
                        for (const id of ctx.connectivityModel.getProcessedNeighborIds(nodeId)) ids.add(id);
                        for (const id of ctx.connectivityModel.getRealNeighborIds(nodeId)) ids.add(id);
                    }
                    ctx.setLegendHighlight(ids);
                } else {
                    const allIds = new Set(ctx.renderer.getNodes().map((n) => n.id));
                    for (const id of selectedIds) allIds.delete(id);
                    ctx.setLegendHighlight(allIds);
                }
                return;
            }

            const isLevel = state.activeTab === "level";
            const checked = isLevel ? state.checkedLevels : state.checkedShapes;
            if (checked.length === 0) { ctx.setLegendHighlight(null); return; }

            let includeRoot = false, includeGroup = false;
            const values = new Set();
            for (const key of checked) {
                if (key === "root") includeRoot = true;
                else if (key === "group") includeGroup = true;
                else values.add(isLevel ? Number(key) : key);
            }
            const filter = isLevel
                ? { levels: values.size > 0 ? values : undefined, includeRoot, includeGroup }
                : { shapes: values.size > 0 ? values : undefined, includeRoot, includeGroup };
            ctx.setLegendHighlight(ctx.getNodeIdsByLegendFilter(filter));
        }

        function update() {
            if (state.expanded) root.dataset.expanded = ""; else delete root.dataset.expanded;
            chevron.textContent = state.expanded ? "▼" : "▲";
            body.replaceChildren();
            if (state.expanded) {
                if (ctx.getSearchQuery()) {
                    body.append(el("div", { class: "fg-legend-notice" },
                        el("span", { text: "Search highlighting is active" }),
                        el("button", { class: "p-btn link sm", text: "Clear search", onclick: () => ctx.setSearchQuery("") }),
                    ));
                } else {
                    body.append(tabStrip());
                    body.append(state.activeTab === "selection" ? selectionRows() : keyRows());
                }
            }
            applyHighlight();
        }

        /** The selection menu's "Highlight" action. */
        function highlightSelection() {
            state.expanded = true;
            state.activeTab = "selection";
            state.selectionFilter = "selected";
            update();
        }

        update();
        return { root, update, highlightSelection, state };
    };

    // =====================================================================
    // Detail panel
    // =====================================================================

    FG.createDetailPanel = function createDetailPanel(ctx) {
        const state = {
            expanded: false,
            wasExpanded: false,
            activeTab: "info",
            linksDirty: false,
            propertiesDirty: false,
            width: 260,
            height: 300,
            editId: "",
            editTitle: "",
            idError: "",
        };
        let lastSelectionKey = null;
        let lastNodeStamp = null;
        let linksGrid = null, linksRows = [], linksOriginalIds = new Set(), linksCounter = 0;
        let propsGrid = null, propsRows = [], propsOriginalKeys = new Set(), propsCounter = 0, propsMultiInfo = new Map();
        let propsStatus = "";
        let appliedLinksSignature = null;

        const title = el("span", { class: "fg-panel-title", text: "select node for edit" });
        const chevron = el("span", { class: "fg-chevron", text: "▼" });
        const header = el("div", { class: "fg-panel-header", "data-name": "graph-detail-toggle" }, title, chevron);
        const body = el("div", { class: "fg-detail-body" });
        const resizer = el("div", { class: "fg-detail-resizer", title: "Drag to resize" },
            FG.createResizeGripElement());
        const root = el("div", { class: "fg-detail", "data-name": "graph-detail-panel" }, resizer, header, body);

        const dirty = () => state.linksDirty || state.propertiesDirty;
        const selected = () => ctx.getSelectedNodes().filter((n) => !n.isGroup);

        header.addEventListener("click", () => {
            if (selected().length === 0 || dirty()) return;
            state.expanded = !state.expanded;
            state.wasExpanded = state.expanded;
            update();
        });

        // -- Resizer ------------------------------------------------------
        // Both axes, to match the built-in editor: the properties and links grids are the
        // reason the panel gets resized at all, and they scroll vertically.
        const MIN_WIDTH = 200, MIN_HEIGHT = 200, MAX_PERCENT = 0.9;
        let resizing = null;
        resizer.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            resizing = { x: event.clientX, y: event.clientY, width: state.width, height: state.height };
        });
        document.addEventListener("mousemove", (event) => {
            if (!resizing) return;
            // Anchored top-right: leftward drag widens, downward drag heightens.
            let width = Math.max(MIN_WIDTH, resizing.width + resizing.x - event.clientX);
            let height = Math.max(MIN_HEIGHT, resizing.height + event.clientY - resizing.y);
            // Clamp against the graph area, NOT root.parentElement: the panel's wrapper is an
            // absolutely-positioned box that shrink-wraps the panel, so measuring it pinned the
            // panel to 90% of its own size and it could only ever shrink.
            const area = document.querySelector("canvas");
            const box = area && area.getBoundingClientRect();
            if (box && box.width > 0 && box.height > 0) {
                width = Math.min(width, box.width * MAX_PERCENT);
                height = Math.min(height, box.height * MAX_PERCENT);
            }
            state.width = width;
            state.height = height;
            applySize(true);
        });
        document.addEventListener("mouseup", () => { resizing = null; });

        /** Push the chosen size onto the DOM. Collapsed panels size themselves. */
        function applySize(sized) {
            root.style.width = sized ? state.width + "px" : "";
            body.style.height = sized ? state.height + "px" : "";
        }

        // -- Info tab -----------------------------------------------------
        function iconRow(kind, onPick, isSelected, isMixed) {
            const row = el("div", { class: "fg-icon-row" });
            const values = kind === "level" ? LEVELS : SHAPES;
            for (const value of values) {
                const button = el("button", {
                    class: "fg-icon-button", type: "button",
                    title: kind === "level" ? "Level " + value : value,
                    onclick: () => onPick(value),
                }, kind === "level" ? FG.createLevelIconElement(value, 16) : FG.createShapeIconElement(value, 16));
                if (isSelected(value)) button.dataset.selected = "";
                if (isMixed && isMixed(value)) button.dataset.mixed = "";
                row.append(button);
            }
            return row;
        }

        function field(label, ...children) {
            return el("div", { class: "fg-field" }, el("span", { class: "fg-field-label", text: label }), ...children);
        }

        function commitId(node) {
            const value = state.editId.trim();
            if (value === node.id) { state.idError = ""; update(); return; }
            if (!value) { state.editId = node.id; state.idError = ""; update(); return; }
            state.idError = ctx.actions.renameNode(node.id, value) ? "" : "ID already exists";
            update();
        }

        function commitTitle(node) {
            const value = state.editTitle.trim();
            if (value !== (node.title || "")) ctx.actions.updateNodeProps(node.id, { title: value || undefined });
        }

        function singleInfoTab(node) {
            const host = el("div", { class: "fg-detail-info" });

            const idInput = el("input", { class: "p-input sm", type: "text", spellcheck: "false", "data-name": "graph-detail-id" });
            idInput.value = state.editId;
            idInput.addEventListener("input", () => { state.editId = idInput.value; });
            idInput.addEventListener("blur", () => commitId(node));
            idInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); idInput.blur(); }
                else if (event.key === "Escape") { event.preventDefault(); state.editId = node.id; state.idError = ""; idInput.value = node.id; idInput.blur(); }
            });
            const errorEl = el("span", { class: "fg-detail-error", text: state.idError });
            errorEl.hidden = !state.idError;

            const titleInput = el("input", { class: "p-input sm", type: "text", spellcheck: "false", placeholder: node.id, "data-name": "graph-detail-title" });
            titleInput.value = state.editTitle;
            titleInput.addEventListener("input", () => { state.editTitle = titleInput.value; });
            titleInput.addEventListener("blur", () => commitTitle(node));
            titleInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); titleInput.blur(); }
                else if (event.key === "Escape") { event.preventDefault(); state.editTitle = node.title || ""; titleInput.value = state.editTitle; titleInput.blur(); }
            });

            host.append(
                field("ID", idInput, errorEl),
                field("Title", titleInput),
                field("Level", iconRow("level", (level) => ctx.actions.updateNodeProps(node.id, { level }), (level) => (node.level == null ? 5 : node.level) === level)),
                field("Shape", iconRow("shape", (shape) => ctx.actions.updateNodeProps(node.id, { shape: shape === "circle" ? undefined : shape }), (shape) => (node.shape || "circle") === shape)),
            );
            return host;
        }

        function multiInfoTab(nodes) {
            const ids = nodes.map((n) => n.id);
            const levels = new Set(nodes.map((n) => (n.level == null ? 5 : n.level)));
            const shapes = new Set(nodes.map((n) => n.shape || "circle"));
            return el("div", { class: "fg-detail-info" },
                el("div", { class: "fg-detail-note", text: "Batch edit level and shape for " + nodes.length + " selected nodes" }),
                field("Level", iconRow("level",
                    (level) => ctx.actions.batchUpdateNodeProps(ids, { level }),
                    (level) => levels.size === 1 && levels.has(level),
                    (level) => levels.size > 1 && levels.has(level))),
                field("Shape", iconRow("shape",
                    (shape) => ctx.actions.batchUpdateNodeProps(ids, { shape: shape === "circle" ? undefined : shape }),
                    (shape) => shapes.size === 1 && shapes.has(shape),
                    (shape) => shapes.size > 1 && shapes.has(shape))),
            );
        }

        // -- Links tab ----------------------------------------------------
        function linkColumns(rows) {
            const AVG = window.AVGrid;
            const opts = { charWidth: 7, padding: 16, minWidth: 50, maxWidth: 200 };
            const width = (key, name) => (AVG && AVG.detectColumnWidth ? AVG.detectColumnWidth(rows, key, name, opts) : 100);
            const columns = [
                { key: "id", name: "ID", width: width("id", "ID"), resizable: true },
                { key: "title", name: "Title", width: width("title", "Title"), resizable: true },
                { key: "level", name: "Level", width: 60, resizable: true, options: LEVELS },
                { key: "shape", name: "Shape", width: 70, resizable: true, options: SHAPES },
            ];
            const customKeys = new Set();
            for (const row of rows) {
                for (const key of Object.keys(row)) {
                    if (key !== "_rowKey" && !KNOWN_LINK_KEYS.has(key) && !key.startsWith("_$")) customKeys.add(key);
                }
            }
            for (const key of Array.from(customKeys).sort()) columns.push({ key, name: key, width: width(key, key), resizable: true });
            return columns;
        }

        function seedLinks(linkedNodes) {
            linksCounter = 0;
            linksRows = linkedNodes.map((node) => Object.assign({}, node, { _rowKey: "link-" + (++linksCounter) }));
            linksOriginalIds = new Set(linkedNodes.map((node) => node.id));
            state.linksDirty = false;
            if (linksGrid) {
                linksGrid.setColumns(linkColumns(linksRows));
                linksGrid.setRows(linksRows);
            }
        }

        function linksTab(node) {
            const host = el("div", { class: "fg-grid-host" });
            const actionsRow = el("div", { class: "fg-grid-actions" });
            const cancel = el("button", { class: "p-btn sm ghost", text: "Cancel", onclick: () => { seedLinks(ctx.getLinkedNodes()); update(); } });
            const apply = el("button", {
                class: "p-btn sm primary", text: "Apply",
                onclick: () => {
                    const rows = (linksGrid ? linksGrid.getRows() : linksRows).map((row) => {
                        const copy = Object.assign({}, row);
                        delete copy._rowKey;
                        return copy;
                    });
                    state.linksDirty = false;
                    ctx.actions.applyLinkedNodesUpdate(node.id, rows, linksOriginalIds);
                },
            });
            actionsRow.append(cancel, apply);
            actionsRow.hidden = !state.linksDirty;

            const gridHost = el("div", { class: "fg-grid", "data-name": "graph-links-grid" });
            const wrapper = el("div", { class: "fg-grid-wrapper" }, gridHost, actionsRow);
            host.append(wrapper);

            const AVGridClass = grid();
            if (AVGridClass) {
                queueMicrotask(() => {
                    if (!gridHost.isConnected) return;
                    linksGrid = AVGridClass.create(gridHost, {
                        name: "graph-links-grid",
                        injectStyles: false,
                        columns: linkColumns(linksRows),
                        rows: linksRows,
                        getRowKey: (row) => row._rowKey,
                        editable: true, canAddRows: true, canDeleteRows: true,
                        rowNoun: "link", rowHeight: 24,
                        disableFiltering: true, disableSorting: true,
                        newRow: () => ({ id: "", _rowKey: "link-" + (++linksCounter) }),
                        onEdit: () => { markLinksDirty(actionsRow); },
                        onAddRows: (event) => {
                            for (const row of event.rows) row._rowKey = "link-" + (++linksCounter);
                            markLinksDirty(actionsRow);
                        },
                        onDeleteRows: () => { markLinksDirty(actionsRow); },
                        onFocusChange: (focus) => {
                            const rows = linksGrid ? linksGrid.getRows() : linksRows;
                            const row = focus && focus.rowKey ? rows.find((item) => item._rowKey === focus.rowKey) : undefined;
                            ctx.setExternalHover((row && row.id) || "");
                        },
                    });
                });
            }
            return host;
        }

        function markLinksDirty(actionsRow) {
            state.linksDirty = true;
            actionsRow.hidden = false;
            ctx.onPanelDirtyChange(true);
        }

        // -- Properties tab -----------------------------------------------
        const PROPERTY_COLUMNS = [
            { key: "key", name: "Name", width: 120, resizable: true },
            { key: "value", name: "Value", width: 200, resizable: true },
        ];

        function extractMultiProperties(nodes) {
            const keys = new Set();
            for (const node of nodes) {
                for (const key of Object.keys(node)) if (!FG.isReservedPropertyKey(key)) keys.add(key);
            }
            return Array.from(keys).sort().map((key) => {
                const values = nodes.map((node) => node[key]).filter((value) => value != null).map(String);
                const uniqueValues = Array.from(new Set(values));
                const allSame = uniqueValues.length === 1 && values.length === nodes.length;
                return { key, value: allSame ? uniqueValues[0] : "", allSame, uniqueValues };
            });
        }

        function seedProperties(nodes) {
            propsCounter = 0;
            propsOriginalKeys = new Set();
            propsMultiInfo = new Map();
            propsRows = [];
            propsStatus = "";
            if (nodes.length > 1) {
                for (const row of extractMultiProperties(nodes)) {
                    propsMultiInfo.set(row.key, { allSame: row.allSame, uniqueValues: row.uniqueValues });
                    propsRows.push({ _rowKey: "prop-" + (++propsCounter), key: row.key, value: row.value, _isChanged: false });
                    propsOriginalKeys.add(row.key);
                }
            } else if (nodes.length === 1) {
                for (const [key, value] of Object.entries(nodes[0])) {
                    if (FG.isReservedPropertyKey(key)) continue;
                    propsRows.push({ _rowKey: "prop-" + (++propsCounter), key, value: value == null ? "" : String(value), _isChanged: false });
                    propsOriginalKeys.add(key);
                }
            }
            state.propertiesDirty = false;
            if (propsGrid) propsGrid.setRows(propsRows);
        }

        function propertiesTab(nodes) {
            const host = el("div", { class: "fg-grid-host" });
            const status = el("div", { class: "fg-detail-status", text: propsStatus });
            status.hidden = !propsStatus;
            const actionsRow = el("div", { class: "fg-grid-actions" });
            const cancel = el("button", { class: "p-btn sm ghost", text: "Cancel", onclick: () => { seedProperties(nodes); update(); } });
            const apply = el("button", {
                class: "p-btn sm primary", text: "Apply",
                onclick: () => {
                    const rows = propsGrid ? propsGrid.getRows() : propsRows;
                    const propsToSet = {};
                    for (const row of rows) {
                        if (!row._isChanged) continue;
                        const key = String(row.key || "").trim();
                        if (key && !FG.isReservedPropertyKey(key)) propsToSet[key] = row.value;
                    }
                    const currentKeys = new Set(rows.map((row) => String(row.key || "").trim()).filter(Boolean));
                    const keysToRemove = Array.from(propsOriginalKeys).filter((key) => !currentKeys.has(key));
                    state.propertiesDirty = false;
                    if (nodes.length > 1) ctx.actions.batchApplyPropertiesUpdate(nodes.map((n) => n.id), propsToSet, keysToRemove);
                    else if (nodes.length === 1) ctx.actions.applyPropertiesUpdate(nodes[0].id, propsToSet, keysToRemove);
                },
            });
            actionsRow.append(cancel, apply);
            actionsRow.hidden = !state.propertiesDirty;

            const gridHost = el("div", { class: "fg-grid", "data-name": "graph-properties-grid" });
            host.append(el("div", { class: "fg-grid-wrapper" }, gridHost, status, actionsRow));

            const AVGridClass = grid();
            if (AVGridClass) {
                queueMicrotask(() => {
                    if (!gridHost.isConnected) return;
                    propsGrid = AVGridClass.create(gridHost, {
                        name: "graph-properties-grid",
                        injectStyles: false,
                        columns: PROPERTY_COLUMNS,
                        rows: propsRows,
                        getRowKey: (row) => row._rowKey,
                        editable: true, canAddRows: true, canDeleteRows: true,
                        rowNoun: "property", rowHeight: 24,
                        disableFiltering: true, disableSorting: true,
                        newRow: () => ({ _rowKey: "prop-" + (++propsCounter), key: "", value: "", _isChanged: true }),
                        onEdit: (event) => {
                            if (event && event.row) event.row._isChanged = true;
                            markPropertiesDirty(actionsRow, apply);
                        },
                        onAddRows: (event) => {
                            for (const row of event.rows) { row._rowKey = "prop-" + (++propsCounter); row._isChanged = true; }
                            markPropertiesDirty(actionsRow, apply);
                        },
                        onDeleteRows: () => { markPropertiesDirty(actionsRow, apply); },
                        onCellClass: (cell) => {
                            if (cell.column.key !== "key" || !cell.row.key) return "";
                            if (FG.isReservedPropertyKey(cell.row.key)) return "cell-error";
                            if (nodes.length > 1) {
                                const info = propsMultiInfo.get(cell.row.key);
                                if (info && !info.allSame && !cell.row._isChanged) return "cell-mixed";
                            }
                            return "";
                        },
                        onFocusChange: (focus) => {
                            if (nodes.length <= 1 || !focus || !focus.rowKey) { propsStatus = ""; }
                            else {
                                const rows = propsGrid ? propsGrid.getRows() : propsRows;
                                const row = rows.find((item) => item._rowKey === focus.rowKey);
                                const info = row && row.key ? propsMultiInfo.get(row.key) : undefined;
                                if (!info) propsStatus = "";
                                else if (info.allSame) propsStatus = "All nodes have the same value";
                                else if (!info.uniqueValues.length) propsStatus = "No nodes have this property";
                                else propsStatus = "Values: " + info.uniqueValues.slice(0, 2).map((v) => '"' + v + '"').join(", ") + (info.uniqueValues.length > 2 ? ", ..." : "");
                            }
                            status.textContent = propsStatus;
                            status.hidden = !propsStatus;
                        },
                    });
                });
            }
            return host;
        }

        function markPropertiesDirty(actionsRow, applyButton) {
            state.propertiesDirty = true;
            actionsRow.hidden = false;
            const rows = propsGrid ? propsGrid.getRows() : propsRows;
            applyButton.disabled = rows.some((row) => row.key && FG.isReservedPropertyKey(row.key));
            ctx.onPanelDirtyChange(true);
        }

        // -- Render -------------------------------------------------------
        function tabStrip(nodes) {
            const strip = el("div", { class: "fg-tabs" });
            for (const tab of ["info", "properties", "links"]) {
                const button = el("button", {
                    class: "fg-tab", type: "button", "data-name": "graph-detail-tab-" + tab,
                    text: tab.charAt(0).toUpperCase() + tab.slice(1),
                    onclick: () => { if (!dirty()) { state.activeTab = tab; update(); } },
                });
                button.hidden = tab === "links" && nodes.length !== 1;
                button.disabled = dirty() && state.activeTab !== tab;
                if (state.activeTab === tab) button.dataset.active = "";
                strip.append(button);
            }
            return strip;
        }

        function syncSelection(nodes) {
            const selectionKey = nodes.map((n) => n.id).sort().join(",");
            const node = nodes.length === 1 ? nodes[0] : undefined;
            const stamp = node ? node.id + " " + (node.title || "") : "";
            if (stamp !== lastNodeStamp) {
                lastNodeStamp = stamp;
                if (node) { state.editId = node.id; state.editTitle = node.title || ""; state.idError = ""; }
            }
            if (selectionKey === lastSelectionKey) return false;
            const hadSelection = lastSelectionKey !== null && lastSelectionKey !== "";
            lastSelectionKey = selectionKey;
            if (nodes.length === 0) {
                state.expanded = false;
                state.wasExpanded = false;
            } else if (!hadSelection) {
                state.expanded = state.wasExpanded;
            }
            if (nodes.length > 1 && state.activeTab === "links") state.activeTab = "info";
            return true;
        }

        function update() {
            const nodes = selected();
            const selectionChanged = syncSelection(nodes);
            if (selectionChanged) {
                linksGrid = null;
                propsGrid = null;
                seedLinks(ctx.getLinkedNodes());
                seedProperties(nodes);
                state.linksDirty = false;
                state.propertiesDirty = false;
                ctx.onPanelDirtyChange(false);
            }

            const headerText = nodes.length > 1
                ? nodes.length + " nodes selected"
                : nodes.length === 1 ? FG.nodeLabel(nodes[0]) : "select node for edit";
            title.textContent = headerText;
            title.title = headerText;
            chevron.hidden = nodes.length === 0;
            chevron.textContent = state.expanded ? "▲" : "▼";
            root.dataset.selection = nodes.length > 0 ? "selected" : "none";
            if (state.expanded && nodes.length > 0) root.dataset.expanded = ""; else delete root.dataset.expanded;
            applySize(state.expanded && nodes.length > 0);
            resizer.hidden = !(state.expanded && nodes.length > 0);

            body.replaceChildren();
            if (!state.expanded || nodes.length === 0) {
                applyLinksConsequence(false, undefined);
                return;
            }
            body.append(tabStrip(nodes));
            if (state.activeTab === "info") body.append(nodes.length > 1 ? multiInfoTab(nodes) : singleInfoTab(nodes[0]));
            else if (state.activeTab === "properties") body.append(propertiesTab(nodes));
            else body.append(linksTab(nodes[0]));

            applyLinksConsequence(state.activeTab === "links" && nodes.length === 1, nodes[0]);
        }

        /** Links tab drives the canvas "links" highlight layer and auto-expands the node. */
        function applyLinksConsequence(active, node) {
            const linkedNodes = ctx.getLinkedNodes();
            const signature = active && node ? node.id + ":" + linkedNodes.length : "";
            if (signature === appliedLinksSignature) return;
            appliedLinksSignature = signature;
            if (active && node) {
                ctx.expandNode(node.id);
                ctx.setHighlightSet(new Set([node.id].concat(linkedNodes.map((n) => n.id))));
            } else {
                ctx.setHighlightSet(null);
                ctx.setExternalHover("");
            }
        }

        function requestExpand() {
            if (selected().length === 0) return;
            state.expanded = true;
            state.wasExpanded = true;
            update();
        }

        function requestCollapse() {
            if (!state.expanded || dirty()) return false;
            state.expanded = false;
            state.wasExpanded = false;
            update();
            return true;
        }

        /** Force a reseed of both grids after an external data change. */
        function invalidate() {
            lastSelectionKey = null;
            lastNodeStamp = null;
            appliedLinksSignature = null;
        }

        update();
        return { root, update, requestExpand, requestCollapse, invalidate, state, get dirty() { return dirty(); } };
    };

    // =====================================================================
    // Toolbar panels — Physics / Expansion / Results
    // =====================================================================

    FG.createToolbarPanels = function createToolbarPanels(ctx) {
        const state = { panel: "closed", selectedResultIndex: -1 };
        const tabs = el("div", { class: "fg-tabs fg-panel-tabs" });
        const host = el("div", { class: "fg-panel-host" });
        const root = el("div", { class: "fg-panel-strip" }, tabs, host);
        const tabButtons = new Map();

        for (const [key, label] of [["settings", "Physics"], ["expansion", "Expansion"], ["results", "Results"]]) {
            const name = key === "settings" ? "graph-panel-physics" : key === "expansion" ? "graph-panel-expansion" : "graph-panel-results";
            const button = el("button", {
                class: "fg-tab", type: "button", "data-name": name, text: label,
                onclick: () => setPanel(key),
            });
            tabButtons.set(key, button);
            tabs.append(button);
        }

        function setPanel(panel) {
            state.panel = panel;
            if (panel !== "results") state.selectedResultIndex = -1;
            update();
        }

        // -- Physics ------------------------------------------------------
        const SLIDERS = [
            { key: "charge", label: "Charge", min: -200, max: 0, step: 1, name: "tuning-charge" },
            { key: "linkDistance", label: "Distance", min: 10, max: 200, step: 1, name: "tuning-link-distance" },
            { key: "collide", label: "Collide", min: 0, max: 1, step: 0.05, name: "tuning-collide" },
        ];

        function physicsPanel() {
            const panel = el("div", { class: "fg-panel fg-tuning", "data-name": "graph-tuning" });
            const params = ctx.renderer.forceParams;
            for (const definition of SLIDERS) {
                const readout = el("span", { class: "fg-tuning-value", text: String(params[definition.key]) });
                const slider = el("input", {
                    class: "fg-slider", type: "range", "data-name": definition.name,
                    min: String(definition.min), max: String(definition.max), step: String(definition.step),
                });
                slider.value = String(params[definition.key]);
                slider.addEventListener("input", () => {
                    const value = Number(slider.value);
                    readout.textContent = String(value);
                    ctx.updateForceParams({ [definition.key]: value });
                });
                panel.append(el("div", { class: "fg-tuning-row" },
                    el("span", { class: "fg-tuning-label", text: definition.label }), slider, readout));
            }
            panel.append(el("div", { class: "fg-tuning-actions" },
                el("button", { class: "p-btn sm ghost", "data-name": "tuning-reset", text: "Reset", onclick: () => { ctx.resetForceParams(); update(); } })));
            return panel;
        }

        // -- Expansion ----------------------------------------------------
        let rootCombo = null;

        function createRootCombo() {
            const options = ctx.getAllNodes()
                .slice()
                .sort((a, b) => FG.nodeLabel(a).localeCompare(FG.nodeLabel(b)))
                .map((node) => ({ value: node.id, label: FG.nodeLabel(node) }));
            options.unshift({ value: AUTO_ROOT, label: "(auto — lowest level)" });

            const current = ctx.getExpansionOptions().rootNode || AUTO_ROOT;
            const selectedOption = options.find((item) => item.value === current) || options[0];

            const input = el("input", {
                class: "p-input sm fg-combo-input", type: "text", spellcheck: "false",
                "data-name": "graph-expansion-root", placeholder: "Filter nodes…",
            });
            input.value = selectedOption.label;
            const list = el("div", { class: "fg-combo-list" });
            const wrap = el("div", { class: "fg-combo" }, input, list);
            list.hidden = true;

            let filter = "";

            function renderList() {
                list.replaceChildren();
                const needle = filter.trim().toLowerCase();
                const matches = needle
                    ? options.filter((item) => item.label.toLowerCase().includes(needle) || String(item.value).toLowerCase().includes(needle))
                    : options;
                if (matches.length === 0) {
                    list.append(el("div", { class: "fg-combo-empty", text: "No matching node" }));
                    return;
                }
                for (const item of matches.slice(0, 200)) {
                    const option = el("div", { class: "fg-combo-option", text: item.label, title: String(item.value) });
                    if (item.value === (ctx.getExpansionOptions().rootNode || AUTO_ROOT)) option.dataset.selected = "";
                    option.addEventListener("mousedown", (event) => {
                        event.preventDefault();
                        ctx.setRootNode(item.value === AUTO_ROOT ? undefined : item.value);
                        input.value = item.label;
                        filter = "";
                        list.hidden = true;
                        update();
                    });
                    list.append(option);
                }
            }

            input.addEventListener("focus", () => { filter = ""; input.select(); list.hidden = false; renderList(); });
            input.addEventListener("input", () => { filter = input.value; list.hidden = false; renderList(); });
            input.addEventListener("blur", () => {
                list.hidden = true;
                const currentValue = ctx.getExpansionOptions().rootNode || AUTO_ROOT;
                const match = options.find((item) => item.value === currentValue) || options[0];
                input.value = match.label;
            });
            input.addEventListener("keydown", (event) => {
                if (event.key === "Escape") { event.preventDefault(); input.blur(); }
            });

            rootCombo = { wrap, input };
            return wrap;
        }

        function numberField(name, placeholder, read, commit, minimum) {
            const input = el("input", { class: "p-input sm", type: "text", spellcheck: "false", "data-name": name, placeholder });
            input.value = read();
            const doCommit = () => {
                const trimmed = input.value.trim();
                if (!trimmed) { commit(undefined); input.value = ""; return; }
                const parsed = parseInt(trimmed, 10);
                if (!isNaN(parsed) && parsed >= minimum) { commit(parsed); input.value = String(parsed); }
                else input.value = read();
            };
            input.addEventListener("blur", doCommit);
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); doCommit(); input.blur(); }
            });
            return input;
        }

        function expansionPanel() {
            const opts = ctx.getExpansionOptions();
            const panel = el("div", { class: "fg-panel fg-expansion", "data-name": "graph-expansion-settings" });
            panel.append(el("div", { class: "fg-expansion-row" }, el("span", { class: "fg-expansion-label", text: "Root Node" }), createRootCombo()));
            panel.append(el("div", { class: "fg-expansion-row" },
                el("span", { class: "fg-expansion-label", text: "Expand Depth" }),
                numberField("graph-expansion-depth", "∞ (unlimited)",
                    () => (opts.expandDepth !== undefined ? String(opts.expandDepth) : ""),
                    (value) => ctx.updateExpansionOptions({ expandDepth: value }), 1)));
            panel.append(el("div", { class: "fg-expansion-row" },
                el("span", { class: "fg-expansion-label", text: "Max Visible" }),
                numberField("graph-expansion-max", "500 (default)",
                    () => (opts.maxVisible !== undefined ? String(opts.maxVisible) : ""),
                    (value) => ctx.updateExpansionOptions({ maxVisible: value }), 10)));
            panel.append(el("div", { class: "fg-expansion-note", text: "Depth and max visible apply when file is reopened" }));
            return panel;
        }

        // -- Results ------------------------------------------------------
        function resultsPanel() {
            const panel = el("div", { class: "fg-panel fg-results", "data-name": "graph-results-panel" });
            const results = ctx.getSearchResults();
            const query = ctx.getSearchQuery();

            if (!results || results.length === 0) {
                panel.append(el("div", { class: "fg-results-empty", text: query ? "No results" : "Type to search" }));
            } else {
                const rows = el("div", { class: "fg-results-rows" });
                const displayed = results.slice(0, MAX_DISPLAYED_RESULTS);
                displayed.forEach((result, index) => {
                    const label = el("div", { class: "fg-results-title" });
                    FG.highlightInto(label, result.label, query);
                    const properties = el("div", { class: "fg-results-properties" });
                    for (const property of result.matchedProps) {
                        const key = el("span", { class: "fg-results-key" });
                        const value = el("span", { class: "fg-results-value" });
                        FG.highlightInto(key, property.key, query);
                        FG.highlightInto(value, property.value, query);
                        properties.append(el("div", { class: "fg-results-property" }, key, document.createTextNode(": "), value));
                    }
                    const row = el("div", { class: "fg-results-row", onclick: () => ctx.revealAndSelectNode(result.nodeId) }, label, properties);
                    if (index === state.selectedResultIndex) { row.dataset.selected = ""; }
                    if (!result.visible) row.dataset.hidden = "";
                    rows.append(row);
                });
                panel.append(rows);
                const extra = results.length - MAX_DISPLAYED_RESULTS;
                if (extra > 0) panel.append(el("div", { class: "fg-results-empty", text: "and " + extra + " more..." }));
            }

            const info = ctx.getSearchInfo();
            if (info) {
                const status = el("div", { class: "fg-results-status" }, el("span", { text: info.visible + " visible" }));
                if (info.hidden > 0) {
                    status.append(el("button", { class: "p-btn link sm", "data-name": "graph-reveal-hidden", text: "[+" + info.hidden + " hidden]", onclick: () => ctx.revealHiddenMatches() }));
                }
                status.append(el("button", {
                    class: "p-btn link sm", "data-name": "graph-select-results",
                    text: ctx.renderer.selectedIds.size > 0 ? "[add to selection]" : "[select all]",
                    onclick: () => ctx.selectSearchResults(),
                }));
                panel.append(status);
            }
            return panel;
        }

        // -- Keyboard navigation from the search box -----------------------
        function moveResultSelection(delta) {
            const results = ctx.getSearchResults();
            if (!results || results.length === 0) return;
            const max = Math.min(results.length, MAX_DISPLAYED_RESULTS);
            state.selectedResultIndex = ((state.selectedResultIndex + delta) % max + max) % max;
            if (state.panel !== "results") state.panel = "results";
            update();
            const row = host.querySelectorAll(".fg-results-row")[state.selectedResultIndex];
            if (row) row.scrollIntoView({ block: "nearest" });
        }

        function pickSelectedResult() {
            const results = ctx.getSearchResults();
            if (!results || results.length === 0) return false;
            const index = state.selectedResultIndex >= 0 ? state.selectedResultIndex : 0;
            if (index >= results.length) return false;
            ctx.revealAndSelectNode(results[index].nodeId);
            return true;
        }

        function update() {
            for (const [key, button] of tabButtons) {
                if (state.panel === key) button.dataset.active = ""; else delete button.dataset.active;
            }
            tabs.hidden = state.panel === "closed";
            host.replaceChildren();
            root.hidden = state.panel === "closed";
            if (state.panel === "closed") return;
            host.append(state.panel === "settings" ? physicsPanel() : state.panel === "expansion" ? expansionPanel() : resultsPanel());
        }

        /** The search box opens the Results panel when it produces results. */
        function onSearchResults(results, query) {
            if (results && results.length > 0) {
                if (state.panel !== "results") state.panel = "results";
                state.selectedResultIndex = -1;
            } else if (!query && state.panel === "results") {
                state.panel = "closed";
            }
        }

        update();
        return {
            root, update, setPanel, onSearchResults, moveResultSelection, pickSelectedResult, state,
            toggleSettings: () => setPanel(state.panel === "settings" ? "closed" : "settings"),
            close: () => { if (state.panel !== "closed") { setPanel("closed"); return true; } return false; },
            get isOpen() { return state.panel !== "closed"; },
        };
    };
})();
