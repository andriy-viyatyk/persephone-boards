// Content Open Test — US-1521 fixture.
//
// The Range Provider Test board next door is `stream-host`, so it can reach the platform pipe
// through `persephone.host.streamUrl()` and proves nothing about the gate US-1521 removed. THIS
// board declares nothing at all, which makes it `simple` — the kind every published board is, and
// the kind D9 names as the migration target off `getFilePath()`. If `content.open()` works here,
// it works for the boards that need it.

(() => {
    const P = window.persephone;
    const out = document.getElementById("out");

    function log(line) {
        out.textContent += (out.textContent === "(not yet run)" ? "" : "\n") + line;
    }

    // Must match scripts/service.mjs's genByte() in the range-provider-test board — the two
    // fixtures share the rangetest: scheme, and a cross-board link is exactly what a trusted
    // board may resolve (EPIC-113 D11: ownership is about who REGISTERED the scheme, not who
    // uses it).
    function genByte(i) {
        return ((i & 0xff) ^ ((i >>> 8) & 0xff) ^ 0xa5) & 0xff;
    }

    async function probe(label, link, options) {
        try {
            const t0 = performance.now();
            const result = await P.content.open(link, options);
            const ms = Math.round(performance.now() - t0);
            log(`\n${label}`);
            log(`  link        ${link}`);
            log(`  url         ${result.url}`);
            log(`  size        ${result.size}`);
            log(`  contentType ${result.contentType}`);
            log(`  opened in   ${ms}ms`);
            return result;
        } catch (error) {
            log(`\n${label}`);
            log(`  link        ${link}`);
            log(`  REJECTED    ${error && error.message ? error.message : String(error)}`);
            return undefined;
        }
    }

    async function fetchRange(result, start, end, verifyBytes) {
        if (!result) return;
        try {
            const response = await fetch(result.url, { headers: { Range: `bytes=${start}-${end}` } });
            const bytes = new Uint8Array(await response.arrayBuffer());
            log(`  GET ${start}-${end} → status=${response.status}`
                + ` · Content-Range=${response.headers.get("Content-Range") ?? "(missing)"}`
                + ` · Content-Type=${response.headers.get("Content-Type") ?? "(missing)"}`
                + ` · ${bytes.length} bytes`);
            if (verifyBytes) {
                for (let k = 0; k < bytes.length; k++) {
                    if (bytes[k] !== genByte(start + k)) {
                        log(`  MISMATCH at ${start + k}: expected ${genByte(start + k)}, got ${bytes[k]}`);
                        return;
                    }
                }
                log(`  bytes OK — all ${bytes.length} match genByte(offset)`);
            }
        } catch (error) {
            log(`  FETCH FAILED ${error && error.message ? error.message : String(error)}`);
        }
    }

    let lastUrl;

    async function run() {
        out.textContent = "(not yet run)";
        log(`persephone.content is ${typeof P.content}`);
        log(`host.streamUrl() should reject for a simple board:`);
        try {
            const url = await P.host.streamUrl();
            log(`  UNEXPECTED — resolved: ${url}`);
        } catch (error) {
            log(`  rejected as expected: ${error && error.message ? error.message : String(error)}`);
        }

        // A board scheme owned by the OTHER fixture board, served by its provider's readRange.
        const ranged = await probe(
            "1. board scheme, ranged provider (cross-board)",
            "rangetest://fixture/probe.rangefix?size=1048576",
        );
        await fetchRange(ranged, 0, 63, true);
        if (ranged) await fetchRange(ranged, ranged.size - 64, ranged.size - 1, true);
        if (ranged) lastUrl = ranged.url;

        // MIME: the extensions US-1521 added, which the old audio/video/image-only table missed.
        await probe("2. contentType — .pdf", sampleFile("pdf"));
        await probe("3. contentType — .md", sampleFile("md"));
        await probe("4. contentType — .json", sampleFile("json"));

        // The no-range provider: buffered fallback must still work through this route.
        const buffered = await probe(
            "5. board scheme, NO readRange (buffered fallback)",
            "norangetest://fixture/probe.rangefix?size=65536",
        );
        await fetchRange(buffered, 0, 63, true);

        // Correctness, not permission: an unresolvable link must reject cleanly (D11).
        await probe("6. unresolvable link rejects", "no-such-scheme://nothing/at/all");

        // The timeoutMs escape hatch against a source that never returns a byte.
        await probe(
            "7. stalled source + timeoutMs aborts",
            "rangetest://fixture/stall.rangefix?size=4096&stall=1",
            { timeoutMs: 3000 },
        );

        log("\nDone.");
    }

    // Real files on disk, named with the extension under test, so contentType is derived exactly
    // as it will be for a published viewer board. A plain board's `getFolderPath()` is undefined
    // (it claims no folder), so the fixture's own location is hardcoded — these files are checked
    // in beside this file.
    const FIXTURE_DIR = "C:/projects/persephone-boards/_test/content-open-test-fixture";

    function sampleFile(extension) {
        return `${FIXTURE_DIR}/sample.${extension}`;
    }

    document.getElementById("run").addEventListener("click", () => { void run(); });
    document.getElementById("revoke").addEventListener("click", async () => {
        if (!lastUrl) { log("\nRun the probes first."); return; }
        log(`\nRe-fetching the URL from before this frame reloaded:`);
        log(`  ${lastUrl}`);
        try {
            const response = await fetch(lastUrl, { headers: { Range: "bytes=0-63" } });
            log(`  status=${response.status} (expected: a live resource is still served)`);
        } catch (error) {
            log(`  rejected: ${error && error.message ? error.message : String(error)}`);
        }
    });

    void run();
})();
