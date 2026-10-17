(() => {
  const P = window.persephone, t = window.audioPlayerT, $ = (selector) => document.querySelector(selector);
  const audio = $("#audio"), visualizer = window.AudioVisualizer;
  let queue, light = false;
  let prefs = { volume: .8, muted: false, shuffle: false, repeat: "off", visualizer: "bars", equalizer: { enabled: false, bandsDb: Array(10).fill(0), preset: "flat" }, crossfadeSeconds: 0, gapless: true, catalogPath: "", catalogPanel: false };
  let shownStatus = { text: t("empty.instructions"), error: false };
  let fullFooter = [
    { id: "status", type: "text", text: shownStatus.text, tone: "muted" },
    { id: "count", type: "text", text: "", tone: "muted", hidden: true, align: "end" },
    { id: "undo", type: "button", text: t("catalog.undo"), hidden: true, align: "end" },
  ];
  let undoShown = false;
  const fullToolbar = [
    { id: "catalog", type: "button", placement: "start", label: t("catalog.none"), title: t("catalog.title") },
    { id: "search", type: "input", placeholder: t("catalog.search"), value: "" },
    { id: "import", type: "menu", label: t("import.menu"), items: [{ id: "folder", label: t("import.fromFolder") }, { id: "playlist", label: t("import.fromPlaylist") }] },
  ];
  let player, catalogView, aiVisionModel, audioSettings, importCancelled = false, disposed = false, coverUrl = "", tagReadId = 0, statusTimer = 0, navigationStarted = false, navigateFallbackLogged = false;
  const catalog = window.AudioCatalogStore.create((state) => {
    if (catalogView) catalogView.render();
    if (!light && !!state.undoAvailable !== undoShown) { undoShown = !!state.undoAvailable; P.statusBar.update("undo", { hidden: !undoShown }); }
    if (state.error) setStatus("catalog.openError", { error: state.error.message }, true);
    else if (state.external) setStatus("catalog.externalChange");
    aiVisionModel?.refresh();
  }, { isLight: () => light });
  const playCounts = window.AudioPlayCounts.create(catalog);
  const dialogs = window.AudioCatalogDialogs.create(P, catalog, (key, error) => setStatus(key, { error: error?.message || "" }, !!error));
  window.getPrefs = async () => prefs;
  window.updatePrefs = (patch) => { Object.assign(prefs, patch); return persistPrefs(); };
  const prettyTime = (value) => { if (!Number.isFinite(value)) return "0:00"; const s = Math.floor(value); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const currentHref = () => player?.current?.href || queue.current?.href || "";
  // The queue stays in memory only; the transport shows where Previous and Next lead.
  function renderQueue() {
    const data = queue.queue, titleOf = (item) => item?.title || item?.href?.split(/[\/]/).pop() || "";
    const previous = data && data.index > 0 ? data.items[data.index - 1] : null;
    const next = data ? data.items[queue.peekNextIndex()] : null;
    $("#previous").disabled = !previous; $("#next").disabled = !next; catalogView?.renderPlaying();
    $("#previous").title = previous ? t("control.previousTitle", { title: titleOf(previous) }) : t("control.previous");
    $("#next").title = next ? t("control.nextTitle", { title: titleOf(next) }) : t("control.next");
  }
  // Shuffle and repeat are icon toggles; the tooltip names the current state.
  function renderPlayModes() {
    const shuffle = $("#shuffle"), repeat = $("#repeat"), shuffleLabel = t(prefs.shuffle ? "control.shuffleOn" : "control.shuffle"), repeatLabel = t(`repeat.${prefs.repeat}`);
    shuffle.classList.toggle("active", !!prefs.shuffle); shuffle.setAttribute("aria-pressed", String(!!prefs.shuffle)); shuffle.title = shuffleLabel; shuffle.setAttribute("aria-label", shuffleLabel);
    repeat.classList.toggle("active", prefs.repeat !== "off"); repeat.dataset.repeat = prefs.repeat; repeat.title = repeatLabel; repeat.setAttribute("aria-label", repeatLabel);
  }
  // Play and Mute are icon buttons; the icon and tooltip follow the state.
  function renderPlayButton(playing) {
    const button = $("#play"), label = t(playing ? "control.pause" : "control.play");
    button.dataset.state = playing ? "playing" : "paused"; button.title = label; button.setAttribute("aria-label", label);
  }
  function renderMuteButton() {
    const button = $("#mute"), label = t(prefs.muted ? "control.unmute" : "control.mute");
    button.dataset.muted = String(!!prefs.muted); button.title = label; button.setAttribute("aria-label", label);
    // The page tab shows the same mute state, like the built-in Video Player.
    P.page.setMuted?.(!!prefs.muted);
  }
  // The seek and volume sliders draw their played part like the Video Player's: a filled track up to the thumb.
  function paintRanges() {
    for (const input of document.querySelectorAll(".transport input[type=range]")) {
      const min = Number(input.min) || 0, max = Number(input.max) || 0, value = Number(input.value) || 0;
      input.style.setProperty("--fill", `${max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0}%`);
    }
  }
  function setStatus(key, params = {}, error = false) {
    clearTimeout(statusTimer); statusTimer = 0;
    // An empty text item would collapse the footer, so "no status" is a single space.
    const text = key ? t(key, params) : " ";
    error = !!error; if (text !== shownStatus.text || error !== shownStatus.error) { shownStatus = { text, error }; P.statusBar.update("status", { text, tone: error ? "error" : "muted" }); }
    if (key === "effects.preloadFailed") statusTimer = setTimeout(() => { if (shownStatus.text === text) setStatus(""); }, 4000);
  }
  // One screen: the catalog panel at the left picks a list, and the list opens over the visualizer.
  // Neither changes playback; the playing queue changes when playback starts from a list.
  function setCatalogPanel(open) {
    if (light) open = false;
    prefs.catalogPanel = !!open; if (!light) void persistPrefs();
    $("#catalog-nav").hidden = !open; $("#catalog-toggle").classList.toggle("active", !!open); $("#catalog-toggle").setAttribute("aria-pressed", String(!!open));
  }
  function showCatalogList(show, { allowNoCatalog = false } = {}) {
    if (light) return;
    if (show && !catalog.document && !allowNoCatalog) { setStatus("catalog.noCatalog"); return; }
    if (show && $("#catalog-overlay").hidden) { audioSettings?.close(); catalogView?.render(); }
    $("#catalog-overlay").hidden = !show; P.statusBar.update("count", { hidden: !show });
  }
  function updateMediaSession(item) {
    if (!("mediaSession" in navigator)) return;
    const info = visualizer.trackInfo || {};
    navigator.mediaSession.metadata = new MediaMetadata({ title: info.title || item?.title || item?.href?.split(/[\\/]/).pop() || "", artist: info.artist || item?.artist || "", album: item?.album || "" });
    navigator.mediaSession.setActionHandler("play", () => { if (!navigationStarted) player.resume().catch(() => {}); }); navigator.mediaSession.setActionHandler("pause", () => { if (!navigationStarted) player.pause(); });
    navigator.mediaSession.setActionHandler("previoustrack", () => { if (!navigationStarted) changeTrack(queue.previous()); }); navigator.mediaSession.setActionHandler("nexttrack", () => { if (!navigationStarted) changeTrack(queue.next()); });
    navigator.mediaSession.setActionHandler("seekto", (event) => { if (!navigationStarted) player.seek(event.seekTime || 0); });
  }
  function playTrackInPage(item, stream = false) {
    if (!item) return;
    player?.cancelTransition();
    renderQueue(); setStatus(""); void player.play(item, stream);
  }
  function changeTrack(item, stream = false, { inPlace = false } = {}) {
    if (!item || navigationStarted) return;
    if (light && !inPlace) {
      const navigate = P.source?.navigate;
      if (typeof navigate === "function") {
        navigationStarted = true;
        let result;
        try { result = navigate.call(P.source, item.href); }
        catch (error) { return fallbackNavigation(item, error); }
        if (result && typeof result.then === "function") {
          result.catch((error) => fallbackNavigation(item, error));
          return;
        }
        return fallbackNavigation(item, new Error("source.navigate did not return a promise"));
      }
      return fallbackNavigation(item, new Error("source.navigate is unavailable"));
    }
    playTrackInPage(item, stream);
  }
  function fallbackNavigation(item, error) {
    navigationStarted = false;
    if (!navigateFallbackLogged) { navigateFallbackLogged = true; console.warn("Audio source navigation failed; continuing playback in this page", error); }
    playTrackInPage(item);
  }
  function playModelItem(item) {
    const found = item?.id ? catalog.document?.links.find((link) => link.id === item.id) : catalog.document?.links.find((link) => window.AudioCatalog.normalizedHref(link.href) === window.AudioCatalog.normalizedHref(item?.href));
    if (found) {
      queue.setCatalog(catalog.document.links, { kind: "all", sourcePath: "all", label: t("catalog.all") });
      queue.setMode("catalog");
      const index = queue.queue.items.findIndex((entry) => entry.id === found.id);
      const selected = queue.select(index); changeTrack(selected); renderQueue();
    } else {
      const selected = queue.enqueue(null, item.href); changeTrack(selected);
    }
  }
  function handlePlayerEvent(type, detail) {
    if (light && navigationStarted) return;
    if (type === "track") {
      if (Number.isInteger(detail.queueIndex)) queue.select(detail.queueIndex);
      visualizer.setTrack(detail); updateMediaSession(detail); setStatus(""); if (!light) void queue.save(); renderQueue();
      const found = catalog.document?.links.find((link) => window.AudioCatalog.normalizedHref(link.href) === window.AudioCatalog.normalizedHref(detail.href));
      catalogView?.render(); setStatus(found ? "catalog.member" : "catalog.notMember");
      if (found) playCounts.record(detail.activationId, found);
      void loadTags(detail, found);
    }
    if (type === "metadata") { visualizer.setTrack(detail); updateMediaSession(detail); renderQueue(); }
    if (type === "playing") { renderPlayButton(true); void visualizer.start(); if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing"; }
    if (type === "pause") { renderPlayButton(false); if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused"; }
    if (type === "timeupdate") { const active=detail?.audio||player.audio; $("#elapsed").textContent = prettyTime(active.currentTime); if (!$("#seek").matches(":active")) $("#seek").value = active.currentTime || 0; }
    if (type === "durationchange" || type === "loadedmetadata") { const active=detail?.audio||player.audio; $("#duration").textContent = prettyTime(active.duration); $("#seek").max = Number.isFinite(active.duration) ? active.duration : 0; }
    if (type === "ended") {
      if (prefs.repeat === "track") changeTrack(queue.current, false, { inPlace: true });
      else { const next = queue.next(); if (next) changeTrack(next); else if (prefs.repeat === "all" && queue.queue?.items.length) changeTrack(queue.select(0)); }
    }
    if (type === "preloadFailure") setStatus("effects.preloadFailed");
    if (type === "volumechange") { $("#volume").value = prefs.volume; renderMuteButton(); }
    if (type === "timeupdate" || type === "durationchange" || type === "loadedmetadata" || type === "volumechange") paintRanges();
    if (type === "failure") { const wma = /\.wma(?:$|[?#])/i.test(detail?.item?.href || ""); setStatus(wma ? "error.unsupported" : "error.load", { error: detail?.error?.message || "" }, true); }
    if (type === "error") { const activeError = detail?.audio?.error || detail?.error; const unsupported = activeError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED; setStatus(unsupported ? "error.unsupported" : "error.decode", {}, true); }
  }
  async function loadTags(item, existing) {
    const readId = ++tagReadId;
    if (coverUrl) URL.revokeObjectURL(coverUrl); coverUrl = "";
    const art = $("#track-cover"); if (art) { art.hidden = true; art.removeAttribute("src"); }
    if (!item?.href || /\.wma(?:$|[?#])/i.test(item.href) || !window.MusicMetadata?.parseFromTokenizer) return;
    try {
      const tags = await window.AudioMetadata.read(item.href);
      if (readId !== tagReadId || player.current?.href !== item.href) { if (tags.picture) URL.revokeObjectURL(tags.picture); return; }
      coverUrl = tags.picture || "";
      Object.assign(item, window.AudioMetadata.fillEmpty(item, tags));
      if (art) { art.hidden = !coverUrl; art.src = coverUrl || ""; }
      if (existing) {
        const latest = catalog.document?.links.find((link) => link.id === existing.id); if (!latest) return;
        const patch = {}; for (const field of ["title", "artist", "album", "year", "duration"]) if ((latest[field] === "" || latest[field] == null) && tags[field] != null && tags[field] !== "") patch[field] = tags[field];
        if (Object.keys(patch).length) await catalog.editWithoutGrant(latest.id, patch);
      }
    } catch (error) { if (error?.message !== "metadata.parserUnavailable") console.warn("Audio tag read failed", error); }
  }
  // catalogPath is written by the catalog store, so merge onto the stored
  // value instead of writing this startup copy over them.
  let prefsWrite = Promise.resolve();
  function persistPrefs() {
    const write = async () => {
      try {
        const stored = await P.storage.get("audio-player").catch(() => undefined) || {};
        const { catalogPath, ...owned } = prefs, { musicFolders, lastMode, ...kept } = stored;
        // A light page owns only the visualizer and equalizer choices; its copy of the
        // other preferences is a startup snapshot that must not overwrite the full player's.
        const written = light ? { visualizer: prefs.visualizer, equalizer: prefs.equalizer } : owned;
        await P.storage.set("audio-player", { ...kept, ...written });
      } catch {}
    };
    prefsWrite = prefsWrite.then(write, write); return prefsWrite;
  }
  const isCatalogSource = (href) => /\.music\.link\.json(?:$|[?#])/i.test(String(href || ""));
  const isPlaylistSource = (href) => /\.(?:m3u|pls)(?:$|[?#])/i.test(String(href || ""));
  async function openDeliveredCatalog(sourcePath) {
    try {
      await catalog.openDelivered(sourcePath); catalogView.render(); queue.setCatalog(catalog.document?.links || [], { kind: "all", sourcePath, label: sourcePath.split(/[\\/]/).pop() });
      setCatalogPanel(true); showCatalogList(true);
    } catch (error) { setStatus("catalog.openError", { error: error.message }, true); }
  }
  async function openCatalog() {
    if (!(await dialogs.openCatalog())) return false;
    catalogView.setFilter({ kind: "all", value: "all" }); queue.setCatalog(catalog.document?.links || [], { kind: "all", sourcePath: "all", label: t("catalog.all") }); setCatalogPanel(true); showCatalogList(true); return true;
  }
  async function newCatalog() {
    if (!(await dialogs.newCatalog())) return false;
    catalogView.setFilter({ kind: "all", value: "all" }); queue.setCatalog([], { kind: "all", sourcePath: "all", label: t("catalog.all") }); setCatalogPanel(true); showCatalogList(true); return true;
  }
  function catalogStats(links) {
    const distinct = (values) => new Set(values.filter(Boolean).map((value) => String(value).trim().toLowerCase()).filter(Boolean)).size;
    const duration = links.reduce((sum, link) => sum + (Number.isFinite(link.duration) && link.duration > 0 ? link.duration : 0), 0);
    const stats = [
      ["catalog.stat.tracks", links.length],
      ["catalog.stat.artists", distinct(links.map((link) => link.artist))],
      ["catalog.stat.albums", distinct(links.map((link) => link.album))],
      ["catalog.stat.tags", distinct(links.flatMap((link) => Array.isArray(link.tags) ? link.tags : []))],
      ["catalog.stat.categories", distinct(links.map((link) => link.category))],
      ["catalog.stat.plays", links.reduce((sum, link) => sum + (Number.isInteger(link.playCount) && link.playCount > 0 ? link.playCount : 0), 0)],
    ].map(([key, value]) => [key, value.toLocaleString()]);
    if (duration > 0) {
      const minutes = Math.round(duration / 60), parts = { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
      let text; try { text = new Intl.DurationFormat(P.locale?.code, { style: "short" }).format(parts); } catch { text = `${parts.hours}:${String(parts.minutes).padStart(2, "0")}`; }
      stats.push(["catalog.stat.duration", text]);
    }
    return stats;
  }
  // The toolbar's catalog button opens this dialog: the open catalog's numbers plus Open and New.
  // Folder import shows it too (`needed`) when there is no catalog to add tracks to.
  function catalogDialog({ needed = false } = {}) {
    const dialog = $("#catalog-dialog"), doc = catalog.document;
    $("#catalog-dialog-title").textContent = needed ? t("folders.import") : doc ? catalog.path.split(/[\\/]/).pop() : t("catalog.none");
    $("#catalog-dialog-path").textContent = !needed && doc ? catalog.path : ""; $("#catalog-dialog-path").hidden = needed || !doc;
    $("#catalog-dialog-needed").hidden = !needed && !!doc;
    const stats = $("#catalog-stats"); stats.replaceChildren(); stats.hidden = needed || !doc;
    if (doc) for (const [key, value] of catalogStats(doc.links || [])) { const term = document.createElement("dt"), detail = document.createElement("dd"); term.textContent = t(key); detail.textContent = value; stats.append(term, detail); }
    // Remembered "Add from folder" paths, each with a rescan button that imports any new files.
    const folders = !needed && doc ? recentFolders() : [];
    $("#catalog-folders").hidden = !folders.length;
    $("#catalog-folders-list").replaceChildren(...folders.map((path) => {
      const item = document.createElement("li"), label = document.createElement("span"), rescan = document.createElement("button");
      label.className = "catalog-folder-path"; label.textContent = path; label.title = path;
      rescan.type = "button"; rescan.className = "catalog-folder-rescan"; rescan.title = t("folders.rescan"); rescan.setAttribute("aria-label", `${t("folders.rescan")}: ${path}`); rescan.dataset.name = "catalog-folder-rescan";
      rescan.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.6 6.2A4.7 4.7 0 0 0 3.2 3.9L2.2 5"/><path d="M2 2.4V5h2.6"/><path d="M2.4 7.8a4.7 4.7 0 0 0 8.4 2.3l1-1.1"/><path d="M12 11.6V9H9.4"/></svg>';
      rescan.addEventListener("click", () => { rescanFolder = path; dialog.close(); });
      item.append(label, rescan); return item;
    }));
    let rescanFolder = null;
    // Without a catalog, creating one is the likely next step, so New is the primary action.
    $("#catalog-dialog-new").classList.toggle("primary", !doc);
    return new Promise((resolve) => {
      const finish = async (action) => {
        dialog.removeEventListener("close", onClose); if (dialog.open) dialog.close();
        resolve(action ? await action() : false);
      };
      const onClose = () => void finish(rescanFolder ? () => importFolder(rescanFolder) : null);
      $("#catalog-dialog-open").onclick = () => void finish(openCatalog);
      $("#catalog-dialog-new").onclick = () => void finish(newCatalog);
      $("#catalog-dialog-close").onclick = () => void finish(null);
      dialog.addEventListener("close", onClose); dialog.showModal();
    });
  }
  // The last three "Add from folder" paths, newest first, kept with the device preferences.
  function recentFolders() { return Array.isArray(prefs.recentFolders) ? prefs.recentFolders.filter((path) => typeof path === "string" && path).slice(0, 3) : []; }
  function rememberFolder(path) {
    const key = (value) => value.replace(/[\\/]+$/, "").toLowerCase();
    prefs.recentFolders = [path, ...recentFolders().filter((item) => key(item) !== key(path))].slice(0, 3);
    if (!light) void persistPrefs();
  }
  async function importFolder(root) {
    if (!catalog.document && !(await catalogDialog({ needed: true }))) return;
    if (!root) { const paths = await P.openFolderDialog({ title: t("folders.choose") }); root = paths?.[0]; }
    if (!root) return;
    rememberFolder(root);
    importCancelled = false; $("#import-dialog").showModal(); $("#import-cancel").disabled = false;
    try {
      const result = await window.AudioFolderImport.importFolder(P, catalog, root, (state) => {
        const key = state.phase === "scan" ? "folders.progressScan" : "folders.progressImport";
        $("#import-progress").textContent = t(key, state);
      }, () => importCancelled);
      $("#import-progress").textContent = t(result.cancelled ? "folders.importCancelled" : "folders.importDone", result);
      if (result.parserUnavailable && !result.cancelled) setStatus("metadata.parserUnavailable");
      catalogView.render(); setTimeout(() => { if ($("#import-dialog").open) $("#import-dialog").close(); }, 1200);
    } catch (error) { $("#import-progress").textContent = error.message; setTimeout(() => $("#import-dialog").close(), 1200); }
  }
  async function start() {
    const sourceUrl = await P.getSourceUrl().catch(() => undefined);
    light = !!sourceUrl && !isCatalogSource(sourceUrl) && !isPlaylistSource(sourceUrl);
    document.documentElement.classList.toggle("light-mode", light);
    document.body.dataset.mode = light ? "light" : "full";
    queue = window.AudioSourceQueue.create(P.source.initialSourceContext, sourceUrl || "", () => light);
    P.statusBar.set(light ? [fullFooter[0]] : fullFooter);
    P.toolbar.set(light ? [] : fullToolbar);
    try { prefs = { ...prefs, ...(await P.storage.get("audio-player") || {}) }; } catch {}
    delete prefs.musicFolders; delete prefs.lastMode; // retired Music folders list and Source/Catalog tab; persistPrefs also drops the stored copies
    visualizer.attach([audio,$("#audio-next")]); player = window.AudioPlayer.create(audio, handlePlayerEvent, visualizer); window.AudioPlayerInstance = player;
    catalogView = window.AudioCatalogView.create(catalog, queue, (item) => { if (queue.mode !== "catalog") queue.setMode("catalog"); changeTrack(item); }, (key, params) => setStatus(key, params), () => showCatalogList(true), () => renderQueue(), { isLight: () => light });
    const playlistImport = window.AudioPlaylistImport.create(P, catalog, (key, params) => setStatus(key, params), (items) => {
      showCatalogList(true, { allowNoCatalog: true });
      const meta = { kind: "playlist", sourcePath: `import:${Date.now()}`, label: t("playlist.import.queue") };
      queue.setCatalog(items, meta); queue.setMode("catalog"); renderQueue();
      const item = queue.select(0); if (!item) return;
      changeTrack(item);
    });
    catalogView.setImporter(playlistImport);
    if (!light) P.toolbar.onAction(({ id, value }) => { if (id === "catalog") { void catalogDialog(); return; } if (id === "search") { catalogView.setSearch(value); return; } if (id !== "import") return; if (value === "folder") void importFolder(); else if (value === "playlist") void playlistImport.pick(); });
    visualizer.setEffect(prefs.visualizer || "bars");
    audioSettings=window.AudioPlayerSettings.create(prefs,(value)=>{prefs={...prefs,...value};visualizer.applyEqualizer(value.equalizer);player.setTransitionSettings({crossfadeSeconds:light?0:prefs.crossfadeSeconds,gapless:light?false:prefs.gapless});void persistPrefs();},{ transitionsEnabled: !light });
    document.querySelectorAll(".effects-toggle").forEach((button) => button.addEventListener("click", () => audioSettings.toggle(button)));
    prefs={...prefs,...audioSettings.value}; visualizer.applyEqualizer(prefs.equalizer); player.setTransitionSettings({crossfadeSeconds:light?0:prefs.crossfadeSeconds,gapless:light?false:prefs.gapless});
    if (!light) aiVisionModel = window.AudioPlayerAiVision.create({
      audio: player, player, queue, catalog,
      play: playModelItem,
      // The agent's setMode picks the playing queue and shows (catalog) or closes (source) the catalog list.
      setMode: (mode) => { showCatalogList(mode === "catalog"); if (mode !== "catalog" || catalog.document) { queue.setMode(mode); player?.refreshNext(); renderQueue(); } },
      refreshView: () => { catalogView?.render(); renderQueue(); },
      refreshQueue: () => { renderQueue(); catalogView?.render(); },
    });
    aiVisionModel?.expose();
    prefs.volume=Math.max(0,Math.min(1,Number(prefs.volume))); prefs.muted=!!prefs.muted; player.setVolume(prefs.volume); player.setMuted(prefs.muted); $("#volume").value = prefs.volume; renderMuteButton();
    player.setNextProvider(()=>{if(light)return null;const q=queue.queue;if(!q?.items?.length||prefs.repeat==="track")return null;let index=queue.peekNextIndex();if(index<0&&!prefs.shuffle&&prefs.repeat==="all")index=0;if(index<0||index>=q.items.length)return null;const item=q.items[index];return {item,index};});
    queue.setShuffle(!!prefs.shuffle); if (!light) { await queue.restore(); catalogView.restoreQueue(queue.queues.catalog); catalogView.restorePlaying(prefs.playingList); } await catalog.restore();
    const initialContext = P.source.initialSourceContext;
    const initialHref = sourceUrl || initialContext?.items?.[initialContext.index]?.href || initialContext?.items?.[0]?.href;
    if (initialHref && isCatalogSource(initialHref)) await openDeliveredCatalog(initialHref);
    else if (initialHref && isPlaylistSource(initialHref)) await playlistImport.openPath(initialHref);
    else if (P.source.initialSourceContext || initialHref) {
      queue.set(P.source.initialSourceContext, initialHref);
      renderQueue(); if (queue.current) changeTrack(queue.current, !!sourceUrl, { inPlace: true });
    } else renderQueue();
    if (!light) P.source.onOpen(({ sourceUrl: href, context }) => {
      if (disposed || !href) return;
      if (isCatalogSource(href)) { void openDeliveredCatalog(href); return; }
      if (isPlaylistSource(href)) { void playlistImport.openPath(href); return; }
      const item = queue.enqueue(context, href); showCatalogList(false); renderQueue(); if (item) changeTrack(item);
    });
    // Without a catalog the panel would be empty, so the toggle offers to open or create one instead.
    $("#catalog-toggle").addEventListener("click", () => { if (!catalog.document) void catalogDialog(); else setCatalogPanel($("#catalog-nav").hidden); });
    $("#catalog-overlay-close").addEventListener("click", () => showCatalogList(false));
    $("#import-cancel").addEventListener("click", () => { importCancelled = true; $("#import-cancel").disabled = true; });
    // With nothing loaded yet (a restored list), Play starts the queue's current track.
    $("#play").addEventListener("click", () => { if (navigationStarted) return; if (!player.current && queue.current) changeTrack(queue.current); else player.toggle(); }); $("#next").addEventListener("click", () => { if (!navigationStarted) changeTrack(queue.next()); }); $("#previous").addEventListener("click", () => { if (!navigationStarted) changeTrack(queue.previous()); });
    if (!light) P.statusBar.onAction(async ({ id }) => { if (id !== "undo") return; const result = await catalog.undoLastBulkEdit(); if (result.changed) setStatus("catalog.undoDone"); else setStatus(result.conflict ? "catalog.undoConflict" : "catalog.undoUnavailable"); });
    $("#shuffle").addEventListener("click", async () => { if (navigationStarted) return; prefs.shuffle = !prefs.shuffle; queue.setShuffle(prefs.shuffle); player.refreshNext(); renderQueue(); renderPlayModes(); if (!light) await persistPrefs(); });
    $("#repeat").addEventListener("click", async () => { if (navigationStarted) return; prefs.repeat = prefs.repeat === "off" ? "track" : prefs.repeat === "track" ? "all" : "off"; renderPlayModes(); if (!light) await persistPrefs(); player.refreshNext(); });
    // A click on the page tab's mute button works like the board's own Mute button.
    P.page.onMuteToggle?.(() => $("#mute").click());
    // A double click on the visualizer itself opens the playing list, like the panel's Now playing entry.
    if (!light) $("#visualizer").addEventListener("dblclick", (event) => { if (event.target.closest("button, input, select, a, dialog, .transport, #catalog-overlay, .effect-picker")) return; catalogView.showPlaying(); });
    $("#mute").addEventListener("click", () => { if (navigationStarted) return; prefs.muted=!prefs.muted; player.setMuted(prefs.muted); renderMuteButton(); if (!light) void persistPrefs(); }); $("#volume").addEventListener("input", (event) => { if (navigationStarted) return; prefs.volume=Number(event.target.value); player.setVolume(prefs.volume); if (!light) void persistPrefs(); });
    for (const input of document.querySelectorAll(".transport input[type=range]")) input.addEventListener("input", paintRanges);
    paintRanges();
    $("#seek").addEventListener("input", (event) => { if (navigationStarted) return; player.seek(Number(event.target.value)); $("#elapsed").textContent = prettyTime(player.currentTime); });
    if (!["off", "track", "all"].includes(prefs.repeat)) prefs.repeat = "off"; renderPlayModes();
    setCatalogPanel(!!prefs.catalogPanel && !!catalog.document); renderQueue(); window.addEventListener("pagehide", teardown, { once: true });
  }
  function teardown() { if (disposed) return; disposed = true; if (coverUrl) URL.revokeObjectURL(coverUrl); catalog.dispose(); player?.destroy(); visualizer.dispose(); }
  void start();
})();
