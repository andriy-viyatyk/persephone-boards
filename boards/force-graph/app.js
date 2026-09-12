// Force Graph board — controller.
//
// The board-shaped replacement for GraphEditor.ts + GraphBodyView.ts: content-host I/O, the
// rebuild pipeline, the toolbar, the context menus, the keyboard map, the panels, the image
// exports and the AiVision surface. The algorithms live in graph-core.js / graph-renderer.js and
// the UI in graph-ui.js / graph-panels.js — none of them should be redesigned here.
(() => {
    const P = window.persephone;
    const FG = window.FG;

    // -- Models ----------------------------------------------------------
    const renderer = new FG.ForceGraphRenderer();
    const dataModel = new FG.GraphDataModel();
    const groupModel = new FG.GraphGroupModel();
    const connectivityModel = new FG.GraphConnectivityModel();
    const visibilityModel = new FG.GraphVisibilityModel();
    const searchModel = new FG.GraphSearchModel(renderer, visibilityModel);

    // -- View state ------------------------------------------------------
    let originalJson = {};
    let isFirstLoad = true;
    let groupingEnabled = true;
    let searchQuery = "";
    let searchInfo = null;
    let searchResults = null;
    let selectedNodes = [];
    let linkedNodes = [];
    let statusHint = "";
    let loading = true;
    let parseError = "";
    let lastWritten = null;
    let hostAttached = false;
    let fileName = "";
    let popupClosedAt = 0;
    let panelDirty = false;

    const $ = (id) => document.getElementById(id);
    const notify = (msg, kind) => {
        try { P.notify(msg, kind || "warning"); } catch (e) { /* a toast is best-effort */ }
    };
    const errText = (e) => (e && e.message) || String(e);

    // ====================================================================
    // Content host
    // ====================================================================

    function parseContent(text) {
        if (!text || !text.trim()) {
            dataModel.sourceData = null;
            originalJson = {};
            parseError = "";
            loading = false;
            renderer.updateData({ nodes: [], links: [] });
            refreshSelection();
            refreshChrome();
            return;
        }

        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            parseError = errText(e) || "Invalid JSON";
            loading = false;
            refreshChrome();
            return;
        }

        originalJson = json && typeof json === "object" ? json : {};
        dataModel.sourceData = {
            nodes: Array.isArray(originalJson.nodes) ? originalJson.nodes : [],
            links: Array.isArray(originalJson.links) ? originalJson.links : [],
            options: originalJson.options,
        };

        const opts = dataModel.sourceData.options || {};
        if (isFirstLoad) {
            const initialParams = {};
            if (opts.charge !== undefined) initialParams.charge = opts.charge;
            if (opts.linkDistance !== undefined) initialParams.linkDistance = opts.linkDistance;
            if (opts.collide !== undefined) initialParams.collide = opts.collide;
            if (Object.keys(initialParams).length > 0) renderer.setInitialForceParams(initialParams);
        }

        parseError = "";
        loading = false;

        rebuildAndRender();
        renderer.rootNodeId = opts.rootNode || "";
        if (detail) detail.invalidate();
        refreshSelection();
        refreshChrome();
        if (aiVisionModel) aiVisionModel.refresh();
    }

    function serialize() {
        const json = Object.assign({}, originalJson);
        if (dataModel.sourceData) {
            json.nodes = dataModel.sourceData.nodes;
            json.links = dataModel.sourceData.links;
            if (dataModel.sourceData.options) json.options = dataModel.sourceData.options;
        }
        return JSON.stringify(json, null, 4);
    }

    let writeTimer = null;

    function writeSoon() {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(writeNow, 300);
    }

    function writeNow() {
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
        if (!hostAttached || !dataModel.sourceData) return;
        const text = serialize();
        if (text === lastWritten) return;
        try {
            P.host.setContent(text);
            lastWritten = text;
        } catch (e) {
            notify("Force Graph: failed to save - " + errText(e), "error");
        }
        if (aiVisionModel) aiVisionModel.refresh();
    }

    function save() {
        writeNow();
        return P.host.save();
    }

    // ====================================================================
    // Rebuild pipeline
    // ====================================================================

    function rebuildAndRender(anchorNodeId, newNodePositions, ensureVisible) {
        if (!dataModel.sourceData) return;

        let nodes = dataModel.sourceData.nodes;
        let links = dataModel.sourceData.links;
        const options = dataModel.sourceData.options;

        if (!groupingEnabled) {
            const groupIds = new Set(nodes.filter((n) => n.isGroup).map((n) => n.id));
            nodes = nodes.filter((n) => !n.isGroup);
            links = links.filter((l) => {
                const ids = FG.linkIds(l);
                return !groupIds.has(ids.source) && !groupIds.has(ids.target);
            });
        }

        groupModel.rebuild(nodes, links);
        const rootId = (options && options.rootNode) || "";
        const processed = groupModel.preprocess(nodes, links, rootId);
        connectivityModel.rebuild(nodes, links, processed, groupModel);

        const filtering = isFirstLoad
            ? visibilityModel.setFullGraph(processed.nodes, processed.links, options)
            : visibilityModel.updateGraph(processed.nodes, processed.links, ensureVisible);

        const copy = filtering
            ? visibilityModel.getVisibleGraph()
            : {
                nodes: processed.nodes.map((n) => Object.assign({}, n)),
                links: processed.links.map((l) => Object.assign({}, l)),
                options: options,
            };

        renderer.syntheticLinkCounts = processed.syntheticLinkCounts;
        renderer.connectivityModel = connectivityModel;

        if (isFirstLoad) {
            renderer.updateData(copy);
            isFirstLoad = false;
        } else {
            renderer.updateVisibleData(copy, anchorNodeId, newNodePositions);
        }

        recomputeSearch();
        if (tooltip) tooltip.clear();
        refreshChrome();
    }

    // ====================================================================
    // Selection snapshots (feed the detail panel)
    // ====================================================================

    function refreshSelection() {
        const selectedIds = renderer.selectedIds;
        const nodes = (dataModel.sourceData && dataModel.sourceData.nodes) || [];
        if (selectedIds.size === 0) {
            selectedNodes = [];
            linkedNodes = [];
        } else {
            selectedNodes = Array.from(selectedIds)
                .map((id) => nodes.find((n) => n.id === id))
                .filter(Boolean)
                .map((n) => Object.assign({}, n));
            linkedNodes = selectedIds.size === 1
                ? connectivityModel.getRealNeighborNodes(Array.from(selectedIds)[0], nodes, (n) => dataModel.cleanNode(n))
                : [];
        }
        if (detail) detail.update();
    }

    function handleSelectionChanged() {
        statusHint = "";
        refreshSelection();
        refreshChrome();
    }

    // ====================================================================
    // Visibility
    // ====================================================================

    function applyVisibilityChange(changed, anchorNodeId) {
        if (!changed) return;
        renderer.updateVisibleData(visibilityModel.getVisibleGraph(), anchorNodeId);
        recomputeSearch();
        if (tooltip) tooltip.clear();
        refreshChrome();
    }

    function expandNode(nodeId) {
        if (!visibilityModel.active) return;
        applyVisibilityChange(visibilityModel.expand(nodeId), nodeId);
    }

    function expandNodeDeep(nodeId) {
        if (!visibilityModel.active) return;
        applyVisibilityChange(visibilityModel.expandDeep(nodeId), nodeId);
    }

    function collapseNode(nodeId) {
        if (!visibilityModel.active) return;
        applyVisibilityChange(visibilityModel.collapse(nodeId));
    }

    /** Agent-safe half of Expand all: no confirmation overlay (EPIC-098's *Core split). */
    function expandAllCore() {
        if (!visibilityModel.active) return;
        applyVisibilityChange(visibilityModel.expandAll());
    }

    async function expandAll() {
        if (!visibilityModel.active) return;
        const total = visibilityModel.totalNodeCount;
        if (total > 1000) {
            const ok = await FG.showConfirmationDialog({
                title: "Expand All Nodes",
                message: "This graph has " + total + " nodes. Expanding all may cause performance issues. Continue?",
            });
            if (ok !== "Yes") return;
        }
        expandAllCore();
    }

    function resetVisibility() {
        if (!visibilityModel.active) return;
        visibilityModel.reset();
        renderer.updateVisibleData(visibilityModel.getVisibleGraph());
        recomputeSearch();
        if (tooltip) tooltip.clear();
        refreshChrome();
    }

    function resetView() {
        isFirstLoad = true;
        rebuildAndRender();
        renderer.rootNodeId = currentRootNodeId();
        refreshSelection();
    }

    function currentRootNodeId() {
        const options = dataModel.sourceData && dataModel.sourceData.options;
        return (options && options.rootNode) || "";
    }

    /** Apply grouping WITHOUT writing shared state — the only safe path from inside onChange. */
    function applyGrouping(next) {
        if (groupingEnabled === next) return;
        groupingEnabled = next;
        renderer.selectNode("");
        isFirstLoad = true;
        rebuildAndRender();
        renderer.rootNodeId = currentRootNodeId();
    }

    /**
     * The UI / agent entry point: apply, then persist. Writing to `persephone.state` from inside
     * its own `onChange` is a feedback loop — two conflicting snapshots in flight then flip the
     * flag forever, re-simulating and clearing the selection on every pass — so the subscriber
     * uses `applyGrouping` and only this function ever calls `merge`.
     */
    function setGrouping(next) {
        if (groupingEnabled === next) return;
        applyGrouping(next);
        try { P.state.merge({ groupingEnabled: next }); } catch (e) { /* state is best-effort */ }
    }

    // ====================================================================
    // Options (root node, expansion, physics, legend)
    // ====================================================================

    function ensureOptions() {
        if (!dataModel.sourceData) return null;
        if (!dataModel.sourceData.options) dataModel.sourceData.options = {};
        return dataModel.sourceData.options;
    }

    function setRootNode(nodeId) {
        const options = ensureOptions();
        if (!options) return;
        if (nodeId) options.rootNode = nodeId;
        else delete options.rootNode;
        renderer.rootNodeId = nodeId || "";
        renderer.renderData();
        writeNow();
        refreshChrome();
    }

    function clearRootIfDeleted(nodeId) {
        const options = dataModel.sourceData && dataModel.sourceData.options;
        if (options && options.rootNode === nodeId) {
            delete options.rootNode;
            renderer.rootNodeId = "";
        }
    }

    function getExpansionOptions() {
        const opts = (dataModel.sourceData && dataModel.sourceData.options) || {};
        return { rootNode: opts.rootNode, expandDepth: opts.expandDepth, maxVisible: opts.maxVisible };
    }

    function updateExpansionOptions(patch) {
        const options = ensureOptions();
        if (!options) return;
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) delete options[key];
            else options[key] = value;
        }
        writeNow();
    }

    function updateForceParams(params) {
        renderer.updateForceParams(params);
        const options = ensureOptions();
        if (!options) return;
        Object.assign(options, params);
        writeSoon();
    }

    function resetForceParams() {
        renderer.resetForceParams();
        const options = dataModel.sourceData && dataModel.sourceData.options;
        if (!options) return;
        delete options.charge;
        delete options.linkDistance;
        delete options.collide;
        writeNow();
    }

    function setLegendDescription(tab, key, value) {
        dataModel.setLegendDescription(tab, key, value);
        writeNow();
    }

    // ====================================================================
    // Search
    // ====================================================================

    function recomputeSearch() {
        const result = searchModel.computeSearch(searchQuery);
        if (!result) {
            renderer.setSearchMatches(null);
            searchInfo = null;
            searchResults = null;
            return;
        }
        renderer.setSearchMatches(result.matchIds);
        searchInfo = result.searchInfo;
        searchResults = result.searchResults;
    }

    function setSearchQuery(query) {
        searchQuery = query;
        recomputeSearch();
        if (panels) panels.onSearchResults(searchResults, searchQuery);
        refreshChrome();
    }

    function revealHiddenMatches() {
        if (searchModel.revealHiddenMatches(searchResults)) {
            recomputeSearch();
            refreshChrome();
        }
    }

    function revealAndSelectNode(nodeId) {
        if (searchModel.revealAndSelectNode(nodeId)) recomputeSearch();
        refreshChrome();
    }

    function selectSearchResults() {
        if (!searchResults || searchResults.length === 0) return;
        if (searchModel.revealHiddenMatches(searchResults)) recomputeSearch();
        renderer.addToSelection(searchResults.map((r) => r.nodeId));
    }

    // ====================================================================
    // Cross-editor page creation (bridge 1.5.0)
    // ====================================================================

    async function openContent(params) {
        if (!P || typeof P.openContent !== "function") {
            notify("Force Graph: this Persephone build cannot open content in another editor.", "warning");
            return undefined;
        }
        try {
            return await P.openContent(params);
        } catch (e) {
            // A .fg.json subgraph falls back to a plain JSON page: the board's contentMasks make
            // Force Graph a switch option for it, so the user is one click from the same result.
            if (params.editor === "graph-view") {
                try {
                    return await P.openContent({
                        editor: "monaco", language: "json",
                        title: params.title, content: params.content,
                    });
                } catch (inner) {
                    notify("Force Graph: could not open the extracted graph - " + errText(inner), "error");
                    return undefined;
                }
            }
            notify("Force Graph: could not open a new page - " + errText(e), "error");
            return undefined;
        }
    }

    // ====================================================================
    // Image export (D4 — the board's own toolbar)
    // ====================================================================

    function canvasBlob() {
        const canvas = $("canvas");
        return new Promise((resolve, reject) => {
            if (!canvas) { reject(new Error("graph canvas is not mounted")); return; }
            canvas.toBlob((value) => {
                if (value) resolve(value);
                else reject(new Error("canvas export failed"));
            }, "image/png");
        });
    }

    async function copyImageToClipboard() {
        try {
            const blob = await canvasBlob();
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            notify("Graph image copied to the clipboard.", "success");
            return true;
        } catch (e) {
            notify("Force Graph: could not copy the image - " + errText(e), "error");
            return false;
        }
    }

    /**
     * The Excalidraw document shape reproduced from `editors/draw/drawExport`
     * (`buildExcalidrawJsonWithImage` + `capDimensions`) — a board cannot import it.
     */
    function buildExcalidrawJsonWithImage(dataUrl, mimeType, naturalWidth, naturalHeight) {
        const MAX_DIMENSION = 1200;
        const longer = Math.max(naturalWidth, naturalHeight);
        const scale = longer > MAX_DIMENSION ? MAX_DIMENSION / longer : 1;
        const width = Math.round(naturalWidth * scale);
        const height = Math.round(naturalHeight * scale);
        const fileId = crypto.randomUUID ? crypto.randomUUID() : "fg-" + Date.now();
        const now = Date.now();

        return JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "persephone",
            elements: [{
                id: fileId + "-el",
                type: "image",
                x: 250, y: 120, width, height,
                angle: 0,
                strokeColor: "transparent",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                frameId: null,
                roundness: null,
                seed: Math.floor(Math.random() * 2147483647),
                version: 1,
                versionNonce: Math.floor(Math.random() * 2147483647),
                isDeleted: false,
                boundElements: null,
                updated: now,
                link: null,
                locked: false,
                status: "saved",
                fileId,
                scale: [1, 1],
            }],
            appState: { currentItemFontFamily: 2 },
            files: { [fileId]: { id: fileId, mimeType, dataURL: dataUrl, created: now } },
        });
    }

    async function openInDrawingEditor() {
        const canvas = $("canvas");
        if (!canvas) {
            notify("Force Graph: the graph canvas is not mounted.", "error");
            return undefined;
        }
        const dataUrl = canvas.toDataURL("image/png");
        const title = (fileName || "Graph").replace(/\.fg\.json$/i, "") + ".excalidraw";
        const json = buildExcalidrawJsonWithImage(dataUrl, "image/png", canvas.width, canvas.height);
        try {
            return await P.openContent({ editor: "draw-view", language: "json", title, content: json });
        } catch (e) {
            // Documented fallback (how-to/open-image-in-drawing-editor.md): hand the PNG data URL
            // to openRawLink and let Persephone build the drawing. Loses only the page title.
            try {
                P.openRawLink(dataUrl, { editor: "draw-view" });
                return undefined;
            } catch (inner) {
                notify("Force Graph: could not open the drawing - " + errText(inner), "error");
                return undefined;
            }
        }
    }

    // ====================================================================
    // Panels, actions, tooltip
    // ====================================================================

    let actions = null;
    let legend = null;
    let detail = null;
    let panels = null;
    let tooltip = null;
    let aiVisionModel = null;

    const panelCtx = {
        renderer, dataModel, groupModel, connectivityModel, visibilityModel,
        get actions() { return actions; },
        getSelectedNodes: () => selectedNodes,
        getLinkedNodes: () => linkedNodes,
        getSearchQuery: () => searchQuery,
        getSearchInfo: () => searchInfo,
        getSearchResults: () => searchResults,
        setSearchQuery,
        revealHiddenMatches,
        revealAndSelectNode,
        selectSearchResults,
        setLegendHighlight: (ids) => renderer.setLegendHighlight(ids),
        setHighlightSet: (ids) => renderer.setHighlightSet(ids),
        setExternalHover: (id) => {
            const selectedId = renderer.selectedId;
            const neighbors = selectedId ? connectivityModel.getRealNeighborIds(selectedId) : new Set();
            renderer.setExternalHover(id, neighbors);
        },
        expandNode,
        getLegendDescriptions: () => dataModel.getLegendDescriptions(),
        setLegendDescription,
        getPresentLevelsAndShapes: () => dataModel.getPresentLevelsAndShapes(renderer.getNodes()),
        getNodeIdsByLegendFilter: (filter) => dataModel.getNodeIdsByLegendFilter(filter, renderer.getNodes()),
        updateForceParams, resetForceParams,
        getExpansionOptions, updateExpansionOptions, setRootNode,
        getAllNodes: () => (dataModel.sourceData ? dataModel.sourceData.nodes : []),
        onPanelDirtyChange: (dirty) => { panelDirty = dirty; },
    };

    // ====================================================================
    // Context menus
    // ====================================================================

    function contextMenuActions() {
        return {
            addNode: (wx, wy) => actions.addNode(wx, wy),
            addChild: (id) => actions.addChild(id),
            deleteNode: (id) => actions.deleteNode(id),
            deleteSelected: () => { void actions.deleteSelectedNodes(); },
            deleteLink: (s, t) => actions.deleteLink(s, t),
            setRootNode: (id) => setRootNode(id),
            collapseNode: (id) => collapseNode(id),
            selectChildren: () => actions.selectChildren(),
            selectMembers: () => actions.selectMembers(),
            selectMembersDeep: () => actions.selectMembersDeep(),
            editGroupTitle: (id) => { void actions.editGroupTitle(id); },
            ungroupNode: (id) => { void actions.ungroupNode(id); },
            deleteGroup: (id) => { void actions.deleteGroupNode(id); },
            groupSelected: () => { void actions.groupSelectedNodes(); },
            removeFromGroup: (id) => actions.removeFromGroup(id),
        };
    }

    async function handleContextMenu(nodeId, clientX, clientY) {
        if (panelDirty) return;
        if (tooltip) tooltip.clear();
        if (panels) { panels.setPanel("closed"); refreshChrome(); }

        let items;
        if (!nodeId) {
            const world = renderer.screenToWorld(clientX, clientY);
            items = FG.buildEmptyAreaContextMenu(world.x, world.y, contextMenuActions());
        } else {
            if (!renderer.selectedIds.has(nodeId)) renderer.selectNode(nodeId);
            const clickedNode = ((dataModel.sourceData && dataModel.sourceData.nodes) || []).find((n) => n.id === nodeId);
            const multiSelectedCount = renderer.selectedIds.size;

            if (clickedNode && clickedNode.isGroup) {
                items = FG.buildGroupNodeContextMenu({
                    groupId: nodeId,
                    hasVisibilityFilter: visibilityModel.active,
                    actions: contextMenuActions(),
                    multiSelectedCount,
                    groupingEnabled,
                });
            } else {
                const links = clickedNode ? FG.getNodeLinks(clickedNode) : [];
                items = FG.buildNodeContextMenu({
                    nodeId,
                    neighborIds: Array.from(connectivityModel.getRealNeighborIds(nodeId)),
                    getNodeLabel: (id) => dataModel.getNodeLabel(id),
                    isRoot: nodeId === currentRootNodeId(),
                    hasVisibilityFilter: visibilityModel.active,
                    actions: contextMenuActions(),
                    isInGroup: groupModel.getGroupOf(nodeId),
                    multiSelectedCount,
                    groupingEnabled,
                    nodeLinks: links.length > 0
                        ? {
                            links,
                            onOpen: (href) => {
                                try { P.openRawLink(FG.toNavigableHref(href)); }
                                catch (e) { notify("Force Graph: could not open the link - " + errText(e), "error"); }
                            },
                        }
                        : undefined,
                });
            }
        }

        await FG.showPopupMenu({ x: clientX, y: clientY }, items);
        popupClosedAt = Date.now();
    }

    async function openSelectionMenu() {
        if (selectedNodes.length === 0) return;
        const info = {
            count: selectedNodes.length,
            hasGroups: selectedNodes.some((n) => n.isGroup),
            hasNonGroups: selectedNodes.some((n) => !n.isGroup),
        };
        const menuActions = {
            selectChildren: () => actions.selectChildren(),
            selectMembers: () => actions.selectMembers(),
            selectMembersDeep: () => actions.selectMembersDeep(),
            highlight: () => legend.highlightSelection(),
            copyMarkdown: () => { void actions.copySelectedMarkdown(); },
            openMarkdown: () => { void actions.openSelectedMarkdown(); },
            openGrid: () => { void actions.openSelectedGrid(); },
            extract: () => { void actions.extractSelected(false); },
            extractWithChildren: () => { void actions.extractSelected(true); },
            deleteNodes: () => { void actions.deleteSelectedNodes(); },
            groupSelected: () => { void actions.groupSelectedNodes(); },
        };
        await FG.showPopupMenu($("selection-info"), FG.buildSelectionMenu(info, menuActions, groupingEnabled));
        popupClosedAt = Date.now();
    }

    // ====================================================================
    // Gestures
    // ====================================================================

    function selectAllVisible() {
        renderer.selectNode("");
        renderer.addToSelection(renderer.getNodes().map((n) => n.id));
    }

    function setShiftHighlight(on) {
        if (!on) { renderer.setAltKeyHighlight(null); return; }
        const selectedIds = renderer.selectedIds;
        if (selectedIds.size === 0) return;
        const ids = new Set(selectedIds);
        for (const nodeId of selectedIds) {
            for (const id of connectivityModel.getProcessedNeighborIds(nodeId)) ids.add(id);
            for (const id of connectivityModel.getRealNeighborIds(nodeId)) ids.add(id);
        }
        renderer.setAltKeyHighlight(ids);
    }

    // ====================================================================
    // Chrome
    // ====================================================================

    function recordsCount() {
        const total = (dataModel.sourceData && dataModel.sourceData.nodes.length) || 0;
        if (!visibilityModel.active) return total + " nodes";
        return renderer.getNodes().length + " of " + total + " nodes";
    }

    function hasGroups() {
        return !!(dataModel.sourceData && dataModel.sourceData.nodes.some((n) => n.isGroup));
    }

    function isEmpty() {
        if (dataModel.sourceData) return dataModel.sourceData.nodes.length === 0;
        return !loading && !parseError;
    }

    function refreshChrome() {
        $("loading").hidden = !loading;

        const errorPanel = $("error-panel");
        errorPanel.hidden = !parseError;
        if (parseError) {
            errorPanel.textContent = "";
            const title = document.createElement("div");
            title.className = "error-title";
            title.textContent = "This file is not valid JSON.";
            errorPanel.appendChild(title);
            errorPanel.appendChild(document.createTextNode(parseError));
        }
        $("empty-hint").hidden = !!parseError || loading || !isEmpty();

        const grouping = $("toggle-grouping");
        grouping.disabled = !hasGroups();
        grouping.classList.toggle("off", !groupingEnabled);
        grouping.title = groupingEnabled ? "Disable grouping" : "Enable grouping";

        $("expand-all").disabled = !visibilityModel.active;
        $("settings").classList.toggle("selected", !!panels && panels.state.panel === "settings");
        // The floating chrome card stays at full opacity, with an accent border, while a
        // panel is open — the built-in editor's `.graph-body-toolbar[data-active]`.
        const chrome = $("chrome");
        if (panels && panels.state.panel !== "closed") chrome.dataset.active = "";
        else delete chrome.dataset.active;
        $("open-in-draw").hidden = loading || !!parseError;
        $("copy-image").hidden = loading || !!parseError;

        // Write the box only when it actually differs from the model. While the user types
        // the two already agree, so this never fights the caret — but it does let Escape,
        // the clear button and setSearchQuery() empty a box that still has focus, which a
        // blanket "skip while focused" guard silently refused to do.
        const searchInput = $("search");
        if (searchInput.value !== searchQuery) {
            const focused = document.activeElement === searchInput;
            searchInput.value = searchQuery;
            if (focused) {
                const caret = searchQuery.length;
                try { searchInput.setSelectionRange(caret, caret); } catch (_e) { /* type has no selection */ }
            }
        }
        $("search-clear").hidden = !searchQuery;

        $("search-info").textContent = searchInfo
            ? searchInfo.visible + " visible / " + searchInfo.hidden + " hidden / " + searchInfo.total + " total"
            : "";

        const selInfo = $("selection-info");
        selInfo.hidden = selectedNodes.length === 0;
        selInfo.textContent = selectedNodes.length + " selected ▾";

        if (legend) legend.update();
        if (detail) detail.update();
        if (panels) panels.update();

        try {
            P.setStatusText(loading || parseError ? "" : (statusHint || recordsCount()));
        } catch (e) { /* older app build with no footer */ }
    }

    function setStatusHint(hint) {
        if (statusHint === hint) return;
        statusHint = hint;
        try { P.setStatusText(loading || parseError ? "" : (statusHint || recordsCount())); } catch (e) { /* no footer */ }
    }

    // ====================================================================
    // Wiring
    // ====================================================================

    function buildActions() {
        actions = FG.createActions({
            dataModel, groupModel, connectivityModel, visibilityModel, renderer,
            rebuildAndRender,
            writeNow,
            clearRootIfDeleted,
            refreshSelection: () => { if (detail) detail.invalidate(); refreshSelection(); },
            initializeEmptyGraph: () => {
                dataModel.sourceData = { nodes: [], links: [] };
                originalJson = { type: "force-graph" };
            },
            getSelectedNodes: () => selectedNodes,
            confirm: FG.showConfirmationDialog,
            prompt: FG.showInputDialog,
            notify,
            openContent,
        });
    }

    function wireRenderer() {
        renderer.setCanvas($("canvas"));

        renderer.onBadgeExpand = (nodeId, deep) => (deep ? expandNodeDeep(nodeId) : expandNode(nodeId));
        renderer.onAltClick = (nodeId) => actions.handleAltClick(nodeId);
        renderer.onSelectionChanged = () => handleSelectionChanged();
        renderer.onContextMenuAction = (nodeId, x, y) => { void handleContextMenu(nodeId, x, y); };
        renderer.onHoverChanged = (nodeId, x, y) => tooltip.handleHoverChanged(nodeId, x, y);
        renderer.onDoubleClick = () => { if (!panelDirty) detail.requestExpand(); };
        renderer.onBeforeClick = () => { if (tooltip) tooltip.clear(); };

        // Port of GraphContentView.handleCanvasClick: while a panel is open, a canvas click
        // closes it instead of changing the selection. Capture on the host runs before the
        // renderer's own listener on the canvas.
        $("canvas").parentElement.addEventListener("click", (event) => {
            if (event.target !== $("canvas")) return;
            if (panelDirty) { event.stopPropagation(); return; }
            if (Date.now() - popupClosedAt < 300) { event.stopPropagation(); return; }
            const panelOpen = panels.isOpen;
            const detailOpen = detail.state.expanded;
            if (!panelOpen && !detailOpen) return;
            if (!panelOpen && detailOpen && renderer.hasNodeAt(event)) return;
            event.stopPropagation();
            panels.close();
            detail.requestCollapse();
            refreshChrome();
        }, true);
    }

    function wireToolbar() {
        $("settings").addEventListener("click", () => { panels.toggleSettings(); refreshChrome(); });
        $("reset-view").addEventListener("click", resetView);
        $("expand-all").addEventListener("click", () => { void expandAll(); });
        $("toggle-grouping").addEventListener("click", () => setGrouping(!groupingEnabled));
        $("selection-info").addEventListener("click", () => { void openSelectionMenu(); });
        $("open-in-draw").addEventListener("click", () => { void openInDrawingEditor(); });
        $("copy-image").addEventListener("click", () => { void copyImageToClipboard(); });

        const search = $("search");
        search.addEventListener("input", () => setSearchQuery(search.value));
        search.addEventListener("focus", () => {
            if (searchResults && searchResults.length > 0) { panels.setPanel("results"); refreshChrome(); }
        });
        search.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); panels.moveResultSelection(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); panels.moveResultSelection(-1); }
            else if (e.key === "Enter") {
                e.preventDefault();
                if (!panels.pickSelectedResult() && searchInfo && searchInfo.hidden > 0) revealHiddenMatches();
            } else if (e.key === "Escape") {
                e.preventDefault();
                if (panels.close()) refreshChrome();
                else setSearchQuery("");
            }
        });
        $("search-clear").addEventListener("click", () => { setSearchQuery(""); search.focus(); });
    }

    function wireKeyboard() {
        document.addEventListener("keydown", (e) => {
            if (e.key === "Shift") { setShiftHighlight(true); return; }
            if (e.key === "Escape" && !FG.isOverlayOpen()) {
                if (panels.close()) { refreshChrome(); return; }
                if (detail.requestCollapse()) return;
            }
            if (!e.ctrlKey || e.altKey) return;

            const key = String(e.key).toLowerCase();
            const active = document.activeElement;
            const inField = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
            if (key === "f") {
                e.preventDefault();
                $("search").focus();
                $("search").select();
            } else if (key === "a" && !inField && !FG.isOverlayOpen()) {
                e.preventDefault();
                selectAllVisible();
            }
        });
        document.addEventListener("keyup", (e) => { if (e.key === "Shift") setShiftHighlight(false); });
        window.addEventListener("blur", () => setShiftHighlight(false));
    }

    function wireTheme() {
        FG.watchGraphPalette(P, (palette) => {
            renderer.setColors(palette);
            const host = document.querySelector(".canvas-host");
            if (host) host.style.background = palette.bg;
            FG.setIconGroupBorder(palette.groupBorder);
            FG.paletteFromContract = palette.fromContract;
        });
    }

    function wireState() {
        try {
            P.state.init({ groupingEnabled: true }, { restorableKeys: ["groupingEnabled"] });
            P.state.onChange((s) => {
                const next = s.groupingEnabled !== false;
                if (next === groupingEnabled) return;
                // applyGrouping, never setGrouping: a write from inside onChange loops forever.
                if (dataModel.sourceData) applyGrouping(next);
                else groupingEnabled = next;
            });
        } catch (e) { /* shared state is a convenience here, not a requirement */ }
    }

    async function load() {
        try {
            const path = await P.getFilePath();
            if (path) fileName = String(path).split(/[\\/]/).pop();
        } catch (e) { /* a plain board open - handled below */ }

        try {
            P.host.onContentChange((text) => {
                if (text === lastWritten) return;
                lastWritten = text;
                parseContent(text);
            });
        } catch (e) { /* not a content host */ }

        let text;
        try {
            text = await P.host.getContent();
        } catch (e) {
            loading = false;
            $("empty-hint").textContent = "Open a .fg.json file to view it here.";
            refreshChrome();
            return;
        }

        hostAttached = true;
        lastWritten = text;
        parseContent(text);
    }

    function mountPanels() {
        legend = FG.createLegendPanel(panelCtx);
        detail = FG.createDetailPanel(panelCtx);
        panels = FG.createToolbarPanels(panelCtx);
        $("legend-slot").append(legend.root);
        $("detail-slot").append(detail.root);
        $("panel-slot").append(panels.root);
    }

    function start() {
        // Swap each toolbar button's fallback text for the built-in editor's icon.
        if (FG.applyToolbarIcons) FG.applyToolbarIcons(document);
        buildActions();
        tooltip = FG.createTooltip({
            renderer, groupModel, dataModel,
            getRootNodeId: currentRootNodeId,
            getSourceNodes: () => (dataModel.sourceData ? dataModel.sourceData.nodes : null),
            setStatusHint,
            openContent,
        });
        mountPanels();
        wireRenderer();
        wireToolbar();
        wireKeyboard();
        wireTheme();
        wireState();
        refreshChrome();
        void load();

        aiVisionModel = FG.createAiVisionModel({
            renderer, dataModel, groupModel, connectivityModel, visibilityModel,
            get actions() { return actions; },
            getFileName: () => fileName,
            getRootNodeId: currentRootNodeId,
            getGroupingEnabled: () => groupingEnabled,
            setGrouping,
            getLoading: () => loading,
            getError: () => parseError,
            isEmpty,
            hasGroups,
            recordsCount,
            getSearchQuery: () => searchQuery,
            getSearchInfo: () => searchInfo,
            getSearchResults: () => searchResults,
            setSearchQuery,
            revealHiddenMatches,
            revealAndSelectNode,
            selectSearchResults,
            resetView, resetVisibility, expandAllCore, expandNode, expandNodeDeep, collapseNode,
            updateForceParams, resetForceParams,
            getExpansionOptions, updateExpansionOptions, setRootNode, setLegendDescription,
            openInDrawingEditor, copyImageToClipboard, save,
        });
        aiVisionModel.register();

        FG.app = {
            renderer, dataModel, groupModel, connectivityModel, visibilityModel, searchModel,
            get actions() { return actions; },
            get legend() { return legend; },
            get detail() { return detail; },
            get panels() { return panels; },
            rebuildAndRender, resetView, resetVisibility,
            expandNode, expandNodeDeep, collapseNode, expandAll, expandAllCore,
            setGrouping, setSearchQuery, revealHiddenMatches, selectSearchResults, revealAndSelectNode,
            selectAllVisible, writeNow, writeSoon, refreshChrome, recordsCount,
            setRootNode, getExpansionOptions, updateExpansionOptions,
            updateForceParams, resetForceParams, setLegendDescription,
            openInDrawingEditor, copyImageToClipboard, openContent,
            get searchResults() { return searchResults; },
            get searchInfo() { return searchInfo; },
            get selectedNodes() { return selectedNodes; },
            get linkedNodes() { return linkedNodes; },
            get groupingEnabled() { return groupingEnabled; },
        };
    }

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
