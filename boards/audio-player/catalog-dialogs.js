(() => {
  function create(P, store, onStatus) {
    async function openCatalog() {
      const paths = await P.openFileDialog({ title: window.audioPlayerT("catalog.openTitle"), multiSelections: false, filters: [{ name: window.audioPlayerT("catalog.open"), extensions: ["link.json"] }] });
      if (!paths?.[0]) return false;
      try { await store.open(paths[0], { grant: true }); onStatus(store.readOnly ? "catalog.readOnly" : "catalog.opened"); return true; }
      catch (error) { onStatus("catalog.openError", error?.message === "INVALID_LINK_CATALOG" ? { message: window.audioPlayerT("catalog.invalidFormat") } : error); return false; }
    }
    async function newCatalog() {
      const path = await P.saveFileDialog({ title: window.audioPlayerT("catalog.newTitle"), filters: [{ name: window.audioPlayerT("catalog.new"), extensions: ["music.link.json"] }], defaultPath: "library.music.link.json" });
      if (!path) return false;
      try { const ok = await store.createFile(path); onStatus(ok ? "catalog.created" : "catalog.readOnly"); return ok; }
      catch (error) { onStatus("catalog.openError", error); return false; }
    }
    return { openCatalog, newCatalog };
  }
  window.AudioCatalogDialogs = { create };
})();
