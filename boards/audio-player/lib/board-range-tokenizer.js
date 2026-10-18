(() => {
  // Total bytes one tag read may fetch; a tag or cover larger than this aborts the read.
  const MAX_READ_BYTES = 32 * 1024 * 1024;

  // A random-access strtok3 tokenizer over a board:// content URL, reading with HTTP Range
  // requests. It extends the bundled AbstractTokenizer (like strtok3's BlobTokenizer) so the
  // parser's readToken/peekNumber helpers and its EndOfStreamError checks work unchanged.
  function create(url, size) {
    const { AbstractTokenizer, EndOfStreamError } = window.MusicMetadata || {};
    if (!AbstractTokenizer || !EndOfStreamError) throw new Error("metadata.parserUnavailable");

    class RangeTokenizer extends AbstractTokenizer {
      constructor() {
        super();
        // AbstractTokenizer leaves fileInfo to the subclass, as BlobTokenizer does.
        this.fileInfo = { path: url, size };
        this.bytesFetched = 0;
      }

      async readBuffer(buffer, options) {
        if (options?.position) this.position = options.position;
        const count = await this.peekBuffer(buffer, options);
        this.position += count;
        return count;
      }

      async peekBuffer(buffer, options) {
        const norm = this.normalizeOptions(buffer, options);
        const count = Math.max(0, Math.min(size - norm.position, norm.length));
        if (!norm.mayBeLess && count < norm.length) throw new EndOfStreamError();
        if (count === 0) return 0;
        if (this.bytesFetched + count > MAX_READ_BYTES) throw new Error("Audio metadata exceeded the read limit");
        const start = norm.position, end = start + count - 1;
        const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (response.status !== 206) throw new Error("Audio source did not honor Range requests");
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength !== count) throw new Error("Truncated audio range response");
        this.bytesFetched += count;
        buffer.set(data);
        return count;
      }

      supportsRandomAccess() { return true; }

      setPosition(position) { this.position = position; }
    }

    return new RangeTokenizer();
  }

  window.AudioRangeTokenizer = { create };
})();
