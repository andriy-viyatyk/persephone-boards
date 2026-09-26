const P = window.persephone;
const input = document.getElementById("torrent-input");
const status = document.getElementById("status");
const fileList = document.getElementById("file-list");

let activeRequestId;
let pollTimer;

function messageFrom(error, fallback = "Torrent service request failed.") {
    if (error && typeof error === "object" && typeof error.message === "string") return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return fallback;
}

function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
}

function clearFiles() {
    fileList.replaceChildren();
}

function renderFiles(torrent) {
    clearFiles();
    if (!torrent || !Array.isArray(torrent.files) || torrent.files.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "The torrent has no files.";
        fileList.append(empty);
        return;
    }
    for (const file of torrent.files) {
        const row = document.createElement("li");
        row.className = "file-row";
        const path = document.createElement("span");
        path.className = "file-path";
        path.textContent = file.path;
        const length = document.createElement("span");
        length.className = "file-meta";
        length.textContent = `${file.length.toLocaleString()} bytes`;
        const index = document.createElement("span");
        index.className = "file-meta";
        index.textContent = `#${file.index}`;
        row.append(path, length, index);
        fileList.append(row);
    }
}

function scheduleStatusPoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void pollStatus(), 750);
}

async function pollStatus() {
    if (!activeRequestId) return;
    try {
        const result = await P.service.request({ op: "status", requestId: activeRequestId });
        if (result.state === "resolving") {
            setStatus("Resolving metadata…");
            scheduleStatusPoll();
            return;
        }
        activeRequestId = undefined;
        if (result.state === "completed") {
            renderFiles(result.torrent);
            setStatus(`${result.torrent.name} · ${result.torrent.files.length} files · metadata only`);
        } else if (result.state === "missing") {
            setStatus("Resolution result expired or was already read.", true);
        } else {
            setStatus(messageFrom(result.error, `Resolution ${result.state}.`), true);
        }
    } catch (error) {
        activeRequestId = undefined;
        setStatus(messageFrom(error), true);
        P.notify(messageFrom(error), "error");
    }
}

async function resolveInput() {
    const value = input.value.trim();
    if (!value) {
        setStatus("Enter a magnet link or a .torrent path.", true);
        return;
    }
    if (activeRequestId) {
        await P.service.request({ op: "cancel", requestId: activeRequestId });
        activeRequestId = undefined;
    }
    clearTimeout(pollTimer);
    clearFiles();
    setStatus("Starting metadata resolution…");
    try {
        const result = await P.service.request({ op: "resolve", magnetOrTorrentId: value });
        activeRequestId = result.requestId;
        setStatus("Resolving metadata…");
        await pollStatus();
    } catch (error) {
        setStatus(messageFrom(error), true);
        P.notify(messageFrom(error), "error");
    }
}

async function removeInput() {
    if (activeRequestId) {
        await P.service.request({ op: "cancel", requestId: activeRequestId });
        activeRequestId = undefined;
    }
    clearTimeout(pollTimer);
    try {
        const result = await P.service.request({ op: "remove", magnetOrTorrentId: input.value.trim() });
        clearFiles();
        setStatus(result.removed ? "Torrent removed." : "No matching torrent is active.");
    } catch (error) {
        setStatus(messageFrom(error), true);
    }
}

async function showStatus() {
    try {
        const result = await P.service.request({ op: "status" });
        const torrentCount = Array.isArray(result.torrents) ? result.torrents.length : 0;
        const jobCount = Array.isArray(result.activeResolutionJobs) ? result.activeResolutionJobs.length : 0;
        setStatus(`${torrentCount} torrent(s) active · ${jobCount} resolution job(s) · metadata only`);
    } catch (error) {
        setStatus(messageFrom(error), true);
    }
}

document.getElementById("resolve").addEventListener("click", () => void resolveInput());
document.getElementById("remove").addEventListener("click", () => void removeInput());
document.getElementById("refresh").addEventListener("click", () => void showStatus());
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void resolveInput();
});

async function loadOpenedTorrentPath() {
    if (typeof P.getFilePath !== "function") return;
    try {
        const filePath = await P.getFilePath();
        if (filePath) {
            input.value = filePath;
            setStatus("A .torrent path was supplied by the editor association.");
        }
    } catch (error) {
        setStatus(messageFrom(error), true);
    }
}

void loadOpenedTorrentPath();
