(() => {
  function create(P, store, onStatus, onPlay) {
    const $ = (selector) => document.querySelector(selector);
    let pending = null;
    const t = window.audioPlayerT;
    const pathKey = (value) => window.AudioCatalog.normalizedHref(value).replace(/\/+$/, "");
    async function markMissing(entries) {
      const parents = new Map();
      for (const entry of entries) {
        if (window.AudioPlaylistFormat.isUrl(entry.href)) continue;
        const href = pathKey(entry.href), parent = String(entry.href).replace(/[\\/][^\\/]*$/, "");
        if (!parents.has(pathKey(parent))) parents.set(pathKey(parent), { path: parent, entries: [] });
        parents.get(pathKey(parent)).entries.push(entry);
      }
      for (const group of parents.values()) {
        const found = new Set(); let cursor;
        try {
          do {
            const page = await P.listFolder(group.path, { recursive: false, limit: 1000, cursor });
            for (const item of page.entries || []) if (!item.isDirectory) found.add(pathKey(item.path));
            cursor = page.nextCursor;
          } while (cursor);
          for (const entry of group.entries) entry.missing = !found.has(pathKey(entry.href));
        } catch (error) {
          if (error?.code === "not-found" || /not-found|enoent/i.test(error?.message || "")) for (const entry of group.entries) entry.missing = true;
          else for (const entry of group.entries) entry.notChecked = true;
        }
      }
      return entries;
    }
    function catalogMatches(entries) {
      const known = new Map((store.document?.links || []).map((track) => [window.AudioCatalog.normalizedHref(track.href), track]));
      const seen = new Set();
      return entries.map((entry) => {
        const key = window.AudioCatalog.normalizedHref(entry.href), existing = known.get(key), duplicate = seen.has(key) || !!existing;
        seen.add(key);
        const track = existing || window.AudioCatalog.normalizeTrack({
          id: window.AudioCatalog.newId(), href: entry.href,
          title: entry.title || window.AudioPlaylistFormat.fallbackTitle(entry.href),
          category: "", tags: [], addedAt: new Date().toISOString(),
          ...(entry.duration != null ? { duration: entry.duration } : {}),
        });
        return { ...entry, track, duplicate, duplicateOf: existing?.id || null, missing: !!entry.missing };
      });
    }
    function showPreview(result) {
      pending = result;
      const list = $("#playlist-preview-list"); list.replaceChildren();
      for (const entry of result.entries) {
        const row = document.createElement("li"), name = document.createElement("span"), detail = document.createElement("small");
        name.textContent = entry.title || window.AudioPlaylistFormat.fallbackTitle(entry.href);
        const notes = [];
        if (entry.duplicate) notes.push(t("playlist.import.duplicate"));
        if (entry.missing) notes.push(t("playlist.import.missing"));
        if (entry.notChecked) notes.push(t("playlist.import.notChecked"));
        if (entry.duration != null) notes.push(t("playlist.import.duration", { duration: Math.round(entry.duration) }));
        detail.textContent = `${entry.href}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
        row.append(name, detail); list.append(row);
      }
      const found = result.entries.length, added = result.entries.filter((entry) => !entry.duplicate).length;
      const hasDurationSeed = result.entries.some((entry) => entry.duplicateOf && entry.duration != null && store.document?.links.find((track) => track.id === entry.duplicateOf)?.duration == null);
      $("#playlist-import-summary").textContent = t("playlist.import.summary", { found, added, duplicates: found - added });
      $("#playlist-import-error").textContent = result.error || "";
      $("#playlist-import-add").disabled = !added && !hasDurationSeed;
      $("#playlist-import-play").disabled = !result.entries.some((entry) => !entry.missing);
      $("#playlist-import-dialog").showModal();
    }
    async function openPath(sourcePath) {
      if (!sourcePath) return false;
      try {
        const text = await P.readFile(sourcePath, { encoding: "utf8" });
        const parsed = window.AudioPlaylistFormat.parse(text, sourcePath);
        await markMissing(parsed.entries);
        const matched = catalogMatches(parsed.entries).map((entry, index) => ({ ...entry, missing: parsed.entries[index].missing || false }));
        showPreview({ ...parsed, entries: matched, error: "" });
        return true;
      } catch (error) {
        showPreview({ sourcePath, format: "", entries: [], error: t(error?.message === "playlist.unsupported" ? "playlist.import.unsupported" : "playlist.import.readError", { error: error?.message || "" }) });
        return false;
      }
    }
    async function pick() {
      const paths = await P.openFileDialog({ title: t("playlist.import.title"), multiSelections: false, filters: [{ name: t("playlist.import.filter"), extensions: ["m3u", "pls"] }] });
      return paths?.[0] ? openPath(paths[0]) : false;
    }
    async function add() {
      if (!pending) return;
      const additions = pending.entries.filter((entry) => !entry.duplicate).map((entry) => entry.track);
      if (additions.length) {
        try {
          const saved = await store.addMany(additions);
          if (!saved) { $("#playlist-import-error").textContent = t("catalog.readOnly"); return; }
          onStatus("playlist.import.added", { count: additions.length });
        } catch (error) { $("#playlist-import-error").textContent = t("playlist.import.writeError", { error: error?.message || "" }); return; }
      }
      const durationSeeds = new Map();
      for (const entry of pending.entries) if (entry.duplicateOf && entry.duration != null) durationSeeds.set(entry.duplicateOf, entry.duration);
      for (const [id, duration] of durationSeeds) {
        const current = store.document?.links.find((track) => track.id === id);
        if (current && current.duration == null) {
          try { await store.edit(id, { duration }); }
          catch (error) { $("#playlist-import-error").textContent = t("playlist.import.writeError", { error: error?.message || "" }); return; }
        }
      }
      $("#playlist-import-dialog").close();
    }
    function play() {
      const playable = (pending?.entries || []).filter((entry) => !entry.missing);
      if (!playable.length) return;
      onPlay(playable.map((entry) => entry.track));
      $("#playlist-import-dialog").close();
    }
    $("#playlist-import-add").addEventListener("click", () => void add());
    $("#playlist-import-play").addEventListener("click", play);
    $("#playlist-import-cancel").addEventListener("click", () => $("#playlist-import-dialog").close());
    return { pick, openPath, get pending() { return pending; } };
  }
  window.AudioPlaylistImport = { create };
})();
