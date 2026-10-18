(() => {
  const MASKS = ["*.mp3", "*.wav", "*.aac", "*.flac", "*.m4a", "*.wma", "*.ogg", "*.opus"];
  const titleFromPath = (path) => path.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  async function scan(P, root, progress, cancelled) {
    const entries = []; let cursor, pageNumber = 0;
    do {
      if (cancelled()) break;
      const page = await P.listFolder(root, { recursive: true, masks: MASKS, limit: 1000, cursor });
      entries.push(...page.entries.filter((entry) => !entry.isDirectory)); cursor = page.nextCursor; pageNumber++;
      progress({ phase: "scan", count: entries.length, page: pageNumber, truncated: page.truncated });
    } while (cursor);
    return entries;
  }
  async function importFolder(P, store, root, progress, cancelled) {
    const entries = await scan(P, root, progress, cancelled); const tracks = []; let skipped = 0, unsupported = 0, parserUnavailable = !window.MusicMetadata?.parseFromTokenizer;
    const existing = new Set((store.document?.links || []).map((link) => window.AudioCatalog.normalizedHref(link.href)));
    for (let i = 0; i < entries.length; i++) {
      if (cancelled()) break;
      const entry = entries[i], href = entry.path;
      if (existing.has(window.AudioCatalog.normalizedHref(href))) { skipped++; continue; }
      let metadata = {};
      if (/\.wma$/i.test(entry.name)) unsupported++;
      else if (!parserUnavailable) { try { metadata = await window.AudioMetadata.read(href); } catch {} }
      const track = window.AudioCatalog.normalizeTrack({ id: window.AudioCatalog.newId(), isDirectory: false, title: metadata.title || titleFromPath(href), href, category: "", tags: [], artist: metadata.artist || "", album: metadata.album || "", year: metadata.year, duration: metadata.duration });
      if (metadata.picture) URL.revokeObjectURL(metadata.picture);
      tracks.push(track); existing.add(window.AudioCatalog.normalizedHref(href));
      progress({ phase: "import", count: i + 1, total: entries.length, added: tracks.length, skipped, unsupported });
    }
    if (tracks.length) await store.addMany(tracks);
    return { added: tracks.length, skipped, unsupported, cancelled: cancelled(), parserUnavailable };
  }
  async function addAuthorizedFolder(P, store, root, options = {}) {
    if (typeof root !== "string" || !root.trim()) throw new Error("Pass an absolute folder path.");
    if (!store.document) throw new Error("Open or create a music catalog before adding tracks from a folder.");
    let entries;
    try { entries = await scan(P, root, () => {}, () => false); }
    catch (error) { throw new Error(`Could not scan "${root}". ${error?.message || error}`); }
    const existing = new Set((store.document.links || []).map((link) => window.AudioCatalog.normalizedHref(link.href)));
    const candidates = [], duplicates = [];
    const parseMetadata = options.parseMetadata !== false;
    let unsupported = 0, parserUnavailable = parseMetadata && !window.MusicMetadata?.parseFromTokenizer;
    for (const entry of entries) {
      const href = entry.path;
      if (existing.has(window.AudioCatalog.normalizedHref(href))) { duplicates.push(href); continue; }
      if (/\.wma$/i.test(entry.name)) unsupported++;
      let metadata = {};
      if (parseMetadata && !/\.wma$/i.test(entry.name) && !parserUnavailable) { try { metadata = await window.AudioMetadata.read(href); } catch {} }
      candidates.push(window.AudioCatalog.normalizeTrack({ id: window.AudioCatalog.newId(), isDirectory: false, title: metadata.title || titleFromPath(href), href, category: "", tags: [], artist: metadata.artist || "", album: metadata.album || "", year: metadata.year, duration: metadata.duration }));
      existing.add(window.AudioCatalog.normalizedHref(href));
    }
    if (candidates.length && !(await store.addManyGranted(candidates))) throw new Error("The catalog cannot be written. The catalog file may be read-only on disk.");
    return { folderPath: root, discovered: entries.length, added: candidates.length, duplicate: duplicates.length, unsupported, duplicateHrefs: duplicates, parserUnavailable };
  }
  window.AudioFolderImport = { importFolder, addAuthorizedFolder, scan, masks: MASKS };
})();
