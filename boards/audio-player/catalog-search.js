(() => {
  const norm = (value) => String(value || "").normalize("NFKD").toLocaleLowerCase();
  // Whether a track has no value for a browse kind; the "Not set" panel entries list these tracks.
  function missing(track, kind) {
    if (kind === "category") return !String(track.category || "").trim();
    if (kind === "tag") return !(track.tags || []).length;
    if (kind === "artist") return !String(track.artist || "").trim();
    if (kind === "year" || kind === "decade") return !Number.isInteger(track.year);
    return false;
  }
  function select(tracks, query = "", filter = { kind: "all", value: "" }) {
    const q = norm(query).trim();
    let list = tracks.filter((track) => {
      if (filter.kind === "category" && track.category !== filter.value && !String(track.category || "").startsWith(`${filter.value}/`)) return false;
      if (filter.kind === "tag" && !(track.tags || []).includes(filter.value)) return false;
      if (filter.kind === "artist" && track.artist !== filter.value) return false;
      if (filter.kind === "year" && String(track.year) !== String(filter.value)) return false;
      if (filter.kind === "decade" && Math.floor(Number(track.year) / 10) * 10 !== Number(filter.value)) return false;
      if (filter.kind === "missing" && !missing(track, filter.value)) return false;
      if (filter.kind === "smart" && filter.value === "top" && Number(track.rating) < 4) return false;
      if (filter.kind === "smart" && filter.value === "played" && Number(track.playCount) < 1) return false;
      return !q || [track.title, track.artist, track.album, track.category, ...(track.tags || [])].some((value) => norm(value).includes(q));
    });
    if (filter.kind === "smart" && filter.value === "top") list.sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title));
    else if (filter.kind === "smart" && filter.value === "played") list.sort((a, b) => b.playCount - a.playCount || a.title.localeCompare(b.title));
    else if (filter.kind === "smart" && filter.value === "recent") list.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    else list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }
  window.AudioCatalogSearch = { select, missing };
})();
