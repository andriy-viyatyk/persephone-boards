// Force Graph board — the AiVision agent surface (BT-015).
//
// Reproduces `GraphEditorFacade.ts`: the same query/analysis members and the same ~30 named
// elements, published at `pages[i].editor.app` instead of `pages[i].editor` (§5.13). It also
// carries the edit methods the facade never had — the built-in editor told agents to edit
// `page.content`, and a board's content is not directly writable from an agent, so the mutations
// the UI performs are exposed here instead.
//
// EPIC-098 rules, restated in EPIC-100 D3:
//   1. no agent-facing method waits on an in-board overlay — every destructive one calls a
//      `*Core` path;
//   2. an action whose UI affordance is "select something first" takes an explicit argument
//      (`addChild(parentId)`, `groupSelected(ids)`);
//   3. a member summary is search text — it is written with the words a person would type.
(() => {
    const FG = (window.FG = window.FG || {});

    const GRAPH_ELEMENTS = [
        { name: "graph-open-in-draw", purpose: "Open the current graph image in a Drawing page.", where: "right side of the graph body toolbar" },
        { name: "graph-copy-image", purpose: "Copy the rendered graph image to the clipboard.", where: "right side of the graph body toolbar, after Open in Drawing" },
        { name: "graph-settings", purpose: "Open or close the force-tuning panel.", where: "left side of the graph body toolbar" },
        { name: "graph-toggle-grouping", purpose: "Toggle group-node rendering.", where: "left side of the graph body toolbar, after Force tuning" },
        { name: "graph-reset-view", purpose: "Rebuild the graph view from its current root and visibility state.", where: "left side of the graph body toolbar, after Grouping" },
        { name: "graph-expand-all", purpose: "Reveal all graph nodes.", where: "left side of the graph body toolbar, after Reset view" },
        { name: "graph-search", purpose: "Enter the UI search query for graph nodes.", where: "middle of the graph body toolbar, after Expand all" },
        { name: "graph-search-clear", purpose: "Clear the current UI search query.", where: "right edge of the graph search field, when search text is present" },
        { name: "graph-selection-menu", purpose: "Open actions for the current node selection.", where: "right side of the graph body toolbar, after search information, when nodes are selected" },
        { name: "graph-panel-physics", purpose: "Select the force-tuning panel.", where: "top of the graph panel strip, Physics tab" },
        { name: "graph-panel-expansion", purpose: "Select expansion settings.", where: "top of the graph panel strip, Expansion tab" },
        { name: "graph-panel-results", purpose: "Select search results.", where: "top of the graph panel strip, Results tab" },
        { name: "tuning-charge", purpose: "Adjust D3 charge/repulsion.", where: "in the Physics panel, first tuning row" },
        { name: "tuning-link-distance", purpose: "Adjust the desired link distance.", where: "in the Physics panel, second tuning row" },
        { name: "tuning-collide", purpose: "Adjust the collision force.", where: "in the Physics panel, third tuning row" },
        { name: "tuning-reset", purpose: "Restore the default force parameters.", where: "in the Physics panel, bottom-right" },
        { name: "graph-detail-panel", purpose: "Identify the graph's selected-node detail panel.", where: "top-right corner of the graph canvas, floating over it" },
        { name: "graph-detail-toggle", purpose: "Expand or collapse the detail panel.", where: "top of the graph detail panel" },
        { name: "graph-detail-id", purpose: "Edit the selected node ID.", where: "in the expanded graph detail panel, Info tab, ID row" },
        { name: "graph-detail-title", purpose: "Edit the selected node title.", where: "in the expanded graph detail panel, Info tab, Title row" },
        { name: "graph-links-grid", purpose: "Inspect or edit links from the selected node.", where: "in the expanded graph detail panel, Links tab" },
        { name: "graph-properties-grid", purpose: "Inspect or edit custom node properties.", where: "in the expanded graph detail panel, Properties tab" },
        { name: "graph-detail-tab-info", purpose: "Show node identity, title, level, and shape.", where: "top of the expanded graph detail panel, Info tab" },
        { name: "graph-detail-tab-properties", purpose: "Show custom properties.", where: "top of the expanded graph detail panel, Properties tab" },
        { name: "graph-detail-tab-links", purpose: "Show linked nodes and editable link rows.", where: "top of the expanded graph detail panel, Links tab" },
        { name: "graph-legend-panel", purpose: "Identify the graph legend panel.", where: "bottom-left corner of the graph canvas, floating over it" },
        { name: "graph-legend-toggle", purpose: "Expand or collapse the legend.", where: "top of the graph legend panel" },
        { name: "graph-legend-tab-selection", purpose: "Show selected and not-selected filters.", where: "top of the expanded graph legend panel, Selection tab" },
        { name: "graph-legend-tab-level", purpose: "Show level, root, and group legend filters.", where: "top of the expanded graph legend panel, Level tab" },
        { name: "graph-legend-tab-shape", purpose: "Show shape, root, and group legend filters.", where: "top of the expanded graph legend panel, Shape tab" },
        { name: "graph-expansion-root", purpose: "Choose the BFS expansion root or automatic root selection.", where: "in the Expansion panel, Root field" },
        { name: "graph-expansion-depth", purpose: "Set the persisted maximum expansion depth.", where: "in the Expansion panel, Depth field" },
        { name: "graph-expansion-max", purpose: "Set the persisted maximum visible-node count.", where: "in the Expansion panel, maximum-visible-nodes field" },
    ];

    const HELP = `This is a .fg.json force-directed graph open in the Force Graph board.
The graph body is one canvas: nodes, labels and links are not DOM elements and cannot be
highlighted or clicked by ref. Drive the graph through this model instead — select(ids),
addNode, addChild, setNodeProps, addLink, deleteNodes — and use elements only for the toolbar,
panel, detail and legend controls.

Editing writes the file immediately: every mutation re-serializes the whole document through
Persephone's content host, and Ctrl+S saves it. Deletes here are immediate and unconfirmed; the
interactive UI asks first, this model does not.

search(query) is the pure data query and changes nothing; setSearchQuery(query) drives the visible
search box and its Results panel. Node ids, not titles, address every node — read nodes[n].id.
Groups are nodes with isGroup: true, and a link touching a group node means membership rather than
a relationship, which is why getNeighborIds (real links) and getVisualNeighborIds (what is drawn)
can differ while grouping is on.`;

    FG.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, refresh() {} };

        const elementParts = aiVision.createElements(GRAPH_ELEMENTS);
        const dataModel = ctx.dataModel;
        const renderer = ctx.renderer;

        const sourceNodes = () => (dataModel.sourceData ? dataModel.sourceData.nodes : []);
        const sourceLinks = () => (dataModel.sourceData ? dataModel.sourceData.links : []);
        const loaded = () => !ctx.getLoading() && !ctx.getError() && dataModel.sourceData !== null;

        function requireLoaded() {
            if (!loaded()) throw new Error("Graph action unavailable: graph content is not loaded.");
        }
        function requireNode(id) {
            const node = sourceNodes().find((n) => n.id === String(id));
            if (!node) throw new Error('No node with id "' + id + '". Read nodes[n].id for the ids in this graph.');
            return node;
        }

        // -- nodes[] node -------------------------------------------------
        const nodeSummary = (id) => {
            const node = sourceNodes().find((n) => n.id === id);
            if (!node) return undefined;
            const clean = dataModel.cleanNode(node);
            return {
                kind: "GraphNode", id: clean.id, title: clean.title, level: clean.level,
                shape: clean.shape, isGroup: !!clean.isGroup,
                group: ctx.groupModel.getGroupOf(id),
                neighbors: Array.from(ctx.connectivityModel.getRealNeighborIds(id)),
                properties: FG.getCustomProperties(node).reduce((acc, [key, value]) => { acc[key] = value; return acc; }, {}),
            };
        };
        const makeNode = (id) => ({
            aiVision: {
                kind: "GraphNode",
                summary: "One node of the graph. Its id is what every node method takes.",
                members: [
                    { name: "id", kind: "property", summary: "Stable node id; pass this to every node method." },
                    { name: "title", kind: "property", summary: "The node's display title, or undefined when it shows its id." },
                    { name: "level", kind: "property", summary: "Importance level 1-5, which sets the drawn size." },
                    { name: "shape", kind: "property", summary: "Node shape: circle, square, diamond, triangle, star or hexagon." },
                    { name: "isGroup", kind: "property", summary: "Whether this node is a group container rather than data." },
                    { name: "group", kind: "property", summary: "The id of the group containing this node, or undefined." },
                    { name: "neighbors", kind: "property", summary: "Ids of the nodes linked to this one by real data links." },
                    { name: "properties", kind: "property", summary: "The node's custom properties as a plain object." },
                ],
                summarize: () => nodeSummary(id),
            },
            get id() { const s = nodeSummary(id); return s && s.id; },
            get title() { const s = nodeSummary(id); return s && s.title; },
            get level() { const s = nodeSummary(id); return s && s.level; },
            get shape() { const s = nodeSummary(id); return s && s.shape; },
            get isGroup() { const s = nodeSummary(id); return s && s.isGroup; },
            get group() { const s = nodeSummary(id); return s && s.group; },
            get neighbors() { const s = nodeSummary(id); return s && s.neighbors; },
            get properties() { const s = nodeSummary(id); return s && s.properties; },
        });

        const nodesNode = {
            aiVision: {
                kind: "GraphNodes",
                summary: "Every node in the graph file, group containers included. Index by position or by node id.",
                members: [
                    { name: "count", kind: "property", summary: "Number of nodes in the file." },
                    { name: "ids", kind: "property", summary: "Every node id, in file order." },
                ],
                index: (key) => {
                    if (typeof key === "number") {
                        const node = sourceNodes()[key];
                        return node ? makeNode(node.id) : undefined;
                    }
                    if (typeof key === "string") return sourceNodes().some((n) => n.id === key) ? makeNode(key) : undefined;
                    return undefined;
                },
                summarize: () => sourceNodes().map((n) => nodeSummary(n.id)),
            },
            get count() { return sourceNodes().length; },
            get ids() { return sourceNodes().map((n) => n.id); },
        };

        // -- helpers reused by several methods ----------------------------
        const cleanNodes = () => sourceNodes().map((n) => dataModel.cleanNode(n));
        const cleanLinks = () => sourceLinks().map((link) => {
            const { source, target } = FG.linkIds(link);
            return { source, target };
        });

        function search(query, includeHidden) {
            const trimmed = String(query || "").trim().toLowerCase();
            if (!trimmed) return [];
            const words = trimmed.split(/\s+/).filter(Boolean);
            const visibleIds = new Set(renderer.getNodes().map((n) => n.id));
            const results = [];
            for (const node of sourceNodes()) {
                const matched = FG.matchNodeSearch(node, words);
                if (!matched) continue;
                const visible = visibleIds.has(node.id);
                if (includeHidden === false && !visible) continue;
                results.push(Object.assign({}, matched, { visible }));
            }
            results.sort((a, b) => (a.visible !== b.visible ? (a.visible ? -1 : 1) : a.label.localeCompare(b.label)));
            return results;
        }

        function bfs(startId, maxDepth, visual) {
            const getNeighbors = visual
                ? (id) => ctx.connectivityModel.getProcessedNeighborIds(id)
                : (id) => ctx.connectivityModel.getRealNeighborIds(id);
            const visited = new Map([[String(startId), 0]]);
            const queue = [{ id: String(startId), depth: 0 }];
            while (queue.length > 0) {
                const { id, depth } = queue.shift();
                if (maxDepth !== undefined && depth >= maxDepth) continue;
                for (const neighborId of getNeighbors(id)) {
                    if (!visited.has(neighborId)) {
                        visited.set(neighborId, depth + 1);
                        queue.push({ id: neighborId, depth: depth + 1 });
                    }
                }
            }
            return Array.from(visited, ([id, depth]) => ({ id, depth }));
        }

        function getComponents() {
            const visited = new Set();
            const components = [];
            const graphRootId = ctx.getRootNodeId();
            for (const node of sourceNodes().filter((n) => !n.isGroup)) {
                if (visited.has(node.id)) continue;
                const component = [];
                const queue = [node.id];
                visited.add(node.id);
                while (queue.length > 0) {
                    const id = queue.shift();
                    component.push(id);
                    for (const neighborId of ctx.connectivityModel.getRealNeighborIds(id)) {
                        if (!visited.has(neighborId)) { visited.add(neighborId); queue.push(neighborId); }
                    }
                }
                let rootId = component[0];
                if (graphRootId && component.includes(graphRootId)) {
                    rootId = graphRootId;
                } else {
                    let maxDegree = 0;
                    for (const id of component) {
                        const degree = ctx.connectivityModel.getRealNeighborIds(id).size;
                        if (degree > maxDegree) { maxDegree = degree; rootId = id; }
                    }
                }
                components.push({ nodeCount: component.length, rootId, nodeIds: component });
            }
            components.sort((a, b) => b.nodeCount - a.nodeCount);
            return components;
        }

        const MEMBERS = [
            { name: "fileName", kind: "property", summary: "Name of the open .fg.json file, or an empty string when none is open." },
            { name: "nodes", kind: "property", node: true, indexable: true, summary: "Every node in the graph; index by position or by node id." },
            { name: "links", kind: "property", summary: "Every link as a {source, target} pair of node ids." },
            { name: "nodeCount", kind: "property", summary: "Total number of nodes in the file." },
            { name: "linkCount", kind: "property", summary: "Total number of links in the file." },
            { name: "getNode", kind: "method", signature: "getNode(id: string)", summary: "Look up one node by id and return it, or undefined when there is no such node." },
            { name: "selectedIds", kind: "property", summary: "Ids of the nodes that are currently selected on the canvas." },
            { name: "selectedNodes", kind: "property", summary: "The currently selected nodes, with their properties." },
            { name: "select", kind: "method", signature: "select(ids: string[])", summary: "Select these nodes on the canvas, replacing whatever was selected before.", caution: "changes the visible selection" },
            { name: "addToSelection", kind: "method", signature: "addToSelection(ids: string[])", summary: "Add these nodes to the current canvas selection.", caution: "changes the visible selection" },
            { name: "clearSelection", kind: "method", signature: "clearSelection()", summary: "Deselect everything on the canvas.", caution: "changes the visible selection" },
            { name: "selectChildren", kind: "method", signature: "selectChildren(ids?: string[])", summary: "Add the children (linked neighbours) of these nodes to the selection; defaults to the current selection." },
            { name: "selectMembers", kind: "method", signature: "selectMembers(ids?: string[])", summary: "Add the direct members of these group nodes to the selection." },
            { name: "selectMembersDeep", kind: "method", signature: "selectMembersDeep(ids?: string[])", summary: "Add every member of these groups and their sub-groups to the selection." },
            { name: "getNeighborIds", kind: "method", signature: "getNeighborIds(nodeId: string)", summary: "Ids of the nodes directly linked to this one by real data links, ignoring group membership." },
            { name: "getVisualNeighborIds", kind: "method", signature: "getVisualNeighborIds(nodeId: string)", summary: "Ids of the nodes this one is drawn connected to; with grouping on, links can route through a group node." },
            { name: "getGroupOf", kind: "method", signature: "getGroupOf(nodeId: string)", summary: "The id of the group this node belongs to, or undefined when it is top level." },
            { name: "getGroupMembers", kind: "method", signature: "getGroupMembers(groupId: string)", summary: "Ids of the direct members of a group node." },
            { name: "getGroupMembersDeep", kind: "method", signature: "getGroupMembersDeep(groupId: string)", summary: "Ids of every member of a group, including members of its sub-groups." },
            { name: "getGroupChain", kind: "method", signature: "getGroupChain(nodeId: string)", summary: "The chain of groups from this node up to the outermost one." },
            { name: "isGroup", kind: "method", signature: "isGroup(nodeId: string)", summary: "Whether this node is a group container rather than a data node." },
            { name: "search", kind: "method", signature: "search(query: string, includeHidden = true)", summary: "Find nodes whose title or properties match every word of the query. A pure data query - it changes nothing on screen." },
            { name: "bfs", kind: "method", signature: "bfs(startId: string, maxDepth?: number, visual = false)", summary: "Walk the graph outward from a node, breadth first, returning each node reached with its distance from the start." },
            { name: "getComponents", kind: "method", signature: "getComponents()", summary: "Find the disconnected sub-graphs (connected components), largest first, each with a suggested root." },
            { name: "rootNodeId", kind: "property", summary: "The id of the graph's root node, or an empty string when it picks one automatically." },
            { name: "setRootNode", kind: "method", signature: "setRootNode(nodeId?: string)", summary: "Make this node the root the graph expands from; pass nothing to go back to automatic selection.", caution: "changes and saves the file" },
            { name: "groupingEnabled", kind: "property", summary: "Whether group containers are being drawn." },
            { name: "toggleGrouping", kind: "method", signature: "toggleGrouping()", summary: "Turn the drawing of group containers on or off.", caution: "changes graph rendering and clears the selection" },
            { name: "loading", kind: "property", summary: "Whether the graph file is still being parsed." },
            { name: "error", kind: "property", summary: "The JSON parse error for the open file, or an empty string when it parsed cleanly." },
            { name: "isEmpty", kind: "property", summary: "Whether the graph has no nodes at all." },
            { name: "hasGroups", kind: "property", summary: "Whether the file contains any group nodes." },
            { name: "hasVisibilityFilter", kind: "property", summary: "Whether the graph is hiding nodes because it is too large to draw at once." },
            { name: "recordsCount", kind: "property", summary: "The visible/total node count shown in the page footer." },
            { name: "totalNodeCount", kind: "property", summary: "Total node count of the full graph, hidden nodes included." },
            { name: "searchQuery", kind: "property", writable: true, summary: "The text in the visible search box; setting it re-runs the on-screen search." },
            { name: "searchInfo", kind: "property", summary: "Counts for the running search: how many matches are visible, hidden and total." },
            { name: "searchResults", kind: "property", summary: "The rows shown in the Results panel for the running search." },
            { name: "setSearchQuery", kind: "method", signature: "setSearchQuery(query: string)", summary: "Type into the visible search box and highlight the matching nodes.", caution: "changes the visible UI" },
            { name: "revealHiddenMatches", kind: "method", signature: "revealHiddenMatches()", summary: "Show the search matches that are currently hidden by the visibility filter.", caution: "changes which nodes are visible" },
            { name: "revealAndSelectNode", kind: "method", signature: "revealAndSelectNode(nodeId: string)", summary: "Bring a hidden node into view and select it.", caution: "changes visibility and selection" },
            { name: "selectSearchResults", kind: "method", signature: "selectSearchResults()", summary: "Reveal every search match and add them all to the selection.", caution: "changes visibility and selection" },
            { name: "resetView", kind: "method", signature: "resetView()", summary: "Rebuild the layout from scratch and restart the physics simulation.", caution: "restarts the simulation and recomputes visibility" },
            { name: "resetVisibility", kind: "method", signature: "resetVisibility()", summary: "Undo every manual expand and collapse, back to the graph's initial visible set.", caution: "changes which nodes are visible" },
            { name: "expandAll", kind: "method", signature: "expandAll()", summary: "Show every node, including the ones hidden for performance. No confirmation is asked.", caution: "can be slow on a very large graph" },
            { name: "expandNode", kind: "method", signature: "expandNode(nodeId: string)", summary: "Reveal one more level of this node's hidden neighbours - what clicking its +N badge does.", caution: "changes which nodes are visible" },
            { name: "expandNodeDeep", kind: "method", signature: "expandNodeDeep(nodeId: string)", summary: "Reveal the whole hidden subtree hanging off this node.", caution: "changes which nodes are visible" },
            { name: "collapseNode", kind: "method", signature: "collapseNode(nodeId: string)", summary: "Hide the nodes revealed below this one, folding its subtree away.", caution: "changes which nodes are visible" },
            { name: "forceParams", kind: "property", summary: "The current physics values: charge, linkDistance and collide." },
            { name: "updateForceParams", kind: "method", signature: "updateForceParams(params: { charge?, linkDistance?, collide? })", summary: "Change the physics of the layout - repulsion, link length, collision - and save them in the file.", caution: "changes and saves the file" },
            { name: "resetForceParams", kind: "method", signature: "resetForceParams()", summary: "Put the physics back to the defaults and drop the saved values.", caution: "changes and saves the file" },
            { name: "expansionOptions", kind: "property", summary: "The saved expansion settings: root node, expand depth and maximum visible nodes." },
            { name: "updateExpansionOptions", kind: "method", signature: "updateExpansionOptions(patch: { expandDepth?, maxVisible? })", summary: "Set how deep and how wide the graph expands when the file is next opened.", caution: "changes and saves the file" },
            { name: "legendDescriptions", kind: "property", summary: "The legend text written for each level and shape." },
            { name: "setLegendDescription", kind: "method", signature: "setLegendDescription(tab: \"levels\" | \"shapes\", key: string, value: string)", summary: "Write the legend description that explains what a level or shape means in this graph.", caution: "changes and saves the file" },
            { name: "addNode", kind: "method", signature: "addNode(props?: object)", summary: "Create a new node and return its id; pass a title, level, shape or any custom property.", caution: "changes and saves the file" },
            { name: "addChild", kind: "method", signature: "addChild(parentId: string, props?: object)", summary: "Create a node linked to this parent and return its new id.", caution: "changes and saves the file" },
            { name: "setNodeProps", kind: "method", signature: "setNodeProps(nodeId: string, props: object)", summary: "Change a node's title, level, shape or custom properties; an empty value removes a property.", caution: "changes and saves the file" },
            { name: "renameNode", kind: "method", signature: "renameNode(oldId: string, newId: string)", summary: "Change a node's id, repointing every link to it. Fails when the new id is already taken.", caution: "changes and saves the file" },
            { name: "deleteNodes", kind: "method", signature: "deleteNodes(ids: string[])", summary: "Remove these nodes and every link touching them.", caution: "Deletes immediately - no confirmation and no undo." },
            { name: "addLink", kind: "method", signature: "addLink(sourceId: string, targetId: string)", summary: "Link two nodes together." , caution: "changes and saves the file" },
            { name: "deleteLink", kind: "method", signature: "deleteLink(sourceId: string, targetId: string)", summary: "Remove the link between two nodes.", caution: "changes and saves the file" },
            { name: "groupSelected", kind: "method", signature: "groupSelected(ids: string[], title?: string)", summary: "Put these nodes into a group container and return the group's id; with exactly one group among them and no title, the rest are added to that group instead.", caution: "changes and saves the file" },
            { name: "setGroupTitle", kind: "method", signature: "setGroupTitle(groupId: string, title: string)", summary: "Rename a group container.", caution: "changes and saves the file" },
            { name: "ungroup", kind: "method", signature: "ungroup(groupId: string)", summary: "Dissolve a group, keeping its members and moving them up one level.", caution: "Removes the group immediately - no confirmation and no undo." },
            { name: "deleteGroup", kind: "method", signature: "deleteGroup(groupId: string)", summary: "Delete a group together with the members drawn inside it; unconnected members are moved up instead.", caution: "Deletes the group and its members immediately - no confirmation and no undo." },
            { name: "removeFromGroup", kind: "method", signature: "removeFromGroup(nodeId: string)", summary: "Take a node out of its group and leave it where it is.", caution: "changes and saves the file" },
            { name: "extract", kind: "method", signature: "extract(withChildren = false)", summary: "Open the selected nodes as a new graph page, optionally pulling in their linked children.", caution: "opens a new page" },
            { name: "openMarkdown", kind: "method", signature: "openMarkdown()", summary: "Open the selected nodes as a Markdown page.", caution: "opens a new page" },
            { name: "openGrid", kind: "method", signature: "openGrid()", summary: "Open the selected nodes as a JSON grid page, one row per node.", caution: "opens a new page" },
            { name: "copyMarkdown", kind: "method", signature: "copyMarkdown()", summary: "Copy the selected nodes to the clipboard as Markdown.", caution: "writes to the clipboard" },
            { name: "openInDrawingEditor", kind: "method", signature: "openInDrawingEditor()", summary: "Open a picture of the graph as a new editable drawing.", caution: "opens a new Drawing page" },
            { name: "copyImageToClipboard", kind: "method", signature: "copyImageToClipboard()", summary: "Copy a PNG picture of the graph to the clipboard.", caution: "writes an image to the clipboard" },
            { name: "save", kind: "method", signature: "save()", summary: "Save the file to disk, the same as pressing Ctrl+S." },
        ];

        const app = {
            aiVision: {
                kind: "GraphBoard",
                summary: "The Force Graph board's live model for the open .fg.json graph.",
                overview: "Read nodes and links for the data.\nUse search, bfs and getComponents to analyse it.\nUse addNode, addChild, setNodeProps, addLink and deleteNodes to change it - every change is written to the file.",
                help: HELP,
                members: MEMBERS.concat(elementParts.members),
                elements: GRAPH_ELEMENTS,
                provide: elementParts.provide,
                summarize: () => ({
                    kind: "GraphBoard",
                    fileName: ctx.getFileName(),
                    nodeCount: sourceNodes().length,
                    linkCount: sourceLinks().length,
                    selectedCount: renderer.selectedIds.size,
                    rootNodeId: ctx.getRootNodeId(),
                    groupingEnabled: ctx.getGroupingEnabled(),
                    loading: ctx.getLoading(),
                    error: ctx.getError(),
                    isEmpty: ctx.isEmpty(),
                    hasGroups: ctx.hasGroups(),
                    hasVisibilityFilter: ctx.visibilityModel.active,
                    recordsCount: ctx.recordsCount(),
                    totalNodeCount: ctx.visibilityModel.totalNodeCount,
                    searchQuery: ctx.getSearchQuery(),
                    searchInfo: ctx.getSearchInfo(),
                    forceParams: Object.assign({}, renderer.forceParams),
                    expansionOptions: ctx.getExpansionOptions(),
                }),
            },

            get fileName() { return ctx.getFileName(); },
            get nodes() { return nodesNode; },
            get links() { return cleanLinks(); },
            get nodeCount() { return sourceNodes().length; },
            get linkCount() { return sourceLinks().length; },
            getNode(id) {
                const node = sourceNodes().find((n) => n.id === String(id));
                return node ? dataModel.cleanNode(node) : undefined;
            },

            get selectedIds() { return Array.from(renderer.selectedIds); },
            get selectedNodes() {
                const ids = renderer.selectedIds;
                return sourceNodes().filter((n) => ids.has(n.id)).map((n) => dataModel.cleanNode(n));
            },
            select(ids) {
                requireLoaded();
                renderer.selectNode("");
                const list = (ids || []).map(String);
                for (const id of list) requireNode(id);
                if (list.length > 0) renderer.addToSelection(list);
                return list;
            },
            addToSelection(ids) {
                requireLoaded();
                const list = (ids || []).map(String);
                for (const id of list) requireNode(id);
                renderer.addToSelection(list);
                return Array.from(renderer.selectedIds);
            },
            clearSelection() { requireLoaded(); renderer.selectNode(""); return true; },
            selectChildren(ids) { requireLoaded(); return ctx.actions.selectChildren(ids && ids.map(String)); },
            selectMembers(ids) { requireLoaded(); return ctx.actions.selectMembers(ids && ids.map(String)); },
            selectMembersDeep(ids) { requireLoaded(); return ctx.actions.selectMembersDeep(ids && ids.map(String)); },

            getNeighborIds(nodeId) { return Array.from(ctx.connectivityModel.getRealNeighborIds(String(nodeId))); },
            getVisualNeighborIds(nodeId) { return Array.from(ctx.connectivityModel.getProcessedNeighborIds(String(nodeId))); },
            getGroupOf(nodeId) { return ctx.groupModel.getGroupOf(String(nodeId)); },
            getGroupMembers(groupId) { return Array.from(ctx.groupModel.getMembers(String(groupId))); },
            getGroupMembersDeep(groupId) { return Array.from(ctx.connectivityModel.getAllRealMembers(String(groupId))); },
            getGroupChain(nodeId) { return ctx.connectivityModel.getGroupChain(String(nodeId)); },
            isGroup(nodeId) { return ctx.groupModel.isGroup(String(nodeId)); },

            search(query, includeHidden) { return search(query, includeHidden); },
            bfs(startId, maxDepth, visual) { requireNode(startId); return bfs(startId, maxDepth, visual); },
            getComponents() { return getComponents(); },

            get rootNodeId() { return ctx.getRootNodeId(); },
            setRootNode(nodeId) {
                requireLoaded();
                if (nodeId != null && nodeId !== "") requireNode(nodeId);
                ctx.setRootNode(nodeId == null || nodeId === "" ? undefined : String(nodeId));
                return ctx.getRootNodeId();
            },
            get groupingEnabled() { return ctx.getGroupingEnabled(); },
            toggleGrouping() { requireLoaded(); ctx.setGrouping(!ctx.getGroupingEnabled()); return ctx.getGroupingEnabled(); },

            get loading() { return ctx.getLoading(); },
            get error() { return ctx.getError(); },
            get isEmpty() { return ctx.isEmpty(); },
            get hasGroups() { return ctx.hasGroups(); },
            get hasVisibilityFilter() { return ctx.visibilityModel.active; },
            get recordsCount() { return ctx.recordsCount(); },
            get totalNodeCount() { return ctx.visibilityModel.totalNodeCount; },

            get searchQuery() { return ctx.getSearchQuery(); },
            set searchQuery(value) { ctx.setSearchQuery(value == null ? "" : String(value)); },
            get searchInfo() { return ctx.getSearchInfo(); },
            get searchResults() { return ctx.getSearchResults(); },
            setSearchQuery(query) { ctx.setSearchQuery(query == null ? "" : String(query)); return ctx.getSearchInfo(); },
            revealHiddenMatches() { requireLoaded(); ctx.revealHiddenMatches(); return ctx.getSearchInfo(); },
            revealAndSelectNode(nodeId) { requireLoaded(); requireNode(nodeId); ctx.revealAndSelectNode(String(nodeId)); return true; },
            selectSearchResults() { requireLoaded(); ctx.selectSearchResults(); return Array.from(renderer.selectedIds); },

            resetView() { requireLoaded(); ctx.resetView(); return true; },
            resetVisibility() { requireLoaded(); ctx.resetVisibility(); return true; },
            expandAll() { requireLoaded(); ctx.expandAllCore(); return ctx.recordsCount(); },
            expandNode(nodeId) { requireLoaded(); requireNode(nodeId); ctx.expandNode(String(nodeId)); return ctx.recordsCount(); },
            expandNodeDeep(nodeId) { requireLoaded(); requireNode(nodeId); ctx.expandNodeDeep(String(nodeId)); return ctx.recordsCount(); },
            collapseNode(nodeId) { requireLoaded(); requireNode(nodeId); ctx.collapseNode(String(nodeId)); return ctx.recordsCount(); },

            get forceParams() { return Object.assign({}, renderer.forceParams); },
            updateForceParams(params) { requireLoaded(); ctx.updateForceParams(params || {}); return Object.assign({}, renderer.forceParams); },
            resetForceParams() { requireLoaded(); ctx.resetForceParams(); return Object.assign({}, renderer.forceParams); },
            get expansionOptions() { return ctx.getExpansionOptions(); },
            updateExpansionOptions(patch) { requireLoaded(); ctx.updateExpansionOptions(patch || {}); return ctx.getExpansionOptions(); },

            get legendDescriptions() { return dataModel.getLegendDescriptions(); },
            setLegendDescription(tab, key, value) {
                requireLoaded();
                const which = String(tab);
                if (which !== "levels" && which !== "shapes") throw new Error('setLegendDescription takes "levels" or "shapes" as its first argument.');
                ctx.setLegendDescription(which, String(key), value == null ? "" : String(value));
                return dataModel.getLegendDescriptions();
            },

            addNode(props) {
                requireLoaded();
                const id = ctx.actions.addNode(0, 0);
                if (props && typeof props === "object") ctx.actions.updateNodeProps(id, props);
                return id;
            },
            addChild(parentId, props) {
                requireLoaded();
                requireNode(parentId);
                const id = ctx.actions.addChild(String(parentId));
                if (!id) throw new Error("Could not add a child node.");
                if (props && typeof props === "object") ctx.actions.updateNodeProps(id, props);
                return id;
            },
            setNodeProps(nodeId, props) {
                requireLoaded();
                requireNode(nodeId);
                if (!props || typeof props !== "object") throw new Error("setNodeProps needs a props object, for example setNodeProps(id, { title: \"Zeus\", level: 1 }).");
                ctx.actions.updateNodeProps(String(nodeId), props);
                return dataModel.cleanNode(requireNode(nodeId));
            },
            renameNode(oldId, newId) {
                requireLoaded();
                requireNode(oldId);
                const target = String(newId || "").trim();
                if (!target) throw new Error("renameNode needs a non-empty new id.");
                if (!ctx.actions.renameNode(String(oldId), target)) {
                    throw new Error('Cannot rename to "' + target + '": a node with that id already exists.');
                }
                return target;
            },
            deleteNodes(ids) {
                requireLoaded();
                const list = (Array.isArray(ids) ? ids : [ids]).map(String);
                for (const id of list) requireNode(id);
                return ctx.actions.deleteNodesCore(list);
            },
            addLink(sourceId, targetId) {
                requireLoaded();
                requireNode(sourceId); requireNode(targetId);
                ctx.actions.addLink(String(sourceId), String(targetId));
                return true;
            },
            deleteLink(sourceId, targetId) {
                requireLoaded();
                requireNode(sourceId); requireNode(targetId);
                ctx.actions.deleteLink(String(sourceId), String(targetId));
                return true;
            },

            groupSelected(ids, title) {
                requireLoaded();
                const list = (ids && ids.length ? ids : Array.from(renderer.selectedIds)).map(String);
                for (const id of list) requireNode(id);
                return ctx.actions.groupSelectedCore(list, title == null ? undefined : String(title));
            },
            setGroupTitle(groupId, title) { requireLoaded(); return ctx.actions.setGroupTitleCore(String(groupId), title); },
            ungroup(groupId) { requireLoaded(); return ctx.actions.ungroupNodeCore(String(groupId)); },
            deleteGroup(groupId) { requireLoaded(); return ctx.actions.deleteGroupCore(String(groupId)); },
            removeFromGroup(nodeId) { requireLoaded(); requireNode(nodeId); ctx.actions.removeFromGroup(String(nodeId)); return true; },

            extract(withChildren) { requireLoaded(); return ctx.actions.extractSelected(!!withChildren); },
            openMarkdown() { requireLoaded(); return ctx.actions.openSelectedMarkdown(); },
            openGrid() { requireLoaded(); return ctx.actions.openSelectedGrid(); },
            copyMarkdown() { requireLoaded(); return ctx.actions.copySelectedMarkdown(); },
            openInDrawingEditor() { requireLoaded(); return ctx.openInDrawingEditor(); },
            copyImageToClipboard() { return ctx.copyImageToClipboard(); },
            save() { return ctx.save(); },
        };

        let remote = null;
        let shape = null;
        const currentShape = () => [sourceNodes().length > 0, sourceLinks().length > 0].join();

        return {
            register() {
                remote = aiVision.expose(app);
                shape = currentShape();
            },
            refresh() {
                if (!remote || typeof remote.refresh !== "function") return;
                const next = currentShape();
                if (next === shape) return;
                shape = next;
                remote.refresh();
            },
        };
    };
})();
