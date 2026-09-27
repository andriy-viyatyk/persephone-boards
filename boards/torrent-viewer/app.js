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
    ["torrent-identifier-required", "Enter a magnet link or choose a .torrent file."],
    ["torrent-removal-active-readers", "This torrent is in use by an open page. Close that page, wait a few seconds, then remove it."],
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
let serviceStopped = false;
let serviceState = "stopped";
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

function fileIcon(path) {
    const extension = fileName(path).split(".").pop()?.toLowerCase() ?? "";
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico"].includes(extension)) return "▧";
    if (["mp4", "mkv", "webm", "mov", "avi", "wmv"].includes(extension)) return "▶";
    if (["mp3", "flac", "wav", "ogg", "m4a", "aac"].includes(extension)) return "♫";
    if (["zip", "7z", "rar", "tar", "gz", "bz2"].includes(extension)) return "◈";
    if (["js", "mjs", "ts", "tsx", "jsx", "json", "css", "html", "xml", "md", "txt", "srt"].includes(extension)) {
        return "≡";
    }
    return "·";
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

function persistAcceptedSources() {
    P.state.merge({ acceptedSources: [...acceptedSources] });
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
    for (const source of [...restored, ...runtimeSources]) {
        const canonical = canonicalSource(source);
        if (!canonical || !isTorrentSource(canonical)) continue;
        if (isHttpTorrentSource(canonical)) {
            transientSources.push(canonical);
            continue;
        }
        acceptedSources.add(canonical);
        const infoHash = normalizeInfoHash(runtimeInfoHashes.get(canonical)) || sourceInfoHash(canonical);
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

function showContextMenu(x, y, items) {
    contextMenu.replaceChildren();
    for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
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

function renderTorrentList() {
    torrentList.replaceChildren();
    const torrents = [...serviceTorrents.values()].sort(compareTorrentRows);
    torrentCount.textContent = String(torrents.length);

    if (torrents.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No active torrents.";
        torrentList.append(empty);
        return;
    }

    for (const torrent of torrents) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "torrent-row";
        button.classList.toggle("selected", torrent.rowKey === selectedInfoHash);
        button.setAttribute("aria-pressed", String(torrent.rowKey === selectedInfoHash));
        button.addEventListener("click", () => {
            selectedInfoHash = torrent.rowKey;
            renderAll();
        });

        const menuItems = [];
        if (torrent.state === "ready" && torrent.infoHash
            && (!torrent.requestId || activeResolutions.has(torrent.requestId))) {
            menuItems.push({ label: "Remove", action: () => removeTorrent(torrent) });
        } else if (torrent.requestId && activeResolutions.has(torrent.requestId)) {
            menuItems.push({
                label: "Cancel",
                action: () => {
                    const job = activeResolutions.get(torrent.requestId);
                    return job ? cancelResolution(job) : undefined;
                },
            });
        }
        if (menuItems.length > 0) {
            button.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                event.stopPropagation();
                showContextMenu(event.clientX, event.clientY, menuItems);
            });
        }

        const dot = document.createElement("span");
        const state = stateLabel(torrent);
        dot.className = "state-dot";
        dot.classList.toggle("streaming", state === "streaming");
        dot.classList.toggle("stalled", ["stalled", "failed", "cancelled"].includes(state));
        dot.title = state;
        dot.setAttribute("aria-label", state);

        const details = document.createElement("span");
        details.className = "torrent-details";
        const name = document.createElement("span");
        name.className = "torrent-name";
        name.textContent = torrent.name
            || (torrent.state === "resolving" ? "Resolving torrent" : `Resolution ${torrent.state}`);
        const meta = document.createElement("span");
        meta.className = "torrent-meta";
        if (torrent.state === "ready" && torrent.stats) {
            meta.textContent = `${torrent.stats.peers} peers / ${formatRate(torrent.stats.downloadSpeed)} / ${state}`;
        } else if (torrent.message) {
            meta.textContent = torrent.message;
        } else if (torrent.requestId && activeResolutions.has(torrent.requestId)) {
            meta.textContent = `Resolving / ${sourceLabel(activeResolutions.get(torrent.requestId).source)}`;
        } else {
            meta.textContent = "Resolving metadata";
        }
        details.append(name, meta);
        button.append(dot, details);
        item.append(button);
        torrentList.append(item);
    }
}

function renderFileList() {
    fileList.replaceChildren();
    const torrent = selectedInfoHash ? serviceTorrents.get(selectedInfoHash) : undefined;
    selectedTorrent.textContent = torrent?.name ?? "-";
    const files = torrent?.state === "ready"
        ? [...torrent.files].sort((left, right) => {
            const bySize = right.length - left.length;
            return bySize || String(left.path).localeCompare(String(right.path)) || left.index - right.index;
        })
        : [];
    fileCount.textContent = String(files.length);

    if (!torrent) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "Select a torrent to see its files.";
        fileList.append(empty);
        return;
    }
    if (torrent.state !== "ready") {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = torrent.message || "Metadata is still resolving.";
        fileList.append(empty);
        return;
    }
    if (files.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "The torrent has no files.";
        fileList.append(empty);
        return;
    }

    for (const file of files) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "file-row";
        row.title = file.path;
        row.addEventListener("dblclick", () => openFile(torrent, file));
        row.addEventListener("keydown", (event) => {
            if (event.key === "Enter") openFile(torrent, file);
        });
        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            showContextMenu(event.clientX, event.clientY, [
                { label: "Open", action: () => openFile(torrent, file) },
                { label: "Copy link", action: () => copyFileLink(torrent, file) },
                { label: "Download this file", action: () => downloadFile(torrent, file) },
            ]);
        });

        const icon = document.createElement("span");
        icon.className = "file-icon";
        icon.textContent = fileIcon(file.path);
        icon.setAttribute("aria-hidden", "true");
        const details = document.createElement("span");
        details.className = "file-details";
        const name = document.createElement("span");
        name.className = "file-name";
        name.textContent = fileName(file.path);
        details.append(name);
        const size = document.createElement("span");
        size.className = "file-size";
        size.textContent = formatBytes(file.length);
        const open = document.createElement("span");
        open.className = "file-open";
        open.textContent = ">";
        open.setAttribute("aria-hidden", "true");
        row.append(icon, details, size, open);
        fileList.append(row);
    }
}

function renderAll() {
    renderTorrentList();
    renderFileList();
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
    serviceStopped = false;
    sourceInput.value = source;
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
        }
        renderAll();
        setStatus(`${torrent.name ?? infoHash} / ${torrent.files.length} files / metadata only`);
    } catch (error) {
        if (!tearingDown && !job.cancelled) {
            const message = messageFrom(error);
            setStatusWithAction(message, true, "Retry", () => resolveSource(source));
            P.notify(message, "error");
        }
    } finally {
        if (job.requestId) activeResolutions.delete(job.requestId);
    }
}

async function addMagnetFromInput() {
    const source = sourceInput.value.trim();
    if (!source) {
        setStatus("Enter a magnet link or choose a .torrent file.", true);
        return;
    }
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
    for (const result of completedMetadata) {
        if (typeof result?.requestId !== "string") continue;
        if (result.state === "completed") {
            const row = readyRow(result.torrent);
            if (row && !next.has(row.rowKey)) next.set(row.rowKey, row);
            continue;
        }
        const state = result.state === "cancelled" ? "cancelled" : "failed";
        next.set(`request:${result.requestId}`, {
            rowKey: `request:${result.requestId}`,
            requestId: result.requestId,
            infoHash: undefined,
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
    if (tearingDown || serviceStopped) return;
    statusTimer = setTimeout(() => {
        statusTimer = undefined;
        void pollServiceStatus();
    }, delay);
}

async function refreshServiceStatus() {
    const status = await P.service.status();
    if (!tearingDown && !serviceStopped) applyServiceStatus(status);
    return status;
}

async function pollServiceStatus() {
    if (tearingDown || serviceStopped) return;
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
        try {
            while (snapshotInFlight && !tearingDown) await waitFor(25);
            const snapshot = await P.service.request({ op: "snapshot" });
            const hasNoTorrents = Array.isArray(snapshot?.torrents) && snapshot.torrents.length === 0;
            const hasNoActiveResolutionJobs = Array.isArray(snapshot?.activeResolutionJobs)
                && snapshot.activeResolutionJobs.length === 0;
            if (hasNoTorrents && hasNoActiveResolutionJobs) {
                await P.service.stop();
                serviceStopped = true;
                serviceState = "stopped";
                stopSnapshotPolling();
                clearServiceModel();
            } else {
                reconcileSnapshot(snapshot);
                renderAll();
            }
            setStatus("Torrent removed.");
        } catch (error) {
            serviceStopped = false;
            setStatus(`Torrent removed, but the service could not be stopped: ${messageFrom(error)}`, true);
        }
    } catch (error) {
        setStatus(messageFrom(error), true);
    }
}

async function pollSnapshot() {
    if (tearingDown || serviceStopped || serviceState !== "running" || snapshotInFlight) return;
    snapshotInFlight = true;
    try {
        const status = await P.service.status();
        if (!status || status.state !== "running") {
            if (!tearingDown) applyServiceStatus(status);
            return;
        }
        if (serviceStopped) return;
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
        if (!tearingDown && !serviceStopped && serviceState === "running") {
            snapshotTimer = setTimeout(() => void pollSnapshot(), SNAPSHOT_INTERVAL_MS);
        }
    }
}

async function bootstrapService() {
    if (tearingDown || serviceStopped) return;
    setStatus("No active torrents.");
    await pollServiceStatus();
}

async function refreshSnapshotForRestore() {
    if (tearingDown || serviceStopped) return;
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
        const state = await P.state.get();
        const transientSources = restoreAcceptedSources(state);
        acceptedSourcesLoaded = true;

        const source = await P.getSourceUrl();
        // Only resolve a source this board can actually own. A plain open hands back the board's
        // own address, and a future caller could hand back anything at all; feeding that to the
        // resolver raises "Invalid torrent identifier" on a page the user simply opened.
        const initialSource = source && isTorrentSource(source) ? rememberAcceptedSource(source) : "";
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
    clearTimers();
    for (const job of activeResolutions.values()) void cancelResolution(job);
    activeResolutions.clear();
}

document.getElementById("add-magnet").addEventListener("click", () => void addMagnetFromInput());
document.getElementById("choose-torrent").addEventListener("click", () => void chooseTorrent());
sourceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void addMagnetFromInput();
});
document.addEventListener("click", (event) => {
    if (!contextMenu.contains(event.target)) hideContextMenu();
});
document.addEventListener("contextmenu", (event) => {
    if (!event.target.closest(".torrent-row, .file-row, .context-menu")) hideContextMenu();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
});
window.addEventListener("resize", hideContextMenu);
window.addEventListener("pagehide", teardown, { once: true });
window.addEventListener("beforeunload", teardown, { once: true });

unsubscribeSource = P.source.onOpen(({ url, sourceUrl }) => {
    const source = url ?? sourceUrl;
    if (isTorrentSource(source) && !tearingDown) void resolveSource(source);
});

renderAll();
void bootstrapService();
void loadOpenedSources();
