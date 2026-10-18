(() => {
  const MAX_COVER_BYTES = 8 * 1024 * 1024;
  function first(value) { return Array.isArray(value) ? value[0] : value; }
  function yearFrom(date) { const match = String(date || "").match(/(?:19|20)\d{2}/); return match ? Number(match[0]) : null; }
  function empty(value) { return value === undefined || value === null || value === ""; }
  async function read(href) {
    const resource = await window.persephone.content.open(href, { timeoutMs: 30000 });
    const tokenizer = window.AudioRangeTokenizer.create(resource.url, resource.size);
    const parser = window.MusicMetadata;
    if (!parser?.parseFromTokenizer) throw new Error("metadata.parserUnavailable");
    let result;
    try { result = await parser.parseFromTokenizer(tokenizer, { duration: false, skipCovers: false, includeChapters: false }); }
    finally { await tokenizer.close(); }
    const common = result.common || {}, format = result.format || {};
    let picture = first(common.picture), coverUrl = "";
    if (picture?.data && picture.data.byteLength <= MAX_COVER_BYTES) {
      coverUrl = URL.createObjectURL(new Blob([picture.data], { type: picture.format || "image/jpeg" }));
    }
    return {
      title: first(common.title) || "", artist: first(common.artist) || "", album: first(common.album) || "",
      year: Number.isInteger(common.year) ? common.year : yearFrom(first(common.date)),
      duration: Number.isFinite(format.duration) ? format.duration : null,
      picture: coverUrl,
    };
  }
  function fillEmpty(track, parsed) {
    const output = { ...track };
    for (const field of ["title", "artist", "album", "year", "duration"]) if (empty(output[field]) && !empty(parsed[field])) output[field] = parsed[field];
    return output;
  }
  window.AudioMetadata = { read, fillEmpty };
})();
