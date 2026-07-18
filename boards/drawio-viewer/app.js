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
const diagramEl = document.getElementById("diagram");
const canvas = document.getElementById("canvas");
const stateEl = document.getElementById("state");
const copyBtn = document.getElementById("copy");
const saveBtn = document.getElementById("save");
const saveMenu = document.getElementById("saveMenu");
const editDrawBtn = document.getElementById("editdraw");
const zoomEl = document.getElementById("zoom");

// The absolute path of the .drawio file being viewed (content-host open); "" for a plain open.
// Used only to suggest a default file name for "Save as SVG"; the content comes from the host.
let currentFilePath = "";

// ── Zoom & pan ──────────────────────────────────────────────────────────────
// A vanilla-JS port of Persephone's built-in BaseImageView (the shared zoom/pan behind the
// Image and Mermaid viewers), applied to GraphViewer's rendered SVG. The diagram starts
// centered and zoomed-to-fit; wheel zooms toward the cursor, left-drag pans, double-click (or
// the % pill) resets to fit. #diagram is the clipped viewport; #canvas fills it and is
// GraphViewer's container (it needs a definite width). The transform target is the `.mxgraph`
// diagram box GraphViewer renders inside #canvas — it carries an explicit px size, so its
// offsetWidth/Height give the true natural size (immune to the CSS transform we apply). It is
// absolutely centered (left/top 50% + a translate(-50%,-50%) baseline) and scaled about its
// center, so translate(0,0)+scale keeps the center pinned to the viewport center — matching
// BaseImageView's flex-centered-scaled-box. SVG scales vector-crisp, so there is no quality loss.
const zoomPan = (() => {
    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const ZOOM_STEP = 0.1;

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let fitScale = 1;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let hasContent = false;
    // The `.mxgraph` diagram box (transform target). Re-grabbed on each render; null when empty.
    let contentEl = null;

    // Layout size of the rendered diagram, unaffected by our CSS transform (offset* ignore
    // transforms). Zero until GraphViewer has laid the diagram out.
    function naturalSize() {
        if (!contentEl) return { w: 0, h: 0 };
        return { w: contentEl.offsetWidth, h: contentEl.offsetHeight };
    }

    function apply() {
        if (!contentEl) return;
        // translate(-50%,-50%) centers the box on its left/top:50% anchor (= viewport center);
        // transform-origin:center makes scale keep that center pinned. Then our pan translate.
        contentEl.style.transform =
            "translate(-50%, -50%) translate(" +
            translateX +
            "px, " +
            translateY +
            "px) scale(" +
            scale +
            ")";
        contentEl.style.transition = dragging ? "none" : "transform 0.1s ease-out";
        zoomEl.textContent = Math.round(scale * 100) + "%";
    }

    // Fit-to-viewport scale; never scales up past 100% (matches BaseImageView).
    function calcFitScale() {
        const { w, h } = naturalSize();
        if (!w || !h) return fitScale;
        const vw = diagramEl.clientWidth;
        const vh = diagramEl.clientHeight;
        if (!vw || !vh) return fitScale;
        return Math.min(vw / w, vh / h, 1);
    }

    function reset() {
        fitScale = calcFitScale();
        scale = fitScale;
        translateX = 0;
        translateY = 0;
        apply();
    }

    // Zoom keeping the point under the cursor fixed (BaseImageView.zoomAtPoint).
    function zoomAtPoint(newScale, clientX, clientY) {
        const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
        const rect = diagramEl.getBoundingClientRect();
        const pointX = clientX - rect.left - rect.width / 2;
        const pointY = clientY - rect.top - rect.height / 2;
        const imagePointX = (pointX - translateX) / scale;
        const imagePointY = (pointY - translateY) / scale;
        if (clamped <= fitScale) {
            // At/under fit — recenter (no point panning a fully-visible diagram).
            scale = clamped;
            translateX = 0;
            translateY = 0;
        } else {
            scale = clamped;
            translateX = pointX - imagePointX * clamped;
            translateY = pointY - imagePointY * clamped;
        }
        apply();
    }

    diagramEl.addEventListener(
        "wheel",
        (e) => {
            if (!hasContent) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
            zoomAtPoint(scale * (1 + delta), e.clientX, e.clientY);
        },
        { passive: false },
    );

    diagramEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !hasContent) return;
        dragging = true;
        dragStartX = e.clientX - translateX;
        dragStartY = e.clientY - translateY;
        diagramEl.setAttribute("data-dragging", "");
    });
    // On window so a drag that leaves the viewport still tracks and releases.
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        translateX = e.clientX - dragStartX;
        translateY = e.clientY - dragStartY;
        apply();
    });
    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        diagramEl.removeAttribute("data-dragging");
        apply();
    });

    diagramEl.addEventListener("dblclick", () => {
        if (hasContent) reset();
    });
    zoomEl.addEventListener("click", () => {
        if (hasContent) reset();
    });

    window.addEventListener("resize", () => {
        if (!hasContent) return;
        if (Math.abs(scale - fitScale) < 1e-6) reset();
        else fitScale = calcFitScale();
    });

    window.addEventListener("keydown", (e) => {
        if (!hasContent) return;
        const rect = diagramEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            zoomAtPoint(scale * 1.2, cx, cy);
        } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            zoomAtPoint(scale / 1.2, cx, cy);
        } else if (e.key === "0") {
            e.preventDefault();
            reset();
        }
    });

    return {
        // Call after a page renders. Grab the freshly-rendered `.mxgraph` box, make it the
        // absolutely-centered transform target, then poll a few frames until it has a non-zero
        // box (GraphViewer lays the SVG out asynchronously) and fit-and-center.
        onRendered() {
            hasContent = true;
            zoomEl.style.display = "block";
            contentEl = canvas.querySelector(".mxgraph");
            if (contentEl) {
                // Override GraphViewer's inline position:relative → absolute-centered anchor.
                contentEl.style.position = "absolute";
                contentEl.style.left = "50%";
                contentEl.style.top = "50%";
                contentEl.style.transformOrigin = "center center";
                contentEl.style.willChange = "transform";
            }
            let tries = 0;
            const tick = () => {
                const { w, h } = naturalSize();
                if (w && h) {
                    reset();
                } else if (tries++ < 30) {
                    requestAnimationFrame(tick);
                } else {
                    reset();
                }
            };
            requestAnimationFrame(tick);
        },
        // Call for empty/error states (no diagram): forget the target and hide the pill.
        clear() {
            hasContent = false;
            contentEl = null;
            scale = 1;
            translateX = 0;
            translateY = 0;
            fitScale = 1;
            zoomEl.style.display = "none";
        },
    };
})();

function showState(message, isError) {
    stateEl.textContent = message;
    stateEl.classList.toggle("error", !!isError);
    stateEl.classList.add("show");
}

function hideState() {
    stateEl.classList.remove("show", "error");
}

// The diagram actions (Copy PNG, Open in Drawing Editor) are only meaningful while a diagram
// is on screen — both rasterize the current page.
function setActionsEnabled(on) {
    copyBtn.disabled = !on;
    saveBtn.disabled = !on;
    editDrawBtn.disabled = !on;
    if (!on) closeSaveMenu(); // don't leave the menu open once there's no diagram to save
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
        // resize:true is what makes GraphViewer stamp an explicit px size on `.mxgraph` (= the
        // diagram bounds) — the natural size our zoom/pan fits to. center:true is harmless (the
        // `.mxgraph` box already hugs the graph). nav:false — its zoom toolbar needs CSP-blocked
        // remote sprites and we provide our own zoom/pan.
        JSON.stringify({
            xml: pageXml,
            lightbox: false,
            nav: false,
            resize: true,
            center: true,
            border: 8,
        }),
    );
    canvas.appendChild(div);
    if (!window.GraphViewer || typeof window.GraphViewer.processElements !== "function") {
        throw new Error("The DrawIO renderer failed to load (lib/viewer-static.min.js).");
    }
    // Defer processing until the container (#canvas) has a real width. GraphViewer fits diagrams
    // LARGER than the container down to its width; if processElements() runs while the container
    // is momentarily 0-wide (a reflow right after a board reload), that fit collapses to nothing
    // and the element is left permanently blank — GraphViewer processes each .mxgraph only once,
    // so re-calling won't recover it. Waiting for a non-zero width makes large diagrams render
    // deterministically. Small diagrams (rendered at natural size, no fit) were never affected,
    // which is why this only bit large ones, and only intermittently.
    let tries = 0;
    const process = () => {
        if (canvas.offsetWidth < 1 && tries++ < 60) {
            requestAnimationFrame(process);
            return;
        }
        try {
            // processElements() only processes .mxgraph divs it hasn't seen — i.e. the one above.
            window.GraphViewer.processElements();
            // Center + fit the freshly-rendered diagram (GraphViewer lays it out asynchronously).
            zoomPan.onRendered();
        } catch (err) {
            const message = err && err.message ? err.message : String(err);
            tabsEl.classList.remove("show");
            canvas.innerHTML = "";
            zoomPan.clear();
            showState("Failed to render diagram: " + message, true);
        }
    };
    requestAnimationFrame(process);
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
    // Use the diagram's NATURAL size (the `.mxgraph` layout box), not getBoundingClientRect —
    // the latter is scaled by the live zoom transform, which would size the PNG to the zoom.
    const mx = canvas.querySelector(".mxgraph");
    const w = Math.max(1, Math.round(mx ? mx.offsetWidth : svg.getBoundingClientRect().width));
    const h = Math.max(1, Math.round(mx ? mx.offsetHeight : svg.getBoundingClientRect().height));
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

// Serialize the currently-rendered diagram as a standalone SVG document string. GraphViewer
// already renders the page as vector SVG, so this is a faithful, resolution-independent export
// (no rasterization) — unlike Copy/Open-in-Drawing which go through PNG. The on-screen <svg>
// carries no explicit size/namespaces (and its `.mxgraph` box holds the natural bounds), so we
// clone it, stamp width/height + xmlns, and prepend a white background rect — a diagram is a
// page authored for a white canvas (the viewport is always white), so the saved file matches.
function diagramToSvgString() {
    const svg = canvas.querySelector("svg");
    if (!svg) throw new Error("No diagram to save.");
    // Natural size from the `.mxgraph` layout box (getBoundingClientRect would be scaled by the
    // live zoom transform) — same reasoning as diagramToPngBlob.
    const mx = canvas.querySelector(".mxgraph");
    const w = Math.max(1, Math.round(mx ? mx.offsetWidth : svg.getBoundingClientRect().width));
    const h = Math.max(1, Math.round(mx ? mx.offsetHeight : svg.getBoundingClientRect().height));
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    // Cover the viewBox bounds if present (drawio SVGs often use a fractional negative origin,
    // e.g. "-0.5 -0.5 w h"); fall back to full-viewport percentages otherwise.
    const vb = (clone.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every((n) => !isNaN(n))) {
        bg.setAttribute("x", String(vb[0]));
        bg.setAttribute("y", String(vb[1]));
        bg.setAttribute("width", String(vb[2]));
        bg.setAttribute("height", String(vb[3]));
    } else {
        bg.setAttribute("x", "0");
        bg.setAttribute("y", "0");
        bg.setAttribute("width", "100%");
        bg.setAttribute("height", "100%");
    }
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

// Suggested default file name for the save dialog: the .drawio file's stem + the given ext
// (e.g. "flow.drawio" + "svg" → "flow.svg"), or "diagram.<ext>" for a plain open.
function suggestedName(ext) {
    const name = basename(currentFilePath || "diagram");
    const stem = name.replace(/\.[^.]+$/, "") || "diagram";
    return stem + "." + ext;
}

// Read a Blob as a bare base64 string (the payload after the "data:...;base64," prefix), so it
// can be handed to persephone.writeFile with { encoding: "base64" } for binary formats (PNG).
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result);
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : "");
        };
        reader.onerror = () => reject(new Error("Failed to read the image blob."));
        reader.readAsDataURL(blob);
    });
}

// Save the current page as an SVG file. Prompts for a path via the board bridge's save dialog,
// then writes the serialized SVG through persephone.writeFile — mirroring the built-in Mermaid/
// SVG editors' "Save as SVG" action, adapted to the board bridge (the board can't reach the
// app's internal fs/dialog helpers directly).
async function saveSvg() {
    try {
        const svgText = diagramToSvgString();
        const path = await P.saveFileDialog({
            title: "Save as SVG",
            defaultPath: suggestedName("svg"),
            filters: [
                { name: "SVG Image", extensions: ["svg"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (!path) return; // user cancelled
        await P.writeFile(path, svgText, { encoding: "utf8" });
        if (P.notify) P.notify("Diagram saved as SVG.", "success");
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (P.notify) P.notify("Save as SVG failed: " + message, "error");
    }
}

// Save the current page as a PNG file (2×, white background — same rasterization as Copy).
// The blob is base64-encoded and written through persephone.writeFile { encoding: "base64" }.
async function savePng() {
    try {
        const blob = await diagramToPngBlob();
        const path = await P.saveFileDialog({
            title: "Save as PNG",
            defaultPath: suggestedName("png"),
            filters: [
                { name: "PNG Image", extensions: ["png"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (!path) return; // user cancelled
        await P.writeFile(path, await blobToBase64(blob), { encoding: "base64" });
        if (P.notify) P.notify("Diagram saved as PNG.", "success");
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (P.notify) P.notify("Save as PNG failed: " + message, "error");
    }
}

// ── Save dropdown menu ────────────────────────────────────────────────────────
// The Save button opens a small popover offering "Save as SVG" / "Save as PNG". The menu is
// position:fixed and placed from the button's on-screen rect at open time (right-aligned to the
// button, just below it), so it isn't clipped by body's overflow:hidden and tracks the button.
function openSaveMenu() {
    saveMenu.classList.add("show");
    const rect = saveBtn.getBoundingClientRect();
    const left = Math.max(4, rect.right - saveMenu.offsetWidth);
    saveMenu.style.left = left + "px";
    saveMenu.style.top = rect.bottom + 4 + "px";
    saveBtn.setAttribute("aria-expanded", "true");
}

function closeSaveMenu() {
    saveMenu.classList.remove("show");
    saveBtn.setAttribute("aria-expanded", "false");
}

saveBtn.addEventListener("click", (e) => {
    if (saveBtn.disabled) return;
    e.stopPropagation(); // don't let the document-level click below immediately re-close it
    if (saveMenu.classList.contains("show")) closeSaveMenu();
    else openSaveMenu();
});

saveMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest(".menu-item");
    if (!item) return;
    closeSaveMenu();
    const format = item.getAttribute("data-format");
    if (format === "svg") saveSvg();
    else if (format === "png") savePng();
});

// Dismiss the menu on an outside click, Escape, or a window resize (which would misplace it).
window.addEventListener("click", closeSaveMenu);
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSaveMenu();
});
window.addEventListener("resize", closeSaveMenu);

// Open the current page as a NEW editable drawing in Persephone's built-in Drawing (Excalidraw)
// editor — the same "Open in Drawing Editor" affordance the built-in Mermaid/Image/SVG viewers
// have. We rasterize the page to a PNG data URL (PNG is safe: drawio's foreignObject HTML labels
// don't reliably render when an SVG is loaded as an <img>, which is how Excalidraw shows embedded
// images) and hand it to openRawLink with the draw-view target. Persephone converts an image data
// URL for draw-view into a fresh untitled drawing (it never binds to / overwrites this .drawio).
async function openInDrawing() {
    try {
        const blob = await diagramToPngBlob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Failed to read the diagram image."));
            reader.readAsDataURL(blob);
        });
        P.openRawLink(dataUrl, { editor: "draw-view" });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (P.notify) P.notify("Open in Drawing Editor failed: " + message, "error");
    }
}

editDrawBtn.addEventListener("click", openInDrawing);

// Render the given content-host XML into the viewer, or an empty/error state. NEVER throws:
// the content host can hand us transiently-invalid XML mid-edit (e.g. while the user is typing
// in Monaco before switching back), so a parse/render failure degrades to the inline error
// overlay rather than crashing the onContentChange callback. No P.notify here — a toast on
// every mid-edit keystroke-state would be noise; the inline overlay is enough.
function render(xml) {
    hideState();
    setActionsEnabled(false);
    try {
        if (xml == null || !xml.trim()) {
            tabsEl.classList.remove("show");
            canvas.innerHTML = "";
            zoomPan.clear();
            showState("The file is empty.", false);
            return;
        }
        const pages = parsePages(xml);
        if (!pages) {
            // Unrecognized shape — hand the raw content to GraphViewer as a last resort.
            tabsEl.classList.remove("show");
            renderPage(xml);
            setActionsEnabled(true);
            return;
        }
        renderTabs(pages, (i) => renderPage(pages[i].xml));
        renderPage(pages[0].xml);
        setActionsEnabled(true);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        tabsEl.classList.remove("show");
        canvas.innerHTML = "";
        zoomPan.clear();
        showState("Failed to render diagram: " + message, true);
    }
}

let unsubscribe = null;

async function load() {
    hideState();
    setActionsEnabled(false);

    // File-name label — still delivered for a content-host board (getFilePath resolves to the
    // edited file's path). Purely cosmetic; the content itself comes from the host, not this path.
    try {
        const filePath = await P.getFilePath();
        currentFilePath = filePath || "";
        nameEl.textContent = filePath ? basename(filePath) : "DrawIO Viewer";
        // Tooltip: the full file path (the label itself shows only the basename).
        nameEl.title = filePath || "";
    } catch {
        currentFilePath = "";
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
