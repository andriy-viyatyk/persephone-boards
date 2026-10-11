(() => {
  function smart(tracks, kind) { return window.AudioSmartPlaylists.list(tracks, kind); }
  function open(queue, items, meta) {
    queue.setCatalog(items, { kind: "playlist", ...meta }, { preserve: false });
    queue.setMode("catalog");
  }
  window.AudioPlaylistQueues = { smart, open };
})();
