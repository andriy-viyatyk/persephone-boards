(() => {
  const clean = (value) => String(value || "").replace(/^\uFEFF/, "").trim();
  const basename = (path) => String(path || "").split(/[\\/]/).pop() || String(path || "");
  const isUrl = (value) => /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const isAbsolute = (value) => isUrl(value) || /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value);
  function fromFileUrl(value) {
    if (!/^file:\/\//i.test(String(value))) return value;
    const url = new URL(value); let path;
    try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
    if (url.hostname && url.hostname.toLocaleLowerCase() !== "localhost") return `\\\\${url.hostname}${path.replace(/\//g, "\\")}`;
    if (/^\/[a-z]:\//i.test(path)) return path.slice(1).replace(/\//g, "\\");
    return path.replace(/\//g, "\\");
  }
  function decodePath(value) { try { return decodeURIComponent(value); } catch { return value; } }
  function fallbackTitle(href) { return decodePath(basename(href)).replace(/\.[^.]+$/, ""); }
  function normalizePath(path) {
    const slash = String(path).replace(/\\/g, "/"), prefix = slash.match(/^[A-Za-z]:\//)?.[0] || (slash.startsWith("//") ? "//" : slash.startsWith("/") ? "/" : "");
    const parts = slash.slice(prefix.length).split("/");
    const stack = [];
    for (const part of parts) { if (!part || part === ".") continue; if (part === "..") { if (stack.length && stack.at(-1) !== "..") stack.pop(); else if (!prefix) stack.push(part); } else stack.push(part); }
    const normalized = prefix + stack.join("/");
    return /^(?:[A-Za-z]:\/|\/\/)/.test(normalized) ? normalized.replace(/\//g, "\\") : normalized;
  }
  function resolve(parent, entry) {
    const value = clean(entry);
    if (!value) return value;
    if (/^file:\/\//i.test(value)) return fromFileUrl(value);
    if (/^https?:\/\//i.test(value)) return value;
    const nativeParent = fromFileUrl(String(parent || ""));
    if (isAbsolute(value)) return /^[a-z]:[\\/]|^\\\\/i.test(value) ? normalizePath(decodePath(value)) : value;
    if (/^https?:\/\//i.test(nativeParent)) { try { return new URL(value, nativeParent).href; } catch { return value; } }
    const decoded = decodePath(value), base = String(nativeParent || "").replace(/[\\/][^\\/]*$/, "");
    return normalizePath(`${base}/${decoded}`);
  }
  function parseM3u(text, sourcePath) {
    let pending = null;
    const entries = [];
    for (const raw of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const ext = line.match(/^#EXTINF\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(.*)$/i);
      if (ext) { const seconds = Number(ext[1]); pending = { title: ext[2].trim() || null, duration: seconds >= 0 ? seconds : null }; continue; }
      if (line.startsWith("#")) continue;
      entries.push({ href: resolve(sourcePath, line), title: pending?.title || null, duration: pending?.duration ?? null }); pending = null;
    }
    return { sourcePath, entries, format: "m3u" };
  }
  function parsePls(text, sourcePath) {
    const values = new Map(); let inPlaylist = false, expected = 0;
    for (const raw of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line.startsWith(";") || line.startsWith("#")) continue;
      const section = line.match(/^\[([^\]]+)\]$/); if (section) { inPlaylist = section[1].toLocaleLowerCase() === "playlist"; continue; }
      if (!inPlaylist) continue;
      const pair = line.match(/^([^=]+)=(.*)$/); if (!pair) continue;
      const key = pair[1].trim(), value = pair[2].trim();
      if (/^NumberOfEntries$/i.test(key)) { expected = Math.max(0, Math.min(100000, Number(value) || 0)); continue; }
      const field = key.match(/^(File|Title|Length)(\d+)$/i); if (!field) continue;
      const index = Number(field[2]); if (!index || index > 100000) continue;
      const item = values.get(index) || {}; item[field[1].toLocaleLowerCase()] = value; values.set(index, item);
    }
    const indexes = [...values.keys()].sort((a, b) => a - b);
    const selected = expected ? indexes.filter((index) => index <= expected) : indexes;
    const entries = selected.flatMap((index) => {
      const item = values.get(index); if (!item.file) return [];
      const length = Number(item.length);
      return [{ href: resolve(sourcePath, item.file), title: item.title || null, duration: Number.isFinite(length) && length >= 0 ? length : null }];
    });
    return { sourcePath, entries, format: "pls" };
  }
  function parse(text, sourcePath) {
    const extension = String(sourcePath || "").split(/[?#]/)[0].split(".").pop().toLocaleLowerCase();
    if (extension === "m3u") return parseM3u(text, sourcePath);
    if (extension === "pls") return parsePls(text, sourcePath);
    throw new Error("playlist.unsupported");
  }
  window.AudioPlaylistFormat = { parse, parseM3u, parsePls, resolve, basename, fallbackTitle, isUrl, isAbsolute, fromFileUrl };
})();
