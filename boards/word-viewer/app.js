// Word Viewer — frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH (not content). We read the
// bytes ourselves and render the .docx with docx-preview (which uses JSZip to unzip the OOXML
// package). Read-only — there is no write path. See CLAUDE.md for the board-specific notes and
// read_guide("boards") for the generic persephone.* bridge reference.

const P = window.persephone;

// DOM handles.
const nameEl = document.getElementById("name");
const stateEl = document.getElementById("state");
const reloadBtn = document.getElementById("reload");
const docEl = document.getElementById("doc");
const zoomEl = document.getElementById("zoom");

let currentPath = ""; // the file path (for the name label / reload)

// ---- zoom ----------------------------------------------------------------------------------
// The document is a SCROLLING view (docx-preview renders paper pages stacked in the scrollable
// #doc). So — unlike the drawio-viewer's transform/pan-to-fit for a single centered diagram —
// zoom here is the CSS `zoom` property applied to the rendered `.docx-wrapper`. `zoom` scales
// layout (not just paint), so scroll metrics grow with it and scrolling stays natural. We keep
// the point under the cursor fixed by adjusting scroll after each change (content point =
// (scrollPos + cursorOffset) / zoom, invariant across zoom). The level persists across a reload
// (re-applied to the freshly-rendered wrapper) so re-reading the file keeps your zoom.
const zoomCtl = (() => {
    const MIN = 0.25;
    const MAX = 5;
    const STEP = 0.1;

    let zoom = 1;
    let wrapper = null; // .docx-wrapper — the transform target; re-grabbed after each render.

    function applyZoom() {
        if (wrapper) wrapper.style.zoom = String(zoom);
        zoomEl.textContent = Math.round(zoom * 100) + "%";
    }

    // Set the zoom level, keeping the content point under (clientX, clientY) fixed. With no
    // coordinates (reset / keyboard) it anchors on the viewport center.
    function setZoom(next, clientX, clientY) {
        if (!wrapper) return;
        const clamped = Math.max(MIN, Math.min(MAX, next));
        const rect = docEl.getBoundingClientRect();
        const px = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
        const py = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;
        // Content-space coordinates of that point BEFORE the change (unaffected by zoom).
        const contentX = (docEl.scrollLeft + px) / zoom;
        const contentY = (docEl.scrollTop + py) / zoom;
        zoom = clamped;
        applyZoom();
        // Re-place the same content point under the cursor at the new zoom.
        docEl.scrollLeft = contentX * zoom - px;
        docEl.scrollTop = contentY * zoom - py;
    }

    // Ctrl+Wheel zooms toward the cursor; a plain wheel scrolls the document normally.
    docEl.addEventListener(
        "wheel",
        (e) => {
            if (!e.ctrlKey || !wrapper) return;
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1 + STEP : 1 / (1 + STEP);
            setZoom(zoom * factor, e.clientX, e.clientY);
        },
        { passive: false },
    );

    // Ctrl +/-/0 — standard zoom shortcuts, mirroring the drawio-viewer.
    window.addEventListener("keydown", (e) => {
        if (!e.ctrlKey || !wrapper) return;
        if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            setZoom(zoom * (1 + STEP));
        } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            setZoom(zoom / (1 + STEP));
        } else if (e.key === "0") {
            e.preventDefault();
            setZoom(1);
        }
    });

    // Click the pill to reset to 100%.
    zoomEl.addEventListener("click", () => setZoom(1));

    return {
        // Call after a document renders: grab the freshly-rendered wrapper, show the pill, and
        // re-apply the current zoom level (so reload keeps the zoom).
        onRendered() {
            wrapper = docEl.querySelector(".docx-wrapper");
            zoomEl.style.display = "block";
            applyZoom();
        },
        // Call for empty/error states (no document): hide the pill, forget the target.
        clear() {
            wrapper = null;
            zoomEl.style.display = "none";
        },
    };
})();

// Note: right-click on a link (Open Link / Copy Link) and on selected text (Copy) is provided
// globally by Persephone's board shim for every board — no board code needed here.

// ---- state overlay -------------------------------------------------------------------------

function showState(message, isError) {
    stateEl.textContent = message;
    stateEl.classList.toggle("error", !!isError);
    stateEl.classList.add("show");
}

function hideState() {
    stateEl.classList.remove("show", "error");
}

function fileName(p) {
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
}

// docx-preview render options. Defaults already give the page-accurate "looks like Word" view
// (inWrapper wraps each section as a paper page). We keep headers/footers/notes on and force
// images to inline data: URLs (useBase64URL) so nothing is fetched over the network — the board
// CSP forbids remote requests, and data: URLs avoid relying on blob: being allowed by img-src.
const RENDER_OPTIONS = {
    className: "docx",
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false, // embedded fonts come from the docx zip (offline-safe)
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    useBase64URL: true, // inline images as data: URLs, not blob:
};

// ---- load the file -------------------------------------------------------------------------

async function load() {
    try {
        showState("Loading…");
        reloadBtn.disabled = true;
        zoomCtl.clear();
        // renderAsync appends into the container; clear any previous render (and its injected
        // <style>) so a reload / re-open starts clean.
        docEl.innerHTML = "";

        const path = await P.getFilePath();
        currentPath = path || "";

        if (!currentPath) {
            // Opened plainly (not as an editor for a file) — clean empty state, no crash.
            nameEl.textContent = "Word Viewer";
            showState("No file open.\nOpen a .docx file to view it here.");
            return;
        }

        nameEl.textContent = fileName(currentPath);
        reloadBtn.disabled = false;

        const b64 = await P.readFile(currentPath, { encoding: "base64" });
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const blob = new Blob([bytes], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        // Render body + inject styles both into #doc so docx-preview's CSS stays scoped there.
        await docx.renderAsync(blob, docEl, docEl, RENDER_OPTIONS);
        hideState();
        zoomCtl.onRendered();
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        docEl.innerHTML = "";
        zoomCtl.clear();
        showState("Could not open this file.\n" + message, true);
        P.notify(message, "error");
    }
}

// ---- wire up -------------------------------------------------------------------------------

// Reload re-reads the file from disk (it may have changed outside the app). This is a simple
// board with no content host, so there's no onContentChange — the toolbar Reload (and the
// board_refresh MCP tool, which re-runs this script) are the only re-render triggers.
reloadBtn.addEventListener("click", load);

load();
