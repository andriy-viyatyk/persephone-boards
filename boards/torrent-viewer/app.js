const P = window.persephone;

const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
// Keep torrent metadata small and separate from D6's 512 MiB service RSS threshold; a bad URL
// must not consume a large fraction of that budget in the renderer.
const MAX_TORRENT_FILE_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_INTERVAL_MS = 1000;
const STATUS_INTERVAL_MS = 750;
const STALLED_SAMPLE_LIMIT = 3;

P.state.init({ acceptedSources: [] }, { restorableKeys: ["acceptedSources"] });

const KNOWN_FAILURE_MESSAGES = new Map([
    ["torrent-file-unavailable", "The .torrent is not available: the torrent is no longer loaded. Open it again, then retry."],
    ["torrent-resolution-no-status-poll", "Resolution was abandoned because this page stopped polling. Retry to start a new attempt."],
    ["torrent-resolution-cancelled", "Torrent resolution was cancelled. Retry to start a new attempt."],
    ["torrent-resolution-removed", "Torrent resolution was cancelled because the torrent was removed."],
    ["torrent-resolution-failed", "The torrent metadata could not be resolved. Retry to start a new attempt."],
    ["torrent-service-shutting-down", "The torrent service is shutting down. Retry to start a new attempt."],
    ["service-request-failed", "The torrent service request failed. Retry the operation."],
    ["torrent-resolution-busy", "Too many torrent resolutions are already running. Wait for one to finish, then retry."],
    ["torrent-source-fetch-failed", "The torrent URL could not be read. Retry to start a new attempt."],
    ["torrent-source-too-large", "The URL did not return a torrent-sized file."],
    ["torrent-source-invalid", "The URL did not return a valid torrent file. Retry to start a new attempt."],
    ["torrent-identifier-required", "Enter a magnet link, an info hash, or choose a .torrent file."],
    ["torrent-link-invalid", "This torrent link is invalid."],
    ["torrent-link-invalid-protocol", "This torrent link uses an unsupported protocol."],
    ["torrent-link-invalid-infohash", "This torrent link has an invalid info hash."],
    ["torrent-link-path-required", "This torrent link does not identify a file."],
    ["torrent-link-path-invalid-encoding", "This torrent link has an invalid file path."],
    ["torrent-link-path-invalid", "This torrent link has an invalid file path."],
    ["torrent-link-magnet-mismatch", "This torrent link contains a magnet for a different torrent."],
    ["torrent-magnet-required", "This torrent is no longer loaded. Add it again before opening this file."],
    ["torrent-unavailable", "This torrent is no longer available. Add it again before opening this file."],
    ["torrent-file-not-found", "The requested file is not in this torrent."],
    ["torrent-file-too-large", "This torrent file is too large to read through the board."],
    ["torrent-range-too-large", "The requested file range is too large for the board."],
    ["torrent-range-invalid", "The requested file range is invalid."],
    ["torrent-range-out-of-bounds", "The requested file range is outside the file."],
    ["torrent-file-size-invalid", "The torrent reported an invalid file size."],
    ["torrent-file-deselect-unavailable", "The torrent service could not prepare its file metadata. Retry the operation."],
    ["torrent-read-aborted", "The torrent read was cancelled. Retry the operation if the page is still open."],
    ["torrent-read-incomplete", "The torrent read ended before the requested bytes arrived. Retry the operation."],
    ["torrent-read-too-many-bytes", "The torrent returned more bytes than requested. Retry the operation."],
]);

const sourceInput = document.getElementById("source-input");
const pageStatus = document.getElementById("page-status");
const torrentList = document.getElementById("torrent-list");
const torrentCount = document.getElementById("torrent-count");
const removeAllButton = document.getElementById("remove-all");
let removeAllInFlight = false;
const selectedTorrent = document.getElementById("selected-torrent");
const fileCount = document.getElementById("file-count");
const fileList = document.getElementById("file-list");
const contextMenu = document.getElementById("context-menu");

// The service owns the inventory. Page state is enrichment only and must never create a row.
const serviceTorrents = new Map();
const pageStateByInfoHash = new Map();
const activeResolutions = new Map();
const pendingResolveKeys = new Set();
const acceptedSources = new Set();
const sourceInfoHashes = new Map();
const timers = new Set();

let selectedInfoHash;
let snapshotTimer;
let statusTimer;
let snapshotInFlight = false;
let tearingDown = false;
let serviceState = "stopped";
/** requestId → source, for this page's failed resolves: what the row's Retry re-resolves. */
const failedSources = new Map();
/** File name → Persephone's icon for it (a `data:` URL); names in flight are in fileIconRequests. */
const fileIcons = new Map();
const fileIconRequests = new Set();
let serviceInstanceKey;
let serviceResetPending = true;
let serviceRestoreNeeded = false;
let observedSnapshotInfoHashes = new Set();
let unsubscribeSource;
let acceptedSourcesLoaded = false;
let sourceRestorePromise;

function rawMessageFrom(error, fallback = "Torrent service request failed.") {
    if (error && typeof error === "object" && typeof error.message === "string") return error.message;
    if (error && typeof error === "object" && typeof error.code === "string") return error.code;
    if (typeof error === "string" && error.length > 0) return error;
    return fallback;
}

function messageFrom(error, fallback = "Torrent service request failed.") {
    const raw = rawMessageFrom(error, fallback);
    if (raw.startsWith("torrent-metadata-timeout:")) {
        // Read the bound out of the reason rather than repeating it: the service owns
        // METADATA_TIMEOUT_MS, and a hardcoded "30 seconds" here would quietly start lying
        // the moment that constant moves.
        const ms = Number(raw.slice("torrent-metadata-timeout:".length).replace(/ms$/, ""));
        const seconds = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null;
        return seconds
            ? `Torrent metadata was not found within ${seconds} seconds. Retry to start a new attempt.`
            : "Torrent metadata was not found in time. Retry to start a new attempt.";
    }
    const known = KNOWN_FAILURE_MESSAGES.get(raw);
    if (known) return known;
    if (/^(?:torrent|service|unknown)-[a-z0-9-]+(?::.*)?$/i.test(raw)) {
        return `The torrent service reported an unrecognised failure: ${raw}. Retry the operation.`;
    }
    return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}

function setStatus(message, isError = false) {
    pageStatus.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    pageStatus.append(text);
    pageStatus.classList.toggle("error", isError);
}

function setStatusWithAction(message, isError, label, action) {
    setStatus(message, isError);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "p-btn ghost sm";
    button.textContent = label;
    button.style.marginLeft = "auto";
    button.addEventListener("click", () => void action());
    pageStatus.append(button);
}

function waitFor(ms) {
    return new Promise((resolve) => {
        const timer = {
            id: setTimeout(() => {
                timers.delete(timer);
                resolve();
            }, ms),
            resolve,
        };
        timers.add(timer);
    });
}

function clearTimers() {
    for (const timer of timers) {
        clearTimeout(timer.id);
        timer.resolve();
    }
    timers.clear();
    clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
    clearTimeout(statusTimer);
    statusTimer = undefined;
}

function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let amount = value;
    let unit = -1;
    while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024;
        unit += 1;
    }
    const digits = amount >= 100 || Number.isInteger(amount) ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(digits)} ${units[unit]}`;
}

function formatRate(value) {
    return `${formatBytes(value)} /s`;
}

function fileName(path) {
    const parts = String(path).split("/");
    return parts[parts.length - 1] || path;
}

function normalizeInfoHash(infoHash) {
    return typeof infoHash === "string" ? infoHash.trim().toLowerCase() : "";
}

function canonicalSource(rawSource) {
    return typeof rawSource === "string" ? rawSource.trim() : "";
}

function sourceInfoHash(source) {
    const canonical = canonicalSource(source);
    const remembered = normalizeInfoHash(sourceInfoHashes.get(canonical));
    if (/^[0-9a-f]{40}$/.test(remembered)) return remembered;
    if (/^[0-9a-f]{40}$/.test(canonical)) return canonical.toLowerCase();

    if (canonical.toLowerCase().startsWith("torrent://")) {
        const match = canonical.match(/^torrent:\/\/([0-9a-f]{40})(?:\/|$)/i);
        if (match) return match[1].toLowerCase();
    }

    if (!canonical.toLowerCase().startsWith("magnet:")) return "";
    try {
        const hashes = new URL(canonical).searchParams.getAll("xt")
            .map((value) => value.match(/^urn:btih:([0-9a-f]{40})$/i)?.[1]?.toLowerCase())
            .filter(Boolean);
        return hashes.length > 0 && hashes.every((hash) => hash === hashes[0]) ? hashes[0] : "";
    } catch {
        return "";
    }
}

/** Saved with the sources: a local .torrent path carries no info hash of its own, and without the
 *  saved one every reload would resolve the path again to learn it is a torrent already listed. */
function persistAcceptedSources() {
    const infoHashes = {};
    for (const source of acceptedSources) {
        const infoHash = sourceInfoHashes.get(source);
        if (infoHash) infoHashes[source] = infoHash;
    }
    P.state.merge({ acceptedSources: [...acceptedSources], sourceInfoHashes: infoHashes });
}

function rememberAcceptedSource(rawSource) {
    const source = canonicalSource(rawSource);
    if (!source || !isTorrentSource(source)) return "";
    if (isHttpTorrentSource(source)) {
        const removed = acceptedSources.delete(source);
        const infoHashRemoved = sourceInfoHashes.delete(source);
        if (removed || infoHashRemoved) persistAcceptedSources();
        return source;
    }
    const infoHash = sourceInfoHash(source);
    if (infoHash) sourceInfoHashes.set(source, infoHash);
    if (acceptedSources.has(source)) return source;
    acceptedSources.add(source);
    persistAcceptedSources();
    return source;
}

function restoreAcceptedSources(state) {
    const runtimeSources = [...acceptedSources];
    const runtimeInfoHashes = new Map(sourceInfoHashes);
    const transientSources = [];
    acceptedSources.clear();
    sourceInfoHashes.clear();
    const restored = Array.isArray(state?.acceptedSources) ? state.acceptedSources : [];
    const savedInfoHashes = state?.sourceInfoHashes && typeof state.sourceInfoHashes === "object"
        ? state.sourceInfoHashes
        : {};
    for (const source of [...restored, ...runtimeSources]) {
        const canonical = canonicalSource(source);
        if (!canonical || !isTorrentSource(canonical)) continue;
        if (isHttpTorrentSource(canonical)) {
            transientSources.push(canonical);
            continue;
        }
        acceptedSources.add(canonical);
        const saved = normalizeInfoHash(savedInfoHashes[canonical]);
        const infoHash = normalizeInfoHash(runtimeInfoHashes.get(canonical))
            || (/^[0-9a-f]{40}$/.test(saved) ? saved : "")
            || sourceInfoHash(canonical);
        if (infoHash) sourceInfoHashes.set(canonical, infoHash);
    }
    persistAcceptedSources();
    return transientSources;
}

function replaceHttpSourceWithMagnet(source, magnet, infoHash) {
    const canonicalMagnet = canonicalSource(magnet);
    const normalizedInfoHash = normalizeInfoHash(infoHash);
    if (!isHttpTorrentSource(source) || !canonicalMagnet.toLowerCase().startsWith("magnet:")) return false;
    if (sourceInfoHash(canonicalMagnet) !== normalizedInfoHash) return false;

    acceptedSources.delete(source);
    sourceInfoHashes.delete(source);
    acceptedSources.add(canonicalMagnet);
    sourceInfoHashes.set(canonicalMagnet, normalizedInfoHash);
    persistAcceptedSources();
    return true;
}

function forgetAcceptedSource(source) {
    const canonical = canonicalSource(source);
    const removed = acceptedSources.delete(canonical);
    const infoHashRemoved = sourceInfoHashes.delete(canonical);
    if (removed || infoHashRemoved) persistAcceptedSources();
}

function removeAcceptedSourcesForInfoHash(infoHash) {
    const normalized = normalizeInfoHash(infoHash);
    if (!normalized) return;
    let changed = false;
    for (const source of acceptedSources) {
        if (sourceInfoHash(source) !== normalized) continue;
        acceptedSources.delete(source);
        sourceInfoHashes.delete(source);
        changed = true;
    }
    if (changed) persistAcceptedSources();
}

function getPageState(infoHash) {
    let state = pageStateByInfoHash.get(infoHash);
    if (!state) {
        state = {
            selection: { fileIndex: null },
            previousDownloaded: undefined,
            stalledSamples: 0,
        };
        pageStateByInfoHash.set(infoHash, state);
    }
    return state;
}

function stateLabel(torrent) {
    if (torrent.state === "resolving") return "resolving";
    if (torrent.state === "failed") return "failed";
    if (torrent.state === "cancelled") return "cancelled";
    const pageState = torrent.infoHash ? pageStateByInfoHash.get(torrent.infoHash) : undefined;
    if (torrent.stats?.activeReaders > 0) {
        return pageState?.stalledSamples >= STALLED_SAMPLE_LIMIT ? "stalled" : "streaming";
    }
    return "metadata only";
}

function sourceLabel(source) {
    if (source.toLowerCase().startsWith("magnet:")) return "magnet link";
    return fileName(source.replaceAll("\\", "/"));
}

function isHttpTorrentSource(source) {
    if (typeof source !== "string") return false;
    try {
        const url = new URL(source);
        // This acceptance must stay a superset of browserUrlMasks, or a cancelled download disappears with no page or error.
        return (url.protocol === "http:" || url.protocol === "https:")
            && (/\.torrent$/i.test(url.pathname) || /\.torrent$/i.test(url.href));
    } catch {
        return false;
    }
}

async function readHttpTorrentSource(source) {
    try {
        const resource = await P.content.open(source);
        if (Number.isFinite(resource.size) && resource.size > MAX_TORRENT_FILE_BYTES) {
            throw new Error("torrent-source-too-large");
        }
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("torrent-source-fetch-failed");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_TORRENT_FILE_BYTES) throw new Error("torrent-source-too-large");
        return bytes;
    } catch (error) {
        const reason = error && typeof error === "object" && typeof error.message === "string"
            ? error.message
            : "";
        if (["torrent-source-fetch-failed", "torrent-source-too-large"].includes(reason)) {
            throw error;
        }
        throw new Error("torrent-source-fetch-failed");
    }
}

function buildFileLink(torrent, file) {
    const infoHash = normalizeInfoHash(torrent?.infoHash);
    if (!/^[0-9a-f]{40}$/.test(infoHash)) {
        throw new Error("torrent-link-invalid-infohash");
    }
    if (typeof torrent?.magnet !== "string" || torrent.magnet.length === 0) {
        throw new Error("torrent-magnet-required");
    }
    let magnet;
    try {
        magnet = new URL(torrent.magnet);
    } catch {
        throw new Error("torrent-link-magnet-mismatch");
    }
    const magnetHashes = magnet.searchParams.getAll("xt")
        .map((value) => value.match(/^urn:btih:([0-9a-f]{40})$/i)?.[1]?.toLowerCase())
        .filter(Boolean);
    if (magnet.protocol !== "magnet:" || magnetHashes.length === 0 || !magnetHashes.includes(infoHash)) {
        throw new Error("torrent-link-magnet-mismatch");
    }
    if (!file || typeof file.path !== "string") throw new Error("torrent-file-not-found");
    return `torrent://${infoHash}/${encodeURIComponent(file.path)}`
        + `?magnet=${encodeURIComponent(torrent.magnet)}`;
}

function hideContextMenu() {
    contextMenu.hidden = true;
    contextMenu.replaceChildren();
}

/** Mouse and arrow keys share one hovered row, as in Persephone's Menu. */
function setHoveredMenuItem(button) {
    for (const item of contextMenu.children) item.classList.toggle("hovered", item === button);
}

function moveMenuHover(step) {
    const items = [...contextMenu.children];
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.classList.contains("hovered"));
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    setHoveredMenuItem(items[next]);
}

function showContextMenu(x, y, items) {
    contextMenu.replaceChildren();
    for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        button.disabled = item.disabled === true;
        button.classList.toggle("start-group", item.startGroup === true);
        button.addEventListener("mouseenter", () => setHoveredMenuItem(button));
        button.addEventListener("mouseleave", () => setHoveredMenuItem(undefined));
        button.addEventListener("click", () => {
            hideContextMenu();
            void item.action();
        });
        contextMenu.append(button);
    }
    contextMenu.hidden = false;
    const width = contextMenu.offsetWidth;
    const height = contextMenu.offsetHeight;
    contextMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    contextMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
}

function compareTorrentRows(left, right) {
    const leftName = String(left.name ?? "");
    const rightName = String(right.name ?? "");
    return leftName.localeCompare(rightName) || left.rowKey.localeCompare(right.rowKey);
}

// Inline glyphs for the badges and the generic file icon. Constant markup, never user data.
const GLYPHS = {
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v10M3.5 8.5 8 13l4.5-4.5"/></svg>',
    peers: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5.5" cy="5" r="2.5"/><path d="M1 13.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5z"/><circle cx="11.5" cy="5.5" r="2"/><path d="M10.6 9.2c.3-.1.6-.2.9-.2 2 0 3.5 1.7 3.5 3.8v.7h-4c0-1.7-.2-3.2-.4-4.3z"/></svg>',
    file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>',
};

function glyphItem(glyph, text) {
    return `<span class="badge-item">${GLYPHS[glyph]}${escapeHtml(text)}</span>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function setIfChanged(element, property, value) {
    if (element[property] !== value) element[property] = value;
}

/** Keyed update: rows keep their DOM identity across the 1 s snapshot poll, so hover, a
 *  double-click in progress, and the open tooltip survive a refresh. */
function syncRows(list, items, keyOf, renderRow, emptyText) {
    if (items.length === 0) {
        const empty = list.firstElementChild;
        if (!empty?.classList.contains("empty-state") || list.children.length !== 1) {
            const item = document.createElement("li");
            item.className = "empty-state";
            list.replaceChildren(item);
        }
        setIfChanged(list.firstElementChild, "textContent", emptyText);
        return;
    }
    const existing = new Map();
    for (const child of [...list.children]) {
        if (child.dataset.key) existing.set(child.dataset.key, child);
        else child.remove();
    }
    items.forEach((item, index) => {
        const key = keyOf(item);
        let row = existing.get(key);
        existing.delete(key);
        if (!row) {
            row = document.createElement("li");
            row.className = "row";
            row.dataset.key = key;
            row.setAttribute("role", "option");
            row.innerHTML = '<span class="row-icon"></span><span class="row-label"></span><span class="badge"></span>';
        }
        renderRow(row, item);
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    });
    for (const row of existing.values()) row.remove();
}

function sortedTorrents() {
    return [...serviceTorrents.values()].sort(compareTorrentRows);
}

function torrentLabel(torrent) {
    return torrent.name
        || (torrent.state === "resolving" ? "Resolving torrent" : `Resolution ${torrent.state}`);
}

function torrentBadge(torrent) {
    if (torrent.state === "resolving") return { html: "resolving…", tone: "" };
    if (torrent.state === "failed") return { html: "failed", tone: "failed" };
    const stats = torrent.stats ?? {};
    const state = stateLabel(torrent);
    return {
        html: glyphItem("down", formatRate(stats.downloadSpeed)) + glyphItem("peers", String(stats.peers ?? 0)),
        tone: state === "streaming" || state === "stalled" ? state : "",
    };
}

function renderTorrentRow(row, torrent) {
    const selected = torrent.rowKey === selectedInfoHash;
    row.classList.toggle("selected", selected);
    row.classList.toggle("failed", torrent.state === "failed");
    row.setAttribute("aria-selected", String(selected));
    const [icon, label, badge] = row.children;
    if (!icon.firstChild) icon.innerHTML = '<img src="./icon.svg" alt="" />';
    setIfChanged(label, "textContent", torrentLabel(torrent));
    const { html, tone } = torrentBadge(torrent);
    setIfChanged(badge, "innerHTML", html);
    badge.classList.toggle("streaming", tone === "streaming");
    badge.classList.toggle("stalled", tone === "stalled");
    badge.classList.toggle("failed", tone === "failed");
}

function renderTorrentList() {
    const torrents = sortedTorrents();
    torrentCount.textContent = String(torrents.length);
    removeAllButton.disabled = removeAllInFlight || torrents.length === 0;
    syncRows(torrentList, torrents, (torrent) => torrent.rowKey, renderTorrentRow, "No active torrents.");
}

function selectedTorrentRow() {
    return selectedInfoHash ? serviceTorrents.get(selectedInfoHash) : undefined;
}

function sortedFiles(torrent) {
    return torrent?.state === "ready"
        ? [...torrent.files].sort((left, right) => {
            const bySize = right.length - left.length;
            return bySize || String(left.path).localeCompare(String(right.path)) || left.index - right.index;
        })
        : [];
}

/** Verified bytes of one file, or 0 while nothing has been read from the torrent. */
function fileDownloaded(torrent, file) {
    const bytes = torrent.stats?.fileProgress?.[file.index];
    return Number.isFinite(bytes) ? Math.min(bytes, file.length) : 0;
}

function percent(part, whole) {
    if (!(whole > 0)) return 0;
    const value = (part / whole) * 100;
    return value >= 99.95 ? 100 : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

function renderFileRow(row, { torrent, file }) {
    const selected = getPageState(torrent.infoHash).selection.fileIndex === file.index;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
    row.title = file.path;
    const [icon, label, badge] = row.children;
    renderFileIcon(icon, fileName(file.path));
    setIfChanged(label, "textContent", fileName(file.path));
    const downloaded = fileDownloaded(torrent, file);
    const size = escapeHtml(formatBytes(file.length));
    setIfChanged(badge, "innerHTML", downloaded > 0 ? `${percent(downloaded, file.length)}% · ${size}` : size);
}

/** Persephone's icon for the name once known, the generic file glyph until then. */
function renderFileIcon(icon, name) {
    const url = fileIcons.get(name);
    if (!url) {
        if (!icon.firstChild || icon.firstChild.nodeName === "IMG") icon.innerHTML = GLYPHS.file;
        return;
    }
    if (icon.firstChild?.nodeName === "IMG" && icon.firstChild.getAttribute("src") === url) return;
    const image = document.createElement("img");
    image.alt = "";
    image.src = url;
    icon.replaceChildren(image);
}

/** Ask Persephone once for the icons of names not seen yet; the list re-renders when they land. */
function requestFileIcons(files) {
    const names = [...new Set(files.map((file) => fileName(file.path)))]
        .filter((name) => !fileIcons.has(name) && !fileIconRequests.has(name));
    if (!names.length) return;
    for (const name of names) fileIconRequests.add(name);
    P.icons.forFiles(names).then((icons) => {
        for (const [name, url] of Object.entries(icons)) fileIcons.set(name, url);
        if (!tearingDown) renderFileList();
    }).catch(() => {
        // Keep the generic glyph; the icons are decoration.
    }).finally(() => {
        for (const name of names) fileIconRequests.delete(name);
    });
}

function renderFileList() {
    const torrent = selectedTorrentRow();
    selectedTorrent.textContent = torrent ? torrentLabel(torrent) : "-";
    const files = sortedFiles(torrent);
    requestFileIcons(files);
    fileCount.textContent = String(files.length);
    let emptyText = "The torrent has no files.";
    if (!torrent) emptyText = "Select a torrent to see its files.";
    else if (torrent.state !== "ready") emptyText = torrent.message || "Metadata is still resolving.";
    syncRows(
        fileList,
        files.map((file) => ({ torrent, file })),
        ({ file }) => String(file.index),
        renderFileRow,
        emptyText,
    );
}

// ── Row interaction (delegated: rows are reused, so listeners live on the lists) ──────────

function torrentMenuItems(torrent) {
    if (torrent.state === "ready" && torrent.infoHash
        && (!torrent.requestId || activeResolutions.has(torrent.requestId))) {
        return [
            { label: "Copy magnet link", action: () => copyText(torrent.magnet, "Magnet link copied."), disabled: !torrent.magnet },
            { label: "Copy info hash", action: () => copyText(torrent.infoHash, "Info hash copied.") },
            { label: "Save .torrent…", action: () => saveTorrentFile(torrent) },
            { label: "Remove", action: () => removeTorrent(torrent), startGroup: true },
        ];
    }
    if (torrent.requestId && activeResolutions.has(torrent.requestId)) {
        return [{
            label: "Cancel",
            action: () => {
                const job = activeResolutions.get(torrent.requestId);
                return job ? cancelByUser(job, torrent.rowKey) : undefined;
            },
        }];
    }
    if (torrent.state === "failed" && torrent.requestId) {
        const items = [];
        const source = failedSourceOf(torrent);
        if (source) items.push({ label: "Retry", action: () => retryFailed(torrent, source) });
        items.push({ label: "Remove", action: () => dismissFailed(torrent) });
        return items;
    }
    return [];
}

function fileMenuItems(torrent, file) {
    return [
        { label: "Open", action: () => openFile(torrent, file) },
        { label: "Copy link", action: () => copyFileLink(torrent, file) },
        { label: "Download this file", action: () => downloadFile(torrent, file) },
    ];
}

function rowKeyOf(event) {
    return event.target.closest?.(".row")?.dataset.key;
}

function selectTorrent(rowKey) {
    if (!rowKey || rowKey === selectedInfoHash) return;
    selectedInfoHash = rowKey;
    renderAll();
}

function fileForKey(torrent, key) {
    return torrent?.state === "ready" ? torrent.files.find((file) => String(file.index) === key) : undefined;
}

function selectFile(torrent, file) {
    if (!torrent?.infoHash || !file) return;
    getPageState(torrent.infoHash).selection.fileIndex = file.index;
    renderFileList();
}

/** Arrow/Home/End over a list's current order; returns the new key or undefined. */
function steppedKey(list, currentKey, key) {
    const keys = [...list.children].map((row) => row.dataset.key).filter(Boolean);
    if (keys.length === 0) return undefined;
    const index = keys.indexOf(currentKey);
    if (key === "Home") return keys[0];
    if (key === "End") return keys[keys.length - 1];
    if (key === "ArrowDown") return keys[Math.min(keys.length - 1, index + 1)];
    if (key === "ArrowUp") return keys[index <= 0 ? 0 : index - 1];
    return undefined;
}

function revealRow(list, key) {
    list.querySelector(`.row[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
}

torrentList.addEventListener("click", (event) => selectTorrent(rowKeyOf(event)));
torrentList.addEventListener("contextmenu", (event) => {
    const torrent = serviceTorrents.get(rowKeyOf(event));
    if (!torrent) return;
    event.preventDefault();
    event.stopPropagation();
    selectTorrent(torrent.rowKey);
    const items = torrentMenuItems(torrent);
    if (items.length > 0) showContextMenu(event.clientX, event.clientY, items);
    else hideContextMenu();
});
torrentList.addEventListener("keydown", (event) => {
    const next = steppedKey(torrentList, selectedInfoHash, event.key);
    if (next === undefined) return;
    event.preventDefault();
    selectTorrent(next);
    revealRow(torrentList, next);
});

fileList.addEventListener("click", (event) => {
    const torrent = selectedTorrentRow();
    selectFile(torrent, fileForKey(torrent, rowKeyOf(event)));
});
fileList.addEventListener("dblclick", (event) => {
    const torrent = selectedTorrentRow();
    const file = fileForKey(torrent, rowKeyOf(event));
    if (file) void openFile(torrent, file);
});
fileList.addEventListener("contextmenu", (event) => {
    const torrent = selectedTorrentRow();
    const file = fileForKey(torrent, rowKeyOf(event));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    selectFile(torrent, file);
    showContextMenu(event.clientX, event.clientY, fileMenuItems(torrent, file));
});
fileList.addEventListener("keydown", (event) => {
    const torrent = selectedTorrentRow();
    if (!torrent?.infoHash) return;
    const currentKey = String(getPageState(torrent.infoHash).selection.fileIndex ?? "");
    if (event.key === "Enter") {
        const file = fileForKey(torrent, currentKey);
        if (file) void openFile(torrent, file);
        return;
    }
    const next = steppedKey(fileList, currentKey, event.key);
    if (next === undefined) return;
    event.preventDefault();
    selectFile(torrent, fileForKey(torrent, next));
    revealRow(fileList, next);
});

// ── Badge tooltip ─────────────────────────────────────────────────────────────────────────

const tooltip = document.getElementById("tooltip");
let tooltipTarget;

function tooltipRows(pairs) {
    return `<dl class="tooltip-grid">${pairs
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`)
        .join("")}</dl>`;
}

function torrentTooltip(torrent) {
    const title = `<div class="tooltip-title">${escapeHtml(torrentLabel(torrent))}</div>`;
    if (torrent.state === "failed") return title + tooltipRows([["Error", torrent.message]]);
    if (torrent.state !== "ready") {
        const job = torrent.requestId ? activeResolutions.get(torrent.requestId) : undefined;
        return title + tooltipRows([
            ["State", "resolving metadata"],
            ["Source", job ? sourceLabel(job.source) : undefined],
            ["Peers", torrent.stats ? String(torrent.stats.peers ?? 0) : undefined],
        ]);
    }
    const stats = torrent.stats ?? {};
    const size = stats.length > 0 ? stats.length : torrent.files.reduce((sum, file) => sum + file.length, 0);
    const verified = Math.min(size, Math.round((stats.progress ?? 0) * size));
    return title + tooltipRows([
        ["State", stateLabel(torrent)],
        ["Download speed", formatRate(stats.downloadSpeed)],
        ["Upload speed", formatRate(stats.uploadSpeed)],
        ["Peers", String(stats.peers ?? 0)],
        ["Size", formatBytes(size)],
        ["Downloaded", `${formatBytes(verified)} (${percent(verified, size)}%)`],
        ["Remaining", formatBytes(size - verified)],
        ["Received", formatBytes(stats.downloaded)],
        ["Uploaded", formatBytes(stats.uploaded)],
        ["Files", String(torrent.files.length)],
        ["Info hash", torrent.infoHash],
    ]);
}

function fileTooltip(torrent, file) {
    const downloaded = fileDownloaded(torrent, file);
    return `<div class="tooltip-title">${escapeHtml(file.path)}</div>` + tooltipRows([
        ["Size", formatBytes(file.length)],
        ["Downloaded", `${formatBytes(downloaded)} (${percent(downloaded, file.length)}%)`],
        ["Remaining", formatBytes(file.length - downloaded)],
    ]);
}

function hideTooltip() {
    tooltipTarget = undefined;
    tooltip.hidden = true;
}

/** Re-render the open tooltip from current data; called on hover and after every render. */
function refreshTooltip() {
    if (!tooltipTarget) return;
    const { list, key } = tooltipTarget;
    const badge = list.querySelector(`.row[data-key="${CSS.escape(key)}"] .badge`);
    let html;
    if (badge && list === torrentList) {
        const torrent = serviceTorrents.get(key);
        if (torrent) html = torrentTooltip(torrent);
    } else if (badge) {
        const torrent = selectedTorrentRow();
        const file = fileForKey(torrent, key);
        if (file) html = fileTooltip(torrent, file);
    }
    if (!html) {
        hideTooltip();
        return;
    }
    setIfChanged(tooltip, "innerHTML", html);
    tooltip.hidden = false;
    // Measure at the origin: at its old position the box would be squeezed by the viewport edge.
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const anchor = badge.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const below = anchor.bottom + 4;
    const top = below + height <= window.innerHeight - 4 ? below : Math.max(4, anchor.top - height - 4);
    tooltip.style.left = `${Math.max(4, Math.min(anchor.right - width, window.innerWidth - width - 4))}px`;
    tooltip.style.top = `${top}px`;
}

for (const list of [torrentList, fileList]) {
    list.addEventListener("mouseover", (event) => {
        const badge = event.target.closest?.(".badge");
        const key = badge?.closest(".row")?.dataset.key;
        if (!key) return;
        tooltipTarget = { list, key };
        refreshTooltip();
    });
    list.addEventListener("mouseout", (event) => {
        if (!event.target.closest?.(".badge")) return;
        if (event.relatedTarget?.closest?.(".badge") === event.target.closest(".badge")) return;
        hideTooltip();
    });
    list.addEventListener("scroll", hideTooltip);
}

// ── Splitter ──────────────────────────────────────────────────────────────────────────────

const workspace = document.querySelector(".workspace");
const splitter = document.getElementById("splitter");
const TORRENTS_WIDTH_KEY = "torrent-viewer.torrentsWidth";
const MIN_TORRENTS_WIDTH = 160;
const MIN_FILES_WIDTH = 200;

function applyTorrentsWidth(width) {
    const max = Math.max(MIN_TORRENTS_WIDTH, workspace.clientWidth - MIN_FILES_WIDTH);
    const clamped = Math.round(Math.min(max, Math.max(MIN_TORRENTS_WIDTH, width)));
    workspace.style.setProperty("--torrents-width", `${clamped}px`);
    return clamped;
}

try {
    const saved = Number(localStorage.getItem(TORRENTS_WIDTH_KEY));
    if (saved > 0) applyTorrentsWidth(saved);
} catch {
    // Storage can be unavailable; the default width applies.
}

splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("dragging");
    hideTooltip();
    const origin = workspace.getBoundingClientRect().left;
    let width;
    const onMove = (moveEvent) => {
        width = applyTorrentsWidth(moveEvent.clientX - origin);
    };
    const onUp = () => {
        splitter.classList.remove("dragging");
        splitter.removeEventListener("pointermove", onMove);
        splitter.removeEventListener("pointerup", onUp);
        splitter.removeEventListener("pointercancel", onUp);
        if (width === undefined) return;
        try {
            localStorage.setItem(TORRENTS_WIDTH_KEY, String(width));
        } catch {
            // Not persisted; the width still applies for this page.
        }
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
});

function renderAll() {
    renderTorrentList();
    renderFileList();
    refreshTooltip();
}

async function cancelResolution(job) {
    job.cancelled = true;
    if (!job.requestId) return;
    try {
        await P.service.request({ op: "cancel", requestId: job.requestId });
    } catch {
        // Teardown and an already-expired result are both safe to ignore.
    }
}

/** The user cancelled a resolve from its row: the row and its saved source go at once. */
async function cancelByUser(job, rowKey) {
    forgetAcceptedSource(job.source);
    // Cancel first: the service drops the job at once, so the next snapshot cannot bring the row back.
    await cancelResolution(job);
    serviceTorrents.delete(rowKey);
    renderAll();
    setStatus("Resolution cancelled.");
}

/** A failed row's source: this page's own record first, else the one the service reported, which
 *  also covers an attempt started by an earlier instance of the page (before a Reload board). */
function failedSourceOf(row) {
    return failedSources.get(row.requestId) ?? row.source ?? undefined;
}

/** Drop a failed row now instead of when the service's result expires. */
async function dismissFailed(row, { keepSource = false } = {}) {
    const { requestId } = row;
    const source = failedSourceOf(row);
    failedSources.delete(requestId);
    if (!keepSource) {
        if (source) forgetAcceptedSource(source);
        // An equivalent magnet (other trackers or name) for the same torrent goes too.
        if (row.failedInfoHash) removeAcceptedSourcesForInfoHash(row.failedInfoHash);
    }
    try {
        await P.service.request({ op: "dismiss", requestId });
    } catch {
        // The result expires on its own.
    }
    serviceTorrents.delete(`request:${requestId}`);
    renderAll();
    if (!keepSource) setStatus("Removed.");
}

async function retryFailed(row, source) {
    await dismissFailed(row, { keepSource: true });
    await resolveSource(source);
}

async function waitForResolution(job) {
    while (!tearingDown && !job.cancelled) {
        const result = await P.service.request({ op: "status", requestId: job.requestId });
        if (result.state === "resolving") {
            await waitFor(STATUS_INTERVAL_MS);
            continue;
        }
        if (result.state === "completed") return result.torrent;
        throw new Error(rawMessageFrom(result.error, `Resolution ${result.state}.`));
    }
    throw new Error("Torrent resolution cancelled.");
}

async function resolveSource(rawSource) {
    const rawCanonical = canonicalSource(rawSource);
    const rememberedInfoHash = sourceInfoHash(rawCanonical);
    const source = rememberAcceptedSource(rawCanonical);
    if (!source || tearingDown) return;
    const infoHash = rememberedInfoHash || sourceInfoHash(source);
    if (hasActiveResolution(infoHash, source)) {
        renderAll();
        return;
    }
    if (hasKnownTorrent(infoHash)) {
        if (infoHash && serviceTorrents.has(infoHash)) selectedInfoHash = infoHash;
        if (isHttpTorrentSource(source) && infoHash) {
            const row = serviceTorrents.get(infoHash);
            if (row?.state === "ready") replaceHttpSourceWithMagnet(source, row.magnet, infoHash);
        }
        renderAll();
        return;
    }
    const pendingKey = infoHash ? `hash:${infoHash}` : `source:${source}`;
    if (pendingResolveKeys.has(pendingKey)) return;
    pendingResolveKeys.add(pendingKey);
    try {
        await resolveSourceInternal(source);
    } finally {
        pendingResolveKeys.delete(pendingKey);
    }
}

async function resolveSourceInternal(source) {
    setStatus("Resolving metadata…");
    const job = { source, requestId: undefined, cancelled: false };
    try {
        const resolverInput = isHttpTorrentSource(source)
            ? await readHttpTorrentSource(source)
            : source;
        const started = await P.service.request({ op: "resolve", magnetOrTorrentId: resolverInput });
        job.requestId = started.requestId;
        job.infoHash = normalizeInfoHash(started.infoHash) || undefined;
        activeResolutions.set(job.requestId, job);
        scheduleServiceStatusPoll(0);
        const torrent = await waitForResolution(job);
        if (tearingDown) return;
        const infoHash = normalizeInfoHash(torrent?.infoHash);
        if (!/^[0-9a-f]{40}$/.test(infoHash) || !Array.isArray(torrent.files)) {
            throw new Error("Torrent metadata is incomplete.");
        }
        selectedInfoHash = infoHash;
        await refreshServiceStatus();
        if (serviceState === "running") {
            while (snapshotInFlight && !tearingDown) await waitFor(25);
            await pollSnapshot();
        }
        const resolvedRow = serviceTorrents.get(infoHash);
        if (isHttpTorrentSource(source)) {
            if (resolvedRow?.state !== "ready"
                || !replaceHttpSourceWithMagnet(source, resolvedRow.magnet, infoHash)) {
                throw new Error("The torrent service did not return a canonical magnet.");
            }
        } else {
            sourceInfoHashes.set(source, infoHash);
            // A .torrent path for a torrent already saved (by its magnet, say) adds nothing to restore.
            const alreadySaved = [...acceptedSources].some((other) => other !== source
                && (sourceInfoHashes.get(other) || sourceInfoHash(other)) === infoHash);
            if (alreadySaved) forgetAcceptedSource(source);
            else persistAcceptedSources();
        }
        renderAll();
        setStatus(`${torrent.name ?? infoHash} / ${torrent.files.length} files / metadata only`);
    } catch (error) {
        if (!tearingDown && !job.cancelled) {
            const message = messageFrom(error);
            const { requestId } = job;
            if (requestId) failedSources.set(requestId, source);
            setStatusWithAction(message, true, "Retry", () => (requestId
                ? retryFailed({ requestId }, source)
                : resolveSource(source)));
            // No toast: the status bar carries the message and the row's "failed" badge marks it.
        }
    } finally {
        if (job.requestId) activeResolutions.delete(job.requestId);
    }
}

/** A bare BitTorrent v1 info hash typed or pasted into the add field: 40 hex characters, or the
 *  32-character base32 form some sites show. Returns the magnet link built from it, or "" when the
 *  text is not an info hash. The magnet carries no trackers, so peers are found through DHT. */
function magnetFromInfoHash(text) {
    const value = text.replace(/^urn:btih:/i, "");
    if (/^[0-9a-f]{40}$/i.test(value)) return `magnet:?xt=urn:btih:${value.toLowerCase()}`;
    if (/^[a-z2-7]{32}$/i.test(value)) return `magnet:?xt=urn:btih:${value.toUpperCase()}`;
    return "";
}

async function addMagnetFromInput() {
    const input = sourceInput.value.trim();
    if (!input) {
        setStatus("Enter a magnet link, an info hash, or choose a .torrent file.", true);
        return;
    }
    const source = magnetFromInfoHash(input) || input;
    // Cleared so the next paste does not append to this source.
    sourceInput.value = "";
    await resolveSource(source);
}

async function chooseTorrent() {
    try {
        const paths = await P.openFileDialog({
            title: "Choose a torrent file",
            filters: [{ name: "Torrent files", extensions: ["torrent"] }],
            multiSelections: false,
        });
        if (paths?.[0]) await resolveSource(paths[0]);
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

function openFile(torrent, file) {
    try {
        const link = buildFileLink(torrent, file);
        getPageState(torrent.infoHash).selection.fileIndex = file.index;
        P.openRawLink(link);
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

async function copyText(text, doneMessage) {
    if (!text) return;
    try {
        await P.clipboard.writeText(text);
        if (!tearingDown) setStatus(doneMessage);
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** A file name from the torrent name: Windows-reserved characters become "_". */
function torrentFileName(torrent) {
    const base = String(torrent.name || torrent.infoHash).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
    return `${base || torrent.infoHash}.torrent`;
}

async function saveTorrentFile(torrent) {
    try {
        const savePath = await P.saveFileDialog({
            title: "Save .torrent",
            defaultPath: torrentFileName(torrent),
            filters: [{ name: "Torrent files", extensions: ["torrent"] }],
        });
        if (!savePath || tearingDown) return;
        const result = await P.service.request({ op: "torrentFile", infoHash: torrent.infoHash });
        await P.writeFile(savePath, base64ToBytes(result.base64), { encoding: "binary" });
        if (!tearingDown) setStatus(`Saved ${fileName(savePath.replaceAll("\\", "/"))}.`);
    } catch (error) {
        if (!tearingDown) {
            setStatus(messageFrom(error, "Could not save the .torrent file."), true);
            P.notify(messageFrom(error, "Could not save the .torrent file."), "error");
        }
    }
}

async function copyFileLink(torrent, file) {
    try {
        await P.clipboard.writeText(buildFileLink(torrent, file));
        if (!tearingDown) setStatus("Torrent link copied.");
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

/** A source this board can resolve: a magnet URI, one of its own `torrent://` links, a local
 *  `.torrent` path, or an HTTP(S) `.torrent` URL. Anything else is ignored rather than reported. */
/** A .torrent file on disk: it resolves from the file with no network, so it gets no placeholder row. */
function isLocalTorrentPath(source) {
    if (typeof source !== "string") return false;
    const value = source.trim();
    return /\.torrent$/i.test(value) && !value.startsWith("magnet:") && !value.startsWith("torrent://")
        && !isHttpTorrentSource(value);
}

function isTorrentSource(source) {
    if (typeof source !== "string" || source.length === 0) return false;
    const value = source.trim();
    if (isHttpTorrentSource(value)) return true;
    return value.startsWith("magnet:")
        || value.startsWith("torrent://")
        || /\.torrent$/i.test(value);
}

function serviceInstance(status) {
    if (status?.state !== "running") return undefined;
    return [status.pid ?? "", status.startedAt ?? "", status.restartCount ?? ""].join(":");
}

function updateServiceInstance(status) {
    const nextInstance = serviceInstance(status);
    const changed = Boolean(serviceInstanceKey && nextInstance && serviceInstanceKey !== nextInstance);
    if (!nextInstance) {
        if (serviceInstanceKey) serviceRestoreNeeded = true;
        serviceResetPending = true;
    } else if (serviceInstanceKey && serviceInstanceKey !== nextInstance) {
        serviceResetPending = true;
        serviceRestoreNeeded = true;
    }
    serviceInstanceKey = nextInstance;
    return changed;
}

function hasActiveResolution(infoHash, source) {
    const normalized = normalizeInfoHash(infoHash);
    return [...activeResolutions.values()].some((job) =>
        job.source === source || (normalized && normalizeInfoHash(job.infoHash) === normalized));
}

function hasKnownTorrent(infoHash) {
    const normalized = normalizeInfoHash(infoHash);
    if (!normalized) return false;
    if (serviceTorrents.has(normalized)) return true;
    return hasActiveResolution(normalized);
}

async function downloadFile(torrent, file) {
    if (file.length > MAX_DOWNLOAD_BYTES) {
        const message = "This file is too large to save through the board bridge, which has no streaming write.";
        setStatus(message, true);
        P.notify(message, "warning");
        return;
    }

    try {
        const savePath = await P.saveFileDialog({
            title: "Save torrent file",
            defaultPath: fileName(file.path),
        });
        if (!savePath || tearingDown) return;

        setStatus(`Reading ${fileName(file.path)}…`);
        const resource = await P.content.open(buildFileLink(torrent, file));
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error(`Torrent file read failed (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        await P.writeFile(savePath, bytes, { encoding: "binary" });
        if (!tearingDown) setStatus(`Saved ${fileName(file.path)}.`);
    } catch (error) {
        if (!tearingDown) {
            setStatus(messageFrom(error, "Could not save the torrent file."), true);
            P.notify(messageFrom(error, "Could not save the torrent file."), "error");
        }
    }
}

function normalizedFiles(files) {
    if (!Array.isArray(files)) return [];
    return files
        .filter((file) => file && typeof file.path === "string")
        .map((file) => ({
            path: file.path,
            length: Number.isSafeInteger(file.length) && file.length >= 0 ? file.length : 0,
            index: Number.isSafeInteger(file.index) && file.index >= 0 ? file.index : 0,
        }));
}

function readyRow(metadata, stats) {
    const infoHash = normalizeInfoHash(metadata?.infoHash);
    if (!/^[0-9a-f]{40}$/.test(infoHash)) return undefined;
    return {
        rowKey: infoHash,
        infoHash,
        name: typeof metadata.name === "string" ? metadata.name : null,
        magnet: typeof metadata.magnet === "string" ? metadata.magnet : null,
        files: normalizedFiles(metadata.files),
        ready: true,
        state: "ready",
        stats,
    };
}

function clearServiceModel() {
    serviceTorrents.clear();
    pageStateByInfoHash.clear();
    selectedInfoHash = undefined;
    renderAll();
}

function reconcileSnapshot(snapshot) {
    const next = new Map();
    const snapshotTorrents = Array.isArray(snapshot?.torrents) ? snapshot.torrents : [];
    for (const torrent of snapshotTorrents) {
        const infoHash = normalizeInfoHash(torrent?.infoHash);
        if (!/^[0-9a-f]{40}$/.test(infoHash)) continue;
        const row = torrent.ready === true
            ? readyRow({ ...torrent, infoHash }, torrent)
            : {
                rowKey: infoHash,
                infoHash,
                name: typeof torrent.name === "string" ? torrent.name : null,
                magnet: null,
                files: [],
                ready: false,
                state: "resolving",
                stats: torrent,
            };
        if (row) next.set(row.rowKey, row);
    }

    const activeJobs = Array.isArray(snapshot?.activeResolutionJobs)
        ? snapshot.activeResolutionJobs
        : [];
    for (const job of activeJobs) {
        if (typeof job?.requestId !== "string") continue;
        const infoHash = normalizeInfoHash(job.infoHash);
        const jobSource = typeof job.source === "string" ? job.source : activeResolutions.get(job.requestId)?.source;
        // A local .torrent parses in well under a second: a "Resolving" row would only flash.
        if (!infoHash && isLocalTorrentPath(jobSource)) continue;
        const rowKey = infoHash && next.has(infoHash) ? infoHash : infoHash || `request:${job.requestId}`;
        let row = next.get(rowKey);
        if (!row) {
            row = {
                rowKey,
                infoHash: infoHash || undefined,
                name: null,
                magnet: null,
                files: [],
                ready: false,
                state: "resolving",
                stats: undefined,
            };
            next.set(rowKey, row);
        }
        if (row.state !== "ready") row.state = "resolving";
        row.requestId = job.requestId;
    }

    const completedMetadata = Array.isArray(snapshot?.completedMetadata)
        ? snapshot.completedMetadata
        : [];
    // One failed row per torrent (or per source, for a path that failed before its info hash was
    // known), and none while another attempt at it is still running: a board reload mid-resolve
    // leaves the old page's attempt to fail beside the new page's attempt.
    const failedKeys = new Set();
    for (const result of [...completedMetadata].reverse()) {
        if (typeof result?.requestId !== "string") continue;
        if (result.state === "completed") {
            const row = readyRow(result.torrent);
            if (row && !next.has(row.rowKey)) next.set(row.rowKey, row);
            continue;
        }
        // A cancelled outcome is not shown: the user cancelled it, or a Remove did.
        if (result.state === "cancelled") continue;
        const failedInfoHash = normalizeInfoHash(result.infoHash);
        const failedSource = typeof result.source === "string" ? result.source : null;
        if (failedInfoHash && next.has(failedInfoHash)) continue;
        const failedKey = failedInfoHash ?? (failedSource ? `source:${canonicalSource(failedSource)}` : null);
        if (failedKey) {
            if (failedKeys.has(failedKey)) continue;
            failedKeys.add(failedKey);
        }
        const state = "failed";
        next.set(`request:${result.requestId}`, {
            rowKey: `request:${result.requestId}`,
            requestId: result.requestId,
            infoHash: undefined,
            failedInfoHash,
            source: failedSource,
            name: null,
            magnet: null,
            files: [],
            ready: false,
            state,
            stats: undefined,
            message: messageFrom(result.error, `Resolution ${result.state}.`),
        });
    }

    const readyHashes = new Set();
    for (const row of next.values()) {
        if (row.state !== "ready" || !row.infoHash) continue;
        readyHashes.add(row.infoHash);
        const pageState = getPageState(row.infoHash);
        const stats = row.stats;
        if (stats?.activeReaders > 0) {
            const downloadedDelta = pageState.previousDownloaded === undefined
                ? 0
                : stats.downloaded - pageState.previousDownloaded;
            if (downloadedDelta <= 0 && stats.downloadSpeed <= 0) pageState.stalledSamples += 1;
            else pageState.stalledSamples = 0;
        } else {
            pageState.stalledSamples = 0;
        }
        if (stats && Number.isFinite(stats.downloaded)) pageState.previousDownloaded = stats.downloaded;
    }
    for (const infoHash of pageStateByInfoHash.keys()) {
        if (!readyHashes.has(infoHash)) pageStateByInfoHash.delete(infoHash);
    }

    // Only a torrent that was READY and then vanished was removed. A resolving row also carries the
    // magnet's infoHash, but a failed resolve drops it; counting resolving rows would silently forget
    // a source the page still shows as failed-with-Retry, and the next restart would lose it.
    const currentReadyInfoHashes = new Set(
        [...readyHashes].map((infoHash) => normalizeInfoHash(infoHash)).filter(Boolean),
    );
    if (!serviceResetPending) {
        for (const infoHash of observedSnapshotInfoHashes) {
            if (!currentReadyInfoHashes.has(infoHash)) removeAcceptedSourcesForInfoHash(infoHash);
        }
    }
    observedSnapshotInfoHashes = currentReadyInfoHashes;
    serviceResetPending = false;

    for (const requestId of failedSources.keys()) {
        if (!next.has(`request:${requestId}`)) failedSources.delete(requestId);
    }
    serviceTorrents.clear();
    for (const [rowKey, row] of next) serviceTorrents.set(rowKey, row);
    if (!selectedInfoHash || !serviceTorrents.has(selectedInfoHash)) {
        selectedInfoHash = [...serviceTorrents.values()]
            .filter((row) => row.state === "ready")
            .sort(compareTorrentRows)[0]?.rowKey;
    }
}

function stopSnapshotPolling() {
    clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
}

function applyServiceStatus(status) {
    const instanceChanged = updateServiceInstance(status);
    const nextState = status?.state ?? "stopped";
    serviceState = nextState;
    if (instanceChanged) clearServiceModel();
    if (nextState !== "running") {
        stopSnapshotPolling();
        clearServiceModel();
    }
    if (nextState === "stopped") setStatus("No active torrents.");
    else if (nextState === "starting") setStatus("Torrent service starting...");
    else if (nextState === "stopping") setStatus("Torrent service stopping...");
    else if (nextState === "failed") {
        setStatusWithAction(
            status?.reason ? `Torrent service unavailable: ${status.reason}` : "Torrent service unavailable.",
            true,
            "Add torrent",
            () => sourceInput.focus(),
        );
    } else if (nextState === "running" && !snapshotInFlight && !snapshotTimer) {
        void pollSnapshot();
    }
    if (nextState === "running" && serviceRestoreNeeded && acceptedSourcesLoaded) {
        serviceRestoreNeeded = false;
        restoreSourcesAfterServiceReset();
    }
}

function scheduleServiceStatusPoll(delay = STATUS_INTERVAL_MS) {
    clearTimeout(statusTimer);
    if (tearingDown) return;
    statusTimer = setTimeout(() => {
        statusTimer = undefined;
        void pollServiceStatus();
    }, delay);
}

async function refreshServiceStatus() {
    const status = await P.service.status();
    if (!tearingDown) applyServiceStatus(status);
    return status;
}

async function pollServiceStatus() {
    if (tearingDown) return;
    try {
        await refreshServiceStatus();
        if (serviceState === "starting" || serviceState === "stopping") scheduleServiceStatusPoll();
    } catch (error) {
        if (!tearingDown) {
            serviceState = "failed";
            stopSnapshotPolling();
            clearServiceModel();
            setStatusWithAction(messageFrom(error), true, "Add torrent", () => sourceInput.focus());
        }
    }
}

async function removeTorrent(torrent) {
    if (!torrent?.infoHash) return;
    const pending = [...activeResolutions.values()].filter((job) => job.infoHash === torrent.infoHash);
    await Promise.all(pending.map((job) => cancelResolution(job)));
    try {
        const result = await P.service.request({ op: "remove", magnetOrTorrentId: torrent.infoHash });
        if (!result.removed) {
            setStatus(result.reason ? messageFrom(result.reason) : "No matching torrent is active.", true);
            return;
        }
        removeAcceptedSourcesForInfoHash(result.infoHash || torrent.infoHash);
        serviceTorrents.delete(torrent.rowKey);
        if (selectedInfoHash === torrent.rowKey) selectedInfoHash = undefined;
        renderAll();
        // The service is NOT stopped when the list empties: it holds the removal marks that make a
        // page still reading this torrent fail instead of adding it back, and a request would restart
        // a stopped service without them. The service drops its WebTorrent client once it is empty.
        setStatus("Torrent removed.");
        try {
            while (snapshotInFlight && !tearingDown) await waitFor(25);
            const snapshot = await P.service.request({ op: "snapshot" });
            reconcileSnapshot(snapshot);
            renderAll();
        } catch {
            // The next snapshot poll reconciles the list.
        }
    } catch (error) {
        setStatus(messageFrom(error), true);
    }
}

/** Header "Remove all": every row goes the way its own menu would take it — a ready torrent is
 *  removed from the service, a resolving one is cancelled, a failed one is dismissed. Rows are
 *  handled one at a time so each removal reconciles before the next. */
async function removeAllTorrents() {
    if (removeAllInFlight) return;
    removeAllInFlight = true;
    renderTorrentList();
    try {
        for (const torrent of sortedTorrents()) {
            if (tearingDown) return;
            if (torrent.state === "ready" && torrent.infoHash) {
                await removeTorrent(torrent);
            } else if (torrent.requestId && activeResolutions.has(torrent.requestId)) {
                await cancelByUser(activeResolutions.get(torrent.requestId), torrent.rowKey);
            } else if (torrent.state === "failed" && torrent.requestId) {
                await dismissFailed(torrent);
            }
        }
        if (!tearingDown) {
            const left = serviceTorrents.size;
            setStatus(left === 0 ? "All torrents removed." : "Some torrents could not be removed.", left !== 0);
        }
    } finally {
        removeAllInFlight = false;
        if (!tearingDown) renderTorrentList();
    }
}

async function pollSnapshot() {
    if (tearingDown || serviceState !== "running" || snapshotInFlight) return;
    snapshotInFlight = true;
    try {
        const status = await P.service.status();
        if (!status || status.state !== "running") {
            if (!tearingDown) applyServiceStatus(status);
            return;
        }
        const snapshot = await P.service.request({ op: "snapshot" });
        if (!tearingDown) {
            reconcileSnapshot(snapshot);
            renderAll();
        }
    } catch (error) {
        if (!tearingDown) {
            try {
                await refreshServiceStatus();
            } catch {
                // The request error below is the useful user-facing failure.
            }
            if (serviceState === "running") setStatus(messageFrom(error), true);
        }
    } finally {
        snapshotInFlight = false;
        if (!tearingDown && serviceState === "running") {
            snapshotTimer = setTimeout(() => void pollSnapshot(), SNAPSHOT_INTERVAL_MS);
        }
    }
}

async function bootstrapService() {
    if (tearingDown) return;
    // No status text here: the torrent list shows its own empty state, and a restore that finds
    // every saved torrent already listed would leave "No active torrents." beside them.
    await pollServiceStatus();
}

async function refreshSnapshotForRestore() {
    if (tearingDown) return;
    while (snapshotInFlight && !tearingDown) await waitFor(25);
    if (!tearingDown && serviceState === "running") await pollSnapshot();
}

async function resolveAcceptedSources(sources) {
    const restoredInfoHashes = new Set();
    for (const source of new Set(sources.map(canonicalSource))) {
        if (tearingDown || !source) return;
        const infoHash = sourceInfoHash(source);
        if (infoHash && restoredInfoHashes.has(infoHash)) continue;
        if (infoHash) restoredInfoHashes.add(infoHash);
        if (hasKnownTorrent(infoHash)) {
            if (infoHash && serviceTorrents.has(infoHash)) selectedInfoHash = infoHash;
            renderAll();
            continue;
        }
        await resolveSource(source);
        // A local .torrent path or an HTTP URL carries no info hash. Resolve it serially and
        // refresh the authoritative snapshot before considering the next source equivalent.
        if (!infoHash) await refreshSnapshotForRestore();
    }
}

function restoreSourcesAfterServiceReset() {
    if (!acceptedSourcesLoaded || sourceRestorePromise || tearingDown) return;
    sourceRestorePromise = resolveAcceptedSources([...acceptedSources]).finally(() => {
        sourceRestorePromise = undefined;
    });
}

async function loadOpenedSources() {
    try {
        // Know what the running service already holds before restoring, so a saved source for a
        // listed torrent is recognised instead of resolved again.
        await serviceBootstrap;
        await refreshSnapshotForRestore();
        const state = await P.state.get();
        const transientSources = restoreAcceptedSources(state);
        acceptedSourcesLoaded = true;

        const source = await P.getSourceUrl();
        // Only resolve a source this board can actually own. A plain open hands back the board's
        // own address, and a future caller could hand back anything at all; feeding that to the
        // resolver raises "Invalid torrent identifier" on a page the user simply opened.
        const initialSource = source && isTorrentSource(source) ? rememberAcceptedSource(source) : "";
        if (initialSource && P.source.initialSourcePrivateSession) notifyPrivateSession();
        const sources = [
            ...transientSources,
            ...(initialSource ? [initialSource] : []),
            ...acceptedSources,
        ];
        sourceRestorePromise = resolveAcceptedSources(sources).finally(() => {
            sourceRestorePromise = undefined;
        });
        await sourceRestorePromise;
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

function teardown() {
    if (tearingDown) return;
    tearingDown = true;
    unsubscribeSource?.();
    unsubscribeToolbar?.();
    unsubscribeTheme?.();
    clearTimers();
    for (const job of activeResolutions.values()) void cancelResolution(job);
    activeResolutions.clear();
}

document.getElementById("add-magnet").addEventListener("click", () => void addMagnetFromInput());
removeAllButton.addEventListener("click", () => void removeAllTorrents());
// "Open .torrent" lives on Persephone's page toolbar; a reloaded frame must declare it again.
P.toolbar.set([
    { id: "open-torrent", type: "button", title: "Open .torrent", icon: { name: "open-file" } },
]);
// Single-colour file icons are drawn in the theme's icon colour: fetch them again on a switch.
const unsubscribeTheme = P.onThemeChange(() => {
    if (!fileIcons.size) return;
    fileIcons.clear();
    renderFileList();
});
const unsubscribeToolbar = P.toolbar.onAction(({ id }) => {
    if (id === "open-torrent") void chooseTorrent();
});
sourceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void addMagnetFromInput();
});
document.addEventListener("click", (event) => {
    if (!contextMenu.contains(event.target)) hideContextMenu();
});
document.addEventListener("contextmenu", (event) => {
    if (!event.target.closest(".row, .context-menu")) hideContextMenu();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
    if (contextMenu.hidden) return;
    // While the menu is open it owns the arrows and Enter, not the list underneath.
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveMenuHover(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
        const hovered = contextMenu.querySelector("button.hovered");
        if (!hovered) return;
        event.preventDefault();
        event.stopPropagation();
        hovered.click();
    }
}, true);
window.addEventListener("resize", () => {
    hideContextMenu();
    hideTooltip();
    applyTorrentsWidth(workspace.style.getPropertyValue("--torrents-width")
        ? parseFloat(workspace.style.getPropertyValue("--torrents-width"))
        : torrentList.closest(".pane").offsetWidth);
});
window.addEventListener("pagehide", teardown, { once: true });
window.addEventListener("beforeunload", teardown, { once: true });

// Persephone (bridge 1.24.0+) reports that a claimed download came from a private browser
// session; the board, not the host, says what that means for a torrent. Older hosts show their
// own notice and leave the flag unset.
function notifyPrivateSession() {
    P.notify("The metadata was fetched privately, but the swarm connection is not anonymous.", "info");
}

unsubscribeSource = P.source.onOpen(({ url, sourceUrl, privateSession }) => {
    const source = url ?? sourceUrl;
    if (!isTorrentSource(source) || tearingDown) return;
    if (privateSession) notifyPrivateSession();
    void resolveSource(source);
});

renderAll();
const serviceBootstrap = bootstrapService();
void loadOpenedSources();
