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

let currentPath = ""; // the file path (for the name label / reload)

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
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        docEl.innerHTML = "";
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
