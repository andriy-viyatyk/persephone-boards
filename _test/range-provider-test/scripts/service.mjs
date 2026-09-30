import { promises as fs } from "node:fs";

// Range Provider Test — module service.
//
// Registers two content providers used to exercise EPIC-113 / US-1474 (a board provider that
// serves ranged reads through the module service) without a torrent or a real swarm:
//
//   test/range   (scheme "rangetest")   — implements readBinary, readRange, stat.
//   test/norange (scheme "norangetest") — implements only readBinary + stat (no ranging), so the
//                                         "a provider without ranging behaves exactly as before"
//                                         case can be exercised.
//
// Both providers serve a large SYNTHETIC resource that is generated on demand and never stored
// on disk or held whole in memory: byte at absolute offset `i` is `genByte(i)`, a pure function of
// `i`, so any returned range can be checked in isolation against what it should contain — see
// README.md for the formula and the exact URL/query contract.
//
// Deliberately controllable behaviour is driven entirely by the requested link's query string
// (parsed from `config.url`, which is the full href `createBoardSchemeHooks` puts in the pipe
// descriptor's provider config — see board-manifest.json's `contentProviders` and
// custom-editor-registry.ts):
//
//   size   - total resource size in bytes (default 4096; capped at 4294967295 = 2^32-1, see
//            README's note on the 32-bit byte formula).
//   delay  - milliseconds to wait before answering EVERY read against this URL (default 0, capped
//            at 30000).
//   stall  - "1" makes every read against this URL hang forever (never resolves on its own) — used
//            to exercise EPIC-113 D6 ("a content read waits until the page closes").
//
// Call counters (readBinary vs readRange, per provider type) are kept in memory here and exposed
// to the board frame over `persephone.service.request({ op: "counters" })` — see README.md.

const counters = {
    "test/range": { readBinary: 0, readRange: 0, lastRanges: [] },
    "test/norange": { readBinary: 0, readRange: 0, lastRanges: [] },
};

function recordCall(type, op, range) {
    const bucket = counters[type];
    bucket[op] += 1;
    if (range) {
        bucket.lastRanges.push({ start: range.start, end: range.end, at: Date.now() });
        if (bucket.lastRanges.length > 20) bucket.lastRanges.shift();
    }
}

function resetCounters() {
    for (const bucket of Object.values(counters)) {
        bucket.readBinary = 0;
        bucket.readRange = 0;
        bucket.lastRanges.length = 0;
    }
}

// Deterministic synthetic byte at absolute offset `i`. Kept to 32-bit-safe bitwise math (see the
// `size` cap below) so this formula matches exactly between here (Node) and the board frame
// (browser JS), which re-derives it to verify a fetched range without ever seeing the whole
// resource.
function genByte(i) {
    const lo = i & 0xff;
    const mid = (i >>> 8) & 0xff;
    return (lo ^ mid ^ 0xa5) & 0xff;
}

function generateRange(start, end) {
    const length = end - start + 1;
    const data = new Uint8Array(length);
    for (let k = 0; k < length; k++) data[k] = genByte(start + k);
    return data;
}

// A `file=<absolute path>` link serves THAT FILE's real bytes instead of the synthetic generator.
// EPIC-113 acceptance item 5 needs the built-in media player to play a resource served by a BOARD
// PROVIDER, and synthetic bytes are not decodable media, so the fixture has to be able to hand out
// something a codec accepts. Ranges still go through readRange, so the ranged path is what carries
// the playback; nothing is cached and nothing is copied.
function paramFile(params) {
    const raw = params.get("file");
    return raw ? decodeURIComponent(raw) : undefined;
}

async function readFileRange(filePath, start, end) {
    const handle = await fs.open(filePath, "r");
    try {
        const length = end - start + 1;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
        await handle.close();
    }
}

function parseParams(config) {
    try {
        return new URL(String(config && config.url)).searchParams;
    } catch {
        return new URLSearchParams();
    }
}

function paramInt(params, name, fallback) {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// Capped below 2^32 so genByte()'s `>>> 8` (a 32-bit unsigned bitwise op in both Node and the
// browser) never wraps for any offset inside the resource. Still comfortably above
// MAX_BUFFERED_PIPE_BYTES (256 MiB), so the "resource larger than the buffered ceiling" scenario
// (EPIC-113 acceptance item 3) is reachable.
const MAX_SIZE = 4294967295;

function paramSize(params) {
    return Math.max(0, Math.min(paramInt(params, "size", 4096), MAX_SIZE));
}

function paramDelayMs(params) {
    return Math.max(0, Math.min(paramInt(params, "delay", 0), 30_000));
}

function paramStall(params) {
    return params.get("stall") === "1";
}

async function applyControls(params) {
    if (paramStall(params)) {
        // Never resolves on its own — and since US-1518 shipped, the platform truly waits rather
        // than timing out at ~10s. A caller that wants a bound supplies one: `content.open()`
        // takes `timeoutMs` (US-1521); a page read is released by closing the page.
        return new Promise(() => {});
    }
    const delayMs = paramDelayMs(params);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function makeImplementation(type, supportsRange) {
    const implementation = {
        writable: false,
        async readBinary(config) {
            const params = parseParams(config);
            await applyControls(params);
            recordCall(type, "readBinary");
            const filePath = paramFile(params);
            if (filePath) {
                const { size } = await fs.stat(filePath);
                return readFileRange(filePath, 0, Math.max(0, size - 1));
            }
            const size = paramSize(params);
            return generateRange(0, Math.max(0, size - 1));
        },
        async stat(config) {
            const params = parseParams(config);
            // stat() honours `delay`/`stall` too. It used not to, which made the stall scenario
            // silently untestable for anything that sizes a resource BEFORE reading it —
            // `persephone.content.open()` (US-1521) resolves size eagerly, so a stall that skipped
            // stat() returned instantly and proved nothing about its `timeoutMs` escape hatch.
            await applyControls(params);
            const filePath = paramFile(params);
            if (filePath) {
                const { size } = await fs.stat(filePath);
                return { exists: true, size };
            }
            return { exists: true, size: paramSize(params) };
        },
    };
    if (supportsRange) {
        implementation.readRange = async (config, range) => {
            const params = parseParams(config);
            await applyControls(params);
            recordCall(type, "readRange", range);
            const filePath = paramFile(params);
            if (filePath) return readFileRange(filePath, range.start, range.end);
            return generateRange(range.start, range.end);
        };
    }
    return implementation;
}

globalThis.persephone.providers.register("test/range", makeImplementation("test/range", true));
globalThis.persephone.providers.register("test/norange", makeImplementation("test/norange", false));

async function handleRequest(message) {
    const request = message && typeof message === "object" ? message : {};
    switch (request.op) {
        case "counters":
            return JSON.parse(JSON.stringify(counters));
        case "reset-counters":
            resetCounters();
            return JSON.parse(JSON.stringify(counters));
        default:
            throw new Error(`unknown-operation:${String(request.op)}`);
    }
}

persephone.service.onRequest(async (message) => {
    try {
        return await handleRequest(message);
    } catch (error) {
        console.error("Range Provider Test service request failed:", error);
        throw Object.assign(new Error("service-request-failed"), { code: "service-error" });
    }
});
