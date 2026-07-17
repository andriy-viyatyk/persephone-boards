// DrawIO Viewer board — a read-only viewer for .drawio (diagrams.net) files.
//
// Persephone opens this board as a CONTENT-HOST custom editor for *.drawio files
// (board-manifest.json: fileMasks/editorPriority/editorName + editorKind:"content-host").
// Persephone owns the file (pipe/encoding/encryption/cache/dirty state); the board reads
// the XML through the content host — persephone.host.getContent() for the current content
// and persephone.host.onContentChange() to re-render when it changes. Each page is rendered
// with the vendored GraphViewer (lib/viewer-static.min.js), which auto-decompresses encoded
// <diagram> bodies.
//
// The host is SHARED with the built-in editors: switch to Monaco (the "DrawIO"↔raw-XML
// switch in the page toolbar) and the same host transfers over — edit the raw XML there,
// switch back, and onContentChange re-renders the diagram from the current content. Ctrl+S
// saves through Persephone's pipe automatically (the shim wires it). This viewer is
// read-only, so it never calls persephone.host.setContent() — editing is Monaco's job.
//
// Multi-page: GraphViewer's own page toolbar relies on remote sprite/stylesheet
// assets that the board CSP forbids (connect-src 'self'), so it can't be used here.
// Instead we parse the <diagram> pages ourselves and render an always-visible tab
// bar — offline, and clearer than drawio's hover toolbar. Each page is rendered by
// wrapping its <diagram> back into a single-page <mxfile> and handing it to GraphViewer.
//
// Fully offline: the renderer is vendored locally (no CDN). Opened plainly (no
// content host) the board shows an empty state.

const P = window.persephone;

const nameEl = document.getElementById("name");
const tabsEl = document.getElementById("tabs");
const canvas = document.getElementById("canvas");
const stateEl = document.getElementById("state");
const copyBtn = document.getElementById("copy");

function showState(message, isError) {
    stateEl.textContent = message;
    stateEl.classList.toggle("error", !!isError);
    stateEl.classList.add("show");
}

function hideState() {
    stateEl.classList.remove("show", "error");
}

// The "Copy PNG" action is only meaningful while a diagram is on screen.
function setCopyEnabled(on) {
    copyBtn.disabled = !on;
}

function basename(p) {
    const m = /[^\\/]+$/.exec(p || "");
    return m ? m[0] : p;
}

// Split a .drawio file into its pages. Each <diagram> (plain or compressed body) is
// re-wrapped into a standalone single-page <mxfile> that GraphViewer renders directly
// (it decompresses encoded bodies itself). Returns null if the XML has no <diagram>.
function parsePages(xml) {
    try {
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        if (doc.querySelector("parsererror")) return null;
        const diagrams = Array.from(doc.getElementsByTagName("diagram"));
        if (diagrams.length === 0) return null;
        const serializer = new XMLSerializer();
        return diagrams.map((d, i) => ({
            name: (d.getAttribute("name") || "").trim() || "Page " + (i + 1),
            xml: "<mxfile>" + serializer.serializeToString(d) + "</mxfile>",
        }));
    } catch {
        return null;
    }
}

function renderPage(pageXml) {
    // Drop any previously-rendered viewer, then hand the page XML to GraphViewer.
    // setAttribute + JSON.stringify avoids manual HTML-attribute escaping of the XML.
    canvas.innerHTML = "";
    const div = document.createElement("div");
    div.className = "mxgraph";
    div.setAttribute(
        "data-mxgraph",
        // lightbox:false — a read-only viewer; without it, clicking the diagram tries to open
        // the drawio lightbox, which (blocked from an inline overlay here) falls back to opening
        // viewer.diagrams.net in the browser — a dead remote page under the board CSP.
        JSON.stringify({
            xml: pageXml,
            lightbox: false,
            nav: true,
            resize: true,
            center: true,
            border: 8,
        }),
    );
    canvas.appendChild(div);
    if (!window.GraphViewer || typeof window.GraphViewer.processElements !== "function") {
        throw new Error("The DrawIO renderer failed to load (lib/viewer-static.min.js).");
    }
    // processElements() only processes .mxgraph divs it hasn't seen — i.e. the one above.
    window.GraphViewer.processElements();
}

function renderTabs(pages, onSelect) {
    tabsEl.innerHTML = "";
    if (pages.length < 2) {
        tabsEl.classList.remove("show");
        return;
    }
    pages.forEach((page, i) => {
        const btn = document.createElement("button");
        btn.className = "tab" + (i === 0 ? " active" : "");
        btn.textContent = page.name;
        btn.addEventListener("click", () => {
            Array.from(tabsEl.children).forEach((c, ci) => c.classList.toggle("active", ci === i));
            onSelect(i);
        });
        tabsEl.appendChild(btn);
    });
    tabsEl.classList.add("show");
}

// Rasterize the currently-rendered diagram SVG to a PNG blob. 2x for crisp output, on a
// white background (a diagram is a page — the dark board canvas behind it is not part of the
// drawing, and diagrams are usually pasted onto white). The SVG has no explicit size/namespace,
// so we clone it and stamp width/height (from its on-screen box) + xmlns before serializing.
async function diagramToPngBlob() {
    const svg = canvas.querySelector("svg");
    if (!svg) throw new Error("No diagram to copy.");
    const box = svg.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const xml = new XMLSerializer().serializeToString(clone);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Failed to rasterize the diagram."));
        im.src = url;
    });
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))), "image/png");
    });
}

// Copy the current page to the clipboard as PNG. The board:// origin is a secure context and
// the button click is a user gesture, so navigator.clipboard.write is permitted here.
async function copyPng() {
    try {
        const blob = await diagramToPngBlob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        if (P.notify) P.notify("Diagram copied to clipboard as PNG.", "success");
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (P.notify) P.notify("Copy failed: " + message, "error");
    }
}

copyBtn.addEventListener("click", copyPng);

// Render the given content-host XML into the viewer, or an empty/error state. NEVER throws:
// the content host can hand us transiently-invalid XML mid-edit (e.g. while the user is typing
// in Monaco before switching back), so a parse/render failure degrades to the inline error
// overlay rather than crashing the onContentChange callback. No P.notify here — a toast on
// every mid-edit keystroke-state would be noise; the inline overlay is enough.
function render(xml) {
    hideState();
    setCopyEnabled(false);
    try {
        if (xml == null || !xml.trim()) {
            tabsEl.classList.remove("show");
            canvas.innerHTML = "";
            showState("The file is empty.", false);
            return;
        }
        const pages = parsePages(xml);
        if (!pages) {
            // Unrecognized shape — hand the raw content to GraphViewer as a last resort.
            tabsEl.classList.remove("show");
            renderPage(xml);
            setCopyEnabled(true);
            return;
        }
        renderTabs(pages, (i) => renderPage(pages[i].xml));
        renderPage(pages[0].xml);
        setCopyEnabled(true);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        tabsEl.classList.remove("show");
        canvas.innerHTML = "";
        showState("Failed to render diagram: " + message, true);
    }
}

let unsubscribe = null;

async function load() {
    hideState();
    setCopyEnabled(false);

    // File-name label — still delivered for a content-host board (getFilePath resolves to the
    // edited file's path). Purely cosmetic; the content itself comes from the host, not this path.
    try {
        const filePath = await P.getFilePath();
        nameEl.textContent = filePath ? basename(filePath) : "DrawIO Viewer";
        // Tooltip: the full file path (the label itself shows only the basename).
        nameEl.title = filePath || "";
    } catch {
        nameEl.textContent = "DrawIO Viewer";
        nameEl.title = "";
    }

    // Content comes from Persephone's content host. getContent() resolves to the current content;
    // onContentChange() re-renders whenever it changes — the key moment being a switch back from
    // Monaco (the shared host transfers over with the user's edits) or an external reload.
    try {
        const xml = await P.host.getContent();
        render(xml);
    } catch {
        // Not a content-host board (opened plainly, or host unavailable) — persephone.host.getContent
        // rejects. Show the empty state.
        nameEl.textContent = "DrawIO Viewer";
        tabsEl.classList.remove("show");
        canvas.innerHTML = "";
        showState("Open a .drawio file to view it here.", false);
        return;
    }

    if (!unsubscribe) {
        unsubscribe = P.host.onContentChange((content) => render(content));
    }
}

load();
