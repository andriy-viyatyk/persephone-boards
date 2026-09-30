// Range Provider Test — frontend.
//
// This same file serves two different roles depending on how the page was opened (see README.md):
//
//   - Opened standalone (Boards panel, boards.openBoard, …): `persephone.host.streamUrl()`
//     rejects (this instance isn't acting as any file's editor), so we render the CONSOLE —
//     buttons that build a `rangetest:`/`norangetest:` scenario link and hand it to
//     `persephone.openRawLink()`.
//   - Opened AS the editor for one of those links (this board also claims `*.rangefix` as a
//     stream-host editor): `streamUrl()` resolves, so we render the STREAM PROBE — fetches against
//     that URL with explicit Range headers, verified byte-for-byte against the same deterministic
//     formula the service uses.

(() => {
    const P = window.persephone;

    // Must match scripts/service.mjs's genByte() exactly — see that file's comment on the 32-bit
    // bitwise math and the `size` cap that keeps it correct.
    function genByte(i) {
        const lo = i & 0xff;
        const mid = (i >>> 8) & 0xff;
        return (lo ^ mid ^ 0xa5) & 0xff;
    }

    function verify(bytes, startOffset) {
        for (let k = 0; k < bytes.length; k++) {
            if (bytes[k] !== genByte(startOffset + k)) {
                return `MISMATCH at offset ${startOffset + k}: expected ${genByte(startOffset + k)}, got ${bytes[k]}`;
            }
        }
        return `OK — all ${bytes.length} bytes match genByte(offset)`;
    }

    // ── Scenario link builder (console mode) ─────────────────────────────────────────────────
    const MB = 1024 * 1024;
    const scenarios = {
        "cold-small": { scheme: "rangetest", size: 4096 },
        "large": { scheme: "rangetest", size: 300 * MB },
        "slow-first-byte": { scheme: "rangetest", size: MB, delay: 3000 },
        "stall": { scheme: "rangetest", size: 4096, stall: true },
        "no-range": { scheme: "norangetest", size: 2 * MB },
        "no-range-oversized": { scheme: "norangetest", size: 300 * MB },
    };

    function buildUrl(name) {
        const s = scenarios[name];
        const params = new URLSearchParams();
        params.set("size", String(s.size));
        if (s.delay) params.set("delay", String(s.delay));
        if (s.stall) params.set("stall", "1");
        return `${s.scheme}://fixture/${name}.rangefix?${params.toString()}`;
    }

    function formatCounters(counters) {
        return JSON.stringify(counters, null, 2);
    }

    async function startConsole() {
        document.getElementById("console").style.display = "";

        document.querySelectorAll("button[data-scenario]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const url = buildUrl(btn.getAttribute("data-scenario"));
                P.openRawLink(url);
                P.notify(`Opened: ${url}`, "info");
            });
        });

        const countersOut = document.getElementById("counters-out");
        document.getElementById("refresh-counters").addEventListener("click", async () => {
            try {
                const counters = await P.service.request({ op: "counters" });
                countersOut.textContent = formatCounters(counters);
            } catch (error) {
                countersOut.textContent = "Error: " + (error && error.message ? error.message : String(error));
            }
        });
        document.getElementById("reset-counters").addEventListener("click", async () => {
            try {
                const counters = await P.service.request({ op: "reset-counters" });
                countersOut.textContent = formatCounters(counters);
            } catch (error) {
                countersOut.textContent = "Error: " + (error && error.message ? error.message : String(error));
            }
        });
    }

    // ── Stream probe (opened as the *.rangefix editor) ────────────────────────────────────────
    function parseContentRangeTotal(header) {
        // "bytes start-end/total"
        const match = /\/(\d+)\s*$/.exec(header || "");
        return match ? Number(match[1]) : undefined;
    }

    async function startStreamProbe(streamUrl) {
        document.getElementById("stream-page").style.display = "";
        const out = document.getElementById("out");
        out.textContent = "";

        function log(line) {
            out.textContent += (out.textContent ? "\n" : "") + line;
        }

        let total;
        const endBtn = document.getElementById("probe-end");

        async function fetchRange(start, end) {
            const t0 = performance.now();
            log(`GET Range: bytes=${start}-${end} …`);
            const response = await fetch(streamUrl, { headers: { Range: `bytes=${start}-${end}` } });
            const bytes = new Uint8Array(await response.arrayBuffer());
            const ms = Math.round(performance.now() - t0);
            const contentRange = response.headers.get("Content-Range") ?? "(missing)";
            const foundTotal = parseContentRangeTotal(contentRange);
            if (foundTotal !== undefined) {
                total = foundTotal;
                endBtn.disabled = false;
            }
            log(`  status=${response.status} · Content-Range=${contentRange} · ${bytes.length} bytes · ${ms}ms`);
            if (response.ok) {
                log(`  ${verify(bytes, start)}`);
            } else {
                // A non-2xx body is an error payload (e.g. the 256 MB buffered ceiling rejecting
                // an oversized no-range resource, or the ~10s deadline timing out a stall=1
                // scenario — see README.md), not resource bytes; verifying it against genByte()
                // would always report a false "MISMATCH".
                log(`  (error response, not resource data): ${new TextDecoder().decode(bytes)}`);
            }
            return bytes;
        }

        document.getElementById("probe-first").addEventListener("click", () => {
            fetchRange(0, 63).catch((error) => log("ERROR: " + (error && error.message ? error.message : String(error))));
        });
        document.getElementById("probe-again").addEventListener("click", () => {
            fetchRange(0, 63).catch((error) => log("ERROR: " + (error && error.message ? error.message : String(error))));
        });
        endBtn.addEventListener("click", () => {
            if (total === undefined) return;
            fetchRange(total - 64, total - 1).catch((error) =>
                log("ERROR: " + (error && error.message ? error.message : String(error))));
        });

        // Cold-start probe: fires immediately on open with no prior request to this board's
        // service — this is EPIC-113 acceptance item 7. A `stall=1` scenario will hang here
        // (or, until US-1518 removes the deadline, time out after ~10s) — close this page's tab
        // to exercise the release path (EPIC-113 D6).
        log("Cold-start probe — first read since this page opened:");
        fetchRange(0, 63).catch((error) => log("ERROR: " + (error && error.message ? error.message : String(error))));
    }

    // ── Mode detection ─────────────────────────────────────────────────────────────────────
    // persephone.host.streamUrl() already awaits the board's handshake internally, but the
    // handshake's pipe-page-id field can still land in a SECOND message shortly after the first
    // one settles whenHandshake() (observed while testing this fixture) — so a single immediate
    // call can throw "Persephone did not provide a page id for streamUrl()" on a page that IS a
    // valid stream-host target. Retry briefly before concluding this is a plain/standalone open.
    async function detectStreamUrl(attempts = 100, intervalMs = 200) {
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                return await P.host.streamUrl();
            } catch (error) {
                if (attempt === attempts - 1) throw error;
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
        }
        throw new Error("unreachable");
    }

    (async () => {
        try {
            const streamUrl = await detectStreamUrl();
            await startStreamProbe(streamUrl);
        } catch {
            await startConsole();
        }
    })();
})();
