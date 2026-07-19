// PowerPoint Viewer — frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH (not content). We read the
// bytes ourselves and render the .pptx with pptx-preview (a self-contained UMD build that bundles
// its own JSZip/echarts). Read-only — there is no write path. See CLAUDE.md for the board-specific
// notes and read_guide("boards") for the generic persephone.* bridge reference.

const P = window.persephone;

// DOM handles.
const nameEl = document.getElementById("name");
const navEl = document.getElementById("nav");
const counterEl = document.getElementById("counter");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const reloadBtn = document.getElementById("reload");
const scrollEl = document.getElementById("scroll");
const slidesEl = document.getElementById("slides");
const stateEl = document.getElementById("state");

// The size we render each slide at (16:9). pptx-preview scales each slide's content to fit this
// viewport, so the deck's native aspect (e.g. 4:3) may be letterboxed/adjusted — a documented v1
// limit. The stack is then scaled to the board width with `zoom` (see fitToWidth).
const SLIDE_W = 960;
const SLIDE_H = 540;
const H_PADDING = 32; // #slides horizontal padding (16px each side), scaled by zoom too

let currentPath = ""; // the file path (for the name label / reload)
let slideEls = []; // the rendered .pptx-preview-slide-wrapper elements, in order
let currentIndex = 0; // 0-based index of the slide currently in view

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

// ---- scale-to-fit --------------------------------------------------------------------------

// Scale the whole slide stack so one slide fits the board width, using CSS `zoom` (Chromium) —
// unlike `transform: scale`, zoom re-flows layout so the scroll height stays correct and text
// re-rasterizes crisply. Capped so a very wide board doesn't blow slides up absurdly.
function fitToWidth() {
    const avail = scrollEl.clientWidth;
    if (!avail) return;
    const scale = Math.min(1.75, Math.max(0.15, avail / (SLIDE_W + H_PADDING)));
    slidesEl.style.zoom = scale;
}

const resizeObserver = new ResizeObserver(fitToWidth);

// ---- slide navigation ----------------------------------------------------------------------

function updateCounter() {
    counterEl.textContent = slideEls.length ? `${currentIndex + 1} / ${slideEls.length}` : "–";
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= slideEls.length - 1;
}

function goToSlide(index) {
    if (!slideEls.length) return;
    currentIndex = Math.max(0, Math.min(slideEls.length - 1, index));
    slideEls[currentIndex].scrollIntoView({ behavior: "smooth", block: "start" });
    updateCounter();
}

// Keep the counter in sync when the user scrolls freely: the "current" slide is the topmost one
// still substantially in view. rAF-throttled so scrolling stays smooth.
let scrollRaf = 0;
function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        if (!slideEls.length) return;
        const viewTop = scrollEl.scrollTop;
        let best = 0;
        for (let i = 0; i < slideEls.length; i++) {
            // offsetTop is in unscaled px; zoom scales it, so compare in the same (scaled) space.
            const top = slideEls[i].getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
            if (top <= scrollEl.clientHeight * 0.35) best = i;
            else break;
        }
        if (best !== currentIndex) {
            currentIndex = best;
            updateCounter();
        }
        void viewTop;
    });
}

// ---- load the file -------------------------------------------------------------------------

function resetView() {
    resizeObserver.disconnect();
    slidesEl.style.zoom = "";
    slidesEl.innerHTML = "";
    slideEls = [];
    currentIndex = 0;
    navEl.classList.remove("show");
    updateCounter();
}

async function load() {
    try {
        showState("Loading…");
        reloadBtn.disabled = true;
        resetView();

        const path = await P.getFilePath();
        currentPath = path || "";

        if (!currentPath) {
            // Opened plainly (not as an editor for a file) — clean empty state, no crash.
            nameEl.textContent = "PowerPoint Viewer";
            showState("No file open.\nOpen a .pptx file to view it here.");
            return;
        }

        nameEl.textContent = fileName(currentPath);
        reloadBtn.disabled = false;

        const b64 = await P.readFile(currentPath, { encoding: "base64" });
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

        const previewer = pptxPreview.init(slidesEl, {
            width: SLIDE_W,
            height: SLIDE_H,
            mode: "list", // render every slide (stacked); we own scroll + nav
        });
        await previewer.preview(bytes.buffer);

        slideEls = Array.from(slidesEl.querySelectorAll(".pptx-preview-slide-wrapper"));
        if (slideEls.length === 0) {
            showState("This deck has no slides.");
            return;
        }

        hideState();
        navEl.classList.add("show");
        currentIndex = 0;
        updateCounter();
        fitToWidth();
        resizeObserver.observe(scrollEl);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        resetView();
        showState("Could not open this file.\n" + message, true);
        P.notify(message, "error");
    }
}

// ---- wire up -------------------------------------------------------------------------------

reloadBtn.addEventListener("click", load);
prevBtn.addEventListener("click", () => goToSlide(currentIndex - 1));
nextBtn.addEventListener("click", () => goToSlide(currentIndex + 1));
scrollEl.addEventListener("scroll", onScroll, { passive: true });

// Arrow / PageUp-Down keys step through slides (skip when a form control is focused).
document.addEventListener("keydown", (e) => {
    if (!slideEls.length) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goToSlide(currentIndex + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goToSlide(currentIndex - 1);
    }
});

load();
