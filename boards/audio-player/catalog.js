(() => {
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const newId = () => globalThis.crypto?.randomUUID?.() || `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normalizedHref = (value) => String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  const validLink = (link) => link && typeof link === "object" && !Array.isArray(link) &&
    typeof link.id === "string" && link.id && typeof link.title === "string" &&
    typeof link.href === "string" && link.href && link.isDirectory !== true;
  function parse(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.links)) {
      throw new Error("INVALID_LINK_CATALOG");
    }
    const state = parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state) ? parsed.state : {};
      return { ...parsed, type: "link-editor", links: parsed.links.filter((link) => link && typeof link === "object" && !Array.isArray(link)), state };
  }
  function normalizeTrack(link) {
    const track = { ...link };
    track.id = String(track.id || newId());
    track.isDirectory = false;
    track.title = String(track.title || track.href.split(/[\\/]/).pop() || "");
    track.href = String(track.href || "");
    track.category = typeof track.category === "string" ? track.category : "";
    track.tags = Array.isArray(track.tags) ? [...new Set(track.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))] : [];
    track.artist = typeof track.artist === "string" ? track.artist : "";
    track.album = typeof track.album === "string" ? track.album : "";
    track.year = Number.isInteger(track.year) ? track.year : null;
    track.rating = Number.isFinite(track.rating) ? Math.max(0, Math.min(5, track.rating)) : 0;
    track.playCount = Number.isInteger(track.playCount) && track.playCount >= 0 ? track.playCount : 0;
    track.lastPlayed = typeof track.lastPlayed === "string" ? track.lastPlayed : null;
    track.addedAt = typeof track.addedAt === "string" ? track.addedAt : new Date().toISOString();
    track.duration = Number.isFinite(track.duration) && track.duration >= 0 ? track.duration : null;
    return track;
  }
  function normalizeCategoryPath(value) {
    if (typeof value !== "string") throw new Error("Category paths must be strings such as \"Ambient\" or \"Ambient/Drone\".");
    const parts = value.trim().replace(/\\/g, "/").split("/").map((part) => part.trim());
    if (!parts.length || parts.some((part) => !part)) throw new Error("Category paths cannot be empty or contain empty path segments.");
    return parts.join("/");
  }
  function categoryPaths(document) {
    const stored = document?.state?.audioPlayer?.categories;
    const values = new Set();
    const add = (raw) => {
      const path = normalizeCategoryPath(raw), parts = path.split("/");
      for (let i = 1; i <= parts.length; i++) values.add(parts.slice(0, i).join("/"));
    };
    if (Array.isArray(stored)) for (const item of stored) if (typeof item === "string" && item.trim()) add(item);
    for (const link of document?.links || []) if (typeof link.category === "string" && link.category.trim()) add(link.category);
    return [...values].sort((a, b) => a.localeCompare(b));
  }
  function replaceCategoryPrefix(value, from, to) {
    if (value === from) return to;
    return value.startsWith(`${from}/`) ? `${to}${value.slice(from.length)}` : value;
  }
  function categoryOperation(document, operation) {
    const categories = categoryPaths(document), from = normalizeCategoryPath(operation.path || operation.oldPath);
    let to;
    if (operation.type === "category-create") {
      if (categories.includes(from)) throw new Error(`Category "${from}" already exists.`);
      categories.push(from);
      return { categories: [...new Set(categories)].sort((a, b) => a.localeCompare(b)), links: document.links };
    }
    if (!categories.some((item) => item === from || item.startsWith(`${from}/`))) throw new Error(`Category "${from}" does not exist.`);
    if (operation.type === "category-rename") to = normalizeCategoryPath(operation.newPath);
    else {
      const parent = operation.parentPath == null || operation.parentPath === "" ? "" : normalizeCategoryPath(operation.parentPath);
      if (parent === from || parent.startsWith(`${from}/`)) throw new Error("A category cannot be moved into itself or one of its descendants.");
      if (parent && !categories.includes(parent)) throw new Error(`Parent category "${parent}" does not exist.`);
      to = parent ? `${parent}/${from.split("/").pop()}` : from.split("/").pop();
    }
    if (to === from) return { categories, links: document.links };
    if (to.startsWith(`${from}/`)) throw new Error("A category cannot be renamed or moved into one of its descendants.");
    const moved = categories.map((item) => replaceCategoryPrefix(item, from, to));
    const movedSet = new Set(moved);
    if (movedSet.size !== moved.length) throw new Error(`Moving "${from}" to "${to}" would merge categories with the same path.`);
    return {
      categories: [...movedSet].sort((a, b) => a.localeCompare(b)),
      links: document.links.map((link) => link.category ? { ...link, category: replaceCategoryPrefix(link.category, from, to) } : link),
    };
  }
  function apply(document, operations) {
    const result = { ...document, type: "link-editor", links: document.links.map((link) => ({ ...link })), state: { ...document.state } };
    for (const operation of operations) {
      if (operation.type === "add" || operation.type === "add-many") {
        const additions = operation.type === "add" ? [operation.link] : operation.links;
        for (const candidate of additions || []) {
          const link = normalizeTrack(candidate), key = normalizedHref(link.href);
          if (!result.links.some((existing) => normalizedHref(existing.href) === key)) result.links.push(link);
        }
      } else if (operation.type === "edit") {
        const index = result.links.findIndex((link) => link.id === operation.id);
        if (index >= 0) result.links[index] = { ...result.links[index], ...operation.patch };
      } else if (operation.type === "bulk-edit") {
        const ids = new Set(operation.ids || []);
        result.links = result.links.map((link) => ids.has(link.id) ? { ...link, ...operation.patch } : link);
      } else if (operation.type === "category-create" || operation.type === "category-rename" || operation.type === "category-move") {
        const changed = categoryOperation(result, operation);
        result.links = changed.links;
        const audioPlayer = result.state.audioPlayer && typeof result.state.audioPlayer === "object" ? result.state.audioPlayer : {};
        result.state.audioPlayer = { ...audioPlayer, categories: changed.categories };
      } else if (operation.type === "play") {
        const index = result.links.findIndex((link) => link.id === operation.id);
        if (index >= 0) {
          const link = result.links[index];
          link.playCount = Math.max(0, Number(link.playCount) || 0) + Math.max(1, operation.count || 1);
          const oldTime = Date.parse(link.lastPlayed || "") || 0, newTime = Date.parse(operation.at) || 0;
          link.lastPlayed = new Date(Math.max(oldTime, newTime)).toISOString();
          if (!link.addedAt) link.addedAt = operation.at;
        }
      } else if (operation.type === "audio-state") {
        const latest = result.state.audioPlayer && typeof result.state.audioPlayer === "object" ? result.state.audioPlayer : {};
        result.state.audioPlayer = { ...latest, ...operation.patch };
      }
    }
    return result;
  }
  function serialize(document) {
    return JSON.stringify({ type: "link-editor", links: document.links, state: document.state }, null, 2) + "\n";
  }
  window.AudioCatalog = { parse, normalizeTrack, apply, serialize, normalizedHref, validLink, newId, categoryPaths, categoryOperation, normalizeCategoryPath };
})();
