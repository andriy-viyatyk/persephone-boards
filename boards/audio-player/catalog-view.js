(() => {
  const $ = (selector) => document.querySelector(selector);
  const pathParent = (path) => String(path || "").replace(/[\\/][^\\/]*$/, "");
  function create(store, queue, playTrack, onStatus, onShowList = () => {}, onQueueChange = () => {}, { isLight = () => false } = {}) {
    let filter = { kind: "all", value: "" }, selectedId = "", editingOriginal = null, importer = null, shownCatalogName = null, searchText = "", shownCount = null, openSection, panelFilter = "", lastNav = null, viewList = null, pendingPlaying = null, savedPlaying;
    // A list is the same list when its kind and source match, whatever its tracks are now.
    const sameList = (a, b) => !!a && !!b && a.kind === b.kind && a.sourcePath === b.sourcePath;
    // Kinds the panel can open again; agent queues and imported playlists have no panel entry.
    const sectionOf = (q) => q.kind === "playlist" ? (String(q.sourcePath).startsWith("smart:") ? "smart" : undefined) : q.kind === "missing" ? q.sourcePath : ["category", "tag", "artist", "year", "decade"].includes(q.kind) ? q.kind : q.kind === "all" || q.kind === "search" ? null : undefined;
    if (!isLight()) void window.getPrefs?.().then((prefs) => { if (prefs && "catalogSection" in prefs && openSection === undefined) { openSection = prefs.catalogSection; if (store.document) render(); } });
    const STAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.95 4 4.4.62-3.18 3.1.75 4.38L8 11.64 4.08 13.7l.75-4.38-3.18-3.1 4.4-.62z"/></svg>';
    const NONE = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2"/></svg>';
    const titleOf = (track) => track.title || track.href.split(/[\\/]/).pop();
    // The search box is Persephone's toolbar input; keep it in step when the board clears or restores it.
    function setSearchText(value) { if (searchText === value) return; searchText = value; if (!isLight()) window.persephone.toolbar.update([{ id: "search", value }]); }
    // The catalog panel is an accordion like Persephone's sidebar: "All tracks" on top, then one
    // collapsible section per browse kind, at most one open; the open one takes the free height.
    function renderNav(sections, total, search, { reveal = false } = {}) {
      lastNav = [sections, total, search];
      // The panel's own filter box narrows the entries by label only; it never touches the track list.
      const needle = panelFilter.trim().toLocaleLowerCase();
      if (needle) sections = sections.map((section) => ({ ...section, entries: section.entries.filter((entry) => !entry.notSet && entry.label.toLocaleLowerCase().includes(needle)) })).filter((section) => section.entries.length);
      const nav = $("#catalog-nav-list"), previousBody = nav.querySelector(".catalog-section-body"), scrollTop = previousBody?.scrollTop || 0, scrolledSection = previousBody?.parentElement.dataset.section;
      // Until the user picks one (or preferences restore it), the first section is open.
      let current = openSection === undefined ? sections[0]?.id || null : openSection;
      if (needle && current && !sections.some((section) => section.id === current)) current = sections[0]?.id || null;
      const navButton = (entry) => {
        const button = document.createElement("button"); button.type = "button";
        // While a search is active its entry is the selected one; clearing it brings back the panel selection.
        const selected = search ? entry.kind === "search" : filter.kind === entry.kind && String(filter.value) === String(entry.value);
        button.className = `catalog-nav-item${selected ? " selected" : ""}`;
        const label = document.createElement("span"), count = document.createElement("span");
        label.className = `catalog-nav-label${entry.notSet ? " not-set" : ""}`; label.textContent = entry.label;
        if (entry.kind === "search") label.insertAdjacentHTML("afterbegin", '<svg class="catalog-nav-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3.8"/><path d="M8.8 8.8l3 3"/></svg>'); count.className = "catalog-nav-count"; count.textContent = String(entry.count ?? "");
        button.append(label, count); button.title = entry.label; button.style.paddingLeft = `${6 + (entry.depth || 0) * 12}px`;
        if (entry.kind === "search") { button.dataset.name = "catalog-search-results"; button.addEventListener("click", onShowList); }
        else button.addEventListener("click", () => { filter = { kind: entry.kind, value: entry.value }; setSearchText(""); render({ rebuildQueue: true }); onShowList(); });
        return button;
      };
      const children = [navButton({ kind: "all", value: "all", label: window.audioPlayerT("catalog.all"), count: total })];
      // The search results get their own entry under "All tracks", so a closed result list can be reopened.
      if (search) children.push(navButton({ kind: "search", value: search.query, label: search.query, count: search.count }));
      for (const section of sections) {
        const open = section.id === current, element = document.createElement("section"), header = document.createElement("button");
        element.className = `catalog-section${open ? " open" : ""}`; element.dataset.section = section.id;
        header.type = "button"; header.className = "catalog-section-header"; header.setAttribute("aria-expanded", String(open)); header.dataset.name = `catalog-section-${section.id}`;
        header.innerHTML = '<svg class="catalog-section-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>';
        const title = document.createElement("span"), count = document.createElement("span");
        title.className = "catalog-section-title"; title.textContent = section.title; count.className = "catalog-section-count"; count.textContent = String(section.entries.filter((entry) => !entry.notSet).length);
        header.append(title, count);
        header.addEventListener("click", () => { openSection = open ? null : section.id; window.updatePrefs?.({ catalogSection: openSection }); render(); });
        element.append(header);
        if (open) {
          const body = document.createElement("div"); body.className = "catalog-section-body";
          body.append(...section.entries.map(navButton)); element.append(body);
          if (scrolledSection === section.id) requestAnimationFrame(() => { body.scrollTop = scrollTop; });
        }
        children.push(element);
      }
      nav.replaceChildren(...children);
      if (reveal) requestAnimationFrame(() => nav.querySelector(".catalog-nav-item.selected")?.scrollIntoView({ block: "nearest" }));
    }
    function render({ rebuildQueue = false, reveal = false } = {}) {
      const doc = store.document, tracks = (doc?.links || []).filter(window.AudioCatalog.validLink), list = $("#catalog-list");
      if (isLight()) {
        const member = !!currentCatalogTrack(), addCurrent = $("#add-current");
        addCurrent.hidden = !window.AudioPlayerInstance?.current || !doc;
        addCurrent.dataset.state = member ? "edit" : "add";
        addCurrent.title = window.audioPlayerT(member ? "catalog.editTrack" : "catalog.addCurrent");
        addCurrent.setAttribute("aria-label", addCurrent.title);
        renderTrackControls();
        return;
      }
      // Redraws keep the list where the user scrolled it; only a different list starts at the top.
      const keptScroll = rebuildQueue ? 0 : list.scrollTop;
      list.replaceChildren();
      const categories = window.AudioCatalog.categoryPaths(doc).sort();
      const tags = [...new Set(tracks.flatMap((x) => x.tags || []))].sort();
      const artists = [...new Set(tracks.map((x) => x.artist).filter(Boolean))].sort();
      const years = [...new Set(tracks.map((x) => x.year).filter(Number.isInteger))].sort((a, b) => b - a);
      const smart = window.AudioSmartPlaylists.definitions;
      // Track counts per entry, counted in one pass with the same matching rules as AudioCatalogSearch.
      const counts = new Map(), bump = (key) => counts.set(key, (counts.get(key) || 0) + 1);
      for (const track of tracks) {
        if (track.artist) bump(`artist:${track.artist}`);
        if (Number.isInteger(track.year)) { bump(`year:${track.year}`); bump(`decade:${Math.floor(track.year / 10) * 10}`); }
        for (const tag of new Set(track.tags || [])) bump(`tag:${tag}`);
        const parts = String(track.category || "").split("/").filter(Boolean);
        for (let depth = 1; depth <= parts.length; depth++) bump(`category:${parts.slice(0, depth).join("/")}`);
      }
      const countOf = (kind, value) => counts.get(`${kind}:${value}`) || 0;
      const query = searchText.trim();
      // A search covers the whole catalog; the panel selection comes back once the search is cleared.
      let items = window.AudioCatalogSearch.select(tracks, query, query ? { kind: "all", value: "all" } : filter), queueMeta = null;
      if (!query && filter.kind === "playlist" && filter.value.startsWith("smart:")) {
        const id = filter.value.slice(6), def = smart.find((item) => item.id === id);
        items = def ? window.AudioPlaylistQueues.smart(tracks, id) : [];
        queueMeta = { kind: "playlist", sourcePath: filter.value, label: def ? window.audioPlayerT(def.key) : "" };
      }
      const sections = [
        { id: "category", title: window.audioPlayerT("catalog.filter.category"), entries: categories.map((value) => ({ kind: "category", value, depth: Math.max(0, value.split("/").length - 1), label: value.split("/").join(" › "), count: countOf("category", value) })) },
        { id: "tag", title: window.audioPlayerT("catalog.filter.tag"), entries: tags.map((value) => ({ kind: "tag", value, label: `# ${value}`, count: countOf("tag", value) })) },
        { id: "artist", title: window.audioPlayerT("catalog.filter.artist"), entries: artists.map((value) => ({ kind: "artist", value, label: value, count: countOf("artist", value) })) },
        { id: "year", title: window.audioPlayerT("catalog.filter.year"), entries: years.map((value) => ({ kind: "year", value, label: String(value), count: countOf("year", value) })) },
        { id: "decade", title: window.audioPlayerT("catalog.filter.decade"), entries: [...new Set(years.map((year) => Math.floor(year / 10) * 10))].map((value) => ({ kind: "decade", value, label: String(value), count: countOf("decade", value) })) },
        { id: "smart", title: window.audioPlayerT("playlist.smart.heading"), entries: smart.map((item) => ({ kind: "playlist", value: `smart:${item.id}`, label: window.audioPlayerT(item.key), count: window.AudioPlaylistQueues.smart(tracks, item.id).length })) },
      ];
      // Each browse kind starts with a "Not set" entry for tracks without that value, when there are any.
      for (const section of sections) {
        if (section.id === "smart") continue;
        const count = tracks.filter((track) => window.AudioCatalogSearch.missing(track, section.id)).length;
        if (count) section.entries.unshift({ kind: "missing", value: section.id, label: window.audioPlayerT("catalog.notSet"), count, notSet: true });
      }
      renderNav(sections.filter((section) => section.entries.length), tracks.length, query ? { query, count: items.length } : null, { reveal });
      const kind = query ? "search" : filter.kind, value = query || filter.value;
      const label = queueMeta?.label || (query ? window.audioPlayerT("catalog.searchLabel", { query }) : filter.kind === "all" ? window.audioPlayerT("catalog.all") : filter.kind === "missing" ? window.audioPlayerT("catalog.filterLabel", { filter: window.audioPlayerT(`catalog.filter.${filter.value}`), value: window.audioPlayerT("catalog.notSet") }) : window.audioPlayerT("catalog.filterLabel", { filter: window.audioPlayerT(`catalog.filter.${filter.kind}`), value: filter.value }));
      viewList = { items, meta: queueMeta || { kind, sourcePath: value || kind, label } };
      // Viewing a list never replaces the playing queue; the playing list itself is refreshed in place.
      const playing = queue.queues.catalog;
      if (!playing || sameList(playing, viewList.meta)) queue.setCatalog(items, viewList.meta, { preserve: !!playing });
      // A list saved by an earlier page becomes the playing queue again, at the track that was playing.
      if (pendingPlaying && sameList(queue.queues.catalog, viewList.meta)) {
        const q = queue.queues.catalog, index = q.items.findIndex((item) => hrefKey(item.href) === hrefKey(pendingPlaying.href));
        if (index >= 0) q.index = index;
        pendingPlaying = null; queue.setMode("catalog");
      }
      renderPlaying();
      $("#catalog-overlay-title").textContent = label;
      window.AudioPlayerInstance?.refreshNext?.(); onQueueChange();
      for (const track of items) {
        const row = document.createElement("li"), main = document.createElement("button"), details = document.createElement("span"), meta = document.createElement("small"), edit = document.createElement("button");
        row.className = "catalog-row"; if (window.AudioPlayerInstance?.current && hrefKey(window.AudioPlayerInstance.current.href) === hrefKey(track.href)) { row.dataset.name = "playing-track"; row.classList.add("playing"); } main.type = "button"; main.className = "catalog-track"; details.textContent = titleOf(track); const lastPlayed = track.lastPlayed && Number.isFinite(Date.parse(track.lastPlayed)) ? window.audioPlayerT("catalog.lastPlayed", { date: new Date(track.lastPlayed).toLocaleDateString() }) : ""; meta.textContent = [track.artist, track.album, track.year, `${track.playCount || 0} ${window.audioPlayerT("catalog.plays")}`, lastPlayed].filter(Boolean).join(" · ");
        main.append(details, meta); main.addEventListener("click", () => { if (!sameList(queue.queues.catalog, viewList.meta)) queue.setCatalog(viewList.items, viewList.meta); if (queue.mode !== "catalog") queue.setMode("catalog"); renderPlaying(); const idx = queue.queue.items.findIndex((item) => item.id === track.id); const item = queue.select(idx); if (!item) return; playTrack(item); });
        edit.type = "button"; edit.className = "catalog-edit"; edit.title = window.audioPlayerT("catalog.editTrack"); edit.setAttribute("aria-label", edit.title);
        edit.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.6 2.2l2.2 2.2-7 7H2.6V9.2z"/><path d="M8.2 3.6l2.2 2.2"/></svg>'; edit.addEventListener("click", () => editTrack(track));
        const side = document.createElement("div"); side.className = "catalog-side"; side.append(edit, ratingStars(track, "row-rating"));
        row.append(main, side);
        row.addEventListener("contextmenu", (event) => { event.preventDefault(); showRowMenu(event.clientX, event.clientY, track); });
        list.append(row);
      }
      list.scrollTop = keptScroll;
      // The catalog button at the left of Persephone's page toolbar names the open catalog file.
      const catalogName = doc ? store.path.split(/[\\/]/).pop() : "";
      if (catalogName !== shownCatalogName) { shownCatalogName = catalogName; window.persephone.toolbar.update([{ id: "catalog", label: catalogName || window.audioPlayerT("catalog.none"), title: doc ? store.path : window.audioPlayerT("catalog.title") }]); }
      $("#catalog-empty").textContent = doc ? window.audioPlayerT("catalog.noResults") : window.audioPlayerT("catalog.empty");
      $("#catalog-empty").hidden = items.length > 0;
      if (items.length !== shownCount) { shownCount = items.length; window.persephone.statusBar.update("count", { text: window.audioPlayerT("playlist.trackCount", { count: items.length }) }); }
      const current = window.AudioPlayerInstance?.current;
      const alreadyAdded = !!currentCatalogTrack();
      // Icon in the now-playing panel: a pencil to edit the track when it is in the catalog, + to add it.
      const addCurrent = $("#add-current"), addLabel = window.audioPlayerT(alreadyAdded ? "catalog.editTrack" : "catalog.addCurrent");
      addCurrent.hidden = !current || !doc; addCurrent.dataset.state = alreadyAdded ? "edit" : "add";
      addCurrent.title = addLabel; addCurrent.setAttribute("aria-label", addLabel);
      renderTrackControls();
    }
    function hrefKey(href) { return window.AudioCatalog.normalizedHref(href); }
    // The catalog entry of the track now playing, if it has one.
    function currentCatalogTrack() {
      const current = window.AudioPlayerInstance?.current;
      return current ? (store.document?.links || []).filter(window.AudioCatalog.validLink).find((track) => hrefKey(track.href) === hrefKey(current.href)) || null : null;
    }
    // Compact rating for the title chip and the list rows, like the track dialog's: a circle for no rating, then five stars.
    function ratingStars(track, className) {
      const stars = document.createElement("div"), rating = Math.max(0, Math.min(5, Number(track.rating) || 0));
      stars.className = `rating-stars rating-compact ${className}`; stars.setAttribute("role", "radiogroup"); stars.setAttribute("aria-label", window.audioPlayerT("metadata.rating"));
      for (let value = 0; value <= 5; value++) {
        const button = document.createElement("button"), label = `${window.audioPlayerT("metadata.rating")}: ${value}`;
        button.type = "button"; button.className = value ? "rating-star" : "rating-none"; button.innerHTML = value ? STAR : NONE; button.title = label;
        button.setAttribute("role", "radio"); button.setAttribute("aria-label", label); button.setAttribute("aria-checked", String(value === rating));
        button.classList.toggle("on", value ? value <= rating : rating === 0);
        button.addEventListener("click", (event) => { event.stopPropagation(); if (value !== rating) void setRating(track, value); });
        stars.append(button);
      }
      return stars;
    }
    async function setRating(track, rating) {
      try {
        if (!await store.edit(track.id, { rating })) { onStatus("catalog.readOnly"); return; }
        const updated = store.document?.links.find((item) => item.id === track.id); if (updated) window.AudioPlayerInstance?.updateCurrent?.(updated);
        render();
      } catch (error) { onStatus("catalog.writeError", error); }
    }
    // Controls for the playing track when it is in the catalog: stars under its name, and every
    // catalog tag down the left edge with the track's own tags on; a click toggles the tag.
    function renderTrackControls() {
      const rating = $("#track-chip-rating"), tagList = $("#track-tag-list"), track = currentCatalogTrack();
      rating.hidden = !track;
      rating.replaceChildren(...(track ? [ratingStars(track, "chip-rating")] : []));
      const allTags = track ? [...new Set((store.document?.links || []).flatMap((link) => (Array.isArray(link.tags) ? link.tags : [])))].sort((a, b) => a.localeCompare(b)) : [];
      const own = new Set(track?.tags || []);
      tagList.hidden = !allTags.length;
      tagList.replaceChildren(...allTags.map((tag) => {
        const button = document.createElement("button"), on = own.has(tag);
        button.type = "button"; button.className = "track-tag"; button.textContent = tag; button.title = tag;
        button.classList.toggle("on", on); button.setAttribute("aria-pressed", String(on));
        button.addEventListener("click", () => void setTags(track, on ? track.tags.filter((item) => item !== tag) : [...(track.tags || []), tag]));
        return button;
      }));
    }
    async function setTags(track, tags) {
      try {
        if (!await store.edit(track.id, { tags })) { onStatus("catalog.readOnly"); return; }
        const updated = store.document?.links.find((item) => item.id === track.id); if (updated) window.AudioPlayerInstance?.updateCurrent?.(updated);
        render();
      } catch (error) { onStatus("catalog.writeError", error); }
    }
    // Row context menu: remove the track from the catalog, or move its file to the Recycle Bin (bridge 1.41.0).
    const rowMenu = document.createElement("div"); rowMenu.className = "row-menu"; rowMenu.setAttribute("role", "menu"); rowMenu.hidden = true; document.body.append(rowMenu);
    const hideRowMenu = () => { rowMenu.hidden = true; };
    function showRowMenu(x, y, track) {
      const items = [{ key: "catalog.removeTrack", run: () => removeTrack(track) }];
      if (typeof window.persephone.trashFile === "function") items.push({ key: "catalog.deleteTrack", danger: true, run: () => confirmDelete(track) });
      rowMenu.replaceChildren(...items.map((item) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "row-menu-item"; button.setAttribute("role", "menuitem");
        button.classList.toggle("danger", !!item.danger); button.textContent = window.audioPlayerT(item.key);
        button.addEventListener("click", () => { hideRowMenu(); void item.run(); });
        return button;
      }));
      rowMenu.hidden = false;
      const { width, height } = rowMenu.getBoundingClientRect();
      rowMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`; rowMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
      rowMenu.querySelector("button")?.focus();
    }
    document.addEventListener("pointerdown", (event) => { if (!rowMenu.hidden && !rowMenu.contains(event.target)) hideRowMenu(); }, true);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !rowMenu.hidden) { event.stopPropagation(); hideRowMenu(); } }, true);
    window.addEventListener("blur", hideRowMenu); $("#catalog-list").addEventListener("scroll", hideRowMenu);
    async function removeTrack(track) {
      try {
        if (!await store.removeTrack(track.id)) { onStatus("catalog.readOnly"); return; }
        render(); onStatus("catalog.removed", { title: titleOf(track) });
      } catch (error) { onStatus("catalog.writeError", error); }
    }
    let deleting = null;
    function confirmDelete(track) {
      deleting = track;
      $("#delete-track-message").textContent = window.audioPlayerT("catalog.deleteMessage", { title: titleOf(track) });
      $("#delete-track-path").textContent = track.href;
      $("#delete-track-dialog").showModal(); $("#delete-track-cancel").focus();
    }
    async function deleteTrack() {
      const track = deleting; deleting = null; $("#delete-track-dialog").close(); if (!track) return;
      // The playing file is held open by the player, so move on to the next track before deleting it.
      if (window.AudioPlayerInstance?.current && hrefKey(window.AudioPlayerInstance.current.href) === hrefKey(track.href)) { $("#next").click(); await new Promise((resolve) => setTimeout(resolve, 300)); }
      try { await window.persephone.trashFile(track.href); }
      catch (error) { onStatus("catalog.deleteError", error); return; }
      try { if (!await store.removeTrack(track.id)) { onStatus("catalog.readOnly"); return; } }
      catch (error) { onStatus("catalog.writeError", error); return; }
      render(); onStatus("catalog.deleted", { title: titleOf(track) });
    }
    $("#delete-track-cancel").addEventListener("click", () => { deleting = null; $("#delete-track-dialog").close(); });
    $("#delete-track-confirm").addEventListener("click", () => void deleteTrack());
    function editTrack(track) {
      selectedId = track?.id || ""; const form = $("#track-form"); form.reset();
      $("#track-dialog-title").textContent = track ? window.audioPlayerT("catalog.editTrack") : window.audioPlayerT("catalog.addTrack");
      const current = track || window.AudioPlayerInstance?.current || {};
      const formFields = {
        title: current.title ?? "", artist: current.artist ?? "", album: current.album ?? "",
        year: current.year ?? "", category: current.category ?? "", rating: current.rating ?? 0,
      };
      for (const [key, value] of Object.entries(formFields)) $(`#track-${key}`).value = String(value);
      tagsField.set(Array.isArray(current.tags) ? current.tags : []);
      paintRating();
      editingOriginal = track ? { title: track.title ?? "", artist: track.artist ?? "", album: track.album ?? "", year: track.year ?? null, category: track.category ?? "", tags: (track.tags || []).join(","), rating: Number(track.rating) || 0 } : null;
      $("#track-dialog").showModal();
    }
    async function saveTrack(event) {
      event.preventDefault(); const current = window.AudioPlayerInstance?.current; if (!selectedId && !current) return;
      const track = store.document?.links.find((item) => item.id === selectedId);
      const values = { title: $("#track-title").value.trim(), artist: $("#track-artist").value.trim(), album: $("#track-album").value.trim(), year: Number($("#track-year").value) || null, category: $("#track-category").value.trim().replace(/\/+$/, ""), tags: tagsField.value, rating: Math.max(0, Math.min(5, Number($("#track-rating").value) || 0)) };
      const patch = track ? Object.fromEntries(Object.entries(values).filter(([key, value]) => String(key === "tags" ? value.join(",") : value ?? "") !== String(editingOriginal?.[key] ?? ""))) : values;
      if (track && !Object.keys(patch).length) { $("#track-dialog").close(); return; }
      try {
        let saved;
        if (track) saved = await store.edit(track.id, patch);
        else saved = await store.add(window.AudioCatalog.normalizeTrack({ ...current, ...patch, id: window.AudioCatalog.newId(), addedAt: new Date().toISOString() }));
        if (!saved) { onStatus("catalog.readOnly"); return; }
        if (track) { const updated = store.document?.links.find((item) => item.id === track.id); if (updated) window.AudioPlayerInstance?.updateCurrent?.(updated); }
        $("#track-dialog").close(); selectedId = ""; editingOriginal = null; render(); onStatus(store.readOnly ? "catalog.readOnly" : "catalog.saved");
      } catch (error) { onStatus("catalog.writeError", error); }
    }
    // Rating picker: an empty circle for no rating, then five stars; the value lives in the hidden #track-rating.
    for (let value = 0; value <= 5; value++) {
      const button = document.createElement("button"); button.type = "button"; button.className = value ? "rating-star" : "rating-none"; button.dataset.value = String(value);
      button.setAttribute("role", "radio"); button.innerHTML = value ? STAR : NONE;
      button.addEventListener("click", () => { $("#track-rating").value = String(value); paintRating(); });
      $("#track-rating-stars").append(button);
    }
    function paintRating() {
      const rating = Math.max(0, Math.min(5, Number($("#track-rating").value) || 0));
      for (const button of $("#track-rating-stars").children) {
        const value = Number(button.dataset.value), label = `${window.audioPlayerT("metadata.rating")}: ${value}`;
        button.classList.toggle("on", value ? value <= rating : rating === 0); button.setAttribute("aria-checked", String(value === rating)); button.title = label; button.setAttribute("aria-label", label);
      }
    }
    // Category and tags suggest what the catalog already has, like Persephone's link editor.
    window.AudioFieldInputs.categoryInput($("#track-category"), { paths: () => window.AudioCatalog.categoryPaths(store.document) });
    const tagsField = window.AudioFieldInputs.tagsInput($("#track-tags"), $("#track-tags-input"), {
      items: () => [...new Set((store.document?.links || []).flatMap((link) => (Array.isArray(link.tags) ? link.tags : [])))].sort((a, b) => a.localeCompare(b)),
    });
    $("#track-form").addEventListener("submit", saveTrack);
    $("#track-cancel").addEventListener("click", () => $("#track-dialog").close());
    $("#add-current").addEventListener("click", () => editTrack(currentCatalogTrack()));
    function restoreQueue(saved) {
      if (isLight()) return;
      if (!saved) return;
      if (saved.kind === "search") { filter = { kind: "all", value: "all" }; setSearchText(saved.sourcePath || ""); }
      else if (["category", "tag", "artist", "year", "decade", "missing", "smart", "playlist"].includes(saved.kind)) { filter = { kind: saved.kind, value: saved.sourcePath || "" }; }
      else { filter = { kind: "all", value: "all" }; }
      if (store.document) render();
    }
    function setImporter(value) { importer = value; }
    // The bottom of the panel names the list that is playing; a click opens that list again.
    function renderPlaying() {
      if (isLight()) { $("#catalog-playing").hidden = true; return; }
      const q = queue.mode === "catalog" ? queue.queues.catalog : null, button = $("#catalog-playing");
      button.hidden = !q?.items.length; if (button.hidden) return;
      $("#catalog-playing-label").textContent = q.label; $("#catalog-playing-count").textContent = String(q.items.length);
      button.title = q.label; button.disabled = sectionOf(q) === undefined;
      // Remembered in the board's storage, so a new Audio Player page can restore it.
      const saved = button.disabled ? null : { kind: q.kind, sourcePath: q.sourcePath, label: q.label, href: q.items[q.index]?.href || "" }, key = JSON.stringify(saved);
      if (key !== savedPlaying) { savedPlaying = key; window.updatePrefs?.({ playingList: saved }); }
    }
    function restorePlaying(saved) {
      if (isLight()) return;
      if (!saved || queue.queues.catalog || sectionOf(saved) === undefined) return;
      savedPlaying = JSON.stringify(saved); pendingPlaying = saved; restoreQueue(saved);
    }
    function showPlaying() {
      if (isLight()) return;
      const q = queue.queues.catalog, section = q && sectionOf(q); if (!q || section === undefined) return;
      if (q.kind === "search") { filter = { kind: "all", value: "all" }; setSearchText(q.sourcePath || ""); }
      else { filter = { kind: q.kind, value: q.kind === "all" ? "all" : q.sourcePath }; setSearchText(""); }
      if (section && section !== openSection) { openSection = section; if (!isLight()) window.updatePrefs?.({ catalogSection: section }); }
      if (panelFilter) { $("#catalog-nav-filter").value = ""; panelFilter = ""; $("#catalog-nav-filter-clear").hidden = true; }
      render({ reveal: true }); onShowList();
    }
    $("#catalog-playing").addEventListener("click", showPlaying);
    const filterInput = $("#catalog-nav-filter"), filterClear = $("#catalog-nav-filter-clear");
    const applyPanelFilter = (value) => { panelFilter = value; filterClear.hidden = !value; if (lastNav) renderNav(...lastNav); };
    filterInput.addEventListener("input", () => applyPanelFilter(filterInput.value));
    filterInput.addEventListener("keydown", (event) => { if (event.key === "Escape" && filterInput.value) { event.stopPropagation(); filterInput.value = ""; applyPanelFilter(""); } });
    filterClear.addEventListener("click", () => { filterInput.value = ""; applyPanelFilter(""); filterInput.focus(); });
    return { render, renderPlaying, showPlaying, restoreQueue, restorePlaying, editTrack, setImporter, setSearch(value) { searchText = String(value || ""); render({ rebuildQueue: true }); onShowList(); }, get filter() { return filter; }, setFilter(value) { filter = value; setSearchText(""); render({ rebuildQueue: true }); } };
  }
  window.AudioCatalogView = { create };
})();
