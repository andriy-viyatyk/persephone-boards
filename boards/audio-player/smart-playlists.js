(() => {
  const title = (track) => String(track?.title || "").toLocaleLowerCase();
  const tie = (a, b) => title(a).localeCompare(title(b)) || String(a.id).localeCompare(String(b.id));
  const time = (value) => { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; };
  function list(tracks, kind) {
    const items = (tracks || []).filter((track) => track && typeof track.id === "string");
    const spec = {
      topRated: { filter: (x) => Number(x.rating) > 0, compare: (a, b) => Number(b.rating) - Number(a.rating) || tie(a, b) },
      mostPlayed: { filter: (x) => Number(x.playCount) > 0, compare: (a, b) => Number(b.playCount) - Number(a.playCount) || tie(a, b) },
      recentlyAdded: { filter: () => true, compare: (a, b) => time(b.addedAt) - time(a.addedAt) || tie(a, b) },
      recentlyPlayed: { filter: (x) => !!x.lastPlayed, compare: (a, b) => time(b.lastPlayed) - time(a.lastPlayed) || tie(a, b) },
    }[kind];
    return spec ? items.filter(spec.filter).slice().sort(spec.compare) : [];
  }
  const definitions = [
    { id: "topRated", key: "playlist.smart.topRated" },
    { id: "mostPlayed", key: "playlist.smart.mostPlayed" },
    { id: "recentlyAdded", key: "playlist.smart.recentlyAdded" },
    { id: "recentlyPlayed", key: "playlist.smart.recentlyPlayed" },
  ];
  window.AudioSmartPlaylists = { list, definitions };
})();
