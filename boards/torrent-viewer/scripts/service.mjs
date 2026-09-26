process.env.WS_NO_BUFFER_UTIL = "1";
process.env.WS_NO_UTF_8_VALIDATE = "1";

const { default: WebTorrent, MemoryChunkStore } = await import("../lib/webtorrent.bundle.mjs");

const METADATA_TIMEOUT_MS = 30_000;
const MAX_RESOLUTION_JOBS = 4;
const NO_POLL_TIMEOUT_MS = 15_000;
const COMPLETED_RESULT_TTL_MS = 60_000;

let client;
let shuttingDown = false;
let nextRequestNumber = 1;

const torrentsByInfoHash = new Map();
const torrentSources = new WeakMap();
const selectionState = new WeakMap();
const pendingResolvers = new Set();
const resolutionJobs = new Map();

function errorMessage(error, fallback = "Torrent service failed.") {
    if (error && typeof error === "object" && typeof error.message === "string") {
        return error.message;
    }
    if (typeof error === "string" && error.length > 0) return error;
    return fallback;
}

function serializedError(error, code = "torrent-resolution-failed") {
    return { code, message: errorMessage(error) };
}

function normalizeInfoHash(infoHash) {
    return typeof infoHash === "string" ? infoHash.trim().toLowerCase() : "";
}

function extractInfoHash(value) {
    if (typeof value !== "string") return undefined;
    const source = value.trim();
    if (/^[0-9a-f]{40}$/i.test(source)) return source.toLowerCase();
    if (!source.toLowerCase().startsWith("magnet:")) return undefined;

    try {
        const magnet = new URL(source);
        for (const extension of magnet.searchParams.getAll("xt")) {
            const match = extension.match(/^urn:btih:([0-9a-z]+)$/i);
            if (match && /^[0-9a-f]{40}$/i.test(match[1])) return match[1].toLowerCase();
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function getClient() {
    if (shuttingDown) throw new Error("torrent-service-shutting-down");
    if (!client) {
        client = new WebTorrent();
        client.on("error", (error) => {
            console.error("WebTorrent client error:", errorMessage(error));
        });
    }
    return client;
}

export function findTorrentByInfoHash(infoHash) {
    const normalized = normalizeInfoHash(infoHash);
    if (!normalized) return undefined;
    const direct = torrentsByInfoHash.get(normalized);
    if (direct) return direct;
    for (const torrent of torrentsByInfoHash.values()) {
        if (normalizeInfoHash(torrent.infoHash) === normalized) return torrent;
    }
    return undefined;
}

function rememberTorrent(torrent, source) {
    const infoHash = normalizeInfoHash(torrent.infoHash);
    if (infoHash) torrentsByInfoHash.set(infoHash, torrent);
    if (source) torrentSources.set(torrent, source);
}

function forgetTorrent(torrent) {
    const infoHash = normalizeInfoHash(torrent?.infoHash);
    if (infoHash && torrentsByInfoHash.get(infoHash) === torrent) {
        torrentsByInfoHash.delete(infoHash);
    }
    selectionState.delete(torrent);
    torrentSources.delete(torrent);
}

function deselectFiles(torrent) {
    const files = Array.isArray(torrent.files) ? torrent.files : [];
    for (const file of files) {
        if (typeof file.deselect !== "function") {
            throw new Error("torrent-file-deselect-unavailable");
        }
        file.deselect();
    }
    selectionState.set(torrent, { fileCount: files.length, allDeselected: true });
    return files;
}

function metadataFor(torrent) {
    // WebTorrent exposes backslashes for this path on Windows. Normalize at this service
    // boundary so the future torrent:// provider never has to guess which separator it got.
    const files = deselectFiles(torrent);
    return {
        infoHash: torrent.infoHash,
        name: torrent.name,
        files: files.map((file, index) => ({
            path: file.path.split("\\").join("/"),
            length: file.length,
            index,
        })),
    };
}

function destroyTorrent(torrent) {
    if (!torrent || torrent.destroyed) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        try {
            torrent.destroy({ destroyStore: true }, finish);
        } catch {
            finish();
        }
    });
}

function makeResolver(source) {
    const operation = {
        source,
        torrent: undefined,
        destroyPromise: undefined,
        cancelWait: undefined,
        cancelled: false,
        completed: false,
        resolve: undefined,
        reject: undefined,
        promise: undefined,
    };
    operation.promise = new Promise((resolve, reject) => {
        operation.resolve = resolve;
        operation.reject = reject;
    });
    operation.destroy = () => {
        if (!operation.torrent) return Promise.resolve();
        if (!operation.destroyPromise) {
            operation.destroyPromise = destroyTorrent(operation.torrent);
        }
        return operation.destroyPromise;
    };
    operation.cancel = (reason) => {
        if (operation.cancelled || operation.completed) return;
        operation.cancelled = true;
        operation.cancelWait?.(new Error(reason));
        void operation.destroy();
    };
    return operation;
}

function waitForMetadata(torrent, operation) {
    if (torrent.ready) return Promise.resolve(metadataFor(torrent));

    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;

        const cleanup = () => {
            clearTimeout(timer);
            torrent.removeListener("metadata", onMetadata);
            torrent.removeListener("error", onError);
            if (operation.cancelWait === cancelWait) operation.cancelWait = undefined;
        };
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };
        const fail = (error) => {
            void operation.destroy();
            finish(reject, error);
        };
        const onMetadata = () => {
            if (operation.cancelled) {
                fail(new Error("torrent-resolution-cancelled"));
                return;
            }
            try {
                finish(resolve, metadataFor(torrent));
            } catch (error) {
                fail(error);
            }
        };
        const onError = (error) => fail(error);
        const cancelWait = (error) => fail(error);

        operation.cancelWait = cancelWait;
        timer = setTimeout(
            () => fail(new Error(`torrent-metadata-timeout:${METADATA_TIMEOUT_MS}ms`)),
            METADATA_TIMEOUT_MS,
        );
        torrent.once("metadata", onMetadata);
        torrent.once("error", onError);
    });
}

async function startResolver(operation) {
    pendingResolvers.add(operation);
    try {
        if (operation.cancelled) throw new Error("torrent-resolution-cancelled");

        const infoHash = extractInfoHash(operation.source);
        const existing = infoHash ? findTorrentByInfoHash(infoHash) : undefined;
        // `deselect: true` is what actually makes this board a VIEWER (EPIC-114 D1), and it is NOT
        // the same thing as deselecting every file afterwards. WebTorrent creates a torrent-level
        // selection over the WHOLE piece range at metadata time unless this option is set
        // (webtorrent/lib/torrent.js:155, `_startAsDeselected`); `file.deselect()` only removes that
        // file's own selection and leaves the whole-range one in place. Measured without it: every
        // file reported deselected while the swarm pushed 82 MB in seconds.
        const torrent = existing ?? getClient().add(operation.source, {
            store: MemoryChunkStore,
            deselect: true,
        });
        operation.torrent = torrent;
        if (!existing) rememberTorrent(torrent, operation.source);

        const metadata = await waitForMetadata(torrent, operation);
        if (operation.cancelled) throw new Error("torrent-resolution-cancelled");
        rememberTorrent(torrent, operation.source);
        operation.completed = true;
        operation.resolve(metadata);
    } catch (error) {
        if (!operation.completed) {
            forgetTorrent(operation.torrent);
            await operation.destroy();
        }
        operation.reject(error);
    } finally {
        pendingResolvers.delete(operation);
    }
}

export function resolveTorrent(magnetOrTorrentId) {
    if (typeof magnetOrTorrentId !== "string" || magnetOrTorrentId.trim().length === 0) {
        return Promise.reject(new Error("torrent-identifier-required"));
    }
    if (shuttingDown) return Promise.reject(new Error("torrent-service-shutting-down"));

    const operation = makeResolver(magnetOrTorrentId.trim());
    void startResolver(operation);
    return operation.promise;
}

function requestId() {
    return `torrent-resolution-${Date.now().toString(36)}-${(nextRequestNumber++).toString(36)}`;
}

function clearJobTimers(job) {
    clearTimeout(job.noPollTimer);
    clearTimeout(job.expiryTimer);
    job.noPollTimer = undefined;
    job.expiryTimer = undefined;
}

function expireJob(job) {
    if (resolutionJobs.get(job.requestId) !== job) return;
    clearJobTimers(job);
    resolutionJobs.delete(job.requestId);
}

function armResultExpiry(job) {
    clearTimeout(job.expiryTimer);
    job.expiryTimer = setTimeout(() => expireJob(job), COMPLETED_RESULT_TTL_MS);
}

function cancelJob(job, reason) {
    if (job.state !== "resolving") return;
    clearTimeout(job.noPollTimer);
    job.noPollTimer = undefined;
    job.state = "cancelled";
    job.error = serializedError(new Error(reason), "torrent-resolution-cancelled");
    job.operation.cancel(reason);
    armResultExpiry(job);
}

function touchJob(job) {
    clearTimeout(job.noPollTimer);
    job.lastPollAt = Date.now();
    job.noPollTimer = setTimeout(() => {
        if (job.state === "resolving" && Date.now() - job.lastPollAt >= NO_POLL_TIMEOUT_MS) {
            cancelJob(job, "torrent-resolution-no-status-poll");
        }
    }, NO_POLL_TIMEOUT_MS);
}

function completeJob(job, result) {
    if (job.state !== "resolving") return;
    clearTimeout(job.noPollTimer);
    job.noPollTimer = undefined;
    job.state = "completed";
    job.result = result;
    armResultExpiry(job);
}

function failJob(job, error) {
    if (job.state !== "resolving") return;
    clearTimeout(job.noPollTimer);
    job.noPollTimer = undefined;
    job.state = "failed";
    job.error = serializedError(error);
    armResultExpiry(job);
}

function startResolutionJob(source) {
    const activeCount = [...resolutionJobs.values()].filter((job) => job.state === "resolving").length;
    if (activeCount >= MAX_RESOLUTION_JOBS) throw new Error("torrent-resolution-busy");

    const operation = makeResolver(source);
    const job = {
        requestId: requestId(),
        source,
        infoHash: extractInfoHash(source) ?? null,
        state: "resolving",
        result: undefined,
        error: undefined,
        operation,
        lastPollAt: Date.now(),
        noPollTimer: undefined,
        expiryTimer: undefined,
    };
    resolutionJobs.set(job.requestId, job);
    touchJob(job);
    // The job must follow `operation.promise`, NOT startResolver()'s own promise. startResolver is
    // `async` and returns undefined: it hands the metadata to `operation.resolve(metadata)` and
    // swallows failures into `operation.reject(error)`. Awaiting the function itself therefore
    // always completed the job with `torrent: undefined`, and never failed it at all.
    void startResolver(operation);
    operation.promise.then(
        (result) => completeJob(job, result),
        (error) => failJob(job, error),
    );
    return {
        state: "resolving",
        requestId: job.requestId,
        infoHash: job.infoHash,
    };
}

function readResolutionStatus(requestIdValue) {
    const job = resolutionJobs.get(requestIdValue);
    if (!job) return { state: "missing", requestId: requestIdValue };
    if (job.state === "resolving") {
        touchJob(job);
        return { state: "resolving", requestId: job.requestId, infoHash: job.infoHash };
    }

    clearJobTimers(job);
    resolutionJobs.delete(job.requestId);
    if (job.state === "completed") {
        return { state: "completed", requestId: job.requestId, torrent: job.result };
    }
    return { state: job.state, requestId: job.requestId, error: job.error };
}

function torrentStatus(torrent) {
    const selection = selectionState.get(torrent);
    return {
        infoHash: torrent.infoHash ?? null,
        name: torrent.name ?? null,
        ready: torrent.ready === true,
        fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
        peers: Number.isFinite(torrent.numPeers) ? torrent.numPeers : 0,
        downloadSpeed: Number.isFinite(torrent.downloadSpeed) ? torrent.downloadSpeed : 0,
        downloaded: Number.isFinite(torrent.downloaded) ? torrent.downloaded : 0,
        allFilesDeselected: selection?.allDeselected === true,
    };
}

export function getServiceSnapshot(consumeCompletedMetadata = false) {
    const jobs = [...resolutionJobs.values()];
    const snapshot = {
        client: client
            ? { destroyed: client.destroyed === true, torrentCount: torrentsByInfoHash.size }
            : null,
        torrents: [...new Set(torrentsByInfoHash.values())].map(torrentStatus),
        activeResolutionJobs: jobs
            .filter((job) => job.state === "resolving")
            .map((job) => ({
                requestId: job.requestId,
                infoHash: job.infoHash,
                lastPollAt: job.lastPollAt,
            })),
        completedMetadata: jobs
            .filter((job) => job.state !== "resolving")
            .map((job) => ({
                requestId: job.requestId,
                state: job.state,
                torrent: job.result,
                error: job.error,
            })),
    };
    if (consumeCompletedMetadata) {
        for (const job of jobs) {
            if (job.state !== "resolving") expireJob(job);
        }
    }
    return snapshot;
}

export async function removeTorrent(magnetOrTorrentId) {
    const source = typeof magnetOrTorrentId === "string" ? magnetOrTorrentId.trim() : "";
    const infoHash = extractInfoHash(source);
    for (const job of resolutionJobs.values()) {
        if (job.state === "resolving" && (job.source === source || (infoHash && job.infoHash === infoHash))) {
            cancelJob(job, "torrent-resolution-removed");
        }
    }

    let torrent = infoHash ? findTorrentByInfoHash(infoHash) : undefined;
    if (!torrent && source) {
        torrent = [...new Set(torrentsByInfoHash.values())].find(
            (candidate) => torrentSources.get(candidate) === source,
        );
    }
    if (!torrent) return { removed: false };
    forgetTorrent(torrent);
    await destroyTorrent(torrent);
    return { removed: true, infoHash: torrent.infoHash ?? null };
}

async function destroyClient() {
    const currentClient = client;
    client = undefined;
    if (!currentClient || currentClient.destroyed) return;
    await new Promise((resolve) => {
        try {
            currentClient.destroy(resolve);
        } catch {
            resolve();
        }
    });
}

export async function shutdownService() {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const job of resolutionJobs.values()) {
        if (job.state === "resolving") cancelJob(job, "torrent-service-shutdown");
        clearJobTimers(job);
    }
    await Promise.allSettled([...pendingResolvers].map((operation) => operation.promise));

    const torrents = [...new Set(torrentsByInfoHash.values())];
    for (const torrent of torrents) {
        forgetTorrent(torrent);
        await destroyTorrent(torrent);
    }
    resolutionJobs.clear();
    await destroyClient();
}

async function handleRequest(request) {
    const message = request && typeof request === "object" ? request : {};
    switch (message.op) {
        case "resolve":
            return startResolutionJob(message.magnetOrTorrentId);
        case "status":
            return typeof message.requestId === "string"
                ? readResolutionStatus(message.requestId)
                : getServiceSnapshot(true);
        case "snapshot":
            return getServiceSnapshot();
        case "cancel": {
            const job = resolutionJobs.get(message.requestId);
            if (job) cancelJob(job, "torrent-resolution-cancelled");
            return { state: "cancelled", requestId: message.requestId };
        }
        case "remove":
            return removeTorrent(message.magnetOrTorrentId);
        default:
            throw new Error(`unknown-operation:${String(message.op)}`);
    }
}

const parentPort = process.parentPort;

function postResponse(requestIdValue, result) {
    parentPort.postMessage({ kind: "response", requestId: requestIdValue, result });
}

function postError(requestIdValue, error) {
    parentPort.postMessage({
        kind: "response",
        requestId: requestIdValue,
        error: serializedError(error, "service-request-failed"),
    });
}

function handleMessage(message) {
    if (!message || typeof message.kind !== "string") return;
    if (message.kind === "init") {
        parentPort.postMessage({ kind: "ready", nonce: message.nonce });
        return;
    }
    if (message.kind === "probe") {
        parentPort.postMessage({ kind: "probe-ack", nonce: message.nonce });
        return;
    }
    if (message.kind === "shutdown") {
        void shutdownService().then(
            () => process.exit(0),
            (error) => {
                console.error("Torrent service shutdown failed:", errorMessage(error));
                process.exit(1);
            },
        );
        return;
    }
    if (message.kind !== "request" || typeof message.requestId !== "string") return;
    void handleRequest(message.message).then(
        (result) => postResponse(message.requestId, result),
        (error) => postError(message.requestId, error),
    );
}

if (parentPort) {
    parentPort.on("message", (event) => {
        handleMessage(event && typeof event === "object" && "data" in event ? event.data : event);
    });
}
