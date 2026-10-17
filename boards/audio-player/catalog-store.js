(() => {
  const P = window.persephone, Catalog = window.AudioCatalog;
  const same = (a, b) => a === b;
  function create(onChange = () => {}, { isLight = () => false } = {}) {
    let path = "", catalogDoc = null, readOnly = true, grantSource = false, textSnapshot = "", operations = [], busy = Promise.resolve(), undoRecord = null;
    let watchDispose = null, watchSerial = 0;
    const publish = (extra = {}) => onChange({ path, document: catalogDoc, readOnly, operations: operations.length, undoAvailable: !!undoRecord, ...extra });
    const fieldsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function undoStillApplies(document, record = undoRecord) {
      if (!record) return true;
      return record.tracks.every((entry) => {
        const link = document.links.find((item) => item.id === entry.id);
        return !!link && Object.keys(entry.expected).every((field) => fieldsEqual(link[field], entry.expected[field]));
      });
    }
    async function read(pathValue = path) {
      if (!pathValue) return null;
      const text = await P.readFile(pathValue, { encoding: "utf8" });
      const parsed = Catalog.parse(text);
      textSnapshot = text; catalogDoc = Catalog.apply(parsed, operations);
      await refreshAccess(pathValue); publish(); return catalogDoc;
    }
    async function refreshAccess(target = path) {
      if (!target) { readOnly = true; return false; }
      const wasReadOnly = readOnly;
      try {
        const access = await P.getFileAccess?.(target);
        if (!access || typeof access.write !== "boolean") readOnly = true;
        else readOnly = !access.write;
      } catch { readOnly = true; }
      if (readOnly !== wasReadOnly) publish();
      return !readOnly;
    }
    async function requestGrant(target = path) {
      if (!target) return false;
      try {
        const granted = await P.rememberFile(target);
        await refreshAccess(target);
        if (granted && !P.getFileAccess) readOnly = false;
      } catch { readOnly = true; }
      publish(); return !readOnly;
    }
    function serializeWrites(task) {
      const result = busy.then(task, task); busy = result.catch(() => {}); return result;
    }
    const normalizedPath = (value) => String(value || "").replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
    function isNotFound(error) { return error?.code === "not-found" || /not[ -]?found/i.test(String(error?.message || error)); }
    async function stopWatching() {
      ++watchSerial;
      const dispose = watchDispose; watchDispose = null;
      if (dispose) { try { await dispose(); } catch {} }
    }
    async function watchPath(target, folder = false) {
      if (!target || !P.watch) return;
      const catalogPath = path;
      const serial = ++watchSerial;
      let dispose;
      const callback = (event = {}) => {
        if (serial !== watchSerial || catalogPath !== path) return;
        if (folder) {
          const changes = Array.isArray(event.changes) ? event.changes : [];
          const found = changes.some((entry) => normalizedPath(entry.path || entry.filePath || entry.href) === normalizedPath(path)
            && ["created", "changed"].includes(entry.kind || entry.type || entry.change));
          if (!found && !event.rescan) return;
          void (async () => { await stopWatching(); await watchPath(path, false); await refresh(); })();
          return;
        }
        if (event.ended === "removed") { void (async () => { await stopWatching(); await watchParent(target); })(); return; }
        if (event.ended === "revoked" || event.ended === "error") { void stopWatching(); return; }
        if (event.rescan || (event.changes || []).some((entry) => ["changed", "created"].includes(entry.kind || entry.type || entry.change))) void refresh();
      };
      try {
        dispose = await P.watch(target, callback, folder ? { recursive: false } : undefined);
        if (serial !== watchSerial || catalogPath !== path) { try { await dispose?.(); } catch {} return; }
        watchDispose = typeof dispose === "function" ? dispose : null;
      } catch (error) {
        if (serial !== watchSerial || catalogPath !== path) return;
        if (!folder && isNotFound(error)) await watchParent(target);
      }
    }
    async function watchParent(target) {
      const parent = String(target).replace(/[\\/][^\\/]*$/, "");
      if (parent && parent !== target) await watchPath(parent, true);
    }
    async function selectPath(target) { await stopWatching(); path = target; }
    function enqueue(operation, { requestFileGrant = true } = {}) {
      return serializeWrites(async () => {
        if (!path) return false;
        await refreshAccess(path);
        if (readOnly && (!requestFileGrant || !(await requestGrant(path)))) return false;
        operations.push(operation); catalogDoc = catalogDoc ? Catalog.apply(catalogDoc, [operation]) : catalogDoc;
        if (undoRecord && !undoStillApplies(catalogDoc)) undoRecord = null;
        publish();
        const latestText = await P.readFile(path, { encoding: "utf8" });
        const latest = Catalog.parse(latestText), merged = Catalog.apply(latest, operations);
        await P.writeFile(path, Catalog.serialize(merged), { encoding: "utf8" });
        textSnapshot = Catalog.serialize(merged); catalogDoc = merged; operations = []; publish(); return true;
      });
    }
    async function open(pathValue) {
      await selectPath(pathValue); grantSource = false; readOnly = true; operations = []; undoRecord = null;
      try {
        const loaded = await read(pathValue);
        if (!isLight()) await P.storage.set("audio-player", { ...(await P.storage.get("audio-player") || {}), catalogPath: pathValue });
        publish(); await watchPath(pathValue); return loaded;
      } catch (error) { if (isNotFound(error)) await watchParent(pathValue); throw error; }
    }
    async function openDelivered(pathValue) {
      await selectPath(pathValue); grantSource = true; readOnly = true; operations = []; undoRecord = null;
      try { await read(pathValue); publish(); await watchPath(pathValue); return catalogDoc; }
      catch (error) { if (isNotFound(error)) await watchParent(pathValue); throw error; }
    }
    async function createFile(pathValue) {
      await selectPath(pathValue); grantSource = false; operations = []; undoRecord = null; catalogDoc = { type: "link-editor", links: [], state: {} }; readOnly = true;
      if (!(await requestGrant(pathValue))) return false;
      await P.writeFile(pathValue, Catalog.serialize(catalogDoc), { encoding: "utf8" });
      textSnapshot = Catalog.serialize(catalogDoc);
      if (!isLight()) await P.storage.set("audio-player", { ...(await P.storage.get("audio-player") || {}), catalogPath: pathValue });
      publish(); await watchPath(pathValue); return true;
    }
    async function refresh() {
      if (!path) return false;
      try {
        await refreshAccess(path);
        const latestText = await P.readFile(path, { encoding: "utf8" });
        if (same(latestText, textSnapshot)) return false;
        textSnapshot = latestText; catalogDoc = Catalog.apply(Catalog.parse(latestText), operations);
        if (undoRecord && !undoStillApplies(catalogDoc)) undoRecord = null;
        publish({ external: true }); return true;
      } catch (error) {
        onChange({ path, document: catalogDoc, readOnly, error });
        if (isNotFound(error)) { await stopWatching(); await watchParent(path); }
        return false;
      }
    }
    async function restore() {
      const prefs = await P.storage.get("audio-player").catch(() => undefined);
      if (prefs?.catalogPath) { try { await open(prefs.catalogPath); } catch (error) { onChange({ path: prefs.catalogPath, error, readOnly: true }); } }
    }
    return {
      open, openDelivered, createFile, restore, refresh,
      add(link) { return enqueue({ type: "add", link: Catalog.normalizeTrack(link) }); },
      addMany(links) { return enqueue({ type: "add-many", links: links.map(Catalog.normalizeTrack) }); },
      addManyGranted(links) { return enqueue({ type: "add-many", links: links.map(Catalog.normalizeTrack) }, { requestFileGrant: false }); },
      edit(id, patch) { return enqueue({ type: "edit", id, patch }); },
      editWithoutGrant(id, patch) { return enqueue({ type: "edit", id, patch }, { requestFileGrant: false }); },
      createCategory(pathValue) { return enqueue({ type: "category-create", path: pathValue }); },
      renameCategory(oldPath, newPath) { return enqueue({ type: "category-rename", oldPath, newPath }); },
      moveCategory(pathValue, parentPath) { return enqueue({ type: "category-move", path: pathValue, parentPath }); },
      createCategoryAgent(pathValue) { return enqueue({ type: "category-create", path: pathValue }, { requestFileGrant: false }); },
      renameCategoryAgent(oldPath, newPath) { return enqueue({ type: "category-rename", oldPath, newPath }, { requestFileGrant: false }); },
      moveCategoryAgent(pathValue, parentPath) { return enqueue({ type: "category-move", path: pathValue, parentPath }, { requestFileGrant: false }); },
      bulkEditTracks(ids, patch) {
        return serializeWrites(async () => {
          await refreshAccess(path);
          if (!path || readOnly) return { changed: 0, readOnly: true };
          const latestText = await P.readFile(path, { encoding: "utf8" }), latest = Catalog.apply(Catalog.parse(latestText), operations);
          const uniqueIds = [...new Set((ids || []).filter((id) => typeof id === "string" && id))];
          const selected = latest.links.filter((link) => uniqueIds.includes(link.id));
          const missingIds = uniqueIds.filter((id) => !selected.some((link) => link.id === id));
          if (missingIds.length) return { changed: 0, missingIds };
          if (!selected.length) return { changed: 0, missingIds: uniqueIds };
          const fields = Object.keys(patch || {});
          const tracks = selected.map((link) => ({
            id: link.id,
            before: Object.fromEntries(fields.map((field) => [field, { present: Object.prototype.hasOwnProperty.call(link, field), value: link[field] }])),
            expected: Object.fromEntries(fields.map((field) => [field, patch[field]])),
          }));
          const merged = Catalog.apply(latest, [{ type: "bulk-edit", ids: selected.map((link) => link.id), patch }]);
          await P.writeFile(path, Catalog.serialize(merged), { encoding: "utf8" });
          textSnapshot = Catalog.serialize(merged); catalogDoc = merged; operations = [];
          undoRecord = { tracks };
          publish();
          return { changed: selected.length, ids: selected.map((link) => link.id), undoAvailable: true };
        });
      },
      undoLastBulkEdit() {
        return serializeWrites(async () => {
          await refreshAccess(path);
          if (!undoRecord || !path || readOnly) return { changed: false, undoAvailable: !!undoRecord, readOnly: !!path && readOnly };
          const latestText = await P.readFile(path, { encoding: "utf8" }), latest = Catalog.apply(Catalog.parse(latestText), operations);
          if (!undoStillApplies(latest)) { undoRecord = null; catalogDoc = latest; textSnapshot = latestText; publish({ external: true, undoConflict: true }); return { changed: false, conflict: true, undoAvailable: false }; }
          const byId = new Map(undoRecord.tracks.map((entry) => [entry.id, entry]));
          const links = latest.links.map((link) => {
            const entry = byId.get(link.id); if (!entry) return link;
            const restored = { ...link };
            for (const [field, old] of Object.entries(entry.before)) { if (old.present) restored[field] = old.value; else delete restored[field]; }
            return restored;
          });
          const merged = { ...latest, links };
          await P.writeFile(path, Catalog.serialize(merged), { encoding: "utf8" });
          textSnapshot = Catalog.serialize(merged); catalogDoc = merged; operations = []; undoRecord = null; publish();
          return { changed: true, tracks: byId.size, undoAvailable: false };
        });
      },
      incrementPlay(id, at = new Date().toISOString()) { return enqueue({ type: "play", id, at, count: 1 }, { requestFileGrant: false }); },
      updateAudioState(patch) { return enqueue({ type: "audio-state", patch }); },
      async remove() { await stopWatching(); path = ""; catalogDoc = null; operations = []; readOnly = true; if (!isLight()) await P.storage.set("audio-player", { ...(await P.storage.get("audio-player") || {}), catalogPath: "" }); publish(); },
      get path() { return path; }, get document() { return catalogDoc; }, get readOnly() { return readOnly; }, get grantSource() { return grantSource; },
      get operations() { return operations.slice(); }, dispose() { void stopWatching(); },
    };
  }
  window.AudioCatalogStore = { create };
})();
