// PDF Viewer board — hosts pdf.js's stock viewer and feeds it the file Persephone
// opened us for.
//
// How it works (and why):
//   * `lib/pdfjs/web/viewer.html` is the UNMODIFIED stock pdf.js viewer, vendored into
//     this board. Reusing it means the whole viewer UI — search, thumbnails, outline,
//     zoom/fit, rotate, text layer, print — comes for free instead of being rewritten.
//   * It runs in a nested iframe that shares this board's `board://<host>` origin, so we
//     can reach into it and call `PDFViewerApplication.open({ data })` directly. That
//     avoids a `blob:` URL entirely, which matters because the board CSP's `connect-src`
//     is `'self'` only and would block fetching one.
//   * The frame is loaded with an EMPTY `?file=` parameter on purpose. The stock viewer
//     does `file = params.get("file") ?? defaultUrl` and then `if (file) this.open(...)`,
//     so an empty value suppresses its auto-open — no attempt to load the sample PDF
//     (which is pruned out of our vendored copy) and no spurious error dialog.
//
// Scope: read-only. Every source Persephone can open is supported — a plain local file, a
// PDF inside an archive, and an `https` URL — with no source-specific code here: the
// manifest declares `editorSources: "any"`, and `getFilePath()` then always hands back a
// readable LOCAL path (Persephone materializes a non-local source into a temp cache file
// first). The only consequence for this board is that the call can be slow and can reject.

const P = window.persephone;

const frame = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const titleEl = document.getElementById("status-title");
const detailEl = document.getElementById("status-detail");
const diagnosticsEl = document.getElementById("diagnostics");

/** CSP violations seen in this frame or the viewer frame, newest last. The shim also
 *  mirrors these into the board's `ui.log`; collecting them here lets the board SHOW
 *  the blocker instead of rendering an unexplained blank frame. */
const violations = [];

function recordViolation(e) {
    const entry = (e.effectiveDirective || e.violatedDirective || "?")
        + " ← " + (e.blockedURI || "(inline)");
    if (!violations.includes(entry)) violations.push(entry);
}

window.addEventListener("securitypolicyviolation", recordViolation);

function showStatus(title, detail) {
    titleEl.textContent = title;
    detailEl.textContent = detail || "";
    statusEl.classList.add("visible");
}

function hideStatus() {
    statusEl.classList.remove("visible");
}

function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// ── Capability probes ───────────────────────────────────────────────────────────────
// v1 doubles as the spike that establishes what the board CSP does and does not permit
// pdf.js to do. Each probe answers one directive, so a failure names its own fix.

/** `worker-src` / `child-src`: can pdf.js start its real worker? Without it pdf.js falls
 *  back to an in-thread "fake worker" — correct output, but parsing blocks the UI. */
async function probeWorker() {
    return new Promise((resolve) => {
        let worker;
        const done = (value) => {
            try { worker && worker.terminate(); } catch { /* already gone */ }
            resolve(value);
        };
        try {
            worker = new Worker("./lib/pdfjs/build/pdf.worker.mjs", { type: "module" });
        } catch (err) {
            resolve({ ok: false, note: (err && err.name ? err.name + ": " : "") + (err && err.message ? err.message : String(err)) });
            return;
        }
        // A CSP-blocked worker constructs without throwing in some Chromium versions and
        // fails asynchronously, so wait briefly for an error before calling it good.
        worker.addEventListener("error", (e) => done({ ok: false, note: e.message || "worker error event" }));
        setTimeout(() => done({ ok: true, note: "constructed, no error" }), 400);
    });
}

/** `script-src 'wasm-unsafe-eval'`: needed by pdf.js's openjpeg decoder for JPEG 2000
 *  images. A minimal 8-byte empty module is enough to test the permission. */
async function probeWasm() {
    const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    try {
        await WebAssembly.compile(empty);
        return { ok: true, note: "compiled empty module" };
    } catch (err) {
        return { ok: false, note: (err && err.message) ? err.message : String(err) };
    }
}

function renderDiagnostics(rows) {
    const cells = rows.map((r) => {
        const verdict = r.ok ? '<span class="ok">works</span>' : '<span class="fail">blocked</span>';
        return "<tr><th>" + r.label + "</th><td>" + verdict + "</td><td>" + r.note + "</td></tr>";
    }).join("");
    const violationRows = violations.length
        ? "<tr><th>CSP violations</th><td colspan=\"2\">" + violations.join("<br>") + "</td></tr>"
        : "";
    diagnosticsEl.innerHTML = "<table>" + cells + violationRows + "</table>";
}

/** Escape a string for safe interpolation into the diagnostics table. */
function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
    ));
}

async function runDiagnostics(frameLoaded) {
    const [worker, wasm] = await Promise.all([probeWorker(), probeWasm()]);
    const rows = [
        {
            label: "Nested iframe (frame-src)",
            ok: frameLoaded.ok,
            note: escapeHtml(frameLoaded.note),
        },
        { label: "pdf.js worker (worker-src)", ok: worker.ok, note: escapeHtml(worker.note) },
        { label: "WebAssembly (wasm-unsafe-eval)", ok: wasm.ok, note: escapeHtml(wasm.note) },
    ];
    renderDiagnostics(rows);
    // Surface the whole verdict in one place for the spike write-up.
    console.log("[pdf-viewer] capability probes: " + JSON.stringify({
        frame: frameLoaded, worker, wasm, violations,
    }));
    return rows;
}

// ── Viewer wiring ───────────────────────────────────────────────────────────────────

/** Load the stock viewer into the iframe and wait until its application object is
 *  initialized. Resolves `{ ok, note, win }` — `ok: false` means the frame did not
 *  become a usable pdf.js viewer (the `frame-src` verdict). */
async function loadViewerFrame() {
    const loaded = new Promise((resolve) => {
        frame.addEventListener("load", () => resolve(true), { once: true });
        // A CSP-blocked frame never becomes a viewer; don't hang forever waiting.
        setTimeout(() => resolve(false), 10000);
    });

    frame.src = "./lib/pdfjs/web/viewer.html?file=";

    const fired = await loaded;
    if (!fired) return { ok: false, note: "no load event within 10s" };

    let win;
    try {
        win = frame.contentWindow;
    } catch (err) {
        return { ok: false, note: "contentWindow unreachable: " + (err && err.message ? err.message : String(err)) };
    }
    if (!win) return { ok: false, note: "contentWindow is null" };

    // Same origin, so we can watch the viewer's own CSP violations too.
    try {
        win.addEventListener("securitypolicyviolation", recordViolation);
    } catch { /* not reachable — reported by the checks below */ }

    const app = win.PDFViewerApplication;
    if (!app) {
        return {
            ok: false,
            note: "frame loaded but PDFViewerApplication is absent — the document is "
                + (win.location && win.location.href ? win.location.href : "unknown"),
        };
    }

    try {
        await app.initializedPromise;
    } catch (err) {
        return { ok: false, note: "initializedPromise rejected: " + (err && err.message ? err.message : String(err)) };
    }

    return { ok: true, note: "pdf.js " + (win.pdfjsVersion || app.constructor?.version || "loaded"), win };
}

async function main() {
    if (!P) {
        showStatus("Persephone bridge unavailable", "This board must run inside Persephone.");
        return;
    }

    // Start the viewer frame immediately and resolve the path alongside it. The two are
    // independent, and `getFilePath()` can take as long as a download for a non-local source —
    // there is no reason for the frame to queue behind it.
    const framePromise = loadViewerFrame();

    // Safe to await at any time — resolves once the host handshake lands. Always a readable LOCAL
    // path: for an archive entry or an https URL Persephone materializes the source into a temp file
    // and hands us that instead, so this call can take as long as a download — and it REJECTS when
    // the source is unreadable (missing archive entry, HTTP failure), which is NOT the same as the
    // `undefined` a plainly-opened board gets. Show a status while it runs, so a remote PDF does not
    // sit on a blank frame with no explanation.
    showStatus("Opening…", "Resolving the document source.");
    let filePath;
    try {
        filePath = await P.getFilePath();
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        showStatus("Could not read the document", message);
        P.notify("Failed to read the PDF source: " + message, "error");
        return;
    }

    const frameResult = await framePromise;

    if (!filePath) {
        // Opened as a plain board rather than as a file's editor. Still useful: show the
        // capability verdict, which is exactly what v1 exists to report.
        showStatus(
            "No document",
            "This board opens PDF files. Open a .pdf file to view it.\n"
            + "Capability probes for this Persephone build:",
        );
        await runDiagnostics(frameResult);
        return;
    }

    if (!frameResult.ok) {
        showStatus("Could not load the PDF viewer", frameResult.note);
        await runDiagnostics(frameResult);
        P.notify("PDF viewer frame failed to load — see the board for details.", "error");
        return;
    }

    try {
        showStatus("Reading…", filePath);
        const startedRead = performance.now();
        // Bytes straight from the bridge — pdf.js wants a Uint8Array, which is exactly what
        // `encoding: "binary"` returns (app 4.0.21+, declared as minAppVersion). The old base64
        // route cost an atob + a per-byte decode here, and capped the board at ~400 MB, where
        // base64 of the file exceeds V8's maximum string length.
        const bytes = await P.readFile(filePath, { encoding: "binary" });
        const readMs = Math.round(performance.now() - startedRead);

        const startedOpen = performance.now();
        await frameResult.win.PDFViewerApplication.open({ data: bytes });
        const openMs = Math.round(performance.now() - startedOpen);

        hideStatus();
        // Kept as a cheap perf trace: a slow open here is the board's own doing, whereas a slow
        // `getFilePath()` above is Persephone materializing a non-local source.
        console.log("[pdf-viewer] " + formatBytes(bytes.length)
            + " read in " + readMs + "ms, opened in " + openMs + "ms");
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        showStatus("Could not open the document", message + "\n" + filePath);
        await runDiagnostics(frameResult);
        P.notify("Failed to open PDF: " + message, "error");
    }
}

main();
