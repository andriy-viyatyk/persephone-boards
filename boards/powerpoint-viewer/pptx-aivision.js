// PowerPoint Viewer board — the AiVision agent surface.
//
// Why this exists: an agent asked to "read this deck" used to shell out to an external converter,
// because the slides on screen were opaque to it. pptx-preview renders into `#slides` in THIS
// BOARD'S OWN DOCUMENT — no nested frame, no cross-origin boundary — as real DOM text (`<p>` per
// paragraph, `<span>` per run). So the rendered DOM *is* the content, and this file publishes it
// at `pages[pageId].editor.app`.
//
// Four things shaped the design. Each was MEASURED against a purpose-built deck, not assumed, and
// each is a deliberate divergence from the Word board's model:
//
//   1. **DOM order is NOT reading order — every slide must be sorted geometrically.** A .docx is
//      a flow document, so walking the DOM yields the text in the order a human reads it. A slide
//      is a CANVAS: pptx-preview emits shapes in the deck's shape/z order, which is authoring
//      order, not visual order. Verified with a slide whose bottom textbox was added first: the
//      DOM emits the footer BEFORE the headline. Every block therefore carries its pixel `top`/
//      `left` and is sorted by them before rendering. Without this, slides come out scrambled —
//      silently, and only on the decks where it matters.
//   2. **Tables and pictures are not `.shape-wrapper` elements.** Text shapes get
//      `.shape-wrapper`, but a table and a picture are emitted as bare, UNCLASSED positioned
//      `<div>` siblings, and a chart as `.chart-node`. A walk restricted to `.shape-wrapper`
//      reports a table slide as title-only — it looks like the renderer dropped the content when
//      it did not. So the walk covers ALL `.slide-wrapper` children and classifies by content.
//   3. **The renderer does not put everything in the DOM, so the package is re-opened.** Speaker
//      notes are not rendered AT ALL (confirmed: no notes text anywhere in the document, and
//      `pptxPreview` exposes only `init` — the previewer object has render methods and no parsed
//      model, so there is no back door). Notes are often the actual narrative of a deck, so they
//      cannot just be dropped. The same re-open also yields chart SERIES DATA (the DOM has only
//      axis tick labels, plus an echarts default title "图表标题" that is pure noise) and the
//      authoritative slide title, which the DOM cannot give: every placeholder renders as
//      `shape-undefined`, so title-vs-body is otherwise only a font-size guess.
//      pptx-preview bundles its JSZip internally and exposes no global, so the board vendors its
//      own `jszip.min.js` for this. It re-unzips the bytes ALREADY IN MEMORY — never a re-read
//      from disk.
//   4. **Bulleted vs numbered is NOT reported, on purpose.** Bullet markers are not rendered
//      (no `::before` content, nothing in `innerText`), and in the package the bullet style is
//      inherited from the slide layout/master rather than sitting on the paragraph — a deck
//      authored normally has no `buChar` on its own paragraphs at all. Resolving that properly
//      means walking master inheritance for very little gain, so body paragraphs are emitted as
//      `-` items indented by their level, and the guide says so. Indent LEVEL is exact: the
//      renderer emits `padding-left` of 36px per level.
//
// Everything here is READ-ONLY with respect to the deck. The save* methods write NEW files at a
// path the agent names; nothing ever modifies the open .pptx.
(() => {
    const PA = (window.PPTXAI = window.PPTXAI || {});

    const HELP = `This is a PowerPoint deck (.pptx) open in the PowerPoint Viewer board. It is
already parsed and rendered, so reading it here needs no conversion step and no external tool.

Start with getStats(). It reports the slide count and the character, table, image and chart count
of EVERY slide, plus which slides have speaker notes. A call result is bounded (20k characters by
default), so ask for a slide range you can actually receive, raise maxLength, or use saveMarkdown
and read the file.

getMarkdown(from, to) is the main read and what you should use by default. Each slide becomes a
"## Slide N - Title" section, body text becomes indented - items at their real outline level, and
tables become Markdown pipe tables. getText(from, to) gives the same range as plain prose.

Read the SPEAKER NOTES. getNotes() returns them per slide, and they are not on the slides
themselves - they are the presenter's script, and for "what is this deck actually saying" they are
frequently more informative than the bullets. getMarkdown includes them by default; pass
{ notes: false } to leave them out.

getCharts() returns each chart's real series, categories and values, read from the deck's own
chart data. Do NOT try to read figures off a chart's rendered axis labels - the rendering carries
only tick marks and a placeholder title, while getCharts has the actual numbers.

Pictures embedded in the deck are listed by getImages(). To actually LOOK at one - a diagram, a
screenshot, a SmartArt graphic - call saveImage(path, index) and open that file with your own
vision. This renderer is approximate for SmartArt and complex shapes, so when a slide's meaning
looks like it lives in a picture, read the picture.

getOutline() gives every slide's title in order - the deck's shape before you read it.
search(query) returns slide numbers with snippets. showText(query) scrolls the USER's view to a
phrase and flashes it, so they can see what you are referring to.

Paths passed to saveMarkdown, saveText, saveImage and saveImages must be ABSOLUTE. Slide numbers
are 1-based everywhere, matching the counter the user sees on screen.`;

    const MEMBERS = [
        { name: "fileName", kind: "property", summary: "Name of the open PowerPoint deck." },
        { name: "filePath", kind: "property", summary: "Absolute path of the open .pptx file on disk." },
        { name: "slideCount", kind: "property", summary: "Number of slides in the deck." },
        { name: "currentSlide", kind: "property", summary: "The slide number the user is currently looking at.", writable: true },
        { name: "isLoaded", kind: "property", summary: "Whether a deck is open and rendered." },

        { name: "getStats", kind: "method", signature: "getStats()", summary: "How big is this deck: total and per-slide character, table, image and chart counts, and which slides have speaker notes, so you can plan how much to read at once. Read this first." },
        { name: "getMarkdown", kind: "method", signature: "getMarkdown(from = 1, to = slideCount, options?)", summary: "The deck as Markdown, one section per slide, with titles, outline-indented body text, tables and speaker notes. This is the main way to read it. Options: { notes } - pass { notes: false } to omit speaker notes." },
        { name: "getText", kind: "method", signature: "getText(from = 1, to = slideCount, options?)", summary: "The same slide range as plain prose with no Markdown markup. Options: { notes }." },
        { name: "getSlideMarkdown", kind: "method", signature: "getSlideMarkdown(slideNumber, options?)", summary: "One slide as Markdown. Options: { notes }." },
        { name: "getNotes", kind: "method", signature: "getNotes(slideNumber?)", summary: "The speaker notes, per slide. These are NOT visible on the slides and are often the real narrative of the deck - read them." },
        { name: "search", kind: "method", signature: "search(query, options?)", summary: "Find text across slides and speaker notes; returns slide numbers and snippets. Options: { caseSensitive, regex, maxHits, contextChars, notes }." },
        { name: "getOutline", kind: "method", signature: "getOutline()", summary: "Every slide's title in order - the deck's shape before you read it." },
        { name: "getTables", kind: "method", signature: "getTables(slideNumber?)", summary: "Tables as arrays of rows, for one slide or the whole deck. Use this when you need the figures rather than the prose." },
        { name: "getCharts", kind: "method", signature: "getCharts(slideNumber?)", summary: "Each chart's real series, categories and values, read from the deck's chart data - NOT from the rendered picture, which carries only axis ticks. This is how you read a chart's numbers." },
        { name: "getImages", kind: "method", signature: "getImages()", summary: "List the pictures embedded in the deck with their slide, size and format. Save one with saveImage to actually look at it." },
        { name: "getMetadata", kind: "method", signature: "getMetadata()", summary: "Deck properties: title, author, company, and the created and modified dates." },

        { name: "saveMarkdown", kind: "method", signature: "saveMarkdown(path, from = 1, to = slideCount, options?)", summary: "Write a slide range as Markdown to a UTF-8 file at an absolute path you name. Use it instead of getMarkdown for a deck too large to receive in one call.", caution: "writes a new file to disk" },
        { name: "saveText", kind: "method", signature: "saveText(path, from = 1, to = slideCount, options?)", summary: "Write a slide range as plain text to a UTF-8 file at an absolute path you name.", caution: "writes a new file to disk" },
        { name: "saveImage", kind: "method", signature: "saveImage(path, index)", summary: "Write one embedded picture to an absolute path you name. THIS IS HOW YOU READ A DIAGRAM OR SMARTART GRAPHIC - open the file afterwards and read it with your own vision. Index comes from getImages().", caution: "writes a new file to disk" },
        { name: "saveImages", kind: "method", signature: "saveImages(directory)", summary: "Write every embedded picture into a directory, one file each, and return the paths.", caution: "writes several new files to disk" },

        { name: "goToSlide", kind: "method", signature: "goToSlide(slideNumber)", summary: "Scroll the user's view to a slide, so they see the slide you are talking about." },
        { name: "showText", kind: "method", signature: "showText(query, options?)", summary: "Scroll the user's view to a phrase on a slide and flash it, so they can see what you are referring to. Options: { caseSensitive, occurrence }.", caution: "changes what the user is looking at" },
        { name: "openTextPage", kind: "method", signature: "openTextPage(from = 1, to = slideCount)", summary: "Open the extracted Markdown as a new page in Persephone, to show the user what you read.", caution: "opens a new page" },
    ];

    PA.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, documentChanged() {} };

        /** Per-slide DOM extraction, keyed by 1-based slide number. The DOM does not change after
         *  a render, so a slide is walked once and kept; `documentChanged()` clears it. */
        const slideCache = new Map();
        let statsCache = null;
        let metadataCache = null;
        /** The package sidecar (notes, charts, titles, metadata) — one lazy re-unzip per deck. */
        let packagePromise = null;

        // ── DOM access ──────────────────────────────────────────────────────────────────

        function slideEls() {
            return Array.from(ctx.getSlidesEl().querySelectorAll(".pptx-preview-slide-wrapper"));
        }

        function requireLoaded() {
            const list = slideEls();
            if (list.length === 0) {
                throw new Error("No PowerPoint deck is rendered in this board yet.");
            }
            return list;
        }

        function requireSlide(list, slideNumber) {
            const n = Number(slideNumber);
            if (!Number.isInteger(n) || n < 1 || n > list.length) {
                throw new Error("Slide " + slideNumber + " is out of range; this deck has "
                    + list.length + " slide" + (list.length === 1 ? "" : "s") + ".");
            }
            return n;
        }

        function resolveRange(list, from, to) {
            const first = from === undefined || from === null ? 1 : requireSlide(list, from);
            const last = to === undefined || to === null ? list.length : requireSlide(list, to);
            if (last < first) throw new Error("Slide range is backwards: " + first + " to " + last + ".");
            return { first, last };
        }

        /** An absolute path is required for every write: a relative path would resolve against
         *  the board folder, quietly dropping the file into the board's own (published) folder. */
        function requireAbsolutePath(path, what) {
            if (typeof path !== "string" || path.trim() === "") {
                throw new Error("Pass an absolute file path to write the " + what + " to.");
            }
            const isAbsolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
            if (!isAbsolute) {
                throw new Error('"' + path + '" is not an absolute path. Pass a full path rooted at '
                    + "a drive or share, such as C:\\Users\\you\\Documents\\ — a relative path would "
                    + "be written inside the board's own folder.");
            }
            return path;
        }

        // ── Block extraction ────────────────────────────────────────────────────────────
        // Each slide is walked into a list of blocks, and both Markdown and plain text are
        // rendered from that same list — so the two reads can never disagree about content, only
        // about markup. Blocks carry their pixel position and are sorted by it (see note 1 in the
        // file header): the DOM emits shapes in authoring order, not reading order.

        const LEVEL_PX = 36; // pptx-preview indents each outline level by exactly 36px

        /** Outline level of a paragraph, from the renderer's own indent. Measured: level 0/1/2
         *  render as padding-left 0px/36px/72px. */
        function paragraphLevel(p) {
            const padding = parseFloat(getComputedStyle(p).paddingLeft);
            if (!Number.isFinite(padding) || padding <= 0) return 0;
            return Math.round(padding / LEVEL_PX);
        }

        function paragraphsOf(el) {
            const out = [];
            el.querySelectorAll("p").forEach((p) => {
                const text = (p.innerText || "").replace(/\s+/g, " ").trim();
                if (text !== "") out.push({ text, level: paragraphLevel(p) });
            });
            return out;
        }

        /** Pixel position of a block within its slide, for the geometric sort. Falls back to the
         *  offset position when the inline style is absent (table/picture wrappers carry it). */
        function positionOf(el, slideEl) {
            const top = parseFloat(el.style.top);
            const left = parseFloat(el.style.left);
            if (Number.isFinite(top) && Number.isFinite(left)) return { top, left };
            const a = el.getBoundingClientRect();
            const b = slideEl.getBoundingClientRect();
            return { top: a.top - b.top, left: a.left - b.left };
        }

        function tableRowsOf(tableEl) {
            const rows = [];
            tableEl.querySelectorAll("tr").forEach((tr) => {
                const cells = [];
                tr.querySelectorAll("td, th").forEach((td) => {
                    cells.push((td.innerText || "").replace(/\s+/g, " ").trim());
                });
                if (cells.length > 0) rows.push(cells);
            });
            return rows;
        }

        /** Walk one slide into positioned blocks. Classification is by CONTENT, not class: only
         *  text shapes get `.shape-wrapper`, while tables and pictures are unclassed `<div>`s and
         *  charts are `.chart-node` (see note 2 in the file header). */
        function extractSlide(slideNumber) {
            const cached = slideCache.get(slideNumber);
            if (cached) return cached;

            const slideEl = slideEls()[slideNumber - 1];
            const blocks = [];
            const wrapper = slideEl.querySelector(".slide-wrapper");
            if (wrapper) {
                Array.from(wrapper.children).forEach((el) => {
                    const pos = positionOf(el, slideEl);
                    const table = el.querySelector("table");
                    if (table) {
                        const rows = tableRowsOf(table);
                        if (rows.length > 0) blocks.push({ type: "table", rows, ...pos });
                        return;
                    }
                    const img = el.querySelector("img");
                    if (img) {
                        blocks.push({ type: "image", alt: img.getAttribute("alt") || "", ...pos });
                        return;
                    }
                    if (el.classList.contains("chart-node")) {
                        blocks.push({ type: "chart", ...pos });
                        return;
                    }
                    const paragraphs = paragraphsOf(el);
                    if (paragraphs.length > 0) blocks.push({ type: "text", paragraphs, ...pos });
                });
            }

            // The geometric sort that makes a slide read the way it looks. Same-row shapes
            // (within half a line) are ordered left-to-right.
            blocks.sort((a, b) => (Math.abs(a.top - b.top) > 12 ? a.top - b.top : a.left - b.left));

            const result = { blocks };
            slideCache.set(slideNumber, result);
            return result;
        }

        // ── Rendering ───────────────────────────────────────────────────────────────────

        function markdownTable(rows) {
            const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
            const pad = (r) => {
                const cells = r.slice();
                while (cells.length < width) cells.push("");
                return cells.map((c) => c.replace(/\|/g, "\\|"));
            };
            const lines = ["| " + pad(rows[0]).join(" | ") + " |",
                           "| " + new Array(width).fill("---").join(" | ") + " |"];
            for (let i = 1; i < rows.length; i++) lines.push("| " + pad(rows[i]).join(" | ") + " |");
            return lines.join("\n");
        }

        /** One slide's body. `title` is the package-authoritative title (may be undefined); the
         *  text block that produced it is skipped so it is not repeated inside the body. */
        function slideBody(slideNumber, markdown, title) {
            const lines = [];
            let titleSkipped = false;
            for (const block of extractSlide(slideNumber).blocks) {
                if (block.type === "text") {
                    const joined = block.paragraphs.map((p) => p.text).join(" ");
                    if (!titleSkipped && title && joined === title) { titleSkipped = true; continue; }
                    for (const p of block.paragraphs) {
                        const indent = "  ".repeat(p.level);
                        lines.push(markdown ? indent + "- " + p.text : indent + p.text);
                    }
                } else if (block.type === "table") {
                    lines.push(markdown
                        ? markdownTable(block.rows)
                        : block.rows.map((r) => r.join("\t")).join("\n"));
                } else if (block.type === "image") {
                    lines.push(markdown ? "![" + block.alt + "]()" : "[picture]");
                } else if (block.type === "chart") {
                    lines.push(markdown
                        ? "_[chart - call getCharts(" + slideNumber + ") for its series and values]_"
                        : "[chart]");
                }
                lines.push("");
            }
            return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        }

        function slideContent(slideNumber, markdown, withNotes, sidecar) {
            const info = sidecar && sidecar.slides ? sidecar.slides[slideNumber - 1] : undefined;
            const title = info && info.title ? info.title : undefined;
            const parts = [];
            if (markdown) {
                parts.push("## Slide " + slideNumber + (title ? " — " + title : ""));
            } else if (title) {
                parts.push(title);
            }
            const body = slideBody(slideNumber, markdown, title);
            if (body !== "") parts.push(body);
            const notes = withNotes && info && info.notes ? info.notes : "";
            if (notes !== "") {
                parts.push(markdown ? "**Speaker notes:** " + notes : "Speaker notes: " + notes);
            }
            return parts.join("\n\n");
        }

        function contentForRange(first, last, markdown, withNotes, sidecar) {
            const out = [];
            for (let n = first; n <= last; n++) out.push(slideContent(n, markdown, withNotes, sidecar));
            return out.join("\n\n").trim();
        }

        /** Plain text of one slide, used by search — body plus notes, no markup. */
        function searchableText(slideNumber, sidecar, withNotes) {
            const info = sidecar && sidecar.slides ? sidecar.slides[slideNumber - 1] : undefined;
            const parts = [];
            if (info && info.title) parts.push(info.title);
            const body = slideBody(slideNumber, false, info && info.title ? info.title : undefined);
            if (body !== "") parts.push(body);
            if (withNotes && info && info.notes) parts.push(info.notes);
            return parts.join("\n");
        }

        function countLines(text) {
            return text === "" ? 0 : text.split("\n").length;
        }

        // ── Images ──────────────────────────────────────────────────────────────────────
        // Every embedded picture is already a `data:` URL in the DOM (pptx-preview inlines them),
        // so saving one is a base64 write of the deck's OWN bytes — not a re-render.

        const EXTENSIONS = {
            "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
            "image/bmp": "bmp", "image/webp": "webp", "image/svg+xml": "svg",
        };

        /** Exact decoded size of a base64 payload. The usual `length * 3 / 4` overstates it by
         *  the padding: a 256-byte PNG reports 258 without this. */
        function base64Bytes(base64) {
            const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
            return Math.floor((base64.length * 3) / 4) - padding;
        }

        function collectImages() {
            const out = [];
            slideEls().forEach((slideEl, i) => {
                slideEl.querySelectorAll("img").forEach((img) => {
                    const src = img.getAttribute("src") || "";
                    const match = /^data:([^;,]+);base64,(.*)$/.exec(src);
                    out.push({
                        index: out.length,
                        slide: i + 1,
                        alt: img.getAttribute("alt") || "",
                        width: img.naturalWidth || undefined,
                        height: img.naturalHeight || undefined,
                        mime: match ? match[1] : undefined,
                        base64: match ? match[2] : undefined,
                    });
                });
            });
            return out;
        }

        function describeImage(entry) {
            return {
                index: entry.index,
                slide: entry.slide,
                alt: entry.alt,
                width: entry.width,
                height: entry.height,
                format: entry.mime,
                bytes: entry.base64 ? base64Bytes(entry.base64) : undefined,
            };
        }

        async function writeImage(path, entry) {
            if (!entry.base64) {
                throw new Error("Image " + entry.index + " is not an embedded picture "
                    + "(its source is a link, not deck data), so it cannot be saved.");
            }
            await P.writeFile(path, entry.base64, { encoding: "base64" });
            return { ...describeImage(entry), path, note: "Open this file to read the picture with your own vision." };
        }

        function joinPath(directory, name) {
            const trimmed = directory.replace(/[\\/]+$/, "");
            const separator = trimmed.includes("\\") ? "\\" : "/";
            return trimmed + separator + name;
        }

        // ── The package sidecar ─────────────────────────────────────────────────────────
        // What the RENDERER does not put in the DOM: speaker notes, chart series data, and the
        // authoritative slide title. Read by re-unzipping the bytes already in memory (see note 3
        // in the file header). One lazy pass per deck, cached.

        function xmlOf(text) {
            return new DOMParser().parseFromString(text, "application/xml");
        }

        /** Local-name lookup: the OOXML parts use namespace prefixes (a:, p:, c:) that
         *  `getElementsByTagName` only matches literally, so match on localName instead. */
        function byLocal(root, localName) {
            return Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === localName);
        }

        function textOfRuns(root) {
            return byLocal(root, "t").map((el) => el.textContent || "").join("");
        }

        /** Resolve a part path relative to its owner (`../notesSlides/x.xml` from `ppt/slides`). */
        function resolvePart(ownerPath, target) {
            if (target.startsWith("/")) return target.slice(1);
            const base = ownerPath.split("/").slice(0, -1);
            for (const segment of target.split("/")) {
                if (segment === "..") base.pop();
                else if (segment !== ".") base.push(segment);
            }
            return base.join("/");
        }

        async function relsOf(zip, partPath) {
            const parts = partPath.split("/");
            const relsPath = parts.slice(0, -1).concat("_rels", parts[parts.length - 1] + ".rels").join("/");
            const file = zip.file(relsPath);
            const map = new Map();
            if (!file) return map;
            const doc = xmlOf(await file.async("string"));
            byLocal(doc, "Relationship").forEach((rel) => {
                map.set(rel.getAttribute("Id"), {
                    target: rel.getAttribute("Target") || "",
                    type: rel.getAttribute("Type") || "",
                });
            });
            return map;
        }

        /** Slide title from the package: the shape whose placeholder is `title` or `ctrTitle`.
         *  The DOM cannot give this — every placeholder renders as `shape-undefined`. */
        function titleFromSlideXml(doc) {
            for (const sp of byLocal(doc, "sp")) {
                const ph = byLocal(sp, "ph")[0];
                if (!ph) continue;
                const type = ph.getAttribute("type") || "";
                if (type === "title" || type === "ctrTitle") {
                    const text = textOfRuns(sp).replace(/\s+/g, " ").trim();
                    if (text !== "") return text;
                }
            }
            return "";
        }

        function chartFromXml(doc) {
            const series = [];
            let categories = [];
            for (const ser of byLocal(doc, "ser")) {
                const txEl = byLocal(ser, "tx")[0];
                const name = txEl ? byLocal(txEl, "v").map((v) => v.textContent || "").join("").trim() : "";
                const catEl = byLocal(ser, "cat")[0];
                if (catEl && categories.length === 0) {
                    categories = byLocal(catEl, "v").map((v) => (v.textContent || "").trim());
                }
                const valEl = byLocal(ser, "val")[0];
                const values = valEl
                    ? byLocal(valEl, "v").map((v) => {
                        const raw = (v.textContent || "").trim();
                        const num = Number(raw);
                        return raw !== "" && Number.isFinite(num) ? num : raw;
                    })
                    : [];
                series.push({ name, values });
            }
            const titleEl = byLocal(doc, "title")[0];
            const title = titleEl ? textOfRuns(titleEl).replace(/\s+/g, " ").trim() : "";
            return { title, categories, series };
        }

        /** Read the deck package once: ordered slide parts, each slide's title, notes and charts,
         *  plus docProps. Returns a sidecar with a `note` instead of throwing when the bytes are
         *  unavailable, so a missing sidecar degrades the read rather than failing it. */
        async function readPackage() {
            const bytes = ctx.getBytes();
            if (!bytes || !window.JSZip) {
                return { unavailable: true, slides: [], charts: [] };
            }
            const zip = await window.JSZip.loadAsync(bytes);

            // Slide ORDER comes from presentation.xml's sldIdLst, resolved through the
            // presentation's rels — never from the slideN.xml file names, which are creation
            // order and can differ from the order the deck presents (and renders) in.
            const presPath = "ppt/presentation.xml";
            const presFile = zip.file(presPath);
            const slidePaths = [];
            if (presFile) {
                const presDoc = xmlOf(await presFile.async("string"));
                const presRels = await relsOf(zip, presPath);
                for (const sldId of byLocal(presDoc, "sldId")) {
                    const rid = Array.from(sldId.attributes).find((a) => a.localName === "id" && a.name !== "id")
                        || sldId.getAttributeNode("r:id");
                    const relId = rid ? rid.value : null;
                    const rel = relId ? presRels.get(relId) : undefined;
                    if (rel) slidePaths.push(resolvePart(presPath, rel.target));
                }
            }

            const slides = [];
            const charts = [];
            for (let i = 0; i < slidePaths.length; i++) {
                const path = slidePaths[i];
                const entry = { title: "", notes: "" };
                const file = zip.file(path);
                if (file) entry.title = titleFromSlideXml(xmlOf(await file.async("string")));

                const rels = await relsOf(zip, path);
                for (const rel of rels.values()) {
                    if (rel.type.endsWith("/notesSlide")) {
                        const notesFile = zip.file(resolvePart(path, rel.target));
                        if (notesFile) {
                            // A notes slide also contains a thumbnail of the slide itself; the
                            // body placeholder is the part that holds the presenter's script.
                            const doc = xmlOf(await notesFile.async("string"));
                            const bodies = byLocal(doc, "sp").filter((sp) => {
                                const ph = byLocal(sp, "ph")[0];
                                return ph && (ph.getAttribute("type") || "") === "body";
                            });
                            const source = bodies.length > 0 ? bodies : byLocal(doc, "sp");
                            entry.notes = source.map((sp) => textOfRuns(sp))
                                .join("\n").replace(/[ \t]+/g, " ").trim();
                        }
                    } else if (rel.type.endsWith("/chart")) {
                        const chartFile = zip.file(resolvePart(path, rel.target));
                        if (chartFile) {
                            const data = chartFromXml(xmlOf(await chartFile.async("string")));
                            charts.push({ index: charts.length, slide: i + 1, ...data });
                        }
                    }
                }
                slides.push(entry);
            }
            return { unavailable: false, slides, charts, zip };
        }

        function packageSidecar() {
            if (!packagePromise) {
                packagePromise = readPackage().catch(() => ({ unavailable: true, slides: [], charts: [] }));
            }
            return packagePromise;
        }

        // ── Metadata ────────────────────────────────────────────────────────────────────

        const CORE_FIELDS = [
            ["title", "title"], ["subject", "subject"], ["author", "creator"],
            ["keywords", "keywords"], ["description", "description"],
            ["lastModifiedBy", "lastModifiedBy"], ["revision", "revision"],
            ["created", "created"], ["modified", "modified"], ["category", "category"],
        ];

        async function readMetadata() {
            if (metadataCache) return metadataCache;
            const sidecar = await packageSidecar();
            if (sidecar.unavailable || !sidecar.zip) {
                return { note: "Deck properties are not available for this deck." };
            }
            const result = {};
            const core = sidecar.zip.file("docProps/core.xml");
            if (core) {
                const doc = xmlOf(await core.async("string"));
                for (const [name, local] of CORE_FIELDS) {
                    const el = byLocal(doc, local)[0];
                    const value = el && el.textContent ? el.textContent.trim() : "";
                    if (value) result[name] = value;
                }
            }
            const appPart = sidecar.zip.file("docProps/app.xml");
            if (appPart) {
                const doc = xmlOf(await appPart.async("string"));
                for (const local of ["Application", "Company", "Slides", "Words", "Paragraphs"]) {
                    const el = byLocal(doc, local)[0];
                    const value = el && el.textContent ? el.textContent.trim() : "";
                    if (value) result[local.toLowerCase()] = value;
                }
            }
            // `slides`/`words` above are what the AUTHORING app last recorded, which can disagree
            // with what this board rendered. Say which is which rather than letting an agent read
            // a stale count as fact.
            if (result.slides !== undefined) {
                result.slidesRecordedByPowerPoint = result.slides;
                delete result.slides;
            }
            result.renderedSlideCount = slideEls().length;
            metadataCache = result;
            return result;
        }

        // ── Stats ───────────────────────────────────────────────────────────────────────

        async function buildStats() {
            const list = requireLoaded();
            const sidecar = await packageSidecar();
            const started = Date.now();
            const slides = [];
            let totalChars = 0;
            let totalMarkdownChars = 0;
            let totalTables = 0;
            let totalImages = 0;
            let totalCharts = 0;
            let slidesWithNotes = 0;

            for (let n = 1; n <= list.length; n++) {
                const info = sidecar.slides[n - 1];
                const plain = slideContent(n, false, false, sidecar);
                const markdown = slideContent(n, true, true, sidecar);
                const blocks = extractSlide(n).blocks;
                const tables = blocks.filter((b) => b.type === "table").length;
                const images = blocks.filter((b) => b.type === "image").length;
                const chartCount = blocks.filter((b) => b.type === "chart").length;
                const hasNotes = !!(info && info.notes);
                if (hasNotes) slidesWithNotes++;
                totalChars += plain.length;
                totalMarkdownChars += markdown.length;
                totalTables += tables;
                totalImages += images;
                totalCharts += chartCount;
                slides.push({
                    slide: n,
                    title: info && info.title ? info.title : undefined,
                    chars: plain.length,
                    markdownChars: markdown.length,
                    tables,
                    images,
                    charts: chartCount,
                    hasNotes,
                    hasText: plain.trim() !== "",
                });
            }

            statsCache = {
                slideCount: list.length,
                totalChars,
                totalMarkdownChars,
                totalTables,
                totalImages,
                totalCharts,
                slidesWithNotes,
                slidesWithText: slides.filter((s) => s.hasText).length,
                scanMs: Date.now() - started,
                slides,
            };
            if (sidecar.unavailable) {
                statsCache.note = "Speaker notes, chart data and slide titles are unavailable for "
                    + "this deck (its package could not be re-read).";
            }
            return statsCache;
        }

        // ── Showing the user ────────────────────────────────────────────────────────────

        /** Scroll a phrase into the user's view and flash it. The match is wrapped in a transient
         *  span; the unwrap moves the children BACK OUT before removing it — removing the span
         *  outright would delete the text with it. */
        function flashRange(range) {
            const mark = document.createElement("span");
            mark.className = "ai-flash";
            try {
                range.surroundContents(mark);
            } catch {
                // The match straddles element boundaries and cannot be wrapped — fall back to
                // scrolling its containing element, which still puts it on screen.
                const host = range.startContainer.parentElement;
                if (host) host.scrollIntoView({ block: "center" });
                return false;
            }
            mark.scrollIntoView({ block: "center" });
            setTimeout(() => {
                const parent = mark.parentNode;
                if (!parent) return;
                while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                parent.removeChild(mark);
                parent.normalize();
            }, 2600);
            return true;
        }

        function findTextRange(query, caseSensitive, occurrence) {
            const root = ctx.getSlidesEl();
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const needle = caseSensitive ? query : query.toLowerCase();
            let seen = 0;
            let node;
            while ((node = walker.nextNode())) {
                const hay = caseSensitive ? node.nodeValue : node.nodeValue.toLowerCase();
                let at = hay.indexOf(needle);
                while (at !== -1) {
                    seen++;
                    if (seen >= occurrence) {
                        const range = document.createRange();
                        range.setStart(node, at);
                        range.setEnd(node, at + query.length);
                        return { range, node };
                    }
                    at = hay.indexOf(needle, at + 1);
                }
            }
            return null;
        }

        /** Which slide a node sits on — used to report back where a match was shown. */
        function slideOfNode(node) {
            let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            while (el && !el.classList.contains("pptx-preview-slide-wrapper")) el = el.parentElement;
            return el ? slideEls().indexOf(el) + 1 : undefined;
        }

        const app = {
            aiVision: {
                kind: "PowerPointBoard",
                summary: "The PowerPoint Viewer board's live model for the open .pptx deck.",
                overview: "Call getStats() first to see how big the deck is, slide by slide.\n"
                    + "Read it with getMarkdown(from, to) - titles, outline levels and tables are preserved.\n"
                    + "Read getNotes() for the speaker's script, and getCharts() for a chart's real numbers.",
                help: HELP,
                members: MEMBERS,
                summarize: () => ({
                    kind: "PowerPointBoard",
                    fileName: ctx.getFileName(),
                    filePath: ctx.getFilePath(),
                    slideCount: slideEls().length || undefined,
                    isLoaded: slideEls().length > 0,
                    // Cheap until something has been read: reported only once a scan has run, so
                    // `summarize` never silently walks a 300-slide deck.
                    totalChars: statsCache ? statsCache.totalChars : undefined,
                    hint: statsCache ? undefined : "Call getStats() for the deck's size, slide by slide.",
                }),
            },

            get fileName() { return ctx.getFileName(); },
            get filePath() { return ctx.getFilePath(); },
            get slideCount() { return slideEls().length || undefined; },
            get isLoaded() { return slideEls().length > 0; },
            get currentSlide() { return ctx.getCurrentSlide(); },
            set currentSlide(value) { ctx.scrollToSlide(requireSlide(requireLoaded(), value)); },

            async getStats() {
                requireLoaded();
                return statsCache || (await buildStats());
            },

            async getMarkdown(from, to, options) {
                const list = requireLoaded();
                const { first, last } = resolveRange(list, from, to);
                const withNotes = !(options && options.notes === false);
                const sidecar = await packageSidecar();
                const text = contentForRange(first, last, true, withNotes, sidecar);
                if (text.trim() === "") {
                    const scope = first === last ? "Slide " + first + " is" : "Slides " + first + "-" + last + " are";
                    return scope + " empty - they carry no text. Check getImages() for pictures on "
                        + "them: a slide's whole meaning is often a diagram.";
                }
                return text;
            },

            async getText(from, to, options) {
                const list = requireLoaded();
                const { first, last } = resolveRange(list, from, to);
                const withNotes = !(options && options.notes === false);
                return contentForRange(first, last, false, withNotes, await packageSidecar());
            },

            async getSlideMarkdown(slideNumber, options) {
                const list = requireLoaded();
                const n = requireSlide(list, slideNumber);
                const withNotes = !(options && options.notes === false);
                return slideContent(n, true, withNotes, await packageSidecar());
            },

            async getNotes(slideNumber) {
                const list = requireLoaded();
                const sidecar = await packageSidecar();
                if (sidecar.unavailable) {
                    return { note: "Speaker notes are not available for this deck (its package could not be re-read)." };
                }
                const range = slideNumber === undefined || slideNumber === null
                    ? { first: 1, last: list.length }
                    : { first: requireSlide(list, slideNumber), last: requireSlide(list, slideNumber) };
                const notes = [];
                for (let n = range.first; n <= range.last; n++) {
                    const info = sidecar.slides[n - 1];
                    if (info && info.notes) notes.push({ slide: n, title: info.title || undefined, notes: info.notes });
                }
                return {
                    count: notes.length,
                    notes,
                    note: notes.length > 0
                        ? "These are the presenter's script - they are not shown on the slides."
                        : "No slide in this range has speaker notes.",
                };
            },

            async search(query, options) {
                const list = requireLoaded();
                if (typeof query !== "string" || query === "") throw new Error("Pass the text to search for.");
                const opts = options || {};
                const withNotes = opts.notes !== false;
                const sidecar = await packageSidecar();
                const maxHits = Number(opts.maxHits) > 0 ? Number(opts.maxHits) : 100;
                const contextChars = Number(opts.contextChars) > 0 ? Number(opts.contextChars) : 80;
                const flags = opts.caseSensitive ? "g" : "gi";
                let pattern;
                try {
                    pattern = opts.regex
                        ? new RegExp(query, flags)
                        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
                } catch (err) {
                    throw new Error("Invalid regular expression: " + (err && err.message ? err.message : String(err)));
                }

                const hits = [];
                let truncated = false;
                for (let n = 1; n <= list.length && !truncated; n++) {
                    const text = searchableText(n, sidecar, withNotes);
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(text)) !== null) {
                        const start = Math.max(0, match.index - contextChars);
                        const end = Math.min(text.length, match.index + match[0].length + contextChars);
                        hits.push({
                            slide: n,
                            match: match[0],
                            index: match.index,
                            snippet: (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ")
                                + (end < text.length ? "…" : ""),
                        });
                        if (hits.length >= maxHits) { truncated = true; break; }
                        // A zero-width match (possible with a regex) would loop forever.
                        if (match[0] === "") pattern.lastIndex++;
                    }
                }
                return {
                    query,
                    hitCount: hits.length,
                    slides: [...new Set(hits.map((h) => h.slide))],
                    truncated,
                    searchedNotes: withNotes,
                    hits,
                };
            },

            async getOutline() {
                const list = requireLoaded();
                const sidecar = await packageSidecar();
                const out = [];
                for (let n = 1; n <= list.length; n++) {
                    const info = sidecar.slides[n - 1];
                    out.push({ slide: n, title: info && info.title ? info.title : "" });
                }
                return out;
            },

            getTables(slideNumber) {
                const list = requireLoaded();
                const range = slideNumber === undefined || slideNumber === null
                    ? { first: 1, last: list.length }
                    : { first: requireSlide(list, slideNumber), last: requireSlide(list, slideNumber) };
                const out = [];
                for (let n = range.first; n <= range.last; n++) {
                    for (const block of extractSlide(n).blocks) {
                        if (block.type === "table") {
                            out.push({
                                index: out.length,
                                slide: n,
                                rowCount: block.rows.length,
                                columnCount: block.rows.reduce((max, r) => Math.max(max, r.length), 0),
                                rows: block.rows,
                            });
                        }
                    }
                }
                return out;
            },

            async getCharts(slideNumber) {
                const list = requireLoaded();
                const sidecar = await packageSidecar();
                if (sidecar.unavailable) {
                    return { count: 0, charts: [], note: "Chart data is not available for this deck (its package could not be re-read)." };
                }
                const wanted = slideNumber === undefined || slideNumber === null
                    ? null
                    : requireSlide(list, slideNumber);
                const charts = sidecar.charts.filter((c) => wanted === null || c.slide === wanted);
                return {
                    count: charts.length,
                    charts,
                    note: charts.length > 0
                        ? "These are the deck's own chart values, not figures read off the rendering."
                        : "No chart in this range.",
                };
            },

            getImages() {
                requireLoaded();
                const images = collectImages().map(describeImage);
                return {
                    count: images.length,
                    images,
                    note: images.length > 0
                        ? "Save one with saveImage(path, index) and open the file to read it."
                        : "This deck has no embedded pictures.",
                };
            },

            getMetadata() {
                requireLoaded();
                return readMetadata();
            },

            async saveMarkdown(path, from, to, options) {
                const list = requireLoaded();
                requireAbsolutePath(path, "Markdown");
                const { first, last } = resolveRange(list, from, to);
                const withNotes = !(options && options.notes === false);
                const text = contentForRange(first, last, true, withNotes, await packageSidecar());
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path, slides: [first, last], chars: text.length, lines: countLines(text) };
            },

            async saveText(path, from, to, options) {
                const list = requireLoaded();
                requireAbsolutePath(path, "text");
                const { first, last } = resolveRange(list, from, to);
                const withNotes = !(options && options.notes === false);
                const text = contentForRange(first, last, false, withNotes, await packageSidecar());
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path, slides: [first, last], chars: text.length, lines: countLines(text) };
            },

            async saveImage(path, index) {
                requireLoaded();
                requireAbsolutePath(path, "image");
                const images = collectImages();
                const n = Number(index);
                if (!Number.isInteger(n) || n < 0 || n >= images.length) {
                    throw new Error("No image with index " + index + "; this deck has "
                        + images.length + " embedded picture" + (images.length === 1 ? "" : "s")
                        + ". Call getImages() for the list.");
                }
                return writeImage(path, images[n]);
            },

            async saveImages(directory) {
                requireLoaded();
                requireAbsolutePath(directory, "images");
                const images = collectImages();
                const written = [];
                const width = String(Math.max(1, images.length)).length;
                for (const entry of images) {
                    const ext = EXTENSIONS[entry.mime] || "bin";
                    const name = "image-" + String(entry.index + 1).padStart(width, "0") + "." + ext;
                    written.push(await writeImage(joinPath(directory, name), entry));
                }
                return { directory, count: written.length, files: written };
            },

            goToSlide(slideNumber) {
                const list = requireLoaded();
                const n = requireSlide(list, slideNumber);
                ctx.scrollToSlide(n);
                return n;
            },

            showText(query, options) {
                requireLoaded();
                if (typeof query !== "string" || query === "") throw new Error("Pass the text to show.");
                const opts = options || {};
                const occurrence = Number(opts.occurrence) > 0 ? Number(opts.occurrence) : 1;
                const found = findTextRange(query, !!opts.caseSensitive, occurrence);
                if (!found) {
                    return {
                        found: false,
                        note: 'No occurrence of "' + query + '" is rendered on any slide. Speaker '
                            + "notes are not rendered, so a phrase that only appears in the notes "
                            + "cannot be shown this way.",
                    };
                }
                const slide = slideOfNode(found.node);
                const flashed = flashRange(found.range);
                return {
                    found: true,
                    slide,
                    flashed,
                    note: flashed
                        ? "Scrolled the user's view to it and highlighted it briefly."
                        : "Scrolled the user's view to it; it spans formatting boundaries so it could not be highlighted.",
                };
            },

            async openTextPage(from, to) {
                const list = requireLoaded();
                const { first, last } = resolveRange(list, from, to);
                const text = contentForRange(first, last, true, true, await packageSidecar());
                const name = ctx.getFileName() || "Deck";
                const title = first === last ? name + " s" + first : name + " s" + first + "-" + last;
                return P.openContent({
                    editor: "md-view",
                    language: "markdown",
                    title,
                    content: "# " + title + "\n\n" + text,
                });
            },
        };

        let remote = null;

        return {
            register() {
                remote = aiVision.expose(app);
            },
            /** Called when a deck renders. Every cache belongs to the previous deck, and the
             *  shape's summary values (slide count, file name) have all changed. */
            documentChanged() {
                slideCache.clear();
                statsCache = null;
                metadataCache = null;
                packagePromise = null;
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
        };
    };
})();
