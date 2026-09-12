// Force Graph board — mutation and group-action models (BT-015).
//
// A port of the app's GraphMutationModel.ts and GraphGroupActionsModel.ts. The algorithms are
// unchanged; the two app couplings are replaced:
//   * `showConfirmationDialog` / `showInputDialog` → `ctx.confirm(...)` / `ctx.prompt(...)`
//     (in-frame overlays, EPIC-100 D2);
//   * `alertsBarModel.addAlert(msg, "warning")` → `ctx.notify(msg, "warning")` (§5.4);
//   * `pagesModel.addEditorPage(...)` → `ctx.openContent(...)` (bridge 1.5.0, §5.7).
//
// EPIC-100 D3: every destructive action is split — `xxxCore(args)` never blocks on an overlay
// and is what the AiVision surface calls; `xxx(...)` is the interactive half that confirms first.
(() => {
    const FG = (window.FG = window.FG || {});

    FG.createActions = function createActions(ctx) {
        const { dataModel, groupModel, connectivityModel, visibilityModel, renderer } = ctx;

        const nodes = () => (dataModel.sourceData ? dataModel.sourceData.nodes : []);
        const findNode = (id) => nodes().find((n) => n.id === id);

        function finalize(refreshSelection) {
            ctx.rebuildAndRender();
            ctx.writeNow();
            if (refreshSelection) ctx.refreshSelection();
        }

        // =================================================================
        // Mutation (nodes, links, properties)
        // =================================================================

        function updateNodeProps(nodeId, props) {
            dataModel.updateNodeProps(nodeId, props);
            finalize(true);
        }

        function batchUpdateNodeProps(nodeIds, props) {
            for (const id of nodeIds) dataModel.updateNodeProps(id, props);
            finalize(true);
        }

        function renameNode(oldId, newId) {
            if (!dataModel.renameNode(oldId, newId)) return false;
            visibilityModel.renameId(oldId, newId);

            const oldRendered = renderer.getNodes().find((n) => n.id === oldId);
            const hints = oldRendered && oldRendered.x != null && oldRendered.y != null
                ? new Map([[newId, { x: oldRendered.x, y: oldRendered.y }]])
                : undefined;
            renderer.selectNode(newId);
            ctx.rebuildAndRender(undefined, hints);
            ctx.writeNow();
            ctx.refreshSelection();
            return true;
        }

        function addNode(worldX, worldY) {
            if (!dataModel.sourceData) ctx.initializeEmptyGraph();
            const id = dataModel.addNode();
            ctx.rebuildAndRender(undefined, new Map([[id, { x: worldX, y: worldY }]]), [id]);
            ctx.writeNow();
            return id;
        }

        function addChild(parentId) {
            const id = dataModel.addChild(parentId);
            if (!id) return "";
            const parentGroup = groupModel.getGroupOf(parentId);
            if (parentGroup) dataModel.addLink(parentGroup, id);
            ctx.rebuildAndRender(parentId, undefined, [id, parentId]);
            ctx.writeNow();
            return id;
        }

        function deleteNode(nodeId) {
            dataModel.deleteNode(nodeId);
            ctx.clearRootIfDeleted(nodeId);
            if (renderer.selectedIds.has(nodeId) && renderer.selectedIds.size <= 1) renderer.selectNode("");
            cleanupEmptyGroups();
            finalize();
        }

        /** Agent-safe: deletes without a confirmation overlay. */
        function deleteNodesCore(ids) {
            if (!ids || ids.length === 0) return 0;
            for (const id of ids) {
                dataModel.deleteNode(id);
                ctx.clearRootIfDeleted(id);
            }
            cleanupEmptyGroups();
            renderer.selectNode("");
            finalize();
            return ids.length;
        }

        async function deleteSelectedNodes() {
            const ids = Array.from(renderer.selectedIds);
            if (ids.length === 0) return;
            if (ids.length > 1) {
                const ok = await ctx.confirm({
                    title: "Delete Nodes",
                    message: "Delete " + ids.length + " selected nodes?",
                });
                if (ok !== "Yes") return;
            }
            deleteNodesCore(ids);
        }

        function addLink(sourceId, targetId) {
            dataModel.addLink(sourceId, targetId);
            finalize();
        }

        function deleteLink(sourceId, targetId) {
            dataModel.deleteLink(sourceId, targetId);
            finalize();
        }

        function applyPropertiesUpdate(nodeId, propsToSet, keysToRemove) {
            dataModel.applyPropertiesUpdate(nodeId, propsToSet, keysToRemove);
            finalize(true);
        }

        function batchApplyPropertiesUpdate(nodeIds, propsToSet, keysToRemove) {
            for (const id of nodeIds) dataModel.applyPropertiesUpdate(id, propsToSet, keysToRemove);
            finalize(true);
        }

        function applyLinkedNodesUpdate(selectedNodeId, rows, originalIds) {
            dataModel.applyLinkedNodesUpdate(selectedNodeId, rows, originalIds);
            finalize(true);
        }

        // =================================================================
        // Markdown / cross-editor
        // =================================================================

        function buildSelectedMarkdown() {
            const selected = ctx.getSelectedNodes();
            if (selected.length === 0) return null;
            const rootId = dataModel.sourceData && dataModel.sourceData.options && dataModel.sourceData.options.rootNode;
            const parts = selected.map((node) => FG.buildMarkdown(node, node.id === rootId));
            if (selected.length === 1) return parts[0];

            const table = ["| Title | ID |", "|-------|-----|"];
            for (const node of selected) {
                table.push("| " + String(node.title || "").replace(/\|/g, "\\|") + " | " + node.id + " |");
            }
            return table.join("\n") + "\n\n---\n\n" + parts.join("\n\n---\n\n");
        }

        function copySelectedMarkdown() {
            const markdown = buildSelectedMarkdown();
            if (markdown) return navigator.clipboard.writeText(markdown);
            return Promise.resolve();
        }

        function openSelectedMarkdown() {
            const markdown = buildSelectedMarkdown();
            if (!markdown) return Promise.resolve(undefined);
            const selected = ctx.getSelectedNodes();
            const title = selected.length === 1 ? (selected[0].title || "Node") : selected.length + " nodes";
            return ctx.openContent({ editor: "md-view", language: "markdown", title, content: markdown });
        }

        function openSelectedGrid() {
            const ids = renderer.selectedIds;
            if (ids.size === 0) return Promise.resolve(undefined);
            const rows = nodes().filter((n) => ids.has(n.id)).map((n) => dataModel.cleanNode(n));
            const title = rows.length === 1 ? (rows[0].title || rows[0].id) : rows.length + " nodes";
            return ctx.openContent({
                editor: "grid-json", language: "json",
                title: title + ".grid.json", content: JSON.stringify(rows, null, 2),
            });
        }

        /** Build the induced subgraph for the current selection. Returns null when nothing to extract. */
        function buildExtract(withChildren) {
            if (!dataModel.sourceData) return null;
            const ids = new Set(renderer.selectedIds);
            if (ids.size === 0) return null;

            if (withChildren) {
                const children = [];
                for (const id of ids) {
                    for (const child of connectivityModel.getRealNeighborIds(id)) children.push(child);
                }
                for (const id of children) ids.add(id);
            }

            const nodeMap = new Map(nodes().map((n) => [n.id, n]));
            for (const id of Array.from(ids)) {
                const node = nodeMap.get(id);
                if (!node || !node.isGroup) continue;
                let hasExtractedMember = false;
                for (const member of groupModel.getMembers(id)) {
                    if (ids.has(member)) { hasExtractedMember = true; break; }
                }
                if (!hasExtractedMember) ids.delete(id);
            }
            if (ids.size === 0) return null;

            const extractedNodes = Array.from(ids)
                .map((id) => nodeMap.get(id))
                .filter(Boolean)
                .map((n) => dataModel.cleanNode(n));
            const extractedLinks = [];
            for (const link of dataModel.sourceData.links) {
                const { source, target } = FG.linkIds(link);
                if (ids.has(source) && ids.has(target)) extractedLinks.push({ source, target });
            }
            return { type: "force-graph", nodes: extractedNodes, links: extractedLinks };
        }

        function extractSelected(withChildren) {
            const graph = buildExtract(withChildren);
            if (!graph) {
                ctx.notify("Cannot extract group(s) only — select regular nodes or use 'Extract with children'", "warning");
                return Promise.resolve(undefined);
            }
            return ctx.openContent({
                editor: "graph-view", language: "json",
                title: withChildren ? "Extract with children.fg.json" : "Extract.fg.json",
                content: JSON.stringify(graph, null, 2),
            });
        }

        // =================================================================
        // Group actions
        // =================================================================

        function cleanupEmptyGroups() {
            if (!dataModel.sourceData) return false;
            let removed = false;
            for (;;) {
                groupModel.rebuild(dataModel.sourceData.nodes, dataModel.sourceData.links);
                const emptyIds = groupModel.getEmptyGroupIds();
                if (emptyIds.length === 0) return removed;
                removed = true;
                for (const id of emptyIds) {
                    dataModel.deleteNode(id);
                    ctx.clearRootIfDeleted(id);
                }
            }
        }

        function reparent(ids, groupId) {
            for (const id of ids) {
                const oldGroup = groupModel.getGroupOf(id);
                if (oldGroup) dataModel.deleteLink(oldGroup, id);
                dataModel.addLink(groupId, id);
            }
        }

        function centroidOf(ids) {
            const byId = new Map(renderer.getNodes().map((n) => [n.id, n]));
            let x = 0, y = 0, count = 0;
            for (const id of ids) {
                const node = byId.get(id);
                if (!node || node.x == null || node.y == null) continue;
                x += node.x; y += node.y; count++;
            }
            return count > 0 ? { x: x / count, y: y / count } : undefined;
        }

        function createGroup(memberIds, parentGroup, title) {
            if (!dataModel.sourceData) return "";
            const newGroupId = dataModel.generateGroupId();
            dataModel.sourceData.nodes.push({ id: newGroupId, isGroup: true });
            reparent(memberIds, newGroupId);
            if (parentGroup) dataModel.addLink(parentGroup, newGroupId);
            if (title) dataModel.updateNodeProps(newGroupId, { title });

            const position = centroidOf(memberIds);
            const hints = position ? new Map([[newGroupId, position]]) : undefined;
            ctx.rebuildAndRender(undefined, hints, [newGroupId]);
            ctx.writeNow();
            renderer.selectNode(newGroupId);
            return newGroupId;
        }

        function partitionSelection(ids) {
            const groupIds = [], regularIds = [];
            for (const id of ids) {
                const node = findNode(id);
                if (node && node.isGroup) groupIds.push(id);
                else if (node) regularIds.push(id);
            }
            return { groupIds, regularIds };
        }

        /** Alt+click: link toggle / group membership toggle, the full built-in behaviour. */
        function handleAltClick(nodeId) {
            if (renderer.selectedIds.size !== 1) {
                ctx.notify("Select one node first, then Alt+click another to link them or change group membership.", "warning");
                return;
            }
            const selectedId = renderer.selectedId;
            if (!selectedId || selectedId === nodeId || !dataModel.sourceData) return;

            const selectedNode = findNode(selectedId);
            const clickedNode = findNode(nodeId);
            if (!selectedNode || !clickedNode) return;

            if (selectedNode.isGroup && clickedNode.isGroup) {
                const clickedParent = groupModel.getGroupOf(nodeId);
                if (clickedParent === selectedId) {
                    dataModel.deleteLink(selectedId, nodeId);
                } else if (groupModel.getGroupOf(selectedId) === nodeId) {
                    dataModel.deleteLink(nodeId, selectedId);
                } else {
                    if (groupModel.wouldCreateCycle(selectedId, nodeId)) {
                        ctx.notify("Cannot add: would create circular group hierarchy.", "warning");
                        return;
                    }
                    if (clickedParent) dataModel.deleteLink(clickedParent, nodeId);
                    dataModel.addLink(selectedId, nodeId);
                }
                finalize();
                return;
            }

            if (selectedNode.isGroup || clickedNode.isGroup) {
                const groupId = selectedNode.isGroup ? selectedId : nodeId;
                const memberId = selectedNode.isGroup ? nodeId : selectedId;
                if (groupModel.getGroupOf(memberId) === groupId) dataModel.deleteLink(groupId, memberId);
                else reparent([memberId], groupId);
                finalize();
                return;
            }

            if (dataModel.linkExists(selectedId, nodeId)) dataModel.deleteLink(selectedId, nodeId);
            else dataModel.addLink(selectedId, nodeId);
            finalize();
        }

        /**
         * Agent-safe grouping: an explicit id list (D3 rule 2) and no dialogs. `title` is used
         * as-is; when the selection already contains exactly one group the regular nodes are
         * added to it, which is the "Add to Group" branch of the interactive three-button dialog.
         */
        function groupSelectedCore(ids, title) {
            if (!dataModel.sourceData) return "";
            const list = (ids && ids.length ? ids : Array.from(renderer.selectedIds)).filter((id) => !!findNode(id));
            const { groupIds, regularIds } = partitionSelection(list);

            if (groupIds.length === 1 && regularIds.length > 0 && title === undefined) {
                reparent(regularIds, groupIds[0]);
                finalize();
                return groupIds[0];
            }

            const parents = new Set((groupIds.length ? groupIds : regularIds).map((id) => groupModel.getGroupOf(id)));
            if (list.length < 2) throw new Error("groupSelected needs at least two node ids.");
            if (parents.size > 1) throw new Error("Cannot group: the selected nodes belong to different groups.");
            return createGroup(list, Array.from(parents)[0], title || "");
        }

        async function requestGroupTitle(value) {
            const result = await ctx.prompt({
                title: "Group Title",
                message: "Enter a title for the group:",
                value: value || "",
            });
            return result && result.button === "OK" ? result.value : undefined;
        }

        async function groupSelectedNodes() {
            if (!dataModel.sourceData) return;
            const selectedIds = Array.from(renderer.selectedIds);
            const { groupIds, regularIds } = partitionSelection(selectedIds);
            const regularParents = new Set(regularIds.map((id) => groupModel.getGroupOf(id)));

            if (groupIds.length === 0) {
                if (regularIds.length < 2) return;
                if (regularParents.size > 1) {
                    ctx.notify("Cannot group: selected nodes belong to different groups.", "warning");
                    return;
                }
                const title = await requestGroupTitle();
                if (title === undefined) return;
                createGroup(regularIds, Array.from(regularParents)[0], title);
                return;
            }

            if (groupIds.length === 1 && regularIds.length > 0) {
                const groupId = groupIds[0];
                const groupNode = findNode(groupId);
                const choice = await ctx.confirm({
                    title: "Group Options",
                    message: "Add " + regularIds.length + ' node(s) to group "'
                        + FG.nodeLabel(groupNode || { id: groupId })
                        + '", or create a new group containing all selected?',
                    buttons: ["Add to Group", "Create New Group", "Cancel"],
                });
                if (choice === "Add to Group") {
                    reparent(regularIds, groupId);
                    finalize();
                } else if (choice === "Create New Group") {
                    const title = await requestGroupTitle();
                    if (title === undefined) return;
                    createGroup(regularIds.concat([groupId]), groupModel.getGroupOf(groupId), title);
                }
                return;
            }

            if (groupIds.length >= 2) {
                const groupParents = new Set(groupIds.map((id) => groupModel.getGroupOf(id)));
                if (groupParents.size > 1) {
                    ctx.notify("Cannot group: selected groups belong to different parent groups.", "warning");
                    return;
                }
                const selectedGroupSet = new Set(groupIds);
                const commonParent = Array.from(groupParents)[0];
                for (const id of regularIds) {
                    const nodeParent = groupModel.getGroupOf(id);
                    if (nodeParent && !selectedGroupSet.has(nodeParent) && nodeParent !== commonParent) {
                        ctx.notify("Cannot group: selected nodes belong to different groups.", "warning");
                        return;
                    }
                }
                const title = await requestGroupTitle();
                if (title === undefined) return;
                createGroup(selectedIds, commonParent, title);
            }
        }

        /** Agent-safe: set a group's title with no input dialog. */
        function setGroupTitleCore(groupId, title) {
            const node = findNode(groupId);
            if (!node || !node.isGroup) throw new Error('No group node with id "' + groupId + '".');
            updateNodeProps(groupId, { title: title == null ? "" : String(title) });
            return node.title || "";
        }

        async function editGroupTitle(groupId) {
            const node = findNode(groupId);
            const title = await requestGroupTitle((node && node.title) || "");
            if (title === undefined) return;
            updateNodeProps(groupId, { title });
        }

        /** Agent-safe ungroup: no confirmation overlay. */
        function ungroupNodeCore(groupId) {
            if (!dataModel.sourceData) return false;
            const node = findNode(groupId);
            if (!node || !node.isGroup) throw new Error('No group node with id "' + groupId + '".');

            const members = Array.from(groupModel.getMembers(groupId));
            const parentGroup = groupModel.getGroupOf(groupId);
            dataModel.removeAllNodeLinks(groupId);
            if (parentGroup) for (const memberId of members) dataModel.addLink(parentGroup, memberId);
            dataModel.sourceData.nodes = dataModel.sourceData.nodes.filter((n) => n.id !== groupId);
            renderer.selectNode("");
            finalize();
            return true;
        }

        async function ungroupNode(groupId) {
            const node = findNode(groupId);
            if (!node || !node.isGroup) return;
            const members = Array.from(groupModel.getMembers(groupId));
            const parentGroup = groupModel.getGroupOf(groupId);
            const destination = parentGroup
                ? members.length + " member(s) will be moved to the parent group."
                : members.length + " member(s) will become top-level nodes.";
            const ok = await ctx.confirm({
                title: "Ungroup",
                message: 'Ungroup "' + FG.nodeLabel(node) + '"? ' + destination,
            });
            if (ok !== "Yes") return;
            ungroupNodeCore(groupId);
        }

        function collectAllSubGroups(groupId) {
            const result = [];
            for (const memberId of groupModel.getMembers(groupId)) {
                if (!groupModel.isGroup(memberId)) continue;
                result.push(memberId, ...collectAllSubGroups(memberId));
            }
            return result;
        }

        function planGroupDelete(groupId) {
            const visualNeighbors = connectivityModel.getProcessedNeighborIds(groupId);
            const toDelete = new Set();
            const toPromote = new Set();
            for (const memberId of groupModel.getMembers(groupId)) {
                if (visualNeighbors.has(memberId)) {
                    toDelete.add(memberId);
                    if (groupModel.isGroup(memberId)) {
                        for (const child of collectAllSubGroups(memberId)) toDelete.add(child);
                        for (const child of connectivityModel.getAllRealMembers(memberId)) toDelete.add(child);
                    }
                } else {
                    toPromote.add(memberId);
                }
            }
            return { toDelete, toPromote, parentGroup: groupModel.getGroupOf(groupId) };
        }

        function buildDeleteMessage(label, deleteCount, promoteCount, realDeleteCount, subGroupDeleteCount, hasParent) {
            const destination = hasParent ? "moved to parent group" : "promoted to top level";
            if (deleteCount === 0) {
                return 'Delete group "' + label + '"? ' + promoteCount + " member(s) will be " + destination + ".";
            }
            if (promoteCount === 0) {
                return subGroupDeleteCount > 0
                    ? 'Delete group "' + label + '" and all ' + (realDeleteCount + subGroupDeleteCount)
                        + " descendants (" + realDeleteCount + " nodes, " + subGroupDeleteCount + " sub-groups)?"
                    : 'Delete group "' + label + '" and its ' + realDeleteCount + " member node(s)?";
            }
            return 'Delete group "' + label + '" with ' + deleteCount + " visually connected descendant(s)? "
                + promoteCount + " unconnected member(s) will be " + destination + ".";
        }

        /** Agent-safe delete-with-children: no confirmation overlay. */
        function deleteGroupCore(groupId) {
            const node = findNode(groupId);
            if (!node || !node.isGroup) throw new Error('No group node with id "' + groupId + '".');
            const plan = planGroupDelete(groupId);
            for (const id of plan.toPromote) {
                dataModel.deleteLink(groupId, id);
                if (plan.parentGroup) dataModel.addLink(plan.parentGroup, id);
            }
            for (const id of plan.toDelete) {
                dataModel.deleteNode(id);
                ctx.clearRootIfDeleted(id);
            }
            dataModel.deleteNode(groupId);
            ctx.clearRootIfDeleted(groupId);
            renderer.selectNode("");
            finalize();
            return plan.toDelete.size + 1;
        }

        async function deleteGroupNode(groupId) {
            const node = findNode(groupId);
            if (!node || !node.isGroup) return;
            const plan = planGroupDelete(groupId);
            const deleted = Array.from(plan.toDelete);
            const realDeleteCount = deleted.filter((id) => !groupModel.isGroup(id)).length;
            const subGroupDeleteCount = deleted.length - realDeleteCount;
            const ok = await ctx.confirm({
                title: "Delete Group",
                message: buildDeleteMessage(
                    FG.nodeLabel(node), plan.toDelete.size, plan.toPromote.size,
                    realDeleteCount, subGroupDeleteCount, !!plan.parentGroup,
                ),
            });
            if (ok !== "Yes") return;
            deleteGroupCore(groupId);
        }

        function removeFromGroup(nodeId) {
            const groupId = groupModel.getGroupOf(nodeId);
            if (!groupId) return;
            dataModel.deleteLink(groupId, nodeId);
            cleanupEmptyGroups();
            finalize();
        }

        function selectChildren(ids) {
            const from = ids && ids.length ? ids : Array.from(renderer.selectedIds);
            const toAdd = [];
            for (const id of from) {
                if (groupModel.isGroup(id)) continue;
                for (const neighborId of connectivityModel.getRealNeighborIds(id)) {
                    if (!renderer.selectedIds.has(neighborId)) toAdd.push(neighborId);
                }
            }
            if (toAdd.length > 0) renderer.addToSelection(toAdd);
            return toAdd.length;
        }

        function selectMembers(ids) {
            const from = ids && ids.length ? ids : Array.from(renderer.selectedIds);
            const toAdd = [];
            for (const id of from) {
                if (!groupModel.isGroup(id)) continue;
                for (const memberId of groupModel.getMembers(id)) {
                    if (!renderer.selectedIds.has(memberId)) toAdd.push(memberId);
                }
            }
            if (toAdd.length > 0) renderer.addToSelection(toAdd);
            return toAdd.length;
        }

        function selectMembersDeep(ids) {
            const from = ids && ids.length ? ids : Array.from(renderer.selectedIds);
            const toAdd = [];
            const visited = new Set();
            const queue = from.filter((id) => groupModel.isGroup(id));
            while (queue.length > 0) {
                const groupId = queue.pop();
                if (!groupId || visited.has(groupId)) continue;
                visited.add(groupId);
                for (const memberId of groupModel.getMembers(groupId)) {
                    if (!renderer.selectedIds.has(memberId)) toAdd.push(memberId);
                    if (groupModel.isGroup(memberId)) queue.push(memberId);
                }
            }
            if (toAdd.length > 0) renderer.addToSelection(toAdd);
            return toAdd.length;
        }

        return {
            // mutation
            updateNodeProps, batchUpdateNodeProps, renameNode, addNode, addChild,
            deleteNode, deleteNodesCore, deleteSelectedNodes, addLink, deleteLink,
            applyPropertiesUpdate, batchApplyPropertiesUpdate, applyLinkedNodesUpdate,
            // markdown / cross-editor
            buildSelectedMarkdown, copySelectedMarkdown, openSelectedMarkdown, openSelectedGrid,
            buildExtract, extractSelected,
            // groups
            handleAltClick, groupSelectedCore, groupSelectedNodes,
            setGroupTitleCore, editGroupTitle,
            ungroupNodeCore, ungroupNode, deleteGroupCore, deleteGroupNode,
            removeFromGroup, cleanupEmptyGroups,
            selectChildren, selectMembers, selectMembersDeep,
        };
    };
})();
