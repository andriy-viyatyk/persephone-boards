// Force Graph board — pure model layer.
//
// A faithful, framework-free port of the app's built-in graph editor models:
//   src/renderer/editors/graph/{types,shapeGeometry,constants,GraphHighlightModel,
//   GraphGroupModel,GraphConnectivityModel,GraphVisibilityModel,GraphDataModel,
//   GraphSearchModel}.ts
//
// Nothing here touches the DOM, `persephone`, or d3 — it is the same algorithms with
// the TypeScript types erased. Keep it that way: the renderer, the theme adapter and
// the controller each live in their own file and all hang off `window.FG`.
(() => {
    const FG = (window.FG = window.FG || {});

    // =====================================================================
    // types.ts
    // =====================================================================

    /** Prefix for runtime-computed system properties on a node. */
    const SYS_PREFIX = "_$";

    const NODE_SHAPES = ["circle", "square", "diamond", "triangle", "star", "hexagon"];

    /** Keys excluded from custom property enumeration (core, presentation, D3 sim). */
    const CUSTOM_PROP_EXCLUDED_KEYS = new Set([
        "id", "title", "level", "shape", "isGroup",
        "x", "y", "vx", "vy", "fx", "fy", "index",
    ]);

    /** Keys added by the D3 simulation — not part of user data. */
    const SIM_KEYS = new Set(["x", "y", "vx", "vy", "fx", "fy", "index"]);

    function linkIds(link) {
        return {
            source: typeof link.source === "string" ? link.source : link.source.id,
            target: typeof link.target === "string" ? link.target : link.target.id,
        };
    }

    function nodeLabel(node) {
        return node.title || node.id;
    }

    function formatPropertyValue(value) {
        if (value === null) return "null";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        const json = JSON.stringify(value);
        return json.length > 100 ? json.slice(0, 97) + "..." : json;
    }

    /** Strip an indexed suffix ("function#1" → "function") for display. */
    function stripIndexedSuffix(key) {
        return key.replace(/#\d+$/, "");
    }

    function getCustomProperties(node) {
        const result = [];
        for (const [key, value] of Object.entries(node)) {
            if (CUSTOM_PROP_EXCLUDED_KEYS.has(key) || key.startsWith(SYS_PREFIX)) continue;
            if (value === undefined) continue;
            result.push([stripIndexedSuffix(key), formatPropertyValue(value)]);
        }
        return result;
    }

    function isReservedPropertyKey(key) {
        return CUSTOM_PROP_EXCLUDED_KEYS.has(key) || key.startsWith(SYS_PREFIX);
    }

    const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

    /** Convert a href to a navigable URL. Local file paths become file:// URLs. */
    function toNavigableHref(href) {
        if (/^https?:\/\/|^file:\/\/|^mailto:/i.test(href)) return href;
        const normalized = href.replace(/\\/g, "/");
        return "file:///" + normalized.replace(/^\//, "");
    }

    /** Extract all markdown links from a node's custom properties. */
    function getNodeLinks(node) {
        const links = [];
        for (const [key, value] of Object.entries(node)) {
            if (CUSTOM_PROP_EXCLUDED_KEYS.has(key) || key.startsWith(SYS_PREFIX)) continue;
            if (typeof value !== "string") continue;
            LINK_RE.lastIndex = 0;
            let match;
            while ((match = LINK_RE.exec(value)) !== null) {
                links.push({ propertyKey: stripIndexedSuffix(key), text: match[1], href: match[2] });
            }
        }
        return links;
    }

    const levelRadii = [14, 11, 8, 6, 4];

    function nodeRadius(node) {
        const level = node.level;
        if (typeof level === "number" && level >= 1 && level <= 5) return levelRadii[level - 1];
        return 4; // invalid or missing level → level 5 (smallest)
    }

    /** Effective radius, accounting for the root and group overrides. */
    function effectiveNodeRadius(node, rootNodeId) {
        if (rootNodeId && node.id === rootNodeId) return levelRadii[0];
        if (node.isGroup) return levelRadii[0];
        return nodeRadius(node);
    }

    // =====================================================================
    // shapeGeometry.ts
    // =====================================================================

    function starPoints(cx, cy, outerR, innerR, spikes) {
        const pts = [];
        for (let i = 0; i < spikes * 2; i++) {
            const angle = (i * Math.PI) / spikes - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
        }
        return pts;
    }

    function compassPoints(cx, cy, outerR, innerR) {
        return starPoints(cx, cy, outerR, innerR, 4);
    }

    function hexagonPoints(cx, cy, r) {
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3 - Math.PI / 6;
            pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
        }
        return pts;
    }

    function diamondPoints(cx, cy, r) {
        const dy = r * 1.2;
        return [[cx, cy - dy], [cx + r, cy], [cx, cy + dy], [cx - r, cy]];
    }

    function trianglePoints(cx, cy, r) {
        const h = r * 1.15;
        return [[cx, cy - h], [cx + r, cy + h * 0.6], [cx - r, cy + h * 0.6]];
    }

    /** Polygon points for a shape. Returns null for circle/group (drawn with an arc). */
    function getShapePoints(shape, cx, cy, r) {
        switch (shape) {
            case "square":
                return [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
            case "diamond":
                return diamondPoints(cx, cy, r);
            case "triangle":
                return trianglePoints(cx, cy, r);
            case "star":
                return starPoints(cx, cy, r * 1.1, r * 0.5, 5);
            case "compass":
                return compassPoints(cx, cy, r * 1.2, r * 0.4);
            case "hexagon":
                return hexagonPoints(cx, cy, r);
            case "group": // double circle — inner circle drawn via arc, like "circle"
                return null;
            default: // "circle" or undefined
                return null;
        }
    }

    function pointsToSvgString(pts) {
        return pts.map(([x, y]) => x + "," + y).join(" ");
    }

    // =====================================================================
    // constants.ts
    // =====================================================================

    const forceProperties = {
        center: { x: 0.5, y: 0.5, enabled: true },
        charge: { enabled: true, strength: -70, distanceMin: 1, distanceMax: 2000 },
        collide: { enabled: true, strength: 0.7, iterations: 1, radius: 6 },
        forceX: { enabled: false, strength: 0.1, x: 0.5 },
        forceY: { enabled: false, strength: 0.1, y: 0.5 },
        link: { enabled: true, distance: 40, iterations: 1 },
    };

    // =====================================================================
    // GraphHighlightModel.ts
    // =====================================================================

    /**
     * Highlight layers + selection/hover state.
     * Layers are named node-id sets ("search", "linksTab", "legend", "altKey"); when
     * several are active only their intersection stays lit (AND logic) and everything
     * else is dimmed.
     */
    class GraphHighlightModel {
        constructor() {
            this.layers = new Map();
            this.activeId = "";
            this.activeChild = new Set();
            this.selectedIds = new Set();
            this.selectedChildren = new Set();
            this.hoveredId = "";
            this.hoveredChild = new Set();
            this.externalHoverId = "";
            this.hoveredBadgeNodeId = "";
            this.selectedLinkKeys = new Set();
            this.hoveredLinkKeys = new Set();
        }

        setLayer(name, ids) {
            if (ids && ids.size > 0) this.layers.set(name, ids);
            else this.layers.delete(name);
        }

        clearLayer(name) {
            this.layers.delete(name);
        }

        computeDimSet() {
            const activeLayers = [...this.layers.values()];
            if (activeLayers.length === 0) return null;
            if (activeLayers.length === 1) return activeLayers[0];
            return new Set([...activeLayers[0]].filter((id) => activeLayers.every((s) => s.has(id))));
        }

        selectSingle(id, neighbors) {
            this.activeId = id;
            this.activeChild = id ? new Set(neighbors) : new Set();
            this.selectedIds = id ? new Set([id]) : new Set();
            this.selectedChildren = this.activeChild;
        }

        toggleSelected(id, getNeighbors) {
            if (this.selectedIds.has(id)) this.selectedIds.delete(id);
            else this.selectedIds.add(id);

            if (this.selectedIds.has(id)) {
                this.activeId = id;
                this.activeChild = new Set(getNeighbors(id));
            } else if (this.selectedIds.size > 0) {
                const last = [...this.selectedIds].pop();
                this.activeId = last;
                this.activeChild = new Set(getNeighbors(last));
            } else {
                this.activeId = "";
                this.activeChild = new Set();
            }

            const children = new Set();
            for (const nodeId of this.selectedIds) {
                for (const neighborId of getNeighbors(nodeId)) {
                    if (!this.selectedIds.has(neighborId)) children.add(neighborId);
                }
            }
            this.selectedChildren = children;
        }

        clearSelection() {
            this.selectSingle("", new Set());
        }

        setHoveredId(id, neighbors) {
            this.hoveredId = id;
            this.hoveredChild = id ? new Set(neighbors) : new Set();
        }

        setExternalHover(id, neighbors) {
            this.externalHoverId = id;
            if (this.hoveredId === id) return;
            this.hoveredId = id;
            this.hoveredChild = id ? new Set(neighbors) : new Set();
        }

        clearSelectionIf(nodeIds) {
            if (this.activeId && !nodeIds.has(this.activeId)) {
                this.activeId = "";
                this.activeChild = new Set();
            }
            let selectionChanged = false;
            for (const id of this.selectedIds) {
                if (!nodeIds.has(id)) {
                    this.selectedIds.delete(id);
                    selectionChanged = true;
                }
            }
            if (selectionChanged) this.selectedChildren = new Set();
            if (this.hoveredId && !nodeIds.has(this.hoveredId) && !this.externalHoverId) {
                this.hoveredId = "";
                this.hoveredChild = new Set();
            }
        }

        clearAll() {
            this.activeId = "";
            this.activeChild = new Set();
            this.selectedIds = new Set();
            this.selectedChildren = new Set();
            this.hoveredId = "";
            this.hoveredChild = new Set();
        }

        nodeColor(node, colors, isSpecial) {
            if (this.selectedIds.has(node.id)) return colors.nodeSelected;
            if (node.id === this.hoveredId) return colors.nodeHighlight;
            return isSpecial ? colors.nodeSpecial : colors.nodeDefault;
        }

        nodeBorderColor(node, colors, isSpecial) {
            if (this.selectedIds.has(node.id)) return colors.borderSelected;
            if (node.id === this.hoveredId) return colors.borderHighlight;
            if (this.hoveredChild.has(node.id)) return colors.borderHighlight;
            return isSpecial ? colors.borderSpecial : colors.borderDefault;
        }

        labelTextColor(node, colors, isSpecial) {
            if (this.selectedIds.has(node.id)) return colors.nodeSelected;
            if (node.id === this.hoveredId || this.hoveredChild.has(node.id)) return colors.nodeHighlight;
            return isSpecial ? colors.nodeSpecial : colors.labelText;
        }

        linkColor(link, colors) {
            const { source, target } = linkIds(link);
            const key = (this.selectedLinkKeys.size > 0 || this.hoveredLinkKeys.size > 0)
                ? (source < target ? source + "→" + target : target + "→" + source)
                : "";
            // Green highlight for the full visual path between selected node(s) and the hovered node.
            if (key && this.hoveredLinkKeys.has(key)) return colors.borderHighlight;
            // Orange for links on visual paths to real neighbors of selected nodes.
            if (key && this.selectedLinkKeys.has(key)) return colors.linkSelected;
            return this.selectedIds.has(source) || this.selectedIds.has(target)
                ? colors.linkSelected
                : colors.linkDefault;
        }
    }

    // =====================================================================
    // GraphGroupModel.ts
    // =====================================================================

    const EMPTY_SET = new Set();

    /**
     * Read-only group membership index + the link pre-processing that turns membership
     * links into containment and routes cross-group links through their group nodes.
     */
    class GraphGroupModel {
        constructor() {
            this.groups = new Map();   // groupId → Set(memberId)
            this.memberOf = new Map(); // memberId → groupId
        }

        rebuild(nodes, links) {
            this.groups.clear();
            this.memberOf.clear();

            const groupIds = new Set();
            for (const node of nodes) {
                if (node.isGroup) {
                    groupIds.add(node.id);
                    this.groups.set(node.id, new Set());
                }
            }
            if (groupIds.size === 0) return;

            // Phase 2a: links where exactly one endpoint is a group (unambiguous).
            for (const link of links) {
                const { source, target } = linkIds(link);
                if (groupIds.has(source) && !groupIds.has(target)) {
                    this.groups.get(source).add(target);
                    if (!this.memberOf.has(target)) this.memberOf.set(target, source);
                } else if (groupIds.has(target) && !groupIds.has(source)) {
                    this.groups.get(target).add(source);
                    if (!this.memberOf.has(source)) this.memberOf.set(source, target);
                }
            }

            // Phase 2b: group-to-group links, with cycle detection.
            for (const link of links) {
                const { source, target } = linkIds(link);
                if (!groupIds.has(source) || !groupIds.has(target)) continue;
                if (this.memberOf.has(source) && this.memberOf.get(source) === target) continue;
                if (this.memberOf.has(target) && this.memberOf.get(target) === source) continue;
                if (this.memberOf.has(target) && this.memberOf.has(source)) continue;

                if (!this.memberOf.has(target)) {
                    if (!this.wouldCreateCycleInternal(source, target)) {
                        this.groups.get(source).add(target);
                        this.memberOf.set(target, source);
                        continue;
                    }
                }
                if (!this.memberOf.has(source)) {
                    if (!this.wouldCreateCycleInternal(target, source)) {
                        this.groups.get(target).add(source);
                        this.memberOf.set(source, target);
                    }
                }
            }
        }

        isGroup(nodeId) { return this.groups.has(nodeId); }
        getGroupOf(nodeId) { return this.memberOf.get(nodeId); }
        getMembers(groupId) { return this.groups.get(groupId) || EMPTY_SET; }
        get groupCount() { return this.groups.size; }

        getEmptyGroupIds() {
            const result = [];
            for (const [groupId, members] of this.groups) {
                if (members.size === 0) result.push(groupId);
            }
            return result;
        }

        wouldCreateCycle(parentGroupId, childId) {
            return this.wouldCreateCycleInternal(parentGroupId, childId);
        }

        wouldCreateCycleInternal(parentId, childId) {
            let current = parentId;
            while (current) {
                if (current === childId) return true;
                current = this.memberOf.get(current);
            }
            return false;
        }

        /**
         * Pre-process links for visualization: hide membership links, split cross-group
         * and inter-group links through group nodes, deduplicate synthetic links.
         * Pure — does not modify source data or internal state. The root node is excluded
         * from group membership so it stays outside all groups.
         */
        preprocess(nodes, links, rootNodeId) {
            const empty = {
                nodes, links, syntheticLinkCounts: new Map(), originalToVisualLinks: new Map(),
            };
            if (this.groups.size === 0) return empty;

            const effectiveMemberOf = new Map(this.memberOf);
            if (rootNodeId) effectiveMemberOf.delete(rootNodeId);

            const effectiveGroups = new Map();
            for (const [groupId, members] of this.groups) {
                const copy = new Set(members);
                if (rootNodeId) copy.delete(rootNodeId);
                effectiveGroups.set(groupId, copy);
            }

            const getAncestorChain = (id) => {
                const chain = [];
                let current = effectiveMemberOf.get(id);
                while (current) {
                    chain.push(current);
                    current = effectiveMemberOf.get(current);
                }
                return chain;
            };

            const syntheticMap = new Map();
            const syntheticCounts = new Map();
            const outputLinks = [];
            const originalToVisualLinks = new Map();

            const canonicalKey = (a, b) => (a < b ? a + "→" + b : b + "→" + a);

            let currentVisualKeys = [];

            const addSynthetic = (source, target) => {
                if (source === target) return;
                const key = canonicalKey(source, target);
                currentVisualKeys.push(key);
                const existing = syntheticCounts.get(key) || 0;
                syntheticCounts.set(key, existing + 1);
                if (!syntheticMap.has(key)) syntheticMap.set(key, { source, target });
            };

            for (const link of links) {
                const { source, target } = linkIds(link);

                // Rule 1: membership link — skip.
                if (this.groups.has(source) && effectiveGroups.get(source) && effectiveGroups.get(source).has(target)) continue;
                if (this.groups.has(target) && effectiveGroups.get(target) && effectiveGroups.get(target).has(source)) continue;

                const originalKey = canonicalKey(source, target);
                currentVisualKeys = [];

                const sAncestors = getAncestorChain(source);
                const tAncestors = getAncestorChain(target);
                const sPath = [source, ...sAncestors];
                const tPath = [target, ...tAncestors];

                // LCA: first node in tPath that also appears in sPath.
                const sSet = new Set(sPath);
                let lca = null;
                let lcaIndexInT = -1;
                for (let i = 0; i < tPath.length; i++) {
                    if (sSet.has(tPath[i])) { lca = tPath[i]; lcaIndexInT = i; break; }
                }
                let lcaIndexInS = -1;
                if (lca !== null) lcaIndexInS = sPath.indexOf(lca);

                if (sAncestors.length === 0 && tAncestors.length === 0) {
                    // Neither in any group → keep as-is (external).
                    outputLinks.push(link);
                    currentVisualKeys.push(originalKey);
                } else if (sAncestors.length > 0 && tAncestors.length > 0 && sAncestors[0] === tAncestors[0]) {
                    // Same immediate group → keep as-is (intra-group).
                    outputLinks.push(link);
                    currentVisualKeys.push(originalKey);
                } else {
                    const sTrimmed = lca !== null ? sPath.slice(0, lcaIndexInS) : sPath;
                    const tTrimmed = lca !== null ? tPath.slice(0, lcaIndexInT) : tPath;

                    for (let i = 0; i < sTrimmed.length - 1; i++) addSynthetic(sTrimmed[i], sTrimmed[i + 1]);
                    for (let i = 0; i < tTrimmed.length - 1; i++) addSynthetic(tTrimmed[i], tTrimmed[i + 1]);

                    const sTop = sTrimmed[sTrimmed.length - 1];
                    const tTop = tTrimmed[tTrimmed.length - 1];
                    if (sTop !== tTop) addSynthetic(sTop, tTop);
                }

                originalToVisualLinks.set(originalKey, currentVisualKeys);
            }

            for (const [, link] of syntheticMap) outputLinks.push(link);

            return { nodes, links: outputLinks, syntheticLinkCounts: syntheticCounts, originalToVisualLinks };
        }
    }

    // =====================================================================
    // GraphConnectivityModel.ts
    // =====================================================================

    /**
     * Read-only query layer bridging the original source graph and the preprocessed
     * visualization graph: real-data neighbours, visual link paths, group analysis.
     */
    class GraphConnectivityModel {
        constructor() {
            this.realAdjacency = new Map();
            this.processedAdjacency = new Map();
            this.originalToVisualLinks = new Map();
            this.groupModel = null;
            this.groupIds = new Set();
        }

        rebuild(nodes, links, preprocessed, groupModel) {
            this.groupModel = groupModel;

            this.groupIds.clear();
            for (const node of nodes) {
                if (node.isGroup) this.groupIds.add(node.id);
            }

            // realAdjacency: original links minus membership (XOR: exactly one endpoint is a group).
            this.realAdjacency.clear();
            for (const link of links) {
                const { source, target } = linkIds(link);
                const sourceIsGroup = this.groupIds.has(source);
                const targetIsGroup = this.groupIds.has(target);
                let isMembership = false;
                if (sourceIsGroup !== targetIsGroup) {
                    isMembership = true;
                } else if (sourceIsGroup && targetIsGroup) {
                    isMembership = this.groupModel.getGroupOf(source) === target
                        || this.groupModel.getGroupOf(target) === source;
                }
                if (isMembership) continue;
                this.addEdge(this.realAdjacency, source, target);
            }

            this.processedAdjacency.clear();
            for (const link of preprocessed.links) {
                const { source, target } = linkIds(link);
                this.addEdge(this.processedAdjacency, source, target);
            }

            this.originalToVisualLinks = preprocessed.originalToVisualLinks;
        }

        getRealNeighborIds(nodeId) {
            return this.realAdjacency.get(nodeId) || EMPTY_SET;
        }

        getRealNeighborNodes(nodeId, sourceNodes, cleanNode) {
            const neighborIds = this.realAdjacency.get(nodeId);
            if (!neighborIds || neighborIds.size === 0) return [];
            return sourceNodes.filter((n) => neighborIds.has(n.id)).map((n) => cleanNode(n));
        }

        getProcessedNeighborIds(nodeId) {
            return this.processedAdjacency.get(nodeId) || EMPTY_SET;
        }

        getVisualLinkKeys(fromId, toId) {
            const key = this.canonicalKey(fromId, toId);
            // With no groups, originalToVisualLinks is empty — fall back to the direct key.
            return this.originalToVisualLinks.get(key) || (this.groupIds.size === 0 ? [key] : []);
        }

        getMembersWithExternalLinks(groupId) {
            const result = new Set();
            const members = this.groupModel && this.groupModel.getMembers(groupId);
            if (!members) return result;
            for (const memberId of members) {
                const neighbors = this.realAdjacency.get(memberId);
                if (!neighbors) continue;
                for (const neighborId of neighbors) {
                    if (!members.has(neighborId) && neighborId !== groupId) { result.add(memberId); break; }
                }
            }
            return result;
        }

        getExternalConnections(groupId) {
            const result = new Set();
            const members = this.groupModel && this.groupModel.getMembers(groupId);
            if (!members) return result;
            for (const memberId of members) {
                const neighbors = this.realAdjacency.get(memberId);
                if (!neighbors) continue;
                for (const neighborId of neighbors) {
                    if (!members.has(neighborId) && neighborId !== groupId) result.add(neighborId);
                }
            }
            return result;
        }

        getGroupChain(nodeId) {
            if (!this.groupModel) return [];
            const chain = [];
            let current = this.groupModel.getGroupOf(nodeId);
            while (current) {
                chain.push(current);
                current = this.groupModel.getGroupOf(current);
            }
            return chain;
        }

        getAllRealMembers(groupId) {
            const result = new Set();
            if (!this.groupModel) return result;
            this.collectRealMembers(groupId, result);
            return result;
        }

        collectRealMembers(groupId, result) {
            const members = this.groupModel && this.groupModel.getMembers(groupId);
            if (!members) return;
            for (const memberId of members) {
                if (this.groupIds.has(memberId)) this.collectRealMembers(memberId, result);
                else result.add(memberId);
            }
        }

        addEdge(adj, a, b) {
            let setA = adj.get(a);
            if (!setA) { setA = new Set(); adj.set(a, setA); }
            setA.add(b);
            let setB = adj.get(b);
            if (!setB) { setB = new Set(); adj.set(b, setB); }
            setB.add(a);
        }

        canonicalKey(a, b) {
            return a < b ? a + "→" + b : b + "→" + a;
        }
    }

    // =====================================================================
    // GraphVisibilityModel.ts
    // =====================================================================

    /**
     * BFS-based visibility for large graphs. Inactive (no filtering) while the graph
     * has no more than `maxVisible` nodes.
     */
    class GraphVisibilityModel {
        constructor() {
            this.fullNodes = new Map();
            this.fullLinkPairs = [];
            this.visibleIds = new Set();
            this.options = {};
            this._focusId = "";
            this._active = false;
            this.componentRoots = [];
        }

        get active() { return this._active; }
        get focusId() { return this._focusId; }

        setFullGraph(nodes, links, options) {
            this.options = options || {};
            const maxVisible = this.options.maxVisible === undefined ? 500 : this.options.maxVisible;

            if (nodes.length <= maxVisible) {
                this._active = false;
                this.fullNodes.clear();
                this.fullLinkPairs = [];
                this.visibleIds.clear();
                return false;
            }

            this._active = true;
            this.rebuildInternal(nodes, links);
            this.computeInitialVisibility(maxVisible);
            return true;
        }

        updateGraph(nodes, links, ensureVisible) {
            this.options = this.options || {};
            const maxVisible = this.options.maxVisible === undefined ? 500 : this.options.maxVisible;

            if (nodes.length <= maxVisible) {
                this._active = false;
                this.fullNodes.clear();
                this.fullLinkPairs = [];
                this.visibleIds.clear();
                return false;
            }

            this._active = true;
            const prevVisible = new Set(this.visibleIds);
            this.rebuildInternal(nodes, links);

            const newNodeIds = new Set(nodes.map((n) => n.id));
            this.visibleIds = new Set();
            for (const id of prevVisible) {
                if (newNodeIds.has(id)) this.visibleIds.add(id);
            }
            if (ensureVisible) {
                for (const id of ensureVisible) this.visibleIds.add(id);
            }
            return true;
        }

        /** Build a visible graph with _$showIndex and _$hiddenCount set on the nodes. */
        getVisibleGraph() {
            const nodes = [];
            for (const id of this.visibleIds) {
                const pn = this.fullNodes.get(id);
                if (!pn) continue;
                const node = Object.assign({}, pn.node, {
                    _$showIndex: pn.showIndex,
                    _$hiddenCount: this.countHiddenNeighbors(id),
                });
                nodes.push(node);
            }
            const links = this.fullLinkPairs
                .filter(({ source, target }) => this.visibleIds.has(source) && this.visibleIds.has(target))
                .map(({ source, target }) => ({ source, target }));
            return { nodes, links, options: this.options };
        }

        toggle(nodeId) {
            const pn = this.fullNodes.get(nodeId);
            if (!pn) return false;
            return this.countHiddenNeighbors(nodeId) > 0 ? this.expand(nodeId) : this.collapse(nodeId);
        }

        renameId(oldId, newId) {
            if (this.visibleIds.has(oldId)) {
                this.visibleIds.delete(oldId);
                this.visibleIds.add(newId);
            }
        }

        reset() {
            const maxVisible = this.options.maxVisible === undefined ? 500 : this.options.maxVisible;
            this.computeInitialVisibility(maxVisible);
        }

        rebuildInternal(nodes, links) {
            this.fullLinkPairs = links.map((link) => linkIds(link));

            const adjacency = new Map();
            for (const node of nodes) adjacency.set(node.id, new Set());
            for (const { source, target } of this.fullLinkPairs) {
                const a = adjacency.get(source);
                if (a) a.add(target);
                const b = adjacency.get(target);
                if (b) b.add(source);
            }

            this._focusId = this.determineFocusNode(nodes);
            const { showIndexMap, depthMap } = this.computeBFS(nodes, adjacency);

            this.fullNodes.clear();
            for (const node of nodes) {
                this.fullNodes.set(node.id, {
                    node,
                    showIndex: showIndexMap.has(node.id) ? showIndexMap.get(node.id) : Infinity,
                    depth: depthMap.has(node.id) ? depthMap.get(node.id) : Infinity,
                    neighbors: adjacency.get(node.id) || new Set(),
                });
            }
        }

        getHiddenNodes() {
            const result = [];
            for (const [id, pn] of this.fullNodes) {
                if (!this.visibleIds.has(id)) result.push(pn.node);
            }
            return result;
        }

        isNodeVisible(nodeId) {
            return this.visibleIds.has(nodeId);
        }

        /** Reveal hidden targets by making every node on the shortest path from focus visible. */
        revealPaths(targetIds) {
            if (!this._focusId || targetIds.length === 0) return false;

            const parent = new Map();
            const visited = new Set([this._focusId]);
            const queue = [this._focusId];
            const targetSet = new Set(targetIds.filter((id) => !this.visibleIds.has(id)));
            if (targetSet.size === 0) return false;

            let found = 0;
            while (queue.length > 0 && found < targetSet.size) {
                const current = queue.shift();
                const pn = this.fullNodes.get(current);
                if (!pn) continue;
                for (const neighborId of pn.neighbors) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        parent.set(neighborId, current);
                        queue.push(neighborId);
                        if (targetSet.has(neighborId)) found++;
                    }
                }
            }

            let changed = false;
            for (const targetId of targetSet) {
                let current = targetId;
                while (current && current !== this._focusId) {
                    if (!this.visibleIds.has(current)) {
                        this.visibleIds.add(current);
                        changed = true;
                    }
                    current = parent.get(current) || "";
                }
            }
            return changed;
        }

        computeBFS(nodes, adjacency) {
            const showIndexMap = new Map();
            const depthMap = new Map();
            this.componentRoots = [];
            if (!this._focusId) return { showIndexMap, depthMap };

            // Step 1: find truly disconnected components, starting from the focus node
            // so it becomes its own component's root.
            const componentOf = new Map();
            const nodeOrder = [{ id: this._focusId }, ...nodes.filter((n) => n.id !== this._focusId)];
            for (const node of nodeOrder) {
                if (componentOf.has(node.id)) continue;
                const rootId = node.id;
                this.componentRoots.push(rootId);
                const queue = [rootId];
                componentOf.set(rootId, rootId);
                while (queue.length > 0) {
                    const cur = queue.shift();
                    for (const neighborId of adjacency.get(cur) || []) {
                        if (!componentOf.has(neighborId)) {
                            componentOf.set(neighborId, rootId);
                            queue.push(neighborId);
                        }
                    }
                }
            }

            // Step 2/3: unlimited BFS from the focus, then from each remaining component root.
            let index = this.bfsFrom(this._focusId, 0, adjacency, showIndexMap, depthMap);
            for (const rootId of this.componentRoots) {
                if (!showIndexMap.has(rootId)) {
                    index = this.bfsFrom(rootId, index, adjacency, showIndexMap, depthMap);
                }
            }
            return { showIndexMap, depthMap };
        }

        bfsFrom(startId, startIndex, adjacency, showIndexMap, depthMap) {
            const queue = [{ id: startId, depth: 0 }];
            showIndexMap.set(startId, startIndex);
            depthMap.set(startId, 0);
            let index = startIndex + 1;

            while (queue.length > 0) {
                const { id: nodeId, depth } = queue.shift();
                for (const neighborId of adjacency.get(nodeId) || []) {
                    if (!showIndexMap.has(neighborId)) {
                        showIndexMap.set(neighborId, index++);
                        depthMap.set(neighborId, depth + 1);
                        queue.push({ id: neighborId, depth: depth + 1 });
                    }
                }
            }
            return index;
        }

        determineFocusNode(nodes) {
            if (this.options.rootNode && nodes.some((n) => n.id === this.options.rootNode)) {
                return this.options.rootNode;
            }
            let best = "";
            let bestLevel = Infinity;
            for (const node of nodes) {
                const level = typeof node.level === "number" ? node.level : Infinity;
                if (level < bestLevel) { bestLevel = level; best = node.id; }
            }
            if (best) return best;
            return nodes[0] ? nodes[0].id : "";
        }

        computeInitialVisibility(maxVisible) {
            const expandDepth = this.options.expandDepth;

            if (expandDepth !== undefined) {
                this.visibleIds = new Set();
                for (const [id, pn] of this.fullNodes) {
                    if (pn.depth <= expandDepth) this.visibleIds.add(id);
                }
                if (this.visibleIds.size > maxVisible) {
                    const sorted = [...this.visibleIds]
                        .map((id) => ({ id, showIndex: this.fullNodes.get(id).showIndex }))
                        .sort((a, b) => a.showIndex - b.showIndex);
                    this.visibleIds = new Set(sorted.slice(0, maxVisible).map((e) => e.id));
                }
            } else {
                const sorted = [...this.fullNodes.entries()].sort((a, b) => a[1].showIndex - b[1].showIndex);
                this.visibleIds = new Set(sorted.slice(0, maxVisible).map(([id]) => id));
            }

            this.ensureComponentRootsVisible();
        }

        expand(nodeId) {
            const pn = this.fullNodes.get(nodeId);
            if (!pn) return false;
            let changed = false;
            for (const neighborId of pn.neighbors) {
                if (!this.visibleIds.has(neighborId)) { this.visibleIds.add(neighborId); changed = true; }
            }
            return changed;
        }

        /** Deep expand: BFS through hidden nodes, treating already-visible nodes as barriers. */
        expandDeep(nodeId) {
            const pn = this.fullNodes.get(nodeId);
            if (!pn) return false;

            const barrier = new Set(this.visibleIds);
            const queue = [nodeId];
            let changed = false;

            while (queue.length > 0) {
                const current = queue.shift();
                const cpn = this.fullNodes.get(current);
                if (!cpn) continue;
                for (const neighborId of cpn.neighbors) {
                    if (barrier.has(neighborId)) continue;         // was already visible — wall
                    if (this.visibleIds.has(neighborId)) continue; // already revealed in this pass
                    this.visibleIds.add(neighborId);
                    changed = true;
                    queue.push(neighborId);
                }
            }
            return changed;
        }

        expandAll() {
            let changed = false;
            for (const id of this.fullNodes.keys()) {
                if (!this.visibleIds.has(id)) { this.visibleIds.add(id); changed = true; }
            }
            return changed;
        }

        get totalNodeCount() { return this.fullNodes.size; }

        collapse(nodeId) {
            const pn = this.fullNodes.get(nodeId);
            if (!pn) return false;

            const clickedIndex = pn.showIndex;
            const toHide = new Set();
            const queue = [];

            for (const neighborId of pn.neighbors) {
                const npn = this.fullNodes.get(neighborId);
                if (npn && npn.showIndex > clickedIndex && this.visibleIds.has(neighborId)) queue.push(neighborId);
            }

            while (queue.length > 0) {
                const current = queue.shift();
                if (toHide.has(current)) continue;
                toHide.add(current);
                const cpn = this.fullNodes.get(current);
                if (!cpn) continue;
                for (const neighborId of cpn.neighbors) {
                    const npn = this.fullNodes.get(neighborId);
                    if (npn && npn.showIndex > clickedIndex && this.visibleIds.has(neighborId) && !toHide.has(neighborId)) {
                        queue.push(neighborId);
                    }
                }
            }

            for (const id of toHide) this.visibleIds.delete(id);
            return toHide.size > 0;
        }

        ensureComponentRootsVisible() {
            for (const rootId of this.componentRoots) {
                const pn = this.fullNodes.get(rootId);
                if (!pn) continue;
                if (!this.visibleIds.has(rootId)) {
                    this.visibleIds.add(rootId);
                    for (const neighborId of pn.neighbors) {
                        if (this.fullNodes.has(neighborId)) this.visibleIds.add(neighborId);
                    }
                }
            }
        }

        countHiddenNeighbors(nodeId) {
            const pn = this.fullNodes.get(nodeId);
            if (!pn) return 0;
            let count = 0;
            for (const neighborId of pn.neighbors) {
                if (!this.visibleIds.has(neighborId)) count++;
            }
            return count;
        }
    }

    // =====================================================================
    // GraphDataModel.ts
    // =====================================================================

    /**
     * Passive store for the graph's source data. Mutators change `sourceData` in place
     * and fire nothing — the controller orchestrates rebuild + serialize.
     */
    class GraphDataModel {
        constructor() {
            this.sourceData = null;
        }

        addNode(id) {
            if (!this.sourceData) this.sourceData = { nodes: [], links: [] };
            const nodeId = id === undefined ? this.generateNodeId() : id;
            this.sourceData.nodes.push({ id: nodeId });
            return nodeId;
        }

        deleteNode(nodeId) {
            if (!this.sourceData) return;
            this.sourceData.nodes = this.sourceData.nodes.filter((n) => n.id !== nodeId);
            this.sourceData.links = this.sourceData.links.filter((link) => {
                const { source, target } = linkIds(link);
                return source !== nodeId && target !== nodeId;
            });
        }

        renameNode(oldId, newId) {
            if (!this.sourceData) return false;
            newId = String(newId).trim();
            if (!newId || newId === oldId) return false;
            if (this.sourceData.nodes.some((n) => n.id === newId)) return false;

            const node = this.sourceData.nodes.find((n) => n.id === oldId);
            if (!node) return false;
            node.id = newId;

            for (const link of this.sourceData.links) {
                if (typeof link.source === "string" && link.source === oldId) link.source = newId;
                if (typeof link.target === "string" && link.target === oldId) link.target = newId;
            }
            if (this.sourceData.options && this.sourceData.options.rootNode === oldId) {
                this.sourceData.options.rootNode = newId;
            }
            return true;
        }

        updateNodeProps(nodeId, props) {
            if (!this.sourceData) return;
            const node = this.sourceData.nodes.find((n) => n.id === nodeId);
            if (!node) return;
            for (const [key, value] of Object.entries(props)) {
                if (key === "id") continue; // renameNode handles ID changes
                if (value === undefined || value === "" || value === null) delete node[key];
                else node[key] = value;
            }
        }

        addChild(parentId) {
            if (!this.sourceData) return "";
            const id = this.generateNodeId();
            this.sourceData.nodes.push({ id });
            this.sourceData.links.push({ source: parentId, target: id });
            return id;
        }

        addLink(sourceId, targetId) {
            if (!this.sourceData) return;
            if (sourceId === targetId) return;
            if (this.linkExists(sourceId, targetId)) return;
            this.sourceData.links.push({ source: sourceId, target: targetId });
        }

        deleteLink(sourceId, targetId) {
            if (!this.sourceData) return;
            this.sourceData.links = this.sourceData.links.filter((link) => {
                const { source, target } = linkIds(link);
                return !((source === sourceId && target === targetId) || (source === targetId && target === sourceId));
            });
        }

        applyLinkedNodesUpdate(selectedNodeId, rows, originalIds) {
            if (!this.sourceData) return;
            const currentIds = new Set(rows.map((r) => r.id).filter(Boolean));

            for (const oldId of originalIds) {
                if (!currentIds.has(oldId)) this.removeLinkSmart(selectedNodeId, oldId);
            }

            for (const row of rows) {
                const id = row.id ? String(row.id).trim() : "";
                if (!id) continue;
                if (!originalIds.has(id)) {
                    if (!this.sourceData.nodes.some((n) => n.id === id)) this.sourceData.nodes.push({ id });
                    if (!this.linkExists(selectedNodeId, id) && selectedNodeId !== id) {
                        this.sourceData.links.push({ source: selectedNodeId, target: id });
                    }
                }
                const node = this.sourceData.nodes.find((n) => n.id === id);
                if (node) this.applyRowPropsToNode(node, row);
            }
        }

        applyPropertiesUpdate(nodeId, propsToSet, keysToRemove) {
            if (!this.sourceData) return;
            const node = this.sourceData.nodes.find((n) => n.id === nodeId);
            if (!node) return;
            for (const key of keysToRemove) delete node[key];
            for (const [key, value] of Object.entries(propsToSet)) node[key] = value;
        }

        getLegendDescriptions() {
            return (this.sourceData && this.sourceData.options && this.sourceData.options.legend) || {};
        }

        setLegendDescription(tab, key, value) {
            if (!this.sourceData) return;
            if (!this.sourceData.options) this.sourceData.options = {};
            if (!this.sourceData.options.legend) this.sourceData.options.legend = {};
            const legend = this.sourceData.options.legend;

            // The root description is canonical in levels.root — sync to both.
            if (key === "root") {
                if (!legend.levels) legend.levels = {};
                if (!legend.shapes) legend.shapes = {};
                if (value) { legend.levels.root = value; legend.shapes.root = value; }
                else { delete legend.levels.root; delete legend.shapes.root; }
            } else {
                if (!legend[tab]) legend[tab] = {};
                if (value) legend[tab][key] = value;
                else delete legend[tab][key];
            }

            if (legend.levels && Object.keys(legend.levels).length === 0) delete legend.levels;
            if (legend.shapes && Object.keys(legend.shapes).length === 0) delete legend.shapes;
            if (!legend.levels && !legend.shapes) delete this.sourceData.options.legend;
        }

        getNodeIdsByLegendFilter(filter, visibleNodes) {
            const result = new Set();
            const rootId = (this.sourceData && this.sourceData.options && this.sourceData.options.rootNode) || "";

            for (const node of visibleNodes) {
                const isRoot = rootId !== "" && node.id === rootId;
                if (filter.includeRoot && isRoot) { result.add(node.id); continue; }
                if (filter.includeGroup && node.isGroup) { result.add(node.id); continue; }
                if (filter.levels) {
                    const level = typeof node.level === "number" && node.level >= 1 && node.level <= 5 ? node.level : 5;
                    if (filter.levels.has(level)) { result.add(node.id); continue; }
                }
                if (filter.shapes) {
                    const shape = isRoot ? "compass" : (node.shape || "circle");
                    if (filter.shapes.has(shape)) result.add(node.id);
                }
            }
            return result;
        }

        getPresentLevelsAndShapes(visibleNodes) {
            const levels = new Set();
            const shapes = new Set();
            const rootId = (this.sourceData && this.sourceData.options && this.sourceData.options.rootNode) || "";
            let hasRoot = false;
            let hasGroup = false;

            for (const node of visibleNodes) {
                if (rootId !== "" && node.id === rootId) { hasRoot = true; continue; }
                if (node.isGroup) { hasGroup = true; continue; }
                const level = typeof node.level === "number" && node.level >= 1 && node.level <= 5 ? node.level : 5;
                levels.add(level);
                shapes.add(node.shape || "circle");
            }
            return { levels, shapes, hasRoot, hasGroup };
        }

        /** Strip _$ runtime and D3 simulation properties, returning a clean copy. */
        cleanNode(node) {
            const clean = {};
            for (const [key, value] of Object.entries(node)) {
                if (!key.startsWith(SYS_PREFIX) && !SIM_KEYS.has(key)) clean[key] = value;
            }
            return clean;
        }

        generateNodeId() {
            if (!this.sourceData) return "node-1";
            const existingIds = new Set(this.sourceData.nodes.map((n) => n.id));
            let i = 1;
            while (existingIds.has("node-" + i)) i++;
            return "node-" + i;
        }

        generateGroupId() {
            if (!this.sourceData) return "group-1";
            const existingIds = new Set(this.sourceData.nodes.map((n) => n.id));
            let i = 1;
            while (existingIds.has("group-" + i)) i++;
            return "group-" + i;
        }

        removeAllNodeLinks(nodeId) {
            if (!this.sourceData) return;
            this.sourceData.links = this.sourceData.links.filter((link) => {
                const { source, target } = linkIds(link);
                return source !== nodeId && target !== nodeId;
            });
        }

        linkExists(aId, bId) {
            if (!this.sourceData) return false;
            return this.sourceData.links.some((link) => {
                const { source, target } = linkIds(link);
                return (source === aId && target === bId) || (source === bId && target === aId);
            });
        }

        getNodeLabel(nodeId) {
            const node = this.sourceData && this.sourceData.nodes.find((n) => n.id === nodeId);
            return node ? nodeLabel(node) : nodeId;
        }

        /** Remove the a↔b link; if b is left with no links at all, delete it too. */
        removeLinkSmart(aId, bId) {
            if (!this.sourceData) return;
            this.sourceData.links = this.sourceData.links.filter((link) => {
                const { source, target } = linkIds(link);
                return !((source === aId && target === bId) || (source === bId && target === aId));
            });
            const hasOtherLinks = this.sourceData.links.some((link) => {
                const { source, target } = linkIds(link);
                return source === bId || target === bId;
            });
            if (!hasOtherLinks) {
                this.sourceData.nodes = this.sourceData.nodes.filter((n) => n.id !== bId);
            }
        }

        applyRowPropsToNode(node, row) {
            for (const [key, value] of Object.entries(row)) {
                if (key === "id") continue;
                if (value === undefined || value === null || value === "") delete node[key];
                else node[key] = value;
            }
        }
    }

    // =====================================================================
    // GraphSearchModel.ts
    // =====================================================================

    /** Match a node against a multi-word AND search. Returns match details or null. */
    function matchNodeSearch(node, words) {
        const label = nodeLabel(node);
        const labelLower = label.toLowerCase();
        const customProps = getCustomProperties(node);

        const fields = [labelLower];
        for (const [key, value] of customProps) {
            fields.push(key.toLowerCase());
            fields.push(value.toLowerCase());
        }

        for (const word of words) {
            if (!fields.some((f) => f.includes(word))) return null;
        }

        const matchedProps = [];
        for (const [key, value] of customProps) {
            const keyLower = key.toLowerCase();
            const valueLower = value.toLowerCase();
            if (words.some((w) => keyLower.includes(w) || valueLower.includes(w))) {
                matchedProps.push({ key, value });
            }
        }
        return { nodeId: node.id, label, matchedProps };
    }

    /** Search computation over the visible graph plus (when filtering) the hidden nodes. */
    class GraphSearchModel {
        constructor(renderer, visibilityModel) {
            this.renderer = renderer;
            this.visibilityModel = visibilityModel;
        }

        computeSearch(query) {
            const trimmed = String(query || "").trim().toLowerCase();
            if (!trimmed) return null;

            const words = trimmed.split(/\s+/).filter(Boolean);
            const visibleNodes = this.renderer.getNodes();
            const matchIds = new Set();
            const results = [];

            for (const node of visibleNodes) {
                const matched = matchNodeSearch(node, words);
                if (matched) {
                    matchIds.add(node.id);
                    results.push(Object.assign({}, matched, { visible: true }));
                }
            }

            const hiddenResults = [];
            if (this.visibilityModel.active) {
                for (const node of this.visibilityModel.getHiddenNodes()) {
                    const matched = matchNodeSearch(node, words);
                    if (matched) hiddenResults.push(Object.assign({}, matched, { visible: false }));
                }
            }

            results.sort((a, b) => a.label.localeCompare(b.label));
            hiddenResults.sort((a, b) => a.label.localeCompare(b.label));
            const allResults = [...results, ...hiddenResults];

            return {
                matchIds: matchIds.size > 0 ? matchIds : new Set(),
                searchInfo: { visible: matchIds.size, hidden: hiddenResults.length, total: visibleNodes.length },
                searchResults: allResults.length > 0 ? allResults : null,
            };
        }

        revealHiddenMatches(searchResults) {
            if (!this.visibilityModel.active || !searchResults) return false;
            const hiddenIds = searchResults.filter((r) => !r.visible).map((r) => r.nodeId);
            if (hiddenIds.length === 0) return false;
            if (!this.visibilityModel.revealPaths(hiddenIds)) return false;
            this.renderer.updateVisibleData(this.visibilityModel.getVisibleGraph());
            return true;
        }

        revealAndSelectNode(nodeId) {
            let visibilityChanged = false;
            if (this.visibilityModel.active && !this.visibilityModel.isNodeVisible(nodeId)) {
                if (this.visibilityModel.revealPaths([nodeId])) {
                    this.renderer.updateVisibleData(this.visibilityModel.getVisibleGraph());
                    visibilityChanged = true;
                }
            }
            this.renderer.selectNode(nodeId);
            return visibilityChanged;
        }
    }

    // =====================================================================
    // Exports
    // =====================================================================

    Object.assign(FG, {
        SYS_PREFIX,
        NODE_SHAPES,
        linkIds,
        nodeLabel,
        formatPropertyValue,
        getCustomProperties,
        isReservedPropertyKey,
        getNodeLinks,
        toNavigableHref,
        levelRadii,
        nodeRadius,
        effectiveNodeRadius,
        starPoints,
        compassPoints,
        hexagonPoints,
        diamondPoints,
        trianglePoints,
        getShapePoints,
        pointsToSvgString,
        forceProperties,
        GraphHighlightModel,
        GraphGroupModel,
        GraphConnectivityModel,
        GraphVisibilityModel,
        GraphDataModel,
        GraphSearchModel,
        matchNodeSearch,
    });
})();
