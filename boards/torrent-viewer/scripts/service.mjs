process.env.WS_NO_BUFFER_UTIL = "1";
process.env.WS_NO_UTF_8_VALIDATE = "1";

const { default: WebTorrent, MemoryChunkStore } = await import("../lib/webtorrent.bundle.mjs");

const METADATA_TIMEOUT_MS = 30_000;
const MAX_RESOLUTION_JOBS = 4;
// Keep the abandoned-job watchdog above D8's metadata bound so it never pre-empts a real resolution.
const NO_POLL_TIMEOUT_MS = METADATA_TIMEOUT_MS + 15_000;
const COMPLETED_RESULT_TTL_MS = 60_000;
const MAX_BOARD_PIPE_CHUNK_BYTES = 1024 * 1024;
const MAX_BUFFERED_PIPE_BYTES = 256 * 1024 * 1024;

let client;
let shuttingDown = false;
let nextRequestNumber = 1;

const torrentsByInfoHash = new Map();
const torrentSources = new WeakMap();
const selectionState = new WeakMap();
const activeReaderCounts = new WeakMap();
const pendingResolvers = new Set();
const resolutionJobs = new Map();

function errorMessage(error, fallback = "Torrent service failed.") {
    if (error && typeof error === "object" && typeof error.message === "string") {
        return error.message;
    }
    if (typeof error === "string" && error.length > 0) return error;
    return fallback;
}

function isTorrentBytes(value) {
    return value instanceof Uint8Array && value.byteLength > 0;
}

function serializedError(error, code = "torrent-resolution-failed") {
    return { code, message: errorMessage(error) };
}

function normalizeInfoHash(infoHash) {
    return typeof infoHash === "string" ? infoHash.trim().toLowerCase() : "";
}

function magnetInfoHashes(value) {
    if (typeof value !== "string") return [];
    const source = value.trim();
    if (!source.toLowerCase().startsWith("magnet:")) return [];

    try {
        const magnet = new URL(source);
        const hashes = [];
        for (const extension of magnet.searchParams.getAll("xt")) {
            const match = extension.match(/^urn:btih:([0-9a-z]+)$/i);
            if (!match) continue;
            if (!/^[0-9a-f]{40}$/i.test(match[1])) return [];
            hashes.push(match[1].toLowerCase());
        }
        return hashes;
    } catch {
        return [];
    }
}

function extractInfoHash(value) {
    if (typeof value !== "string") return undefined;
    const source = value.trim();
    if (/^[0-9a-f]{40}$/i.test(source)) return source.toLowerCase();
    const hashes = magnetInfoHashes(source);
    if (hashes.length === 0 || hashes.some((hash) => hash !== hashes[0])) return undefined;
    return hashes[0];
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
    if (typeof source === "string" && source) torrentSources.set(torrent, source);
}

function forgetTorrent(torrent) {
    const infoHash = normalizeInfoHash(torrent?.infoHash);
    if (infoHash && torrentsByInfoHash.get(infoHash) === torrent) {
        torrentsByInfoHash.delete(infoHash);
    }
    selectionState.delete(torrent);
    activeReaderCounts.delete(torrent);
    torrentSources.delete(torrent);
}

function deselectFiles(torrent) {
    const files = Array.isArray(torrent.files) ? torrent.files : [];
    const activeReaders = activeReaderCounts.get(torrent) ?? 0;
    if (activeReaders > 0) return files;
    for (const file of files) {
        if (typeof file.deselect !== "function") {
            throw new Error("torrent-file-deselect-unavailable");
        }
        file.deselect();
    }
    selectionState.set(torrent, { fileCount: files.length, allDeselected: true, activeReaders });
    return files;
}

function metadataProjection(torrent) {
    // WebTorrent exposes backslashes for this path on Windows. Normalize at this service
    // boundary so the torrent:// provider never has to guess which separator it got. This
    // projection is deliberately metadata-only: do not add file buffers, streams, or handles.
    return {
        infoHash: torrent.infoHash,
        magnet: torrent.magnetURI,
        name: torrent.name,
        files: (Array.isArray(torrent.files) ? torrent.files : []).map((file, index) => ({
            path: file.path.split("\\").join("/"),
            length: file.length,
            index,
        })),
    };
}

function metadataFor(torrent) {
    deselectFiles(torrent);
    return metadataProjection(torrent);
}

function abortError() {
    const error = new Error("torrent-read-aborted");
    error.name = "AbortError";
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function awaitWithAbort(promise, signal) {
    throwIfAborted(signal);
    if (!signal) return promise;

    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };
        const onAbort = () => finish(reject, abortError());

        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
        );
    });
}

function parseTorrentLink(config) {
    let url;
    try {
        url = new URL(String(config?.url));
    } catch {
        throw new Error("torrent-link-invalid");
    }
    if (url.protocol !== "torrent:") throw new Error("torrent-link-invalid-protocol");

    const infoHash = normalizeInfoHash(url.hostname);
    if (!/^[0-9a-f]{40}$/.test(infoHash)) throw new Error("torrent-link-invalid-infohash");
    if (!url.pathname.startsWith("/")) throw new Error("torrent-link-path-required");

    let canonicalPath;
    try {
        canonicalPath = decodeURIComponent(url.pathname.slice(1));
    } catch {
        throw new Error("torrent-link-path-invalid-encoding");
    }
    if (!canonicalPath || canonicalPath.split("/").some((part) => part === "." || part === "..")) {
        throw new Error("torrent-link-path-invalid");
    }

    const magnetValue = url.searchParams.get("magnet");
    let magnet;
    if (magnetValue !== null) {
        const magnetHashes = magnetInfoHashes(magnetValue);
        if (magnetHashes.length === 0 || magnetHashes.some((hash) => hash !== infoHash)) {
            throw new Error("torrent-link-magnet-mismatch");
        }
        magnet = magnetValue;
    }

    return { infoHash, canonicalPath, magnet };
}

function fileForPath(torrent, canonicalPath) {
    const files = Array.isArray(torrent.files) ? torrent.files : [];
    return files.find((file) => file.path.split("\\").join("/") === canonicalPath);
}

async function torrentFileForLink(link, signal) {
    throwIfAborted(signal);
    if (removedInfoHashes.has(link.infoHash)) {
        throw new Error("torrent-removed: this torrent was removed from the Torrent Viewer");
    }
    let torrent = findTorrentByInfoHash(link.infoHash);
    if (!link.magnet && !torrent) {
        throw new Error("torrent-magnet-required: torrent is no longer loaded");
    }
    if (link.magnet) {
        await awaitWithAbort(resolveTorrent(link.magnet), signal);
    } else if (!torrent.ready) {
        await awaitWithAbort(resolveTorrent(link.infoHash), signal);
    }
    throwIfAborted(signal);

    torrent = findTorrentByInfoHash(link.infoHash);
    if (!torrent || torrent.destroyed) throw new Error("torrent-unavailable");
    if (!torrent.ready) await awaitWithAbort(resolveTorrent(link.infoHash), signal);
    throwIfAborted(signal);

    return { torrent, file: fileForPath(torrent, link.canonicalPath) };
}

/** Info hashes the user removed during this service instance. A file link carries its magnet, so
 *  without this a page still reading a removed torrent (a player, say) would silently add it back.
 *  Removal is the user's call and takes effect at once: those reads fail instead. Adding the torrent
 *  again from the board clears the mark. */
const removedInfoHashes = new Set();

function beginReader(torrent) {
    const activeReaders = (activeReaderCounts.get(torrent) ?? 0) + 1;
    activeReaderCounts.set(torrent, activeReaders);
    const previous = selectionState.get(torrent);
    selectionState.set(torrent, {
        fileCount: Array.isArray(torrent.files) ? torrent.files.length : previous?.fileCount ?? 0,
        allDeselected: false,
        activeReaders,
    });
}

function endReader(torrent) {
    const activeReaders = Math.max(0, (activeReaderCounts.get(torrent) ?? 1) - 1);
    if (activeReaders === 0) {
        activeReaderCounts.delete(torrent);
        deselectFiles(torrent);
        return;
    }
    activeReaderCounts.set(torrent, activeReaders);
    const previous = selectionState.get(torrent);
    selectionState.set(torrent, {
        fileCount: previous?.fileCount ?? (Array.isArray(torrent.files) ? torrent.files.length : 0),
        allDeselected: false,
        activeReaders,
    });
}

async function collectIterator(iterator, stream, expectedLength, signal) {
    const chunks = [];
    let totalLength = 0;
    let aborted = false;
    const onAbort = () => {
        aborted = true;
        try {
            iterator.destroy?.();
        } catch {
            // The cleanup in finally remains authoritative.
        }
        try {
            stream.destroy?.(abortError());
        } catch {
            // The cleanup in finally remains authoritative.
        }
    };

    try {
        if (signal?.aborted) {
            onAbort();
            throw abortError();
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        while (true) {
            throwIfAborted(signal);
            const result = await iterator.next();
            if (result.done) break;
            if (signal?.aborted || aborted) throw abortError();
            const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
            totalLength += chunk.byteLength;
            if (totalLength > expectedLength) throw new Error("torrent-read-too-many-bytes");
            chunks.push(chunk);
        }
        throwIfAborted(signal);
        if (totalLength !== expectedLength) throw new Error("torrent-read-incomplete");

        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return result;
    } catch (error) {
        if (signal?.aborted || aborted) throw abortError();
        throw error;
    } finally {
        signal?.removeEventListener("abort", onAbort);
        try {
            await iterator.return?.();
        } catch {
            // The iterator is still explicitly destroyed below.
        }
        try {
            iterator.destroy?.();
        } catch {
            // Destroy is idempotent and best effort after a failed read.
        }
        if (stream !== iterator) {
            try {
                stream.destroy?.();
            } catch {
                // Destroy is idempotent and best effort after a failed read.
            }
        }
    }
}

async function readFileBytes(
    torrent,
    file,
    start,
    end,
    signal,
    maxLength = MAX_BOARD_PIPE_CHUNK_BYTES,
) {
    const expectedLength = end - start + 1;
    if (expectedLength > maxLength) {
        throw new Error("torrent-range-too-large");
    }
    throwIfAborted(signal);
    beginReader(torrent);
    let stream;
    try {
        throwIfAborted(signal);
        stream = file.createReadStream({ start, end });
        const iterator = typeof stream?.[Symbol.asyncIterator] === "function"
            ? stream[Symbol.asyncIterator]()
            : stream;
        return await collectIterator(iterator, stream, expectedLength, signal);
    } finally {
        try {
            stream?.destroy?.();
        } finally {
            endReader(torrent);
        }
    }
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

function isTorrentClaimedByAnother(operation) {
    for (const other of pendingResolvers) {
        if (other === operation || other.torrent !== operation.torrent) continue;
        if (!other.cancelled && !other.failed) return true;
    }
    return false;
}

function makeResolver(source) {
    const operation = {
        source,
        torrent: undefined,
        destroyPromise: undefined,
        cancelWait: undefined,
        cancelled: false,
        failed: false,
        completed: false,
        // False when this operation joined a torrent that was already listed: it may never destroy it.
        ownsTorrent: true,
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
            // Two pages can resolve the same torrent at once and share it. A failed or cancelled
            // attempt releases only its own claim; the torrent dies with the last live claimant.
            if (!operation.ownsTorrent || isTorrentClaimedByAnother(operation)) {
                operation.destroyPromise = Promise.resolve();
            } else {
                forgetTorrent(operation.torrent);
                operation.destroyPromise = destroyTorrent(operation.torrent);
            }
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
            operation.failed = true;
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

/** A torrent another attempt is still resolving. WebTorrent sets a magnet's infoHash only after
 *  its async parse, so `torrentsByInfoHash` can miss it, and a second `client.add` of the same
 *  magnet (a board reload mid-resolve) fails with "Cannot add duplicate torrent". */
function pendingTorrentFor(infoHash, operation) {
    for (const other of pendingResolvers) {
        if (other === operation || !other.torrent || other.torrent.destroyed) continue;
        if (other.cancelled || other.failed) continue;
        if (extractInfoHash(other.source) === infoHash) return other.torrent;
    }
    return undefined;
}

async function startResolver(operation) {
    pendingResolvers.add(operation);
    try {
        if (operation.cancelled) throw new Error("torrent-resolution-cancelled");

        const infoHash = extractInfoHash(operation.source);
        const existing = infoHash ? findTorrentByInfoHash(infoHash) ?? pendingTorrentFor(infoHash, operation) : undefined;
        // `deselect: true` is what actually makes this board a VIEWER (EPIC-114 D1), and it is NOT
        // the same thing as deselecting every file afterwards. WebTorrent creates a torrent-level
        // selection over the WHOLE piece range at metadata time unless this option is set
        // (webtorrent/lib/torrent.js:155, `_startAsDeselected`); `file.deselect()` only removes that
        // file's own selection and leaves the whole-range one in place. Measured without it: every
        // file reported deselected while the swarm pushed 82 MB in seconds.
        const torrentInput = isTorrentBytes(operation.source)
            ? Buffer.from(operation.source)
            : operation.source;
        // A local path or .torrent bytes carry no visible info hash, so a torrent already loaded
        // (from its magnet, say) is only found by WebTorrent itself: it destroys the new copy with
        // "Cannot add duplicate torrent" and hands the loaded one to this callback.
        let loadedDuplicate;
        const added = existing ? undefined : getClient().add(torrentInput, {
            store: MemoryChunkStore,
            deselect: true,
        }, (ready) => {
            if (ready !== added) loadedDuplicate = ready;
        });
        const torrent = existing ?? added;
        operation.torrent = torrent;
        operation.ownsTorrent = !existing?.ready;
        if (!existing) rememberTorrent(torrent, operation.source);

        let metadata;
        try {
            metadata = await waitForMetadata(torrent, operation);
        } catch (error) {
            if (!loadedDuplicate || loadedDuplicate.destroyed || operation.cancelled) throw error;
            // Join the loaded torrent instead of failing. The copy WebTorrent destroyed was never
            // indexed under its info hash, so forgetting it left the loaded torrent's entry alone.
            operation.failed = false;
            operation.destroyPromise = undefined;
            operation.torrent = loadedDuplicate;
            operation.ownsTorrent = !loadedDuplicate.ready;
            metadata = await waitForMetadata(loadedDuplicate, operation);
        }
        if (operation.cancelled) throw new Error("torrent-resolution-cancelled");
        // operation.torrent, not `torrent`: after a duplicate join `torrent` is the destroyed copy.
        // A joined torrent keeps the source it was first added from.
        if (operation.torrent === torrent) rememberTorrent(torrent, operation.source);
        else rememberTorrent(operation.torrent);
        operation.completed = true;
        operation.resolve(metadata);
    } catch (error) {
        if (!operation.completed) {
            operation.failed = true;
            await operation.destroy();
        }
        const failure = isTorrentBytes(operation.source) && !operation.cancelled
            ? new Error("torrent-source-invalid")
            : error;
        operation.reject(failure);
    } finally {
        pendingResolvers.delete(operation);
    }
}

export function resolveTorrent(magnetOrTorrentId) {
    if (!isTorrentBytes(magnetOrTorrentId)
        && (typeof magnetOrTorrentId !== "string" || magnetOrTorrentId.trim().length === 0)) {
        return Promise.reject(new Error("torrent-identifier-required"));
    }
    if (shuttingDown) return Promise.reject(new Error("torrent-service-shutting-down"));

    const source = typeof magnetOrTorrentId === "string"
        ? magnetOrTorrentId.trim()
        : magnetOrTorrentId;
    const operation = makeResolver(source);
    void startResolver(operation);
    return operation.promise;
}

async function statTorrentFile(config, options = {}) {
    throwIfAborted(options.signal);
    const link = parseTorrentLink(config);
    const { file } = await torrentFileForLink(link, options.signal);
    throwIfAborted(options.signal);
    if (!file) return { exists: false };
    if (!Number.isSafeInteger(file.length) || file.length < 0) {
        throw new Error("torrent-file-size-invalid");
    }
    return { exists: true, size: file.length };
}

function validateRange(file, range) {
    const start = range?.start;
    const end = range?.end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        throw new Error("torrent-range-invalid");
    }
    if (end >= file.length) throw new Error("torrent-range-out-of-bounds");
    const length = end - start + 1;
    if (length > MAX_BOARD_PIPE_CHUNK_BYTES) throw new Error("torrent-range-too-large");
    return { start, end };
}

async function readTorrentRange(config, range, options = {}) {
    throwIfAborted(options.signal);
    const link = parseTorrentLink(config);
    const { torrent, file } = await torrentFileForLink(link, options.signal);
    if (!file) throw new Error("torrent-file-not-found");
    const { start, end } = validateRange(file, range);
    return readFileBytes(torrent, file, start, end, options.signal);
}

async function readTorrentBinary(config, options = {}) {
    throwIfAborted(options.signal);
    const link = parseTorrentLink(config);
    const { torrent, file } = await torrentFileForLink(link, options.signal);
    if (!file) throw new Error("torrent-file-not-found");
    if (!Number.isSafeInteger(file.length) || file.length < 0) {
        throw new Error("torrent-file-size-invalid");
    }
    if (file.length > MAX_BUFFERED_PIPE_BYTES) {
        throw new Error("torrent-file-too-large");
    }
    if (file.length === 0) return new Uint8Array(0);
    return readFileBytes(
        torrent,
        file,
        0,
        file.length - 1,
        options.signal,
        MAX_BUFFERED_PIPE_BYTES,
    );
}

function registerProvider() {
    const register = globalThis.persephone?.providers?.register;
    if (typeof register !== "function") return;
    register.call(globalThis.persephone.providers, "torrent/viewer", {
        stat: statTorrentFile,
        readRange: readTorrentRange,
        readBinary: readTorrentBinary,
    });
}

registerProvider();

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

    if (!isTorrentBytes(source)
        && (typeof source !== "string" || source.trim().length === 0)) {
        throw new Error("torrent-identifier-required");
    }
    const normalizedSource = typeof source === "string" ? source.trim() : source;
    const sourceInfoHash = extractInfoHash(normalizedSource);
    if (sourceInfoHash) removedInfoHashes.delete(sourceInfoHash);
    // A new attempt supersedes earlier failed outcomes for the same torrent. Without this every
    // board reload that re-resolves a saved source adds another "Resolution failed" row for the TTL.
    for (const previous of [...resolutionJobs.values()]) {
        if (previous.state !== "failed" && previous.state !== "cancelled") continue;
        const sameSource = typeof normalizedSource === "string" && previous.source === normalizedSource;
        const sameInfoHash = sourceInfoHash && previous.infoHash === sourceInfoHash;
        if (sameSource || sameInfoHash) expireJob(previous);
    }
    const operation = makeResolver(normalizedSource);
    const job = {
        requestId: requestId(),
        source: normalizedSource,
        infoHash: extractInfoHash(normalizedSource) ?? null,
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
        (result) => {
            // A `.torrent` file or URL only learns its info hash here.
            const resolvedInfoHash = normalizeInfoHash(result?.infoHash);
            if (resolvedInfoHash) removedInfoHashes.delete(resolvedInfoHash);
            completeJob(job, result);
        },
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

    if (job.state === "completed") {
        return { state: "completed", requestId: job.requestId, torrent: job.result };
    }
    return { state: job.state, requestId: job.requestId, error: job.error };
}

function finiteOrZero(value) {
    return Number.isFinite(value) ? value : 0;
}

/** Each file's verified bytes, index-aligned with `files`. Walking the piece map costs something
 *  per file, so a torrent nothing has been read from (the metadata-only common case) reports null. */
function fileProgressOf(torrent) {
    if (torrent.ready !== true || !(torrent.downloaded > 0) || !Array.isArray(torrent.files)) return null;
    return torrent.files.map((file) => finiteOrZero(file.downloaded));
}

function torrentStatus(torrent) {
    const selection = selectionState.get(torrent);
    const metadata = torrent.ready === true ? metadataProjection(torrent) : undefined;
    return {
        ...(metadata ?? {
            infoHash: torrent.infoHash ?? null,
            name: torrent.name ?? null,
            files: [],
            magnet: null,
        }),
        ready: torrent.ready === true,
        fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
        peers: Number.isFinite(torrent.numPeers) ? torrent.numPeers : 0,
        downloadSpeed: finiteOrZero(torrent.downloadSpeed),
        uploadSpeed: finiteOrZero(torrent.uploadSpeed),
        downloaded: finiteOrZero(torrent.downloaded),
        uploaded: finiteOrZero(torrent.uploaded),
        length: finiteOrZero(torrent.length),
        progress: finiteOrZero(torrent.progress),
        fileProgress: fileProgressOf(torrent),
        activeReaders: activeReaderCounts.get(torrent) ?? 0,
        allFilesDeselected: selection?.allDeselected === true,
    };
}

export function getServiceSnapshot() {
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
                source: typeof job.source === "string" ? job.source : null,
                lastPollAt: job.lastPollAt,
            })),
        completedMetadata: jobs
            .filter((job) => job.state !== "resolving")
            .map((job) => ({
                requestId: job.requestId,
                infoHash: job.infoHash,
                // The magnet or path string the page saved (never .torrent bytes): it lets any page
                // instance retry or forget a failed row, not only the one that started the attempt.
                source: typeof job.source === "string" ? job.source : null,
                state: job.state,
                torrent: job.result,
                error: job.error,
            })),
    };
    return snapshot;
}

export async function removeTorrent(magnetOrTorrentId) {
    const source = typeof magnetOrTorrentId === "string" ? magnetOrTorrentId.trim() : "";
    const infoHash = extractInfoHash(source);
    let torrent = infoHash ? findTorrentByInfoHash(infoHash) : undefined;
    if (!torrent && source) {
        torrent = [...new Set(torrentsByInfoHash.values())].find(
            (candidate) => torrentSources.get(candidate) === source,
        );
    }
    if (!torrent) return { removed: false };
    // No in-use check: a page still reading this torrent fails its next read (see removedInfoHashes).
    const removedInfoHash = normalizeInfoHash(torrent.infoHash);
    if (removedInfoHash) removedInfoHashes.add(removedInfoHash);
    for (const job of resolutionJobs.values()) {
        if (job.state === "resolving" && (job.source === source || (infoHash && job.infoHash === infoHash))) {
            cancelJob(job, "torrent-resolution-removed");
        } else if (job.state === "completed" && removedInfoHash
            && normalizeInfoHash(job.result?.infoHash) === removedInfoHash) {
            // A retained result would put the row back on every page's next snapshot until it expired.
            expireJob(job);
        }
    }
    forgetTorrent(torrent);
    await destroyTorrent(torrent);
    // An empty service stays running (it holds the removal marks) but releases the client's DHT and
    // tracker sockets; the next resolve creates a new client.
    const idle = torrentsByInfoHash.size === 0
        && pendingResolvers.size === 0
        && ![...resolutionJobs.values()].some((job) => job.state === "resolving");
    if (idle) await destroyClient();
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
                : getServiceSnapshot();
        case "snapshot":
            return getServiceSnapshot();
        case "cancel": {
            // The cancelling page stops polling first, so nothing needs the outcome: drop it at once
            // rather than keep a cancelled row on every page for the result TTL.
            const job = resolutionJobs.get(message.requestId);
            if (job) {
                cancelJob(job, "torrent-resolution-cancelled");
                expireJob(job);
            }
            return { state: "cancelled", requestId: message.requestId };
        }
        case "dismiss": {
            // Drop a finished outcome (a failed row) before its TTL. A resolving job is left alone.
            // The page shows one failed row per torrent, so dismiss every failed outcome for it.
            const job = resolutionJobs.get(message.requestId);
            if (job && job.state !== "resolving") {
                for (const other of [...resolutionJobs.values()]) {
                    if (other.state === "resolving" || other.state === "completed") continue;
                    const sameInfoHash = job.infoHash && other.infoHash === job.infoHash;
                    const sameSource = typeof job.source === "string" && other.source === job.source;
                    if (other === job || sameInfoHash || sameSource) expireJob(other);
                }
            }
            return { dismissed: true, requestId: message.requestId };
        }
        case "remove":
            return removeTorrent(message.magnetOrTorrentId);
        case "torrentFile": {
            // WebTorrent re-encodes the .torrent from the metadata whatever the source was, so a
            // magnet-resolved torrent can be saved too. Base64: the reply crosses the main process.
            const torrent = findTorrentByInfoHash(message.infoHash);
            if (!torrent?.ready || !torrent.torrentFile) throw new Error("torrent-file-unavailable");
            return { name: torrent.name ?? null, base64: Buffer.from(torrent.torrentFile).toString("base64") };
        }
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
