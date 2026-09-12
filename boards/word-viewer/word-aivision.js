// Word Viewer board — the AiVision agent surface.
//
// Why this exists: an agent asked to "read this Word document" used to shell out to an external
// converter, because the document on screen was opaque to it. It never needed to. docx-preview
// renders the .docx into `#doc` in THIS BOARD'S OWN DOCUMENT — no nested frame, no cross-origin
// boundary. The rendered DOM *is* the content, already laid out and already paginated into one
// `section.docx` per page break. This file publishes it at `pages[pageId].editor.app`.
//
// Four things shaped the design, and each is a deliberate divergence from the PDF board's model:
//
//   1. **Markdown is the primary output, not plain text.** A PDF yields a flat stream of
//      positioned glyphs, so plain text with page markers is the honest ceiling. A .docx is
//      structured: heading level survives as a `docx_heading<N>` class, tables are real `<table>`
//      elements, list items are `display: list-item`. Flattening that to prose would DESTROY
//      information the document actually carries, so `getMarkdown()` is the main read and
//      `getText()` is the fallback for when an agent wants no markup at all.
//   2. **Text is never missing and never wrong.** A .docx stores characters, not glyph outlines.
//      There is no scanned-document case and no ToUnicode mojibake case, so `hasTextLayer` and
//      `pagesWithUnreadableText` — half of the PDF model — have no analogue here and are absent.
//      Their absence is a fact about the format, not an omission.
//   3. **Embedded images are already extractable, so there is no page RENDERER.** The board sets
//      `useBase64URL: true`, so every picture in the document is a `data:` URL sitting in the
//      DOM. `saveImage()` is a base64 decode, not a canvas render — which is also why none of the
//      PDF board's rendering hazards (the rAF/`intent` hang, the font-realm hollow-glyph bug)
//      exist here. What is NOT offered is a picture of a whole PAGE: there is no HTML-to-canvas
//      path, and unlike a scanned PDF nothing needs one, because the text is always readable.
//   4. **`showText()` can exist here.** The PDF board could not highlight anything, because its
//      viewer controls live in a nested frame the board-frame overlay cannot reach. Here the
//      document is in the board's own DOM, so the board can scroll a phrase into the user's view
//      and flash it — which is how an agent points at what it is talking about.
//
// Everything here is READ-ONLY with respect to the document. The save* methods write NEW files at
// a path the agent names; nothing ever modifies the open .docx.
(() => {
    const WA = (window.WORDAI = window.WORDAI || {});

    const HELP = `This is a Word document (.docx) open in the Word Viewer board. It is already
parsed and rendered, so reading it here needs no conversion step and no external tool.

Start with getStats(). It reports the page count and the character, line, table and image count of
EVERY page, which is what you need to decide how to read the document: a short one can be read in
a single getMarkdown() call, a long one should be read a few pages at a time. A call result is
bounded (20k characters by default), so ask for a page range you can actually receive, raise
maxLength, or use saveMarkdown() and read the file.

getMarkdown(from, to) is the main read and what you should use by default. Unlike a PDF, a Word
document carries real structure, and this preserves it: headings become # levels, tables become
Markdown pipe tables, list items become - or 1. items with their nesting, and hyperlinks keep
their targets. getText(from, to) gives the same range as plain prose when you want no markup.

Text in a .docx is always real text. There is no scanned-document case and no garbled-font case
here - if getMarkdown returns nothing for a page, that page is genuinely empty.

Pictures embedded in the document are already decoded and are listed by getImages(). To actually
LOOK at one - a chart, a diagram, a screenshot pasted into the document - call
saveImage(path, index) and then open that file with your own vision. There is no way to render a
whole PAGE as a picture, and nothing here needs one, because the text is never missing.

getTables(page?) returns tables as arrays of rows, which is what you want when you need the
figures rather than the prose around them.

search(query) returns page numbers with snippets - use it to locate a topic in a long document
before reading those pages in full. showText(query) scrolls the USER's view to a phrase and
flashes it, so they can see what you are referring to.

Paths passed to saveMarkdown, saveText, saveImage and saveImages must be ABSOLUTE. Page numbers
are 1-based everywhere, matching the pages the user sees on screen.`;

    const MEMBERS = [
        { name: "fileName", kind: "property", summary: "Name of the open Word document." },
        { name: "filePath", kind: "property", summary: "Absolute path of the open .docx file on disk." },
        { name: "pageCount", kind: "property", summary: "Number of rendered pages in the document." },
        { name: "currentPage", kind: "property", summary: "The page number the user is currently looking at.", writable: true },
        { name: "isLoaded", kind: "property", summary: "Whether a document is open and rendered." },

        { name: "getStats", kind: "method", signature: "getStats()", summary: "How big is this document: total and per-page character, line, table and image counts, so you can plan how much to read at once. Read this first." },
        { name: "getMarkdown", kind: "method", signature: "getMarkdown(from = 1, to = pageCount)", summary: "The document as Markdown, preserving headings, tables, lists and links. This is the main way to read it. Mind the result size - check getStats() first." },
        { name: "getText", kind: "method", signature: "getText(from = 1, to = pageCount)", summary: "The same page range as plain prose with no Markdown markup, when you want the words only." },
        { name: "getPageMarkdown", kind: "method", signature: "getPageMarkdown(pageNumber)", summary: "One page as Markdown, with no page marker." },
        { name: "search", kind: "method", signature: "search(query, options?)", summary: "Find text in the document; returns page numbers and snippets. Options: { caseSensitive, regex, maxHits, contextChars }." },
        { name: "getOutline", kind: "method", signature: "getOutline()", summary: "The document's headings as a flat list with titles, nesting level and page numbers - so you can see its shape before reading it." },
        { name: "getTables", kind: "method", signature: "getTables(pageNumber?)", summary: "Tables as arrays of rows, for one page or the whole document. Use this when you need the figures rather than the prose." },
        { name: "getImages", kind: "method", signature: "getImages()", summary: "List the pictures embedded in the document with their page, size and format. Save one with saveImage to actually look at it." },
        { name: "getMetadata", kind: "method", signature: "getMetadata()", summary: "Document properties: title, author, subject, keywords, and the created and modified dates." },

        { name: "saveMarkdown", kind: "method", signature: "saveMarkdown(path, from = 1, to = pageCount)", summary: "Write a page range as Markdown to a UTF-8 file at an absolute path you name. Use it instead of getMarkdown for a document too large to receive in one call.", caution: "writes a new file to disk" },
        { name: "saveText", kind: "method", signature: "saveText(path, from = 1, to = pageCount)", summary: "Write a page range as plain text to a UTF-8 file at an absolute path you name.", caution: "writes a new file to disk" },
        { name: "saveImage", kind: "method", signature: "saveImage(path, index)", summary: "Write one embedded picture to an absolute path you name. THIS IS HOW YOU READ A CHART OR DIAGRAM - open the file afterwards and read it with your own vision. Index comes from getImages().", caution: "writes a new file to disk" },
        { name: "saveImages", kind: "method", signature: "saveImages(directory)", summary: "Write every embedded picture into a directory, one file each, and return the paths.", caution: "writes several new files to disk" },

        { name: "goToPage", kind: "method", signature: "goToPage(pageNumber)", summary: "Scroll the user's view to a page, so they see the page you are talking about." },
        { name: "showText", kind: "method", signature: "showText(query, options?)", summary: "Scroll the user's view to a phrase in the document and flash it, so they can see what you are referring to. Options: { caseSensitive, occurrence }.", caution: "changes what the user is looking at" },
        { name: "openTextPage", kind: "method", signature: "openTextPage(from = 1, to = pageCount)", summary: "Open the extracted Markdown as a new page in Persephone, to show the user what you read.", caution: "opens a new page" },
    ];

    WA.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, documentChanged() {} };

        /** Per-page extraction result, keyed by 1-based page number. The DOM does not change
         *  after a render, so a page is walked once and kept; `documentChanged()` clears it. */
        const pageCache = new Map();
        let statsCache = null;
        let metadataCache = null;

        // ── DOM access ──────────────────────────────────────────────────────────────────
        // docx-preview renders `.docx-wrapper > section.docx` (one per page break), and inside
        // each section an `<article>` for the body plus optional `<header>` / `<footer>`.

        function sections() {
            return Array.from(ctx.getDocEl().querySelectorAll("section.docx"));
        }

        function requireLoaded() {
            const list = sections();
            if (list.length === 0) {
                throw new Error("No Word document is rendered in this board yet.");
            }
            return list;
        }

        function requirePage(list, pageNumber) {
            const n = Number(pageNumber);
            if (!Number.isInteger(n) || n < 1 || n > list.length) {
                throw new Error("Page " + pageNumber + " is out of range; this document has "
                    + list.length + " page" + (list.length === 1 ? "" : "s") + ".");
            }
            return n;
        }

        function resolveRange(list, from, to) {
            const first = from === undefined || from === null ? 1 : requirePage(list, from);
            const last = to === undefined || to === null ? list.length : requirePage(list, to);
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
                throw new Error('"' + path + '" is not an absolute path. Pass a full path rooted at '
                    + "a drive or share, such as C:\\Users\\you\\Documents\\ — a relative path would "
                    + "be written inside the board's own folder.");
            }
            return path;
        }

        // ── Block extraction ────────────────────────────────────────────────────────────
        // Each page is walked into a list of blocks, and both Markdown and plain text are
        // rendered from that same list — so the two reads can never disagree about content,
        // only about markup.

        /** Heading level from docx-preview's class. It names paragraph classes after the style
         *  id, lowercased and prefixed: a Word "Heading 2" style becomes `docx_heading2`. The
         *  `docx_title` style is the document title, which reads as an H1. */
        function headingLevel(el) {
            const cls = el.className || "";
            const match = /(?:^|\s)docx_heading[ _-]?(\d)(?:\s|$)/.exec(cls);
            if (match) return Math.min(6, Math.max(1, Number(match[1])));
            if (/(?:^|\s)docx_title(?:\s|$)/.test(cls)) return 1;
            return 0;
        }

        /** List identity and depth. docx-preview marks every numbered/bulleted paragraph with
         *  `display: list-item` (the renderer-agnostic signal) plus a `docx-num-<numId>-<ilvl>`
         *  class carrying the list it belongs to and its indent level. Ordered vs bulleted is
         *  only distinguishable from the generated marker: an ordered list's `::before` is built
         *  from `counter(...)`, a bulleted one's is a literal glyph. */
        function listInfo(el) {
            if (getComputedStyle(el).display !== "list-item") return null;
            const match = /(?:^|\s)docx-num-(.+?)-(\d+)(?:\s|$)/.exec(el.className || "");
            const level = match ? Number(match[2]) : 0;
            let ordered = false;
            try {
                ordered = getComputedStyle(el, "::before").content.includes("counter(");
            } catch {
                // A browser that will not report generated content — fall back to a bullet,
                // which loses the numbering but never mislabels prose as a list.
            }
            return { level, ordered };
        }

        /** Inline text of an element, with hyperlinks preserved as Markdown links. Word's own
         *  soft line breaks inside a paragraph become spaces: a paragraph is one block, and a
         *  stray newline inside it would break the Markdown table and list syntax around it. */
        function inlineMarkdown(el) {
            let out = "";
            for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    out += node.nodeValue;
                } else if (node.nodeType !== Node.ELEMENT_NODE) {
                    continue;
                } else if (node.tagName === "A" && node.getAttribute("href")) {
                    const label = (node.textContent || "").trim();
                    const href = node.getAttribute("href");
                    out += label ? "[" + label + "](" + href + ")" : href;
                } else if (node.tagName === "BR") {
                    out += " ";
                } else if (node.tagName === "IMG") {
                    out += ""; // Images are emitted as their own block, not inline noise.
                } else {
                    out += inlineMarkdown(node);
                }
            }
            return out;
        }

        const squash = (text) => text.replace(/\s+/g, " ").trim();

        /** A Markdown table cell may not contain a raw pipe or a newline. */
        const cellText = (el) => squash(inlineMarkdown(el)).replace(/\|/g, "\\|");

        function tableBlock(table) {
            const rows = [];
            for (const tr of table.querySelectorAll("tr")) {
                const cells = Array.from(tr.children)
                    .filter((c) => c.tagName === "TD" || c.tagName === "TH")
                    .map(cellText);
                if (cells.length > 0) rows.push(cells);
            }
            return rows.length > 0 ? { type: "table", rows } : null;
        }

        function imageBlocks(el, into) {
            for (const img of el.querySelectorAll("img")) {
                into.push({
                    type: "image",
                    alt: img.getAttribute("alt") || "",
                    width: img.naturalWidth || undefined,
                    height: img.naturalHeight || undefined,
                    src: img.src,
                });
            }
        }

        /** Walk one container (an `<article>`, `<header>` or `<footer>`) into blocks. */
        function walkBlocks(container, blocks) {
            for (const el of container.children) {
                if (el.tagName === "TABLE") {
                    const block = tableBlock(el);
                    if (block) blocks.push(block);
                    continue;
                }
                if (el.querySelector && el.querySelector("img")) {
                    // A picture paragraph: emit the image, and any caption text beside it.
                    imageBlocks(el, blocks);
                    const text = squash(inlineMarkdown(el));
                    if (text) blocks.push({ type: "paragraph", text });
                    continue;
                }
                // A container that holds block-level children of its own (docx-preview nests
                // paragraphs inside a div for some section layouts) — recurse rather than
                // flattening it to one paragraph.
                if (el.children.length > 0 && Array.from(el.children).some(
                    (c) => c.tagName === "TABLE" || c.tagName === "P" || c.tagName === "DIV")) {
                    walkBlocks(el, blocks);
                    continue;
                }
                const text = squash(inlineMarkdown(el));
                if (!text) continue;
                const level = headingLevel(el);
                if (level > 0) {
                    blocks.push({ type: "heading", level, text });
                    continue;
                }
                const list = listInfo(el);
                if (list) {
                    blocks.push({ type: "listItem", level: list.level, ordered: list.ordered, text });
                    continue;
                }
                blocks.push({ type: "paragraph", text });
            }
        }

        /** Extract one page. Page furniture (the running header and footer) is collected
         *  separately and labelled: it repeats on every page, so folding it into the body would
         *  bury the actual content — but dropping it silently would lose footnotes, which
         *  docx-preview also renders into the footer area. */
        function extractPage(pageNumber) {
            if (pageCache.has(pageNumber)) return pageCache.get(pageNumber);
            const section = requireLoaded()[pageNumber - 1];
            const blocks = [];
            const furniture = [];
            for (const child of section.children) {
                if (child.tagName === "ARTICLE") {
                    walkBlocks(child, blocks);
                } else if (child.tagName === "HEADER" || child.tagName === "FOOTER") {
                    const sub = [];
                    walkBlocks(child, sub);
                    for (const block of sub) furniture.push({ ...block, where: child.tagName.toLowerCase() });
                } else {
                    walkBlocks(child, blocks);
                }
            }
            const result = { page: pageNumber, blocks, furniture };
            pageCache.set(pageNumber, result);
            return result;
        }

        // ── Rendering blocks ────────────────────────────────────────────────────────────

        function tableToMarkdown(rows) {
            const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
            const pad = (row) => {
                const copy = row.slice();
                while (copy.length < width) copy.push("");
                return "| " + copy.join(" | ") + " |";
            };
            const out = [pad(rows[0]), "| " + Array(width).fill("---").join(" | ") + " |"];
            for (const row of rows.slice(1)) out.push(pad(row));
            return out.join("\n");
        }

        function blocksToMarkdown(blocks) {
            const parts = [];
            for (const block of blocks) {
                switch (block.type) {
                    case "heading":
                        parts.push("#".repeat(block.level) + " " + block.text);
                        break;
                    case "listItem":
                        // Markdown renumbers ordered lists itself, so "1." for every item is
                        // both correct and stable under a partial page range.
                        parts.push("  ".repeat(block.level) + (block.ordered ? "1. " : "- ") + block.text);
                        break;
                    case "table":
                        parts.push(tableToMarkdown(block.rows));
                        break;
                    case "image":
                        parts.push("![" + (block.alt || "embedded image") + "]()");
                        break;
                    default:
                        parts.push(block.text);
                }
            }
            // Consecutive list items belong in one block, so they render as one list rather than
            // a sequence of one-item lists.
            let out = "";
            for (let i = 0; i < parts.length; i++) {
                const bothList = i > 0 && blocks[i].type === "listItem" && blocks[i - 1].type === "listItem";
                out += (i === 0 ? "" : bothList ? "\n" : "\n\n") + parts[i];
            }
            return out;
        }

        function blocksToText(blocks) {
            const parts = [];
            for (const block of blocks) {
                if (block.type === "table") {
                    for (const row of block.rows) parts.push(row.join("\t"));
                } else if (block.type === "image") {
                    if (block.alt) parts.push("[image: " + block.alt + "]");
                } else {
                    parts.push(block.text);
                }
            }
            return parts.join("\n");
        }

        function pageContent(pageNumber, asMarkdown) {
            const { blocks, furniture } = extractPage(pageNumber);
            const render = asMarkdown ? blocksToMarkdown : blocksToText;
            let out = render(blocks);
            const footer = furniture.filter((b) => b.text || b.rows);
            if (footer.length > 0) {
                const label = asMarkdown ? "\n\n_[page header/footer]_ " : "\n[page header/footer] ";
                out += label + render(footer).replace(/\n+/g, " ");
            }
            return out;
        }

        function contentForRange(first, last, asMarkdown) {
            const parts = [];
            for (let n = first; n <= last; n++) {
                const text = pageContent(n, asMarkdown);
                // A page marker keeps an agent oriented in a multi-page read and lets it cite a
                // page number back to the user.
                parts.push(first === last ? text : "--- page " + n + " ---\n\n" + text);
            }
            return parts.join("\n\n");
        }

        const countLines = (text) => (text === "" ? 0 : text.split("\n").length);

        // ── Images ──────────────────────────────────────────────────────────────────────
        // The board renders with `useBase64URL: true`, so every picture is already a decoded
        // `data:` URL in the DOM. Saving one is a base64 write, with no rendering step at all.

        function collectImages() {
            const list = [];
            sections().forEach((section, i) => {
                for (const img of section.querySelectorAll("img")) {
                    const src = img.src || "";
                    const match = /^data:([^;,]+)[^,]*,(.*)$/.exec(src);
                    list.push({
                        index: list.length,
                        page: i + 1,
                        alt: img.getAttribute("alt") || undefined,
                        width: img.naturalWidth || undefined,
                        height: img.naturalHeight || undefined,
                        mime: match ? match[1] : undefined,
                        base64: match ? match[2] : undefined,
                        src: match ? undefined : src,
                    });
                }
            });
            return list;
        }

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

        function describeImage(entry) {
            return {
                index: entry.index,
                page: entry.page,
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
                    + "(its source is a link, not document data), so it cannot be saved.");
            }
            await P.writeFile(path, entry.base64, { encoding: "base64" });
            return { ...describeImage(entry), path, note: "Open this file to read the picture with your own vision." };
        }

        function joinPath(directory, name) {
            const trimmed = directory.replace(/[\\/]+$/, "");
            const separator = trimmed.includes("\\") ? "\\" : "/";
            return trimmed + separator + name;
        }

        // ── Metadata ────────────────────────────────────────────────────────────────────
        // Document properties live in the package's `docProps/core.xml`, which docx-preview does
        // not surface. The board keeps the raw bytes it rendered from, and JSZip is already
        // loaded as the renderer's own dependency, so reading them is a re-unzip of what is
        // already in memory — never a re-read from disk.

        const CORE_FIELDS = [
            ["title", "dc:title"], ["subject", "dc:subject"], ["author", "dc:creator"],
            ["keywords", "cp:keywords"], ["description", "dc:description"],
            ["lastModifiedBy", "cp:lastModifiedBy"], ["revision", "cp:revision"],
            ["created", "dcterms:created"], ["modified", "dcterms:modified"],
            ["category", "cp:category"],
        ];

        async function readMetadata() {
            if (metadataCache) return metadataCache;
            const bytes = ctx.getBytes();
            if (!bytes) return { note: "Document properties are not available for this document." };
            const zip = await window.JSZip.loadAsync(bytes);
            const result = {};
            const core = zip.file("docProps/core.xml");
            if (core) {
                const doc = new DOMParser().parseFromString(await core.async("string"), "application/xml");
                for (const [name, tag] of CORE_FIELDS) {
                    const el = doc.getElementsByTagName(tag)[0];
                    const value = el && el.textContent ? el.textContent.trim() : "";
                    if (value) result[name] = value;
                }
            }
            const app = zip.file("docProps/app.xml");
            if (app) {
                const doc = new DOMParser().parseFromString(await app.async("string"), "application/xml");
                for (const tag of ["Application", "Company", "Pages", "Words", "Characters", "Paragraphs"]) {
                    const el = doc.getElementsByTagName(tag)[0];
                    const value = el && el.textContent ? el.textContent.trim() : "";
                    if (value) result[tag.toLowerCase()] = value;
                }
            }
            // `pages`/`words` above are what the AUTHORING app last recorded, which can disagree
            // with what this board rendered. Say which is which rather than letting an agent
            // read a stale count as fact.
            if (result.pages) {
                result.pagesRecordedByWord = result.pages;
                delete result.pages;
            }
            result.renderedPageCount = sections().length;
            metadataCache = result;
            return result;
        }

        // ── Stats ───────────────────────────────────────────────────────────────────────

        function buildStats() {
            const list = requireLoaded();
            const started = performance.now();
            const pages = [];
            let totalChars = 0;
            let totalMarkdownChars = 0;
            let totalLines = 0;
            let totalTables = 0;
            let totalImages = 0;
            for (let n = 1; n <= list.length; n++) {
                const { blocks } = extractPage(n);
                const text = pageContent(n, false);
                const markdown = pageContent(n, true);
                const tables = blocks.filter((b) => b.type === "table").length;
                const images = blocks.filter((b) => b.type === "image").length;
                const headings = blocks.filter((b) => b.type === "heading").length;
                pages.push({
                    page: n,
                    chars: text.length,
                    markdownChars: markdown.length,
                    lines: countLines(text),
                    tables, images, headings,
                    hasText: text.trim().length > 0,
                });
                totalChars += text.length;
                totalMarkdownChars += markdown.length;
                totalLines += countLines(text);
                totalTables += tables;
                totalImages += images;
            }
            statsCache = {
                kind: "WordStats",
                pageCount: list.length,
                totalChars,
                totalMarkdownChars,
                totalLines,
                totalTables,
                totalImages,
                pagesWithText: pages.filter((p) => p.hasText).length,
                scanMs: Math.round(performance.now() - started),
                pages,
                note: totalImages > 0
                    ? "This document contains " + totalImages + " embedded picture"
                      + (totalImages === 1 ? "" : "s") + ". Text extraction cannot read what is "
                      + "inside them - list them with getImages() and save one with "
                      + "saveImage(path, index) to look at it."
                    : undefined,
            };
            return statsCache;
        }

        // ── Showing the user ────────────────────────────────────────────────────────────

        /** Scroll a phrase into the user's view and flash it. This is the counterpart the PDF
         *  board could not have: there the document lives in a nested frame the overlay cannot
         *  reach, but here it is in the board's own DOM, so a Range around the match can be
         *  scrolled to and outlined directly. */
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
            const docEl = ctx.getDocEl();
            const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT);
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

        /** Which page a node sits on — used to report back where a match was shown. */
        function pageOfNode(node) {
            let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            while (el && !(el.tagName === "SECTION" && el.classList.contains("docx"))) {
                el = el.parentElement;
            }
            return el ? sections().indexOf(el) + 1 : undefined;
        }

        const app = {
            aiVision: {
                kind: "WordBoard",
                summary: "The Word Viewer board's live model for the open .docx document.",
                overview: "Call getStats() first to see how big the document is, page by page.\n"
                    + "Read it with getMarkdown(from, to) - headings, tables and lists are preserved.\n"
                    + "Locate a topic with search(query); read a chart with saveImage(path, index).",
                help: HELP,
                members: MEMBERS,
                summarize: () => ({
                    kind: "WordBoard",
                    fileName: ctx.getFileName(),
                    filePath: ctx.getFilePath(),
                    pageCount: sections().length || undefined,
                    isLoaded: sections().length > 0,
                    // Cheap until something has been read: reported only once a scan has run, so
                    // `summarize` never silently walks a thousand-page document.
                    totalChars: statsCache ? statsCache.totalChars : undefined,
                    hint: statsCache ? undefined : "Call getStats() for the document's size, page by page.",
                }),
            },

            get fileName() { return ctx.getFileName(); },
            get filePath() { return ctx.getFilePath(); },
            get pageCount() { return sections().length || undefined; },
            get isLoaded() { return sections().length > 0; },
            get currentPage() { return ctx.getCurrentPage(); },
            set currentPage(value) { ctx.scrollToPage(requirePage(requireLoaded(), value)); },

            getStats() {
                requireLoaded();
                return statsCache || buildStats();
            },

            getMarkdown(from, to) {
                const list = requireLoaded();
                const { first, last } = resolveRange(list, from, to);
                const text = contentForRange(first, last, true);
                if (text.trim() === "") {
                    const scope = first === last ? "Page " + first + " is" : "Pages " + first + "-" + last + " are";
                    return scope + " empty - they contain no text. Check getImages() for pictures "
                        + "on them; a .docx never hides readable text the way a scanned PDF does.";
                }
                return text;
            },

            getText(from, to) {
                const list = requireLoaded();
                const { first, last } = resolveRange(list, from, to);
                return contentForRange(first, last, false);
            },

            getPageMarkdown(pageNumber) {
                const list = requireLoaded();
                return pageContent(requirePage(list, pageNumber), true);
            },

            search(query, options) {
                const list = requireLoaded();
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
                for (let n = 1; n <= list.length && !truncated; n++) {
                    const text = pageContent(n, false);
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

            getOutline() {
                const list = requireLoaded();
                const out = [];
                for (let n = 1; n <= list.length; n++) {
                    for (const block of extractPage(n).blocks) {
                        if (block.type === "heading") {
                            out.push({ title: block.text, level: block.level, page: n });
                        }
                    }
                }
                return out;
            },

            getTables(pageNumber) {
                const list = requireLoaded();
                const range = pageNumber === undefined || pageNumber === null
                    ? { first: 1, last: list.length }
                    : { first: requirePage(list, pageNumber), last: requirePage(list, pageNumber) };
                const out = [];
                for (let n = range.first; n <= range.last; n++) {
                    for (const block of extractPage(n).blocks) {
                        if (block.type === "table") {
                            out.push({
                                index: out.length,
                                page: n,
                                rowCount: block.rows.length,
                                columnCount: block.rows.reduce((max, r) => Math.max(max, r.length), 0),
                                rows: block.rows,
                            });
                        }
                    }
                }
                return out;
            },

            getImages() {
                requireLoaded();
                const images = collectImages().map(describeImage);
                return {
                    count: images.length,
                    images,
                    note: images.length > 0
                        ? "Save one with saveImage(path, index) and open the file to read it."
                        : "This document has no embedded pictures.",
                };
            },

            getMetadata() {
                requireLoaded();
                return readMetadata();
            },

            async saveMarkdown(path, from, to) {
                const list = requireLoaded();
                requireAbsolutePath(path, "Markdown");
                const { first, last } = resolveRange(list, from, to);
                const text = contentForRange(first, last, true);
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path, pages: [first, last], chars: text.length, lines: countLines(text) };
            },

            async saveText(path, from, to) {
                const list = requireLoaded();
                requireAbsolutePath(path, "text");
                const { first, last } = resolveRange(list, from, to);
                const text = contentForRange(first, last, false);
                await P.writeFile(path, text, { encoding: "utf8" });
                return { path, pages: [first, last], chars: text.length, lines: countLines(text) };
            },

            async saveImage(path, index) {
                requireLoaded();
                requireAbsolutePath(path, "image");
                const images = collectImages();
                const n = Number(index);
                if (!Number.isInteger(n) || n < 0 || n >= images.length) {
                    throw new Error("No image with index " + index + "; this document has "
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

            goToPage(pageNumber) {
                const list = requireLoaded();
                const n = requirePage(list, pageNumber);
                ctx.scrollToPage(n);
                return n;
            },

            showText(query, options) {
                requireLoaded();
                if (typeof query !== "string" || query === "") throw new Error("Pass the text to show.");
                const opts = options || {};
                const occurrence = Number(opts.occurrence) > 0 ? Number(opts.occurrence) : 1;
                const found = findTextRange(query, !!opts.caseSensitive, occurrence);
                if (!found) {
                    return { found: false, note: 'No occurrence of "' + query + '" is rendered in this document.' };
                }
                const page = pageOfNode(found.node);
                const flashed = flashRange(found.range);
                return {
                    found: true,
                    page,
                    flashed,
                    note: flashed
                        ? "Scrolled the user's view to it and highlighted it briefly."
                        : "Scrolled the user's view to it; it spans formatting boundaries so it could not be highlighted.",
                };
            },

            openTextPage(from, to) {
                const list = requireLoaded();
                const { first, last } = resolveRange(list, from, to);
                const text = contentForRange(first, last, true);
                const name = ctx.getFileName() || "Document";
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
            /** Called when a document renders. Every cache belongs to the previous document, and
             *  the shape's summary values (page count, file name) have all changed. */
            documentChanged() {
                pageCache.clear();
                statsCache = null;
                metadataCache = null;
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
        };
    };
})();
