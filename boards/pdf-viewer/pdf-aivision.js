// PDF Viewer board — the AiVision agent surface.
//
// Why this exists: an agent asked to "read this PDF" used to shell out to some external
// converter, because the document on screen was opaque to it. It never needed to. The board
// hosts pdf.js's stock viewer in a NESTED SAME-ORIGIN `board://` frame, so
// `frame.contentWindow.PDFViewerApplication.pdfDocument` is a full `PDFDocumentProxy` — the
// document is already parsed and sitting in the page. This file publishes it at
// `pages[pageId].editor.app`.
//
// Three things shaped the design:
//
//   1. **Transport, not extraction, is the limit.** Extracting all 14 pages of a sample paper
//      takes 121 ms and yields 83k characters, and `call` bounds a result (20k by default).
//      So every text read is page-ranged, and `getStats()` exists to tell an agent HOW BIG the
//      document is — per page — so it can plan its reads instead of hitting a truncation.
//   2. **A scanned PDF has no text layer at all.** pdf.js does no OCR: `getTextContent()`
//      simply returns zero items. Without `hasTextLayer` an agent reads "" and reports the
//      document is blank. Instead it reads the flag and switches to `savePageImage()`, which
//      renders the page to a real PNG on disk that the agent opens with its own vision.
//   3. **No `elements` / `highlight`.** `createElements` binds `data-name` attributes in the
//      BOARD's document, but every viewer control (`#pageNumber`, `#findInput`, …) lives in the
//      nested frame, where the board-frame overlay cannot find it. Rather than publish a
//      `highlight` that silently points at nothing, this model publishes none, and the board
//      editor's own `snapshot()` remains the way to drive the viewer's UI. `goToPage()` is here
//      so an agent can still move the user's view.
//
// Everything here is READ-ONLY with respect to the PDF. The save* methods write NEW files at a
// path the agent names; nothing ever modifies the open document.
(() => {
    const PDFAI = (window.PDFAI = window.PDFAI || {});

    const HELP = `This is a PDF open in the PDF Viewer board. The document is already parsed by
pdf.js, so reading it here needs no conversion step and no external tool.

Start with getStats(). It reports the page count and the character and line count of EVERY page,
which is what you need to decide how to read the document: a short PDF can be read in one
getText() call, a long one should be read a few pages at a time. A call result is bounded (20k
characters by default), so ask for a page range you can actually receive, or raise maxLength.

If hasTextLayer is false the PDF is a SCAN — an image of a document with no text in it. pdf.js
does not OCR, so getText() legitimately returns nothing. Use savePageImage(path, n) instead: it
renders that page to a PNG file at the path you name, which you can then open and read with your
own vision. The same trick reads a figure, chart or complex table on a page that does have text.

Text can also come out WRONG rather than missing. When an embedded font carries no ToUnicode map -
common for the labels inside charts and figures - the text extracts as meaningless symbols like
'$!"# %!"#'. getStats() reports those pages as pagesWithUnreadableText with a sample, and the
prose around them is still correct. Never try to interpret a garbled run: render that page with
savePageImage and read the picture.

search(query) is a plain text search over the extracted text and returns page numbers with
snippets — use it to locate a topic in a long document before reading those pages in full.

Paths passed to saveText, savePageImage and savePageImages must be ABSOLUTE. Page numbers are
1-based everywhere, matching what the viewer shows the user.`;

    const MEMBERS = [
        { name: "fileName", kind: "property", summary: "Name of the open PDF file." },
        { name: "filePath", kind: "property", summary: "Absolute path of the open PDF file on disk." },
        { name: "pageCount", kind: "property", summary: "Number of pages in the document." },
        { name: "currentPage", kind: "property", summary: "The page number the user is currently looking at.", writable: true },
        { name: "hasTextLayer", kind: "property", summary: "Whether the PDF contains extractable text. False means it is a scan - read it with savePageImage instead." },
        { name: "hasOutline", kind: "property", summary: "Whether the PDF has bookmarks/table of contents, readable with getOutline()." },
        { name: "info", kind: "property", summary: "Document metadata: title, author, subject, keywords, producer, creation date." },
        { name: "isLoaded", kind: "property", summary: "Whether a document is open and ready to read." },

        { name: "getStats", kind: "method", signature: "getStats()", summary: "How big is this PDF: total and per-page character and line counts, so you can plan how much to read at once. Read this first." },
        { name: "getText", kind: "method", signature: "getText(from = 1, to = pageCount)", summary: "The text of a page range, with a page marker between pages. Mind the result size - check getStats() first." },
        { name: "getPageText", kind: "method", signature: "getPageText(pageNumber)", summary: "The text of one page, with no page marker." },
        { name: "search", kind: "method", signature: "search(query, options?)", summary: "Find text in the document; returns page numbers and snippets. Options: { caseSensitive, regex, maxHits, contextChars }." },
        { name: "getOutline", kind: "method", signature: "getOutline()", summary: "The PDF bookmarks / table of contents as a flat list with titles, nesting level and page numbers." },
        { name: "getMetadata", kind: "method", signature: "getMetadata()", summary: "Full document metadata, including the raw XMP fields when the PDF carries them." },
        { name: "getPageLabels", kind: "method", signature: "getPageLabels()", summary: "The printed page labels (i, ii, 1, 2, A-1) when the PDF numbers its pages differently from their position." },

        { name: "saveText", kind: "method", signature: "saveText(path, from = 1, to = pageCount)", summary: "Write the text of a page range to a UTF-8 file at an absolute path you name, and return that path. Use it instead of getText for a document too large to receive in one call.", caution: "writes a new file to disk" },
        { name: "savePageImage", kind: "method", signature: "savePageImage(path, pageNumber, options?)", summary: "Render one page to an image file at an absolute path you name, and return the path with its size. THIS IS HOW YOU READ A SCANNED PDF - open the file afterwards and read it with your own vision. Options: { scale, format, quality }.", caution: "writes a new file to disk" },
        { name: "savePageImages", kind: "method", signature: "savePageImages(directory, from = 1, to = pageCount, options?)", summary: "Render a range of pages into a directory, one image per page, and return the paths.", caution: "writes several new files to disk" },
        { name: "getPageImage", kind: "method", signature: "getPageImage(pageNumber, options?)", summary: "One page as a base64 data URL. Usually far too large for a call result - prefer savePageImage, which writes a file you can open.", caution: "returns a very large string" },

        { name: "goToPage", kind: "method", signature: "goToPage(pageNumber)", summary: "Scroll the user's view to a page, so they see the page you are talking about." },
        { name: "openTextPage", kind: "method", signature: "openTextPage(from = 1, to = pageCount)", summary: "Open the extracted text as a new Markdown page in Persephone, to show the user what you read.", caution: "opens a new page" },
    ];

    /** Default render scale. 1.5 puts a US-Letter page at ~918x1188 — legible to a vision
     *  model without producing a needlessly huge file. */
    const DEFAULT_SCALE = 1.5;
    const MAX_SCALE = 4;

    PDFAI.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, refresh() {} };

        /** Extracted text per page number. A page is parsed once and kept — re-reading a range
         *  costs nothing, and `getStats()` warms the whole document in one pass. */
        const textCache = new Map();
        let statsCache = null;

        const getDoc = () => ctx.getDocument();

        /** pdf.js hands back prototyped objects (its metadata `info`, its XMP map), and the
         *  AiVision resolver only serializes plain JSON — an un-normalized value reaches the
         *  agent as "No AiVision descriptor yet for Object" instead of its contents. A JSON
         *  round-trip flattens it and turns Dates into strings. */
        function toPlain(value) {
            if (value === undefined || value === null) return undefined;
            try {
                return JSON.parse(JSON.stringify(value));
            } catch {
                return undefined;
            }
        }

        function requireDoc() {
            const doc = getDoc();
            if (!doc) throw new Error("No PDF is open in this board yet.");
            return doc;
        }

        function requirePage(doc, pageNumber) {
            const n = Number(pageNumber);
            if (!Number.isInteger(n) || n < 1 || n > doc.numPages) {
                throw new Error("Page " + pageNumber + " is out of range; this document has "
                    + doc.numPages + " page" + (doc.numPages === 1 ? "" : "s") + ".");
            }
            return n;
        }

        /** Clamp a requested range to the document, defaulting to the whole thing. */
        function resolveRange(doc, from, to) {
            const first = from === undefined || from === null ? 1 : requirePage(doc, from);
            const last = to === undefined || to === null ? doc.numPages : requirePage(doc, to);
            if (last < first) throw new Error("Page range is backwards: " + first + " to " + last + ".");
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
                throw new Error('"' + path + '" is not an absolute path. Pass a full path such as '
                    + "C:\\Users\\you\\Documents\\page-3.png — a relative path would be written "
                    + "inside the board's own folder.");
            }
            return path;
        }

        // ── Text ────────────────────────────────────────────────────────────────────────
        // pdf.js yields text as positioned items in content-stream order. Joining them in that
        // order with `hasEOL` as the line break reproduces the document's reading order well
        // (verified on a two-column paper with code listings and figure captions). Deliberately
        // NOT reconstructing layout from item transforms: that is a heuristic, and when it
        // guesses wrong it reads worse than the plain order.
        async function pageText(pageNumber) {
            if (textCache.has(pageNumber)) return textCache.get(pageNumber);
            const doc = requireDoc();
            const page = await doc.getPage(pageNumber);
            const content = await page.getTextContent();
            let out = "";
            for (const item of content.items) {
                if (typeof item.str !== "string") continue;
                out += item.str + (item.hasEOL ? "\n" : "");
            }
            textCache.set(pageNumber, out);
            return out;
        }

        const countLines = (text) => (text === "" ? 0 : text.split("\n").length);

        // ── Mojibake detection ──────────────────────────────────────────────────────────
        // A PDF can yield text that is neither missing nor correct. When an embedded font
        // carries no `ToUnicode` map — routine for the fonts chart and plotting tools embed —
        // pdf.js returns the raw glyph codes, so a figure's labels extract as `$!"# %!"#`.
        // That is worse than no text: an agent reads it as content and reports nonsense.
        //
        // It cannot be caught per page — on the sample paper the affected pages still score
        // 0.85 letters-per-character, because only the FIGURE is garbled and the surrounding
        // prose is fine. So the test is per TOKEN: a run of 4+ characters with no vowel and no
        // digit is not a word in any Latin-script language. Trailing punctuation is stripped
        // first, which is what separates real mojibake from the false positives this produced
        // on clean pages ("VMs.", "C++.", "SFX." — all 3 characters once stripped).
        // Two further conditions keep this from crying wolf, each one earned against real text:
        //   * a digit disqualifies the token — that is what keeps code listings (`sp[0],`,
        //     `ebx(748)`) from reading as garbage;
        //   * a symbol is REQUIRED — that is what keeps vowel-free acronyms (HTML, HTTP, SFX)
        //     from reading as garbage.
        // Everything left is symbol soup with no vowel and no digit, which is not language.
        const GARBLED_MIN_TOKENS = 2;

        function findGarbled(text) {
            const samples = [];
            let count = 0;
            for (const raw of text.split(/\s+/)) {
                const token = raw.replace(/^[.,;:()[\]"']+/, "").replace(/[.,;:()[\]"']+$/, "");
                if (token.length < 4) continue;
                if (/[aeiouAEIOU0-9]/.test(token)) continue;
                if (!/[^A-Za-z0-9]/.test(token)) continue;
                count++;
                if (samples.length < 3) samples.push(token);
            }
            return { count, samples };
        }

        async function buildStats() {
            const doc = requireDoc();
            const started = performance.now();
            const pages = [];
            let totalChars = 0;
            let totalLines = 0;
            const garbledPages = [];
            for (let n = 1; n <= doc.numPages; n++) {
                const text = await pageText(n);
                const lines = countLines(text);
                const entry = { page: n, chars: text.length, lines, hasText: text.trim().length > 0 };
                const garbled = findGarbled(text);
                if (garbled.count >= GARBLED_MIN_TOKENS) {
                    entry.someTextUnreadable = true;
                    entry.unreadableSample = garbled.samples;
                    garbledPages.push(n);
                }
                pages.push(entry);
                totalChars += text.length;
                totalLines += lines;
            }
            const pagesWithText = pages.filter((p) => p.hasText).length;
            statsCache = {
                kind: "PdfStats",
                pageCount: doc.numPages,
                totalChars,
                totalLines,
                pagesWithText,
                hasTextLayer: pagesWithText > 0,
                scanMs: Math.round(performance.now() - started),
                pagesWithUnreadableText: garbledPages.length > 0 ? garbledPages : undefined,
                pages,
                note: pagesWithText === 0
                    ? "This PDF has no text layer - it is a scan. getText() will return nothing; "
                      + "render pages with savePageImage(path, n) and read the images instead."
                    : pagesWithText < doc.numPages
                        ? "Some pages have no text (scanned or image-only) - render those with savePageImage."
                        : undefined,
                unreadableNote: garbledPages.length > 0
                    ? "Pages " + garbledPages.join(", ") + " contain text that extracts as meaningless "
                      + "symbols (a font with no ToUnicode map, typical of chart and figure labels). "
                      + "The prose on those pages is still fine - but do not try to interpret the "
                      + "garbled runs. Render those pages with savePageImage to read what they say."
                    : undefined,
            };
            return statsCache;
        }

        async function textForRange(first, last) {
            const parts = [];
            for (let n = first; n <= last; n++) {
                const text = await pageText(n);
                // A page marker keeps an agent oriented in a multi-page read and lets it cite a
                // page number back to the user.
                parts.push(first === last ? text : "--- page " + n + " ---\n" + text);
            }
            return parts.join("\n\n");
        }

        // ── Rendering ───────────────────────────────────────────────────────────────────
        async function renderPage(pageNumber, options) {
            const doc = requireDoc();
            const n = requirePage(doc, pageNumber);
            const opts = options || {};
            const scale = Math.min(Math.max(Number(opts.scale) || DEFAULT_SCALE, 0.1), MAX_SCALE);
            const format = String(opts.format || "png").toLowerCase();
            if (format !== "png" && format !== "jpeg" && format !== "jpg") {
                throw new Error('Unknown image format "' + opts.format + '". Use "png" or "jpeg".');
            }
            const mime = format === "png" ? "image/png" : "image/jpeg";
            const quality = opts.quality === undefined ? 0.85 : Number(opts.quality);

            const page = await doc.getPage(n);
            const viewport = page.getViewport({ scale });

            // The canvas MUST belong to the viewer frame's document, not this one. pdf.js
            // registers the PDF's fonts as font faces on the document that owns the document
            // proxy — the viewer frame (12 faces there, 0 here). A canvas from the board's own
            // document cannot see them, so every glyph rasterizes as a hollow box: a
            // pixel-perfect page layout with no readable text, and no error anywhere.
            const canvas = ctx.getViewerDocument().createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            // `intent: "print"` is LOAD-BEARING, not a copy-paste leftover. pdf.js's default
            // "display" intent drives its render loop with `requestAnimationFrame`, and Chromium
            // does not fire rAF in a window that is not painting. An agent calls this while the
            // user is in another application, so the Persephone window is usually unfocused —
            // `document.visibilityState` still reads "visible", rAF never fires, and a "display"
            // render NEVER SETTLES. It hangs with no error, which surfaces only as a call
            // timeout. Measured: display = hang, print = 41 ms, same window state.
            // "print" renders the printable appearance (annotations print their values), which
            // is what you want for reading a page anyway.
            const task = page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" });
            await Promise.race([
                task.promise,
                new Promise((_, reject) => setTimeout(() => {
                    try { task.cancel(); } catch { /* already finished */ }
                    reject(new Error("Rendering page " + n + " did not finish within 30s."));
                }, 30000)),
            ]);
            const dataUrl = canvas.toDataURL(mime, quality);
            return { pageNumber: n, dataUrl, width: canvas.width, height: canvas.height, format: format === "jpg" ? "jpeg" : format };
        }

        async function writeImage(path, rendered) {
            const base64 = rendered.dataUrl.slice(rendered.dataUrl.indexOf(",") + 1);
            await P.writeFile(path, base64, { encoding: "base64" });
            // base64 inflates by 4/3; report the real file size so an agent can judge the cost.
            const bytes = Math.floor((base64.length * 3) / 4);
            return {
                path,
                page: rendered.pageNumber,
                width: rendered.width,
                height: rendered.height,
                format: rendered.format,
                bytes,
                note: "Open this file to read the page with your own vision.",
            };
        }

        /** `page-3.png` for a range written into a directory. Keeps the numbering zero-padded so
         *  the files sort in page order in any file listing. */
        function pageFileName(pageNumber, pageCount, format) {
            const width = String(pageCount).length;
            return "page-" + String(pageNumber).padStart(width, "0") + "." + (format === "jpeg" ? "jpg" : format);
        }

        function joinPath(directory, name) {
            const trimmed = directory.replace(/[\\/]+$/, "");
            const separator = trimmed.includes("\\") ? "\\" : "/";
            return trimmed + separator + name;
        }

        // ── Outline ─────────────────────────────────────────────────────────────────────
        /** pdf.js returns bookmarks as a tree whose destinations are internal references.
         *  Flatten it and resolve each destination to a real page number, because "chapter 4
         *  starts on page 37" is the useful form. A destination that will not resolve is kept
         *  with `page: undefined` rather than dropping the entry. */
        async function flattenOutline(doc, items, level, out) {
            for (const item of items) {
                let page;
                try {
                    let dest = item.dest;
                    if (typeof dest === "string") dest = await doc.getDestination(dest);
                    if (Array.isArray(dest) && dest[0]) {
                        page = (await doc.getPageIndex(dest[0])) + 1;
                    }
                } catch {
                    // Unresolvable destination — report the heading without a page number.
                }
                out.push({ title: item.title, level, page });
                if (item.items && item.items.length > 0) {
                    await flattenOutline(doc, item.items, level + 1, out);
                }
            }
            return out;
        }

        const app = {
            aiVision: {
                kind: "PdfBoard",
                summary: "The PDF Viewer board's live model for the open PDF document.",
                overview: "Call getStats() first to see how big the document is, page by page.\n"
                    + "Read it with getText(from, to), or locate a topic with search(query).\n"
                    + "If hasTextLayer is false the PDF is a scan: use savePageImage(path, n) and read the image.",
                help: HELP,
                members: MEMBERS,
                summarize: () => ({
                    kind: "PdfBoard",
                    fileName: ctx.getFileName(),
                    filePath: ctx.getFilePath(),
                    pageCount: ctx.getPageCount(),
                    currentPage: ctx.getCurrentPage(),
                    isLoaded: !!getDoc(),
                    // Cheap until something has been read: reported only once a scan has run,
                    // so `summarize` never silently parses a thousand-page document.
                    hasTextLayer: statsCache ? statsCache.hasTextLayer : undefined,
                    totalChars: statsCache ? statsCache.totalChars : undefined,
                    hint: statsCache ? undefined : "Call getStats() for the document's size, page by page.",
                }),
            },

            get fileName() { return ctx.getFileName(); },
            get filePath() { return ctx.getFilePath(); },
            get pageCount() { return ctx.getPageCount(); },
            get currentPage() { return ctx.getCurrentPage(); },
            set currentPage(value) { ctx.setCurrentPage(requirePage(requireDoc(), value)); },
            get isLoaded() { return !!getDoc(); },
            get hasOutline() { return ctx.getHasOutline(); },
            get hasTextLayer() {
                if (statsCache) return statsCache.hasTextLayer;
                // Unknown until something is read; say so rather than guessing from one page.
                return undefined;
            },
            get info() { return toPlain(ctx.getInfo()); },

            async getStats() {
                requireDoc();
                return statsCache || (await buildStats());
            },

            async getText(from, to) {
                const doc = requireDoc();
                const { first, last } = resolveRange(doc, from, to);
                const text = await textForRange(first, last);
                if (text.trim() === "") {
                    const scope = first === last ? "Page " + first + " has" : "Pages " + first + "-" + last + " have";
                    return scope + " no extractable text. This is normal for a scanned PDF - "
                        + "render the pages with savePageImage(path, pageNumber) and read the images instead.";
                }
                return text;
            },

            async getPageText(pageNumber) {
                const doc = requireDoc();
                return pageText(requirePage(doc, pageNumber));
            },

            async search(query, options) {
                const doc = requireDoc();
                if (typeof query !== "string" || query === "") throw new Error("Pass the text to search for.");
                const opts = options || {};
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
                for (let n = 1; n <= doc.numPages && !truncated; n++) {
                    const text = await pageText(n);
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(text)) !== null) {
                        const start = Math.max(0, match.index - contextChars);
                        const end = Math.min(text.length, match.index + match[0].length + contextChars);
                        hits.push({
                            page: n,
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
                    pages: [...new Set(hits.map((h) => h.page))],
                    truncated,
                    hits,
                };
            },

            async getOutline() {
                const doc = requireDoc();
                const outline = await doc.getOutline();
                if (!outline || outline.length === 0) return [];
                return flattenOutline(doc, outline, 0, []);
            },

            async getMetadata() {
                const doc = requireDoc();
                const meta = await doc.getMetadata();
                const result = { info: toPlain(meta && meta.info) || {} };
                if (meta && meta.metadata && typeof meta.metadata.getAll === "function") {
                    result.xmp = toPlain(meta.metadata.getAll());
                }
                return result;
            },

            async getPageLabels() {
                const doc = requireDoc();
                return (await doc.getPageLabels()) || null;
            },

            async saveText(path, from, to) {
                const doc = requireDoc();
                requireAbsolutePath(path, "text");
                const { first, last } = resolveRange(doc, from, to);
                const text = await textForRange(first, last);
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path, pages: [first, last], chars: text.length, lines: countLines(text) };
            },

            async savePageImage(path, pageNumber, options) {
                requireDoc();
                requireAbsolutePath(path, "image");
                const rendered = await renderPage(pageNumber, options);
                return writeImage(path, rendered);
            },

            async savePageImages(directory, from, to, options) {
                const doc = requireDoc();
                requireAbsolutePath(directory, "images");
                const { first, last } = resolveRange(doc, from, to);
                const opts = options || {};
                const format = String(opts.format || "png").toLowerCase();
                const written = [];
                for (let n = first; n <= last; n++) {
                    const rendered = await renderPage(n, opts);
                    const target = joinPath(directory, pageFileName(n, doc.numPages, format === "jpg" ? "jpeg" : format));
                    written.push(await writeImage(target, rendered));
                }
                return { directory, count: written.length, files: written };
            },

            async getPageImage(pageNumber, options) {
                requireDoc();
                const rendered = await renderPage(pageNumber, options);
                return {
                    page: rendered.pageNumber,
                    width: rendered.width,
                    height: rendered.height,
                    chars: rendered.dataUrl.length,
                    dataUrl: rendered.dataUrl,
                };
            },

            goToPage(pageNumber) {
                const doc = requireDoc();
                const n = requirePage(doc, pageNumber);
                ctx.setCurrentPage(n);
                return n;
            },

            async openTextPage(from, to) {
                const doc = requireDoc();
                const { first, last } = resolveRange(doc, from, to);
                const text = await textForRange(first, last);
                const name = ctx.getFileName() || "PDF";
                const title = first === last ? name + " p" + first : name + " p" + first + "-" + last;
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
            /** Called when a document opens. The cached text belongs to the previous document,
             *  and the shape's summary values (page count, file name) have all changed. */
            documentChanged() {
                textCache.clear();
                statsCache = null;
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
        };
    };
})();
