const P = window.persephone;

const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const SNAPSHOT_INTERVAL_MS = 1000;
const STATUS_INTERVAL_MS = 750;
const STALLED_SAMPLE_LIMIT = 3;

const sourceInput = document.getElementById("source-input");
const pageStatus = document.getElementById("page-status");
const torrentList = document.getElementById("torrent-list");
const torrentCount = document.getElementById("torrent-count");
const selectedTorrent = document.getElementById("selected-torrent");
const fileCount = document.getElementById("file-count");
const fileList = document.getElementById("file-list");
const contextMenu = document.getElementById("context-menu");

// The UI only owns session metadata. The service remains the owner of torrent instances.
const sessions = new Map();
const activeResolutions = new Map();
const timers = new Set();

let selectedInfoHash;
let snapshotTimer;
let snapshotInFlight = false;
let tearingDown = false;

function messageFrom(error, fallback = "Torrent service request failed.") {
    if (error && typeof error === "object" && typeof error.message === "string") return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return fallback;
}

function setStatus(message, isError = false) {
    pageStatus.textContent = message;
    pageStatus.classList.toggle("error", isError);
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

function stateLabel(session) {
    if (session.stats?.activeReaders > 0) {
        return session.stalledSamples >= STALLED_SAMPLE_LIMIT ? "stalled" : "streaming";
    }
    return "metadata only";
}

function sourceLabel(source) {
    if (source.toLowerCase().startsWith("magnet:")) return "magnet link";
    return fileName(source.replaceAll("\\", "/"));
}

function buildFileLink(torrent, file) {
    const link = `torrent://${torrent.infoHash}/${encodeURIComponent(file.path)}`
        + `?magnet=${encodeURIComponent(torrent.magnet)}`;
    return link;
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

function renderTorrentList() {
    torrentList.replaceChildren();
    const torrents = [...sessions.values()].sort((left, right) => {
        const byName = String(left.metadata.name).localeCompare(String(right.metadata.name));
        return byName || left.infoHash.localeCompare(right.infoHash);
    });
    torrentCount.textContent = String(torrents.length);

    if (torrents.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No torrents added this session.";
        torrentList.append(empty);
        return;
    }

    for (const session of torrents) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "torrent-row";
        button.classList.toggle("selected", session.infoHash === selectedInfoHash);
        button.setAttribute("aria-pressed", String(session.infoHash === selectedInfoHash));
        button.addEventListener("click", () => {
            selectedInfoHash = session.infoHash;
            renderAll();
        });
        button.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            showContextMenu(event.clientX, event.clientY, [
                { label: "Remove", action: () => removeTorrent(session) },
            ]);
        });

        const dot = document.createElement("span");
        const state = stateLabel(session);
        dot.className = "state-dot";
        dot.classList.toggle("streaming", state === "streaming");
        dot.classList.toggle("stalled", state === "stalled");
        dot.title = state;
        dot.setAttribute("aria-label", state);

        const details = document.createElement("span");
        details.className = "torrent-details";
        const name = document.createElement("span");
        name.className = "torrent-name";
        name.textContent = session.metadata.name;
        const meta = document.createElement("span");
        meta.className = "torrent-meta";
        if (session.stats) {
            meta.textContent = `${session.stats.peers} peers · ${formatRate(session.stats.downloadSpeed)} · ${state}`;
        } else {
            meta.textContent = `Resolving · ${sourceLabel(session.source)}`;
        }
        details.append(name, meta);
        button.append(dot, details);
        item.append(button);
        torrentList.append(item);
    }
}

function renderFileList() {
    fileList.replaceChildren();
    const session = selectedInfoHash ? sessions.get(selectedInfoHash) : undefined;
    selectedTorrent.textContent = session?.metadata.name ?? "—";
    const files = session
        ? [...session.files].sort((left, right) => {
            const bySize = right.length - left.length;
            return bySize || String(left.path).localeCompare(String(right.path)) || left.index - right.index;
        })
        : [];
    fileCount.textContent = String(files.length);

    if (!session) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "Select a torrent to see its files.";
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
        row.addEventListener("dblclick", () => openFile(session, file));
        row.addEventListener("keydown", (event) => {
            if (event.key === "Enter") openFile(session, file);
        });
        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            showContextMenu(event.clientX, event.clientY, [
                { label: "Open", action: () => openFile(session, file) },
                { label: "Copy link", action: () => copyFileLink(session, file) },
                { label: "Download this file", action: () => downloadFile(session, file) },
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
        open.textContent = "▸";
        open.setAttribute("aria-hidden", "true");
        row.append(icon, details, size, open);
        fileList.append(row);
    }
}

function renderAll() {
    renderTorrentList();
    renderFileList();
}

function addSession(torrent, source, requestId) {
    if (!torrent || typeof torrent.infoHash !== "string" || !Array.isArray(torrent.files)) {
        throw new Error("Torrent metadata is incomplete.");
    }
    if (typeof torrent.magnet !== "string" || torrent.magnet.length === 0) {
        throw new Error("Torrent metadata did not include its canonical magnet URI.");
    }

    const infoHash = torrent.infoHash.toLowerCase();
    const session = sessions.get(infoHash) ?? {
        infoHash,
        source,
        magnet: torrent.magnet,
        metadata: torrent,
        files: torrent.files,
        selection: { fileIndex: null },
        requestId: undefined,
        previousDownloaded: undefined,
        stalledSamples: 0,
        stats: undefined,
    };
    session.source = source;
    session.magnet = torrent.magnet;
    session.metadata = torrent;
    session.files = torrent.files;
    session.requestId = requestId;
    sessions.set(infoHash, session);
    selectedInfoHash = infoHash;
    return session;
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
        throw new Error(messageFrom(result.error, `Resolution ${result.state}.`));
    }
    throw new Error("Torrent resolution cancelled.");
}

async function resolveSource(rawSource) {
    const source = typeof rawSource === "string" ? rawSource.trim() : "";
    if (!source || tearingDown) return;

    const duplicate = [...activeResolutions.values()].find((job) => job.source === source);
    if (duplicate) await cancelResolution(duplicate);

    sourceInput.value = source;
    setStatus("Resolving metadata…");
    const job = { source, requestId: undefined, cancelled: false };
    try {
        const started = await P.service.request({ op: "resolve", magnetOrTorrentId: source });
        job.requestId = started.requestId;
        job.infoHash = typeof started.infoHash === "string" ? started.infoHash.toLowerCase() : undefined;
        activeResolutions.set(job.requestId, job);
        const torrent = await waitForResolution(job);
        if (tearingDown) return;
        const session = addSession(torrent, source, job.requestId);
        session.requestId = undefined;
        renderAll();
        setStatus(`${session.metadata.name} · ${session.files.length} files · metadata only`);
    } catch (error) {
        if (!tearingDown && !job.cancelled) {
            setStatus(messageFrom(error), true);
            P.notify(messageFrom(error), "error");
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

function openFile(session, file) {
    session.selection.fileIndex = file.index;
    P.openRawLink(buildFileLink(session, file));
}

async function copyFileLink(session, file) {
    try {
        await P.clipboard.writeText(buildFileLink(session, file));
        if (!tearingDown) setStatus("Torrent link copied.");
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

/** A source this board can resolve: a magnet URI, one of its own `torrent://` links, or a
 *  `.torrent` path. Anything else is not ours and is ignored rather than reported as an error. */
function isTorrentSource(source) {
    if (typeof source !== "string" || source.length === 0) return false;
    const value = source.trim();
    return value.startsWith("magnet:")
        || value.startsWith("torrent://")
        || /\.torrent$/i.test(value);
}

async function downloadFile(session, file) {
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
        const resource = await P.content.open(buildFileLink(session, file));
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

async function removeTorrent(session) {
    const pending = [...activeResolutions.values()].filter(
        (job) => job.source === session.source || job.infoHash === session.infoHash,
    );
    await Promise.all(pending.map((job) => cancelResolution(job)));
    try {
        const result = await P.service.request({ op: "remove", magnetOrTorrentId: session.infoHash });
        if (result.removed) {
            sessions.delete(session.infoHash);
            if (selectedInfoHash === session.infoHash) {
                selectedInfoHash = sessions.keys().next().value;
            }
            renderAll();
            setStatus("Torrent removed.");
        } else {
            setStatus("No matching torrent is active.", true);
        }
    } catch (error) {
        setStatus(messageFrom(error), true);
    }
}

function updateSessionStats(snapshot) {
    const statsByHash = new Map(
        (Array.isArray(snapshot?.torrents) ? snapshot.torrents : [])
            .filter((torrent) => typeof torrent.infoHash === "string")
            .map((torrent) => [torrent.infoHash.toLowerCase(), torrent]),
    );
    for (const session of sessions.values()) {
        const stats = statsByHash.get(session.infoHash);
        if (!stats) continue;
        if (stats.activeReaders > 0) {
            const downloadedDelta = session.previousDownloaded === undefined
                ? 0
                : stats.downloaded - session.previousDownloaded;
            if (downloadedDelta <= 0 && stats.downloadSpeed <= 0) session.stalledSamples += 1;
            else session.stalledSamples = 0;
        } else {
            session.stalledSamples = 0;
        }
        session.previousDownloaded = stats.downloaded;
        session.stats = stats;
    }
}

async function pollSnapshot() {
    if (tearingDown || snapshotInFlight) return;
    snapshotInFlight = true;
    try {
        const snapshot = await P.service.request({ op: "snapshot" });
        if (!tearingDown) {
            updateSessionStats(snapshot);
            renderTorrentList();
        }
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    } finally {
        snapshotInFlight = false;
        if (!tearingDown) snapshotTimer = setTimeout(() => void pollSnapshot(), SNAPSHOT_INTERVAL_MS);
    }
}

async function loadOpenedSource() {
    try {
        const source = await P.getSourceUrl();
        // Only resolve a source this board can actually own. A plain open hands back the board's
        // own address, and a future caller could hand back anything at all; feeding that to the
        // resolver raises "Invalid torrent identifier" on a page the user simply opened.
        if (source && isTorrentSource(source) && !tearingDown) await resolveSource(source);
    } catch (error) {
        if (!tearingDown) setStatus(messageFrom(error), true);
    }
}

function teardown() {
    if (tearingDown) return;
    tearingDown = true;
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

renderAll();
void pollSnapshot();
void loadOpenedSource();
