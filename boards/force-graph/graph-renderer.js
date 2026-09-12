// Force Graph board — canvas renderer + d3-force simulation.
//
// A faithful port of src/renderer/editors/graph/ForceGraphRenderer.ts. Three
// deliberate deviations from the built-in, all about the board sandbox:
//
//  1. Colors are INJECTED (`setColors`) instead of resolved from CSS variables — a
//     canvas cannot read `var(...)`, and a board gets its palette from
//     `persephone.getTheme()`. See graph-theme.js.
//  2. `closeAppPopupMenu()` (an app-shell call) becomes the `onBeforeClick` hook, for
//     whatever in-board popup BT-015 adds.
//  3. `setCanvas()` attaches the plain mouse listeners itself (the built-in's view did
//     that). `onContextMenuAction` is only intercepted when a handler is registered, so
//     with no in-board menu yet the app's own default context menu still works.
//
// d3 comes from the vendored UMD bundle as the `window.d3` global — there is no
// bundler in a board, so `import * as d3` is not available.
(() => {
    const FG = (window.FG = window.FG || {});
    const { linkIds, nodeLabel, effectiveNodeRadius, getShapePoints, forceProperties } = FG;

    const defaultForceParams = {
        charge: forceProperties.charge.strength,
        linkDistance: forceProperties.link.distance,
        collide: forceProperties.collide.strength,
    };

    /** The 13 canvas colors the renderer needs. Neutral placeholders until setColors(). */
    const placeholderColors = {
        nodeDefault: "#00bfff", nodeHighlight: "#32cd32", nodeSelected: "#ffb6c1",
        borderDefault: "#00bfff", borderHighlight: "#228b22", borderSelected: "#fa8072",
        linkDefault: "#778899", linkSelected: "#ffb6c1",
        labelBg: "rgba(121, 121, 121, 0.2)", labelText: "#cccccc",
        groupBorder: "#3a6ea5", nodeSpecial: "#b07ce8", borderSpecial: "#9055c8",
    };

    /**
     * Owns the D3 force simulation and all canvas drawing.
     * Lifecycle: new → setCanvas() → updateData() → dispose().
     */
    class ForceGraphRenderer {
        constructor() {
            const d3 = window.d3;
            this.canvas = null;
            this.simulation = null;
            this.isDraggingNode = false;
            this.graphData = { nodes: [], links: [] };
            this.dimensions = { width: 0, height: 0 };
            this.transform = d3.zoomIdentity;
            this._forceParams = Object.assign({}, defaultForceParams);

            this.highlight = new FG.GraphHighlightModel();
            this.colors = Object.assign({}, placeholderColors);
            this.resizeObserver = null;

            // Callbacks, all null until the controller wires them.
            this.onBadgeExpand = null;       // (nodeId, deep)
            this.onHoverChanged = null;      // (nodeId, clientX, clientY)
            this.onContextMenuAction = null; // (nodeId, clientX, clientY) — see deviation 3
            this.onAltClick = null;          // (nodeId)
            this.onSelectionChanged = null;  // (Set<nodeId>)
            this.onDoubleClick = null;       // (nodeId)
            this.onBeforeClick = null;       // see deviation 2

            this.syntheticLinkCounts = null;
            this.connectivityModel = null;
            this._rootNodeId = "";
            this._lastClientX = 0;
            this._lastClientY = 0;

            // Bound so they can be added and removed as DOM listeners.
            this.onClick = this.onClick.bind(this);
            this.onContextMenu = this.onContextMenu.bind(this);
            this.onMouseMove = this.onMouseMove.bind(this);
            this.onDblClick = this.onDblClick.bind(this);
            this.handleResize = this.handleResize.bind(this);
            this.renderData = this.renderData.bind(this);
        }

        // =================================================================
        // Public API
        // =================================================================

        setCanvas(canvas) {
            if (this.canvas === canvas) return;

            this.cleanupCanvas();
            this.canvas = canvas;

            if (canvas) {
                const d3 = window.d3;
                this.simulation = d3.forceSimulation([]);
                this.simulation.on("tick", this.renderData);
                this.addDrag();
                this.addZoom();
                this.handleResize();

                canvas.addEventListener("click", this.onClick);
                canvas.addEventListener("contextmenu", this.onContextMenu);
                canvas.addEventListener("mousemove", this.onMouseMove);
                canvas.addEventListener("dblclick", this.onDblClick);

                this.resizeObserver = new ResizeObserver(() => this.handleResize());
                this.resizeObserver.observe(canvas);

                // Data may have arrived before the canvas was ready — apply it now.
                if (this.graphData.nodes.length > 0) {
                    this.simulation.nodes(this.graphData.nodes);
                    this.initializeForces(this.graphData.links);
                }
            }
        }

        updateData(graphData) {
            this.graphData = graphData;
            this.highlight.clearAll();
            if (this.simulation) {
                this.simulation.nodes(graphData.nodes);
                this.initializeForces(graphData.links);
            }
        }

        /**
         * Update with new visible data, preserving the positions of existing nodes.
         * `anchorNodeId` places newly appearing nodes near an existing one;
         * `newNodePositions` gives explicit world positions for brand-new nodes.
         */
        updateVisibleData(graphData, anchorNodeId, newNodePositions) {
            const positions = new Map();
            for (const node of this.graphData.nodes) {
                if (node.x !== undefined && node.y !== undefined) {
                    positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
                }
            }

            const anchor = anchorNodeId ? positions.get(anchorNodeId) : undefined;

            for (const node of graphData.nodes) {
                const pos = positions.get(node.id);
                if (pos) {
                    node.x = pos.x;
                    node.y = pos.y;
                    node.vx = pos.vx;
                    node.vy = pos.vy;
                } else if (newNodePositions && newNodePositions.has(node.id)) {
                    const hint = newNodePositions.get(node.id);
                    node.x = hint.x;
                    node.y = hint.y;
                } else if (anchor) {
                    // New node — near the anchor with a small random offset so they spread out.
                    node.x = anchor.x + (Math.random() - 0.5) * 20;
                    node.y = anchor.y + (Math.random() - 0.5) * 20;
                }
            }

            this.graphData = graphData;

            const nodeIds = new Set(graphData.nodes.map((n) => n.id));
            this.highlight.clearSelectionIf(nodeIds);

            if (this.simulation) {
                this.simulation.nodes(graphData.nodes);
                this.initializeForces(graphData.links);
            }
        }

        /** Replace the canvas palette (call on theme change). Repaints only when it changed. */
        setColors(next) {
            const keys = Object.keys(placeholderColors);
            if (keys.every((key) => next[key] === this.colors[key])) return;
            this.colors = Object.assign({}, this.colors, next);
            this.renderData();
        }

        setSearchMatches(matchIds) {
            this.highlight.setLayer("search", matchIds);
            this.renderData();
        }

        setHighlightSet(ids) {
            this.highlight.setLayer("linksTab", ids);
            this.renderData();
        }

        setLegendHighlight(ids) {
            this.highlight.setLayer("legend", ids);
            this.renderData();
        }

        setAltKeyHighlight(ids) {
            this.highlight.setLayer("altKey", ids);
            this.renderData();
        }

        /** Hover driven from outside the canvas (e.g. a grid row focus). "" clears. */
        setExternalHover(id, neighbors) {
            if (this.highlight.hoveredId === id && this.highlight.externalHoverId === id) return;
            this.highlight.setExternalHover(id, neighbors);
            this.computeHoveredLinkKeys();
            this.renderData();
            // Deliberately no onHoverChanged — a tooltip is not meaningful for external hover.
        }

        get isDragging() { return this.isDraggingNode; }
        get selectedId() { return this.highlight.activeId; }
        get selectedIds() { return this.highlight.selectedIds; }

        selectNode(nodeId) { this.setActiveId(nodeId); }

        addToSelection(nodeIds) {
            if (nodeIds.length === 0) return;
            const getNeighbors = (nid) =>
                (this.connectivityModel && this.connectivityModel.getProcessedNeighborIds(nid)) || new Set();
            for (const id of nodeIds) {
                if (!this.highlight.selectedIds.has(id)) this.highlight.toggleSelected(id, getNeighbors);
            }
            this.computeSelectedLinkKeys();
            this.renderData();
            if (this.onSelectionChanged) this.onSelectionChanged(new Set(this.highlight.selectedIds));
        }

        /** Screen (clientX/clientY) → world (simulation) coordinates. */
        screenToWorld(clientX, clientY) {
            if (!this.canvas) return { x: 0, y: 0 };
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: this.transform.invertX(clientX - rect.left),
                y: this.transform.invertY(clientY - rect.top),
            };
        }

        getNodes() { return this.graphData.nodes; }

        get forceParams() { return this._forceParams; }
        static get defaultForceParams() { return defaultForceParams; }

        updateForceParams(params) {
            Object.assign(this._forceParams, params);
            this.applyTunedForces();
        }

        resetForceParams() {
            this._forceParams = Object.assign({}, defaultForceParams);
            this.applyTunedForces();
        }

        /** Seed force params from saved options before the first render (no restart). */
        setInitialForceParams(params) {
            Object.assign(this._forceParams, params);
        }

        set rootNodeId(id) {
            if (this._rootNodeId === id) return;
            this._rootNodeId = id;
            this.renderData();
        }

        get rootNodeId() { return this._rootNodeId; }

        applyTunedForces() {
            if (!this.simulation) return;
            const { width, height } = this.dimensions;
            if (width === 0 || height === 0) return;

            this.applyPositionForces(width, height);

            const linkForce = this.simulation.force("link");
            if (linkForce) linkForce.distance((link) => this.computeLinkDistance(link));

            this.simulation.alpha(1).restart();
        }

        /** Per-link distance, scaled down for synthetic group↔group links by collapsed count. */
        computeLinkDistance(link) {
            if (!this.syntheticLinkCounts || this.syntheticLinkCounts.size === 0) {
                return this._forceParams.linkDistance;
            }
            const { source, target } = linkIds(link);
            const key = source < target ? source + "→" + target : target + "→" + source;
            const count = this.syntheticLinkCounts.get(key);
            if (count && count > 1) {
                // Linear: more collapsed links → proportionally shorter, floored at 10%.
                return this._forceParams.linkDistance * Math.max(0.1, 1 / count);
            }
            return this._forceParams.linkDistance;
        }

        dispose() {
            this.cleanupCanvas();
            this.canvas = null;
        }

        // =================================================================
        // Mouse handlers
        // =================================================================

        onClick(event) {
            if (this.onBeforeClick) this.onBeforeClick();

            // A badge click takes priority — expand hidden neighbours.
            const badgeNode = this.findBadgeAt(event);
            if (badgeNode && this.onBadgeExpand) {
                this.onBadgeExpand(badgeNode.id, event.ctrlKey);
                return;
            }

            const node = this.findNodeAt(event);

            // Alt+Click → toggle a link with the selected node.
            if (event.altKey && node && this.onAltClick) {
                this.onAltClick(node.id);
                return;
            }

            // Ctrl+Click on a node → toggle multi-selection.
            if (event.ctrlKey && node) {
                const getNeighbors = (nid) =>
                    (this.connectivityModel && this.connectivityModel.getProcessedNeighborIds(nid)) || new Set();
                this.highlight.toggleSelected(node.id, getNeighbors);
                this.computeSelectedLinkKeys();
                this.renderData();
                if (this.onSelectionChanged) this.onSelectionChanged(new Set(this.highlight.selectedIds));
                return;
            }

            // Plain click → single selection (empty area deselects).
            this.setActiveId(node ? node.id : "");
        }

        onContextMenu(event) {
            // No in-board menu registered → let Persephone's own default menu show.
            if (!this.onContextMenuAction) return;
            event.preventDefault();
            event.stopPropagation();
            const node = this.findNodeAt(event);
            this.onContextMenuAction(node ? node.id : "", event.clientX, event.clientY);
        }

        onMouseMove(event) {
            this._lastClientX = event.clientX;
            this._lastClientY = event.clientY;

            const badgeNode = this.findBadgeAt(event);
            const prevBadgeId = this.highlight.hoveredBadgeNodeId;
            this.highlight.hoveredBadgeNodeId = badgeNode ? badgeNode.id : "";

            if (this.canvas) this.canvas.style.cursor = badgeNode ? "pointer" : "";

            if (prevBadgeId !== this.highlight.hoveredBadgeNodeId) this.renderData();

            // Skip mouse hover during a drag, or while external hover owns the state.
            if (!this.isDraggingNode && !this.highlight.externalHoverId) {
                const node = this.findNodeAt(event);
                this.setHoveredId(node ? node.id : "");
            }
        }

        onDblClick(event) {
            const node = this.findNodeAt(event);
            if (node && this.onDoubleClick) this.onDoubleClick(node.id);
        }

        // =================================================================
        // Dimensions
        // =================================================================

        handleResize() {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;

            if (width === this.dimensions.width && height === this.dimensions.height) return;
            this.dimensions = { width, height };

            if (width > 0 && height > 0) {
                const dpr = window.devicePixelRatio || 1;
                const ctx = this.canvas.getContext("2d");
                if (ctx) {
                    this.canvas.width = width * dpr;
                    this.canvas.height = height * dpr;
                    ctx.scale(dpr, dpr);
                }
            }

            // Re-apply the position forces with the new center (leave the link force alone).
            // Exception: `initializeForces` bails out while the canvas still measures 0x0, which
            // is the normal case in a board frame (the data arrives before the first layout), so
            // the first non-zero resize is where the link force actually gets installed.
            const needsLinkForce = this.simulation
                && !this.simulation.force("link")
                && this.graphData.links.length > 0;
            if (needsLinkForce && width > 0 && height > 0) this.initializeForces(this.graphData.links);
            else this.updatePositionForces();
        }

        // =================================================================
        // Forces
        // =================================================================

        /** Full setup including the link force — only when the graph data changes. */
        initializeForces(links) {
            const d3 = window.d3;
            const { width, height } = this.dimensions;
            if (!this.simulation || width === 0 || height === 0) return;

            this.applyPositionForces(width, height);

            this.simulation.force(
                "link",
                forceProperties.link.enabled
                    ? d3.forceLink(links)
                        .id((d) => d.id)
                        .distance((link) => this.computeLinkDistance(link))
                        .iterations(forceProperties.link.iterations)
                    : null,
            );

            this.simulation.alpha(1).restart();
        }

        /** Position forces only (center/charge/collide/forceX/forceY) — safe on resize. */
        updatePositionForces() {
            const { width, height } = this.dimensions;
            if (!this.simulation || width === 0 || height === 0) return;
            this.applyPositionForces(width, height);
            this.simulation.alpha(1).restart();
        }

        applyPositionForces(width, height) {
            const d3 = window.d3;
            if (!this.simulation) return;

            this.simulation
                .force(
                    "center",
                    forceProperties.center.enabled
                        ? d3.forceCenter(width * forceProperties.center.x, height * forceProperties.center.y)
                        : null,
                )
                .force(
                    "charge",
                    forceProperties.charge.enabled
                        ? d3.forceManyBody()
                            .strength(this._forceParams.charge)
                            .distanceMin(forceProperties.charge.distanceMin)
                            .distanceMax(forceProperties.charge.distanceMax)
                        : null,
                )
                .force(
                    "collide",
                    forceProperties.collide.enabled
                        ? d3.forceCollide()
                            .strength(this._forceParams.collide)
                            .radius((d) => effectiveNodeRadius(d, this._rootNodeId) + 1)
                            .iterations(forceProperties.collide.iterations)
                        : null,
                )
                .force(
                    "forceX",
                    forceProperties.forceX.enabled
                        ? d3.forceX().strength(forceProperties.forceX.strength).x(width * forceProperties.forceX.x)
                        : null,
                )
                .force(
                    "forceY",
                    forceProperties.forceY.enabled
                        ? d3.forceY().strength(forceProperties.forceY.strength).y(height * forceProperties.forceY.y)
                        : null,
                );
        }

        // =================================================================
        // Zoom & drag
        // =================================================================

        addZoom() {
            const d3 = window.d3;
            if (!this.canvas) return;

            const zoomBehavior = d3.zoom()
                .scaleExtent([0.1, 12])
                .filter((event) => !this.isDraggingNode && !event.button && event.buttons !== 2)
                .on("zoom", (event) => {
                    this.transform = event.transform;
                    this.renderData();
                    // Clear the tooltip during zoom, but preserve external hover.
                    if (this.highlight.hoveredId && !this.highlight.externalHoverId) {
                        this.highlight.hoveredId = "";
                        this.highlight.hoveredChild = new Set();
                        if (this.onHoverChanged) this.onHoverChanged("", 0, 0);
                    }
                });

            const sel = d3.select(this.canvas);
            sel.call(zoomBehavior);
            // Disable d3-zoom's built-in double-click zoom — the wheel is enough, and
            // dblclick is the detail-panel gesture.
            sel.on("dblclick.zoom", null);
        }

        addDrag() {
            const d3 = window.d3;
            if (!this.canvas) return;

            const dragBehavior = d3.drag()
                .filter((event) => event.button === 0)
                .subject((event) => {
                    const node = this.findNode(event.x, event.y);
                    if (node) {
                        node.fx = node.x;
                        node.fy = node.y;
                        return node;
                    }
                    return null;
                })
                .on("start", (event) => {
                    if (!event.subject) return;
                    this.isDraggingNode = true;
                    this.setHoveredId(""); // clear hover/tooltip the moment a drag begins
                    if (this.simulation) this.simulation.alphaTarget(0.2).restart();
                })
                .on("drag", (event) => {
                    if (!event.subject || !this.canvas) return;
                    const canvasRect = this.canvas.getBoundingClientRect();
                    const mouseX = event.sourceEvent.clientX - canvasRect.left;
                    const mouseY = event.sourceEvent.clientY - canvasRect.top;
                    event.subject.fx = this.transform.invertX(mouseX);
                    event.subject.fy = this.transform.invertY(mouseY);
                })
                .on("end", (event) => {
                    if (!event.subject) return;
                    event.subject.fx = null;
                    event.subject.fy = null;
                    this.isDraggingNode = false;
                    if (this.simulation) this.simulation.alphaTarget(0);
                });

            d3.select(this.canvas).call(dragBehavior);
        }

        // =================================================================
        // Hit-testing
        // =================================================================

        findNode(x, y) {
            const tx = this.transform.invertX(x);
            const ty = this.transform.invertY(y);
            return this.graphData.nodes.find((node) => {
                const dx = tx - (node.x || 0);
                const dy = ty - (node.y || 0);
                const r = effectiveNodeRadius(node, this._rootNodeId);
                return Math.sqrt(dx * dx + dy * dy) <= r;
            });
        }

        hasNodeAt(event) {
            return this.findNodeAt(event) !== undefined;
        }

        findNodeAt(event) {
            if (!this.canvas) return undefined;
            const rect = this.canvas.getBoundingClientRect();
            return this.findNode(event.clientX - rect.left, event.clientY - rect.top);
        }

        badgeRadius(hiddenCount) {
            return Math.max(3, 2 + String(hiddenCount).length);
        }

        /** Hit-test the "+N" badge. Returns the node that owns it, or undefined. */
        findBadgeAt(event) {
            if (!this.canvas || this.transform.k <= 0.5) return undefined;
            const rect = this.canvas.getBoundingClientRect();
            const tx = this.transform.invertX(event.clientX - rect.left);
            const ty = this.transform.invertY(event.clientY - rect.top);

            for (const d of this.graphData.nodes) {
                const hiddenCount = d._$hiddenCount || 0;
                if (hiddenCount <= 0) continue;

                const r = effectiveNodeRadius(d, this._rootNodeId);
                const badgeX = (d.x || 0) + r * 0.7;
                const badgeY = (d.y || 0) - r * 0.7;
                const badgeR = this.badgeRadius(hiddenCount);

                const dx = tx - badgeX;
                const dy = ty - badgeY;
                if (dx * dx + dy * dy <= badgeR * badgeR) return d;
            }
            return undefined;
        }

        // =================================================================
        // Active / hovered state
        // =================================================================

        setActiveId(id) {
            const prevIds = this.highlight.selectedIds;
            const changed = prevIds.size !== (id ? 1 : 0) || (id && !prevIds.has(id));
            this.highlight.selectSingle(
                id,
                (this.connectivityModel && this.connectivityModel.getProcessedNeighborIds(id)) || new Set(),
            );
            this.computeSelectedLinkKeys();
            this.renderData();
            if (changed && this.onSelectionChanged) this.onSelectionChanged(new Set(this.highlight.selectedIds));
        }

        /** Canonical link keys on visual paths from selected nodes to their real neighbours. */
        computeSelectedLinkKeys() {
            const cm = this.connectivityModel;
            const keys = new Set();
            if (cm && this.highlight.selectedIds.size > 0) {
                for (const nodeId of this.highlight.selectedIds) {
                    for (const realNeighborId of cm.getRealNeighborIds(nodeId)) {
                        for (const key of cm.getVisualLinkKeys(nodeId, realNeighborId)) keys.add(key);
                    }
                }
            }
            this.highlight.selectedLinkKeys = keys;
        }

        setHoveredId(id) {
            const changed = this.highlight.hoveredId !== id;
            this.highlight.setHoveredId(
                id,
                (this.connectivityModel && this.connectivityModel.getRealNeighborIds(id)) || new Set(),
            );
            this.computeHoveredLinkKeys();
            this.renderData();
            if (changed && this.onHoverChanged) this.onHoverChanged(id, this._lastClientX, this._lastClientY);
        }

        /** Link keys on the visual path from the selection to the hovered node (direct neighbours only). */
        computeHoveredLinkKeys() {
            const cm = this.connectivityModel;
            const hoveredId = this.highlight.hoveredId;
            const keys = new Set();
            if (cm && hoveredId && this.highlight.selectedIds.size > 0) {
                for (const nodeId of this.highlight.selectedIds) {
                    if (!cm.getRealNeighborIds(nodeId).has(hoveredId)) continue;
                    for (const key of cm.getVisualLinkKeys(nodeId, hoveredId)) keys.add(key);
                }
            }
            this.highlight.hoveredLinkKeys = keys;
        }

        // =================================================================
        // Drawing
        // =================================================================

        drawShape(ctx, shape, x, y, r) {
            ctx.beginPath();
            const pts = getShapePoints(shape, x, y, r);
            if (pts) {
                if (shape === "square") {
                    ctx.rect(x - r, y - r, r * 2, r * 2); // rect for crispness
                } else {
                    ctx.moveTo(pts[0][0], pts[0][1]);
                    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                    ctx.closePath();
                }
            } else if (shape === "group") {
                // Group: inner circle at 65% of the radius — the outer ring is drawn separately.
                ctx.arc(x, y, r * 0.65, 0, 2 * Math.PI);
            } else {
                ctx.arc(x, y, r, 0, 2 * Math.PI);
            }
        }

        renderData() {
            const ctx = this.canvas && this.canvas.getContext("2d");
            if (!ctx) return;

            ctx.save();
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            const { transform, graphData, highlight, colors } = this;
            const dimSet = highlight.computeDimSet();
            const dimming = dimSet !== null;

            ctx.translate(transform.x, transform.y);
            ctx.scale(transform.k, transform.k);

            // Links
            graphData.links.forEach((d) => {
                ctx.beginPath();
                ctx.moveTo(d.source.x || 0, d.source.y || 0);
                ctx.lineTo(d.target.x || 0, d.target.y || 0);
                const linkCol = highlight.linkColor(d, colors);
                const isHighlighted = linkCol !== colors.linkDefault && linkCol !== colors.linkSelected;
                if (dimming) {
                    const { source, target } = linkIds(d);
                    ctx.globalAlpha = isHighlighted || dimSet.has(source) || dimSet.has(target) ? 1.0 : 0.15;
                }
                ctx.strokeStyle = linkCol;
                ctx.lineWidth = isHighlighted ? 2 : 0.5;
                ctx.stroke();
            });

            // Nodes
            const rootId = this._rootNodeId;
            graphData.nodes.forEach((d) => {
                if (dimming) ctx.globalAlpha = dimSet.has(d.id) ? 1.0 : 0.15;
                const isRoot = rootId !== "" && d.id === rootId;
                const isSpecial = isRoot || !!d.isGroup;
                const r = effectiveNodeRadius(d, rootId);
                const shape = isRoot ? "compass" : d.isGroup ? "group" : d.shape;
                this.drawShape(ctx, shape, d.x || 0, d.y || 0, r);
                ctx.fillStyle = highlight.nodeColor(d, colors, isSpecial);
                ctx.fill();
                ctx.strokeStyle = highlight.nodeBorderColor(d, colors, isSpecial);
                ctx.lineWidth = 1.5;
                ctx.stroke();

                if (shape === "group") {
                    ctx.beginPath();
                    ctx.arc(d.x || 0, d.y || 0, r, 0, 2 * Math.PI);
                    const isSelected = highlight.selectedIds.has(d.id);
                    const isHovered = d.id === highlight.hoveredId;
                    ctx.strokeStyle = isSelected ? colors.borderSelected
                        : isHovered ? colors.borderHighlight
                        : colors.groupBorder;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            });

            if (dimming) ctx.globalAlpha = 1.0;

            // "+N" badges for nodes with hidden neighbours
            if (transform.k > 0.5) {
                const c = colors;
                ctx.font = "bold 5px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";

                graphData.nodes.forEach((d) => {
                    const hiddenCount = d._$hiddenCount || 0;
                    if (hiddenCount > 0) {
                        if (dimming) ctx.globalAlpha = dimSet.has(d.id) ? 1.0 : 0.15;
                        const r = effectiveNodeRadius(d, rootId);
                        const badgeX = (d.x || 0) + r * 0.7;
                        const badgeY = (d.y || 0) - r * 0.7;
                        const badgeR = this.badgeRadius(hiddenCount);
                        const isHovered = d.id === highlight.hoveredBadgeNodeId;

                        ctx.beginPath();
                        ctx.arc(badgeX, badgeY, badgeR, 0, 2 * Math.PI);
                        ctx.fillStyle = isHovered ? c.nodeSelected : c.nodeHighlight;
                        ctx.fill();
                        ctx.strokeStyle = isHovered ? c.borderSelected : c.borderHighlight;
                        ctx.lineWidth = 1;
                        ctx.stroke();

                        ctx.fillStyle = c.labelText;
                        ctx.fillText("+" + hiddenCount, badgeX, badgeY);
                    }
                });
            }

            if (dimming) ctx.globalAlpha = 1.0;

            // Labels
            const showImportantLabels = transform.k > 0.8;
            const hasHighlight = highlight.selectedIds.size > 0 || !!highlight.hoveredId;

            if (showImportantLabels || hasHighlight) {
                const c = colors;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";

                graphData.nodes.forEach((d) => {
                    const isSelected = highlight.selectedIds.has(d.id);
                    const isHovered = d.id === highlight.hoveredId;
                    const isHoveredChild = highlight.hoveredChild.has(d.id);
                    const isHighlighted = isSelected || isHovered || isHoveredChild;
                    const isRoot = rootId !== "" && d.id === rootId;

                    // Highlighted labels always show; "important" ones only when zoomed in.
                    if (!isHighlighted) {
                        if (!showImportantLabels) return;
                        const isImportant = isRoot || d.isGroup || (typeof d.level === "number" && d.level >= 1 && d.level <= 2);
                        if (!isImportant) return;
                    }

                    if (dimming) ctx.globalAlpha = isHighlighted ? 1.0 : (dimSet.has(d.id) ? 1.0 : 0.15);
                    const text = nodeLabel(d);
                    const r = effectiveNodeRadius(d, rootId);

                    const level = isRoot || d.isGroup ? 1 : (typeof d.level === "number" ? d.level : 5);
                    const fontSize = level <= 1 ? 14 : level === 2 ? 12 : level === 3 ? 11 : 10;
                    ctx.font = fontSize + "px sans-serif";

                    const paddingY = 1;
                    const paddingX = 2;
                    const textWidth = ctx.measureText(text).width;
                    const textHeight = fontSize * 0.75;

                    const labelX = (d.x || 0) + r + 4;
                    const labelY = d.y || 0;

                    ctx.fillStyle = c.labelBg;
                    ctx.fillRect(
                        labelX - paddingX,
                        labelY - textHeight / 2 - paddingY,
                        textWidth + 2 * paddingX,
                        textHeight + 2 * paddingY,
                    );

                    const isSpecialLabel = isRoot || !!d.isGroup;
                    ctx.fillStyle = isHighlighted
                        ? highlight.labelTextColor(d, c, isSpecialLabel)
                        : isSpecialLabel ? c.nodeSpecial : c.labelText;
                    ctx.fillText(text, labelX, labelY);
                });
            }

            if (dimming) ctx.globalAlpha = 1.0;
            ctx.restore();
        }

        cleanupCanvas() {
            if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
            if (this.simulation) { this.simulation.stop(); this.simulation = null; }
            if (this.canvas) {
                this.canvas.removeEventListener("click", this.onClick);
                this.canvas.removeEventListener("contextmenu", this.onContextMenu);
                this.canvas.removeEventListener("mousemove", this.onMouseMove);
                this.canvas.removeEventListener("dblclick", this.onDblClick);
            }
        }
    }

    FG.ForceGraphRenderer = ForceGraphRenderer;
    FG.defaultForceParams = defaultForceParams;
})();
