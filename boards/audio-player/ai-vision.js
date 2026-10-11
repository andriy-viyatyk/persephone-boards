(() => {
  const TRACK_FIELDS = ["id", "isDirectory", "title", "href", "category", "tags", "imgSrc", "artist", "year", "album", "rating", "playCount", "lastPlayed", "addedAt", "duration"];
  const EDIT_FIELDS = new Set(["category", "tags", "artist", "year", "album", "rating"]);
  const DEFAULT_LIMIT = 50, MAX_LIMIT = 100;
  const text = (value) => value == null ? "" : String(value).trim();
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const ELEMENTS = [
    { name: "catalog-toggle", view: "main", purpose: "Show or hide the catalog panel (all tracks, categories, tags, artists, years, smart lists).", where: "Top-left corner of the player view, shown on hover." },
    { name: "catalog-panel", view: "main", purpose: "Catalog panel; clicking an entry opens its track list over the visualizer.", where: "Left side of the player view, when toggled on." },
    { name: "catalog-list", view: "main", purpose: "Track list of the catalog entry or search; clicking a track plays it.", where: "Overlay over the visualizer." },
    { name: "catalog-list-close", view: "main", purpose: "Close the catalog track list overlay.", where: "Top-right corner of the catalog track list overlay." },
    { name: "play-pause", view: "main", purpose: "Start or pause the currently selected audio track.", where: "Transport bar over the bottom of the visualizer; only the seek slider shows until it is hovered." },
    { name: "audio-effects", view: "main", purpose: "Open the Audio effects popover: equalizer, crossfade and gapless playback.", where: "Transport bar over the bottom of the visualizer, right of the volume slider (shown on hover)." },
    { name: "next-track", view: "main", purpose: "Advance to the next item in the active source or catalog queue.", where: "Transport bar over the bottom of the visualizer; only the seek slider shows until it is hovered." },
    { name: "playing-track", view: "main", purpose: "The catalog row of the track that is playing.", where: "The highlighted row in the catalog track list overlay." },
  ];

  function create(ctx) {
    const P = window.persephone, aiVision = P && P.aiVision;
    let remote = null, lastShape = "";
    const tracks = () => (ctx.catalog.document?.links || []).filter(window.AudioCatalog.validLink);
    const byId = (id) => tracks().find((track) => track.id === id);
    function project(track) {
      const value = {};
      for (const key of TRACK_FIELDS) value[key] = track[key] === undefined ? (key === "tags" ? [] : key === "rating" || key === "playCount" ? 0 : null) : track[key];
      value.tags = Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === "string") : [];
      return plain(value);
    }
    function pagination(items, options = {}) {
      const limit = options.limit === undefined ? DEFAULT_LIMIT : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
      let offset = 0;
      if (options.cursor !== undefined && options.cursor !== null && options.cursor !== "") {
        const raw = typeof options.cursor === "number" ? options.cursor : Number(String(options.cursor).replace(/^offset:/, ""));
        if (!Number.isInteger(raw) || raw < 0) throw new Error("cursor must be a non-negative offset returned by the previous page.");
        offset = raw;
      }
      const page = items.slice(offset, offset + limit), next = offset + page.length;
      return { items: plain(page), total: items.length, nextCursor: next < items.length ? `offset:${next}` : undefined, truncated: next < items.length };
    }
    function filterTracks(options = {}, predicate = () => true) {
      const q = text(options.text ?? options.query).toLocaleLowerCase();
      const category = options.category == null ? null : String(options.category);
      const tag = options.tag == null ? null : String(options.tag);
      const artist = options.artist == null ? null : String(options.artist).toLocaleLowerCase();
      const year = options.year == null ? null : Number(options.year);
      if (year !== null && !Number.isInteger(year)) throw new Error("year filter must be a whole number.");
      return tracks().filter((track) => {
        if (!predicate(track)) return false;
        if (category !== null && track.category !== category) return false;
        if (tag !== null && !(track.tags || []).includes(tag)) return false;
        if (artist !== null && text(track.artist).toLocaleLowerCase() !== artist) return false;
        if (year !== null && track.year !== year) return false;
        if (q && ![track.title, track.href, track.category, track.artist, track.album, ...(track.tags || [])].some((part) => text(part).toLocaleLowerCase().includes(q))) return false;
        return true;
      });
    }
    function gaps(field, options = {}) {
      const missing = filterTracks(options, (track) => field === "category" ? !text(track.category) : field === "artist" ? !text(track.artist) : track.year == null);
      return pagination(missing.map((track) => ({ id: track.id, href: track.href, title: track.title, missing: [field] })), options);
    }
    function missingMetadataValues() { return tracks().map((track) => ({ id: track.id, href: track.href, title: track.title, missing: [!text(track.category) && "category", !text(track.artist) && "artist", track.year == null && "year"].filter(Boolean) })).filter((item) => item.missing.length); }
    function missingMetadata() { return pagination(missingMetadataValues()).items; }
    function categoryValues() {
      return window.AudioCatalog.categoryPaths(ctx.catalog.document).map((path) => ({ id: path, path, depth: path.split("/").length, trackCount: tracks().filter((track) => track.category === path || track.category.startsWith(`${path}/`)).length }));
    }
    function tagValues() {
      const counts = new Map(); for (const track of tracks()) for (const tag of track.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ id: value, value, trackCount: count }));
    }
    function artistValues() {
      const counts = new Map(); for (const track of tracks()) if (text(track.artist)) counts.set(track.artist, (counts.get(track.artist) || 0) + 1);
      return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ id: name, name, trackCount: count }));
    }
    const trackMemberHelp = {
      id: "Stable Link Editor id used by updateTracks and queue methods.", isDirectory: "Always false for audio catalog tracks; folders are not returned as tracks.", title: "Catalog display title; it may differ from the source file name.",
      href: "Original audio file path or URL; this is never a temporary board:// stream URL.", category: "Slash-separated catalog category path, or an empty string when uncategorized.",
      tags: "Catalog tag names attached to this track.", imgSrc: "Catalog artwork path or URL, or null when no artwork is stored.", artist: "Stored artist name, or an empty string when unknown.",
      year: "Release year as a number, or null when unknown.", album: "Stored album name, or an empty string when unknown.", rating: "User rating from 0 through 5.",
      playCount: "Number of recorded successful playback activations.", lastPlayed: "ISO timestamp of the last recorded play, or null when never played.",
      addedAt: "ISO timestamp when this catalog track was added.", duration: "Duration in seconds, or null when unknown.",
    };
    function makeTrackNode(id) {
      const descriptorMembers = TRACK_FIELDS.map((name) => ({ name, kind: "property", summary: trackMemberHelp[name] })).concat([{ name: "access", kind: "property", summary: trackMemberHelp.access }]);
      const node = { aiVision: { kind: "AudioTrack", summary: "One audio track from the Link Editor catalog, projected as plain metadata.", members: descriptorMembers, summarize: () => { const track = byId(id); return track ? project(track) : undefined; } } };
      for (const name of TRACK_FIELDS) Object.defineProperty(node, name, { enumerable: true, get: () => { const track = byId(id); return track ? project(track)[name] : undefined; } });
      Object.defineProperty(node, "access", { enumerable: true, get: () => { const track = byId(id); return track ? project(track).access : undefined; } });
      return node;
    }
    function makeCollection(kind, summary, values, itemKind, itemSummary, fields, projectItem = (item) => item) {
      const itemMembers = fields.map(([name, description]) => ({ name, kind: "property", summary: description }));
      const node = {
        aiVision: {
          kind, summary,
          members: [{ name: "count", kind: "property", summary: "Number of items in the current collection." }, { name: "totalCount", kind: "property", summary: "Total number of items before any property-level display bound." }],
          index: (key) => {
            const list = values();
            const item = typeof key === "number" ? list[key] : typeof key === "string" ? list.find((entry) => entry.id === key) : undefined;
            if (!item) return undefined;
            if (itemKind === "AudioTrack") return makeTrackNode(item.id);
            const result = { aiVision: { kind: itemKind, summary: itemSummary, members: itemMembers, summarize: () => values().find((entry) => entry.id === item.id) } };
            for (const [name] of fields) Object.defineProperty(result, name, { enumerable: true, get: () => values().find((entry) => entry.id === item.id)?.[name] });
            return result;
          },
          summarize: () => pagination(values().map(projectItem)),
        },
        get count() { return values().length; }, get totalCount() { return values().length; },
      };
      return node;
    }
    const tracksNode = makeCollection("AudioTracks", "Catalog tracks indexed by position or stable Link Editor id. Use listTracks() for filters and cursor pages.", () => tracks(), "AudioTrack", "One audio catalog track.", TRACK_FIELDS.map((name) => [name, trackMemberHelp[name]]).concat([["access", trackMemberHelp.access]]), (track) => project(track));
    const categoriesNode = makeCollection("AudioCategories", "The normalized category tree, indexed by position or full slash-separated path.", categoryValues, "AudioCategory", "One catalog category and its descendant track count.", [["id", "Stable category path used to identify the category."], ["path", "Normalized slash-separated category path."], ["depth", "Number of path segments from the root."], ["trackCount", "Tracks assigned to this category or any descendant category."]]);
    const tagsNode = makeCollection("AudioTags", "Distinct catalog tags indexed by position or tag value.", tagValues, "AudioTag", "One tag value and its track count.", [["id", "Tag value used to identify this tag."], ["value", "Tag text stored on catalog tracks."], ["trackCount", "Number of tracks carrying this tag."]]);
    const artistsNode = makeCollection("AudioArtists", "Distinct non-empty artist names indexed by position or artist name.", artistValues, "AudioArtist", "One artist name and its track count.", [["id", "Artist name used to identify this value."], ["name", "Artist name stored on catalog tracks."], ["trackCount", "Number of tracks credited to this artist."]]);
    const missingMetadataNode = makeCollection("AudioMetadataGaps", "Catalog tracks missing category, artist, or year.", missingMetadataValues, "AudioMetadataGap", "One track and the metadata field names that are empty.", [["id", "Link Editor id for the track with missing metadata."], ["href", "Original audio file path or URL."], ["title", "Track title from the catalog."], ["missing", "Names of the missing category, artist, or year fields."]]);
    function nowPlaying() {
      const current = ctx.player?.current || ctx.queue.current;
      if (!current?.href) return null;
      const link = tracks().find((track) => window.AudioCatalog.normalizedHref(track.href) === window.AudioCatalog.normalizedHref(current.href));
      return { id: link?.id, href: current.href, title: current.title || link?.title || current.href.split(/[\\/]/).pop(), artist: link?.artist || current.artist || undefined, mode: ctx.queue.mode, sourceLabel: ctx.queue.queue?.label || undefined, position: Number(ctx.audio.currentTime) || 0, duration: Number.isFinite(ctx.audio.duration) ? ctx.audio.duration : link?.duration ?? undefined, paused: !!ctx.audio.paused };
    }
    function validatePatch(patch) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("patch must be an object with one or more of category, tags, artist, year, album, and rating.");
      const keys = Object.keys(patch);
      if (!keys.length) throw new Error("patch must contain at least one editable field.");
      const unsupported = keys.filter((key) => !EDIT_FIELDS.has(key));
      if (unsupported.length) throw new Error(`Cannot update ${unsupported.join(", ")}; allowed fields are category, tags, artist, year, album, and rating.`);
      const out = {};
      for (const [key, value] of Object.entries(patch)) {
        if (["category", "artist", "album"].includes(key)) {
          if (key === "category" && value != null && value !== "") out[key] = window.AudioCatalog.normalizeCategoryPath(value);
          else if (typeof value === "string") out[key] = value.trim();
          else throw new Error(`${key} must be a string${key === "category" ? " (or an empty string to clear it)" : ""}.`);
        } else if (key === "tags") {
          if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) throw new Error("tags must be an array of strings.");
          out.tags = [...new Set(value.map((tag) => tag.trim()).filter(Boolean))];
        } else if (key === "year") {
          if (value !== null && (!Number.isInteger(value) || value < 0 || value > 9999)) throw new Error("year must be null or a whole year from 0 to 9999.");
          out.year = value;
        } else if (key === "rating") {
          if (!Number.isFinite(value) || value < 0 || value > 5) throw new Error("rating must be a number from 0 to 5.");
          out.rating = value;
        }
      }
      return out;
    }
    async function updateTracks(ids, patch) {
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id.trim())) throw new Error("ids must be a non-empty array of catalog track ids.");
      const cleanPatch = validatePatch(patch), uniqueIds = [...new Set(ids)];
      const missingIds = uniqueIds.filter((id) => !byId(id));
      if (missingIds.length) throw new Error(`Unknown track id${missingIds.length === 1 ? "" : "s"}: ${missingIds.join(", ")}. Nothing was changed.`);
      const result = await ctx.catalog.bulkEditTracks(uniqueIds, cleanPatch);
      if (result.missingIds?.length) throw new Error(`Catalog tracks no longer exist: ${result.missingIds.join(", ")}. Nothing was changed.`);
      if (!result.changed) throw new Error("The catalog cannot be written. The catalog file may be read-only on disk.");
      for (const id of uniqueIds) { const updated = byId(id); if (updated) ctx.player.updateCurrent(updated); }
      ctx.refreshView();
      return { changed: result.changed, ids: result.ids, patch: cleanPatch, undoAvailable: true };
    }
    function expose() {
      if (!aiVision || P.view !== "main" || remote) return;
      const elementParts = aiVision.createElements(ELEMENTS);
      const app = {
        aiVision: {
          kind: "AudioPlayer",
          summary: P.i18n?.t("aiVision.summary") || "The Audio Player's catalog and current playback.",
          overview: P.i18n?.t("aiVision.overview") || "Use missingCategory, missingArtist, and missingYear to find catalog gaps; call updateTracks(ids, patch) for one undoable bulk write.",
          help: P.i18n?.t("aiVision.help") || "Track ids are stable Link Editor catalog ids. Read gap queries, gather trusted metadata, then apply one validated updateTracks call.",
          members: [
            { name: "tracks", kind: "property", node: true, indexable: true, summary: "The first page of catalog tracks as plain JSON, including Link Editor id, title, href, category, tags, artwork, artist, year, album, rating, play count, dates, and duration. Use listTracks(options) for filters and further pages." },
            { name: "categories", kind: "property", node: true, indexable: true, summary: "The normalized category tree as {id, path, depth, trackCount} values; paths use slash-separated parent and child names." },
            { name: "tags", kind: "property", node: true, indexable: true, summary: "Distinct catalog tags as {id, value, trackCount} values, sorted by tag name." },
            { name: "artists", kind: "property", node: true, indexable: true, summary: "Distinct non-empty artist names as {id, name, trackCount} values, sorted by artist name." },
            { name: "missingMetadata", kind: "property", node: true, indexable: true, summary: "The first page of tracks missing category, artist, or year, with each track's id, href, title, and exact missing field names." },
            { name: "nowPlaying", kind: "property", summary: "Current source or catalog track, stable catalog id when present, active mode, queue label, playback position, duration, and paused state." },
            { name: "listTracks", kind: "method", signature: "listTracks(options?: {limit?, cursor?, text?, category?, tag?, artist?, year?})", summary: "Read catalog tracks with optional text, exact category, tag, artist, or year filters. Returns {items, total, nextCursor?, truncated}; limit defaults to 50 and is capped at 100." },
            { name: "missingCategory", kind: "method", signature: "missingCategory(options?: {limit?, cursor?, text?, artist?, year?})", summary: "Find tracks whose category is empty. Returns bounded pages with ids, hrefs, titles, missing field names, total, nextCursor, and truncated status." },
            { name: "missingArtist", kind: "method", signature: "missingArtist(options?: {limit?, cursor?, text?, category?, tag?, year?})", summary: "Find tracks whose artist is empty. Returns bounded pages with ids, hrefs, titles, missing field names, total, nextCursor, and truncated status." },
            { name: "missingYear", kind: "method", signature: "missingYear(options?: {limit?, cursor?, text?, category?, tag?, artist?})", summary: "Find tracks with no year. Returns bounded pages with ids, hrefs, titles, missing field names, total, nextCursor, and truncated status." },
            { name: "getCategories", kind: "method", signature: "getCategories()", summary: "Read the normalized category tree and descendant track counts, including saved empty categories." },
            { name: "getTags", kind: "method", signature: "getTags()", summary: "Read distinct catalog tags and the number of tracks carrying each tag." },
            { name: "getArtists", kind: "method", signature: "getArtists()", summary: "Read distinct non-empty artist names and the number of tracks for each artist." },
            { name: "getNowPlaying", kind: "method", signature: "getNowPlaying()", summary: "Read the current track, source or catalog mode, queue label, playback position, duration, and paused state." },
            { name: "updateTracks", kind: "method", signature: "updateTracks(ids: string[], patch: {category?, tags?, artist?, year?, album?, rating?})", summary: "Validate every id and patch field, then update all selected catalog tracks in one merge-safe write and one undo step. Category uses slash-separated paths; year may be null; rating must be 0 through 5.", caution: "Writes catalog metadata immediately. One Undo action in the Audio Player restores the entire previous field set." },
            { name: "createCategory", kind: "method", signature: "createCategory(path: string)", summary: "Create a normalized slash-separated category path in the catalog tree, such as Ambient/Drone; empty path segments and duplicate paths are rejected.", caution: "Writes the catalog immediately." },
            { name: "renameCategory", kind: "method", signature: "renameCategory(oldPath: string, newPath: string)", summary: "Rename a category path and update all descendant category paths on tracks and in the saved tree in one merge-safe catalog write.", caution: "Changes every track assigned to this category or a descendant immediately." },
            { name: "moveCategory", kind: "method", signature: "moveCategory(path: string, parentPath: string)", summary: "Move a category under a new parent path, or to the root with an empty parentPath; descendant paths update together and cycles or collisions are rejected.", caution: "Changes every track assigned to this category or a descendant immediately." },
            { name: "addTracksFromFolder", kind: "method", signature: "addTracksFromFolder(folderPath: string, options?: {parseMetadata?: boolean})", timeoutMs: 115000, summary: "Scan one folder (recursively) with paged audio masks, skip files already in the catalog, optionally parse tags locally, and return discovered, added, duplicate, and unsupported counts. It never opens a picker.", caution: "Adds new matching files to the catalog immediately." },
            { name: "play", kind: "method", signature: "play(trackIdOrHref: string)", summary: "Select and play a catalog track id or file href.", caution: "Starts audio playback and changes the active queue cursor." },
            { name: "pause", kind: "method", signature: "pause()", summary: "Pause the active audio element without changing its track or queue cursor.", caution: "Pauses playback immediately." },
            { name: "next", kind: "method", signature: "next()", summary: "Select and play the next item in the active source or catalog queue, if one exists.", caution: "Changes the active queue cursor and starts the next track." },
            { name: "setMode", kind: "method", signature: "setMode(mode: \"source\" | \"catalog\")", summary: "Switch the active queue between the delivered source queue and the catalog queue; catalog mode requires an open catalog.", caution: "Changes which queue controls playback." },
            { name: "setQueue", kind: "method", signature: "setQueue({mode, trackIds?, hrefs?, startAt?})", summary: "Replace the selected source or catalog queue with known catalog ids or file hrefs and select startAt (default 0). Returns mode, cursor, count, and selected track; this does not open a dialog.", caution: "Replaces the active queue and changes its selected cursor." },
            { name: "undoLastBulkEdit", kind: "method", signature: "undoLastBulkEdit()", summary: "Restore the field preimage from the latest bulk metadata edit in one merge-safe catalog write; returns changed false when no safe undo remains.", caution: "Writes the catalog immediately." },
            ...elementParts.members,
          ],
            elements: ELEMENTS, provide: elementParts.provide,
          summarize: () => ({ kind: "AudioPlayer", trackCount: tracks().length, categoryCount: categoryValues().length, catalogPath: ctx.catalog.path || null, readOnly: !!ctx.catalog.readOnly, mode: ctx.queue.mode, nowPlaying: nowPlaying() }),
        },
        get tracks() { return tracksNode; },
        get categories() { return categoriesNode; },
        get tags() { return tagsNode; },
        get artists() { return artistsNode; },
        get missingMetadata() { return missingMetadataNode; },
        get nowPlaying() { return nowPlaying(); },
        listTracks(options) { return pagination(filterTracks(options || {}).map((track) => project(track)), options || {}); },
        missingCategory(options) { return gaps("category", options || {}); },
        missingArtist(options) { return gaps("artist", options || {}); },
        missingYear(options) { return gaps("year", options || {}); },
        getCategories() { return categoryValues(); }, getTags() { return tagValues(); }, getArtists() { return artistValues(); }, getNowPlaying() { return nowPlaying(); },
        updateTracks,
        async createCategory(path) { const normalized = window.AudioCatalog.normalizeCategoryPath(path); const result = await ctx.catalog.createCategoryAgent(normalized); if (!result) throw new Error("The catalog cannot be written. The catalog file may be read-only on disk."); ctx.refreshView(); return { created: normalized, categories: categoryValues() }; },
        async renameCategory(oldPath, newPath) { const from = window.AudioCatalog.normalizeCategoryPath(oldPath), to = window.AudioCatalog.normalizeCategoryPath(newPath); const result = await ctx.catalog.renameCategoryAgent(from, to); if (!result) throw new Error("The catalog cannot be written. The catalog file may be read-only on disk."); ctx.refreshView(); return { from, to, categories: categoryValues() }; },
        async moveCategory(path, parentPath) { const normalized = window.AudioCatalog.normalizeCategoryPath(path), parent = parentPath == null || parentPath === "" ? "" : window.AudioCatalog.normalizeCategoryPath(parentPath); const result = await ctx.catalog.moveCategoryAgent(normalized, parent); if (!result) throw new Error("The catalog cannot be written. The catalog file may be read-only on disk."); ctx.refreshView(); return { path: normalized, parentPath: parent, categories: categoryValues() }; },
        async addTracksFromFolder(folderPath, options = {}) { if (!options || typeof options !== "object" || Array.isArray(options) || (options.parseMetadata !== undefined && typeof options.parseMetadata !== "boolean")) throw new Error("options may contain only parseMetadata: true or false."); const result = await window.AudioFolderImport.addAuthorizedFolder(P, ctx.catalog, folderPath, options); ctx.refreshView(); return result; },
        async play(trackIdOrHref) {
          if (typeof trackIdOrHref !== "string" || !trackIdOrHref.trim()) throw new Error("Pass a catalog track id or file href.");
          const track = byId(trackIdOrHref) || tracks().find((item) => window.AudioCatalog.normalizedHref(item.href) === window.AudioCatalog.normalizedHref(trackIdOrHref));
          const item = track || { href: trackIdOrHref, title: trackIdOrHref.split(/[\\/]/).pop() || trackIdOrHref };
          ctx.play(item); return { status: "playing", id: track?.id, href: item.href, mode: ctx.queue.mode };
        },
        pause() { ctx.player.pause(); return { paused: true, nowPlaying: nowPlaying() }; },
        next() { const item = ctx.queue.next(); if (!item) return { advanced: false, reason: "end-of-queue", nowPlaying: nowPlaying() }; ctx.play(item); return { advanced: true, href: item.href, mode: ctx.queue.mode }; },
        setMode(mode) { if (mode !== "source" && mode !== "catalog") throw new Error('mode must be "source" or "catalog".'); if (mode === "catalog" && !ctx.catalog.document) throw new Error("Open or create a catalog in the Audio Player UI before selecting catalog mode."); ctx.setMode(mode); return { mode: ctx.queue.mode, cursor: ctx.queue.queue?.index ?? -1, queueCount: ctx.queue.queue?.items.length || 0 }; },
        setQueue(options) {
          if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Pass {mode, trackIds?, hrefs?, startAt?}.");
          const mode = options.mode || ctx.queue.mode;
          if (mode !== "source" && mode !== "catalog") throw new Error('mode must be "source" or "catalog".');
          const ids = options.trackIds === undefined ? [] : options.trackIds, hrefs = options.hrefs === undefined ? [] : options.hrefs;
          if (!Array.isArray(ids) || !Array.isArray(hrefs) || ids.some((id) => typeof id !== "string") || hrefs.some((href) => typeof href !== "string" || !href.trim())) throw new Error("trackIds and hrefs must be arrays of strings.");
          if (!ids.length && !hrefs.length) throw new Error("Supply at least one trackId or href to set the queue.");
          if (ids.length + hrefs.length > 1000) throw new Error("A queue is limited to 1000 items per call.");
          const items = [...ids.map((id) => { const item = byId(id); if (!item) throw new Error(`Unknown track id "${id}".`); return project(item, false); }), ...hrefs.map((href) => { const item = tracks().find((track) => window.AudioCatalog.normalizedHref(track.href) === window.AudioCatalog.normalizedHref(href)); return item ? project(item, false) : { href, title: href.split(/[\\/]/).pop() || href }; })];
          const startAt = options.startAt === undefined ? 0 : Number(options.startAt);
          if (!Number.isInteger(startAt) || startAt < 0 || startAt >= items.length) throw new Error(`startAt must be a whole queue index from 0 to ${items.length - 1}.`);
          if (mode === "catalog") {
            if (!ctx.catalog.document) throw new Error("Open or create a catalog before setting a catalog queue.");
            const all = tracks();
            const queueItems = items.map((item) => all.find((entry) => window.AudioCatalog.normalizedHref(entry.href) === window.AudioCatalog.normalizedHref(item.href)));
            const absent = queueItems.findIndex((item) => !item);
            if (absent >= 0) throw new Error(`Catalog queue href is not in the open catalog: ${items[absent].href}.`);
            ctx.queue.setCatalog(queueItems, { kind: "agent", sourcePath: `agent:${Date.now()}`, label: "Agent queue" });
          } else ctx.queue.setSource(items, startAt, "Agent source queue");
          ctx.setMode(mode); if (mode === "catalog") ctx.queue.select(startAt); ctx.refreshQueue();
          const current = ctx.queue.queue?.items[ctx.queue.queue.index] || null;
          return { mode, cursor: ctx.queue.queue?.index ?? -1, queueCount: ctx.queue.queue?.items.length || 0, selected: current ? { id: current.id, href: current.href, title: current.title } : null };
        },
        async undoLastBulkEdit() { const result = await ctx.catalog.undoLastBulkEdit(); if (result.readOnly && result.undoAvailable) throw new Error("The catalog cannot be written. The catalog file may be read-only on disk."); ctx.refreshView(); return result; },
      };
      remote = aiVision.expose(app);
      refreshShape();
    }
    function refreshShape() {
      if (!remote || P?.view !== "main") return;
      const first = tracks()[0];
      const shape = JSON.stringify({ hasTracks: !!first, fields: first ? TRACK_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(project(first, false), key)) : [], categories: categoryValues().map((item) => item.path) });
      if (shape === lastShape) return;
      lastShape = shape;
      remote.refresh();
    }
    return { expose, refresh: refreshShape, get remote() { return remote; } };
  }
  window.AudioPlayerAiVision = { create };
})();
