// DrawIO Viewer board — the AiVision agent surface.
//
// Why this exists at all, given that a .drawio file is "just XML on disk":
//
//   1. **The XML on disk is usually NOT readable.** drawio compresses each <diagram> body by
//      default — encodeURIComponent → raw deflate → base64 — so a file saved by the desktop or
//      web app reads as one long opaque blob. Reading the file gets you nothing; this board
//      already has drawio's own decoder loaded (Graph.decompress), so it hands over the real
//      mxGraphModel XML.
//   2. **The file is not always the truth, and not always reachable.** This is a CONTENT-HOST
//      board: the content comes from Persephone's pipe, so it is whatever the user is looking
//      at right now — including unsaved edits made in Monaco, and including files that live
//      inside an archive, behind https:// or encrypted, where there is no path to read.
//   3. **mxGraphModel XML is a poor way to understand a diagram.** It is a flat cell list where
//      an arrow is a row referencing two ids, geometry is relative to whatever parent a cell
//      happens to have, and a label may be HTML. So this model resolves all of that once and
//      publishes the diagram as what it actually is: shapes with text, and connections between
//      named things. `describe()` is the read that answers "what does this diagram say".
//   4. **Some diagrams have no text.** A shapes-and-arrows picture, an AWS icon layout, a
//      wireframe — every label empty. There is nothing to read, and the only way to know what
//      it shows is to LOOK at it. `savePageImage()` renders a page to a real PNG on disk that
//      the agent opens with its own vision. `getStats()` says when a page needs that.
//
// Everything here is read-only with respect to the diagram: this board never writes content
// back to the host. The save* methods write NEW files at a path the agent names.
(() => {
    const DrawioAI = (window.DrawioAI = window.DrawioAI || {});

    const HELP = `This is a .drawio (diagrams.net) diagram open in the DrawIO Viewer board.

Read it from HERE, not from the file. A .drawio file usually stores each page deflate+base64
compressed, so the bytes on disk are an opaque blob; this board has drawio's own decoder, so
getXml() gives you the real XML. The content also comes from Persephone's content host, which
means it includes edits the user has not saved yet, and it works for a file inside an archive
or behind a URL, where there is no path to open.

Start with getStats(): pages, how many shapes and connections each has, and how much label text
there is. Then describe(page) is the main read - shapes in reading order with their containers,
and the connections as "A -> B: label". That is the diagram as a sentence, and it is far smaller
and far clearer than the XML. getShapes()/getConnections() give the same thing structured, with
ids and geometry, when you need to compute over it.

If a page reports textChars: 0 it is a PICTURE - shapes and arrows with no labels, or an icon
layout. There is nothing to read. Call savePageImage(path, page) and open the PNG with your own
vision. Do the same whenever the answer depends on colour, icons or spatial arrangement rather
than on the words: the labels alone do not tell you that two boxes are inside the same dashed
region, and the image does.

Ids come from the file and are stable (e.g. "orders"), but many diagrams use generated ids like
"2_HGaZ8rQZ-xVyPUt0K-3". Anywhere a shape reference is asked for, you may pass the id OR the
shape's text; an ambiguous text is refused, listing the ids it matched, rather than picking one.

You can also drive what the user sees: goToPage(n) switches the page tab, and focusShape(ref)
zooms to a shape and rings it on screen. Use focusShape when you are talking about one box -
it is how you point, instead of describing where to look.`;

    const MEMBERS = [
        { name: "fileName", kind: "property", summary: "Name of the open .drawio file." },
        { name: "filePath", kind: "property", summary: "Absolute path of the open .drawio file, when it has one. Empty for a file opened from an archive or a URL." },
        { name: "isLoaded", kind: "property", summary: "Whether a diagram is parsed and on screen." },
        { name: "pageCount", kind: "property", summary: "Number of pages in the file." },
        { name: "pageNames", kind: "property", summary: "The page names, in tab order." },
        { name: "currentPage", kind: "property", summary: "The 1-based page the user is looking at. Assigning to it switches the page tab.", writable: true },
        { name: "isCompressed", kind: "property", summary: "Whether the file stores its pages compressed. When true, reading the file from disk yourself gives you an opaque base64 blob - read it here instead." },
        { name: "zoom", kind: "property", summary: "The on-screen zoom of the current page, where 1 is 100%." },

        { name: "getStats", kind: "method", signature: "getStats()", summary: "What this file contains: every page with its shape and connection counts and how much label text it has. Read this first - a page with textChars 0 is a picture and must be read with savePageImage." },
        { name: "describe", kind: "method", signature: "describe(page?, options?)", summary: "THE MAIN READ. One page (default: the current one) as compact Markdown: shapes in reading order with their containers, then the connections as \"A -> B: label\". Pass page 0 or \"all\" for every page. Options: { maxChars, ids }." },
        { name: "getShapes", kind: "method", signature: "getShapes(page?)", summary: "The page's shapes as data: id, text, kind, container, position and size, and any custom attributes the diagram carries." },
        { name: "getConnections", kind: "method", signature: "getConnections(page?)", summary: "The page's arrows as data: id, label, and the id and text of the shapes at each end. An arrow attached to nothing is reported with a null end rather than dropped." },
        { name: "getShape", kind: "method", signature: "getShape(ref, page?)", summary: "One shape in full - its text, kind, geometry, raw style string, custom attributes, and every connection into and out of it. Pass an id or the shape's text." },
        { name: "getText", kind: "method", signature: "getText(page?)", summary: "Just the text of a page, in reading order, one label per line. Use it to grep a big diagram; describe() is better for understanding one." },
        { name: "search", kind: "method", signature: "search(query, options?)", summary: "Find shapes and connections whose text matches, across every page. Options: { caseSensitive, regex, page, maxHits }." },
        { name: "getXml", kind: "method", signature: "getXml(page?)", summary: "The DECOMPRESSED mxGraphModel XML of a page, or of the whole file when called with \"all\". This is what the file would contain if it were not compressed.", caution: "can be large - check getStats() first" },
        { name: "getView", kind: "method", signature: "getView()", summary: "What is on screen right now: the page, the zoom, the diagram's natural size, and which shape (if any) is ringed." },

        { name: "savePageImage", kind: "method", signature: "savePageImage(path, page?, options?)", summary: "Render a page to a PNG file at an absolute path you name, and return the path and size. THIS IS HOW YOU READ A DIAGRAM THAT HAS NO TEXT - open the file afterwards and look at it. Renders off screen, so it does not disturb the user's view. Options: { scale }.", caution: "writes a new file to disk" },
        { name: "savePageSvg", kind: "method", signature: "savePageSvg(path, page?)", summary: "Save a page as a vector SVG file at an absolute path you name. Prefer savePageImage when you intend to look at it yourself.", caution: "writes a new file to disk" },
        { name: "savePageImages", kind: "method", signature: "savePageImages(directory, options?)", summary: "Render every page into a directory, one PNG per page, and return the paths.", caution: "writes several new files to disk" },

        { name: "goToPage", kind: "method", signature: "goToPage(page)", summary: "Switch the page tab the user is looking at. Accepts a 1-based number or a page name." },
        { name: "focusShape", kind: "method", signature: "focusShape(ref, options?)", summary: "POINT AT SOMETHING: zoom to a shape and draw a ring around it on screen, switching pages if needed. Pass an id or the shape's text. Options: { zoom, message }." },
        { name: "clearHighlight", kind: "method", signature: "clearHighlight()", summary: "Remove the ring drawn by focusShape and leave the zoom where it is." },
        { name: "zoomToFit", kind: "method", signature: "zoomToFit()", summary: "Fit the whole page in the viewport and centre it - what a double-click on the diagram does." },
        { name: "setZoom", kind: "method", signature: "setZoom(scale)", summary: "Set the zoom, where 1 is 100%. Clamped to 0.1-10." },
        { name: "reload", kind: "method", signature: "reload()", summary: "Re-read the content from Persephone's host and re-render. The user's page tab and zoom reset." },
        { name: "openTextPage", kind: "method", signature: "openTextPage(page?)", summary: "Open describe() as a new Markdown page in Persephone, to show the user what you read of the diagram.", caution: "opens a new page" },
        { name: "openInDrawing", kind: "method", signature: "openInDrawing()", summary: "Open the current page as a new, editable drawing in Persephone's Drawing editor. It is a copy - the .drawio file is never modified.", caution: "opens a new page" },
    ];

    /** A read returns at most this much text before it truncates and says so. The host bounds a
     *  result at 20,000 characters anyway; stopping here means the model reports the truncation
     *  itself instead of the agent receiving a sentence cut in half. */
    const MAX_CHARS = 18000;
    /** Render scale for savePageImage. 2x matches the board's own Copy/Save as PNG, and keeps
     *  small label text legible to a vision model. */
    const DEFAULT_SCALE = 2;
    const MAX_SCALE = 6;

    DrawioAI.createAiVisionModel = function createAiVisionModel(ctx) {
        const P = window.persephone;
        const aiVision = P && P.aiVision;
        if (!aiVision) return { register() {}, contentChanged() {}, viewChanged() {} };

        // ── Parsing ─────────────────────────────────────────────────────────────────────
        // Parsed once per content change and cached: every read below works off this.
        let parsed = null;
        let parseError = null;

        /** drawio stores a page body either as plain XML (<mxGraphModel> as a child of
         *  <diagram>) or, by default, as text: encodeURIComponent → raw deflate → base64.
         *  Graph.decompress is drawio's own decoder, already loaded with the viewer. */
        function decodeDiagram(diagramEl) {
            const inner = diagramEl.getElementsByTagName("mxGraphModel")[0];
            if (inner) return { xml: new XMLSerializer().serializeToString(inner), compressed: false };
            const body = (diagramEl.textContent || "").trim();
            if (!body) return { xml: "", compressed: false };
            try {
                const xml = window.Graph.decompress(body);
                return { xml: xml || "", compressed: true };
            } catch (err) {
                return { xml: "", compressed: true, error: err && err.message ? err.message : String(err) };
            }
        }

        /** A style string is `shape=cylinder3;html=1;fillColor=#fff;` — or starts with a bare
         *  token naming the shape (`rhombus;whiteSpace=wrap;`). Both forms are normal. */
        function parseStyle(style) {
            const out = { bare: [], keys: {} };
            for (const part of String(style || "").split(";")) {
                const token = part.trim();
                if (!token) continue;
                const eq = token.indexOf("=");
                if (eq < 0) out.bare.push(token);
                else out.keys[token.slice(0, eq)] = token.slice(eq + 1);
            }
            return out;
        }

        /** A readable shape name. drawio has no "type" field — the shape IS the style, so this
         *  reports what the style says and falls back to the geometry-level default (a plain or
         *  rounded rectangle) rather than inventing a taxonomy. */
        function shapeKind(style) {
            const s = parseStyle(style);
            if (s.keys.shape) return s.keys.shape.replace(/^mxgraph\./, "");
            if (s.bare.length > 0) return s.bare[0];
            if (s.keys.ellipse !== undefined) return "ellipse";
            if (s.keys.rounded === "1") return "rounded rectangle";
            return "rectangle";
        }

        /** A label may be HTML (`<b>API gateway</b><br>rate limiting`) — that is what html=1
         *  means, and it is the default in current drawio. Turn it into the text a human reads:
         *  line breaks preserved, tags gone. Parsed as a document rather than regex-stripped so
         *  entities decode correctly; nothing is inserted into this page's DOM. */
        function labelText(value) {
            const raw = value == null ? "" : String(value);
            if (raw === "") return "";
            if (raw.indexOf("<") < 0 && raw.indexOf("&") < 0) return raw.trim();
            const withBreaks = raw
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/(p|div|li|tr)>/gi, "\n");
            const doc = new DOMParser().parseFromString("<body>" + withBreaks + "</body>", "text/html");
            return (doc.body.textContent || "")
                .replace(/\u00a0/g, " ")
                .split("\n")
                .map((line) => line.trim())
                .filter((line, i, all) => line !== "" || (i > 0 && i < all.length - 1))
                .join("\n")
                .trim();
        }

        /** A shape's text on one line — labels are routinely multi-line, and a describe() bullet
         *  that wraps onto its own lines stops being a list. */
        const oneLine = (text) => text.replace(/\s*\n\s*/g, " / ");

        function parsePage(diagramEl, index) {
            const name = (diagramEl.getAttribute("name") || "").trim() || "Page " + (index + 1);
            const id = diagramEl.getAttribute("id") || "";
            const decoded = decodeDiagram(diagramEl);
            const page = {
                number: index + 1,
                name,
                id,
                xml: decoded.xml,
                compressed: decoded.compressed,
                decodeError: decoded.error,
                shapes: [],
                edges: [],
                byId: new Map(),
            };
            if (!decoded.xml) return page;

            const doc = new DOMParser().parseFromString(decoded.xml, "application/xml");
            if (doc.querySelector("parsererror")) {
                page.decodeError = "The page XML did not parse.";
                return page;
            }

            // Cells come either bare (<mxCell id=…>) or wrapped in an <object>/<UserObject>
            // carrying the label plus arbitrary custom attributes — the second form is how
            // drawio stores per-shape metadata, and dropping it loses real content.
            const raw = [];
            for (const cell of Array.from(doc.getElementsByTagName("mxCell"))) {
                const holder = cell.parentNode;
                const wrapped = holder && holder.nodeType === 1
                    && (holder.nodeName === "object" || holder.nodeName === "UserObject");
                const owner = wrapped ? holder : cell;
                const data = {};
                if (wrapped) {
                    for (const attr of Array.from(owner.attributes)) {
                        if (attr.name === "id" || attr.name === "label") continue;
                        if (attr.value !== "") data[attr.name] = attr.value;
                    }
                }
                raw.push({
                    id: owner.getAttribute("id") || cell.getAttribute("id") || "",
                    value: wrapped ? owner.getAttribute("label") : cell.getAttribute("value"),
                    style: cell.getAttribute("style") || "",
                    parent: cell.getAttribute("parent") || "",
                    source: cell.getAttribute("source") || "",
                    target: cell.getAttribute("target") || "",
                    isVertex: cell.getAttribute("vertex") === "1",
                    isEdge: cell.getAttribute("edge") === "1",
                    geometry: cell.getElementsByTagName("mxGeometry")[0] || null,
                    data: Object.keys(data).length > 0 ? data : undefined,
                });
            }

            const byRawId = new Map(raw.map((c) => [c.id, c]));

            /** mxGeometry x/y are relative to the cell's PARENT when the parent is a shape —
             *  a box inside a container reads as x=20 even though it sits at 300 on the page.
             *  Absolute coordinates are what "where is this" means, so resolve the chain. */
            function absoluteGeometry(cell) {
                const g = cell.geometry;
                if (!g) return null;
                let x = Number(g.getAttribute("x") || 0);
                let y = Number(g.getAttribute("y") || 0);
                const width = Number(g.getAttribute("width") || 0);
                const height = Number(g.getAttribute("height") || 0);
                let parent = byRawId.get(cell.parent);
                let guard = 0;
                while (parent && parent.isVertex && guard++ < 50) {
                    const pg = parent.geometry;
                    if (pg) {
                        x += Number(pg.getAttribute("x") || 0);
                        y += Number(pg.getAttribute("y") || 0);
                    }
                    parent = byRawId.get(parent.parent);
                }
                return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
            }

            for (const cell of raw) {
                if (cell.isVertex) {
                    const container = byRawId.get(cell.parent);
                    const shape = {
                        id: cell.id,
                        text: labelText(cell.value),
                        kind: shapeKind(cell.style),
                        style: cell.style,
                        data: cell.data,
                        geometry: absoluteGeometry(cell),
                        parentId: container && container.isVertex ? container.id : undefined,
                    };
                    page.shapes.push(shape);
                    page.byId.set(shape.id, shape);
                } else if (cell.isEdge) {
                    page.edges.push({
                        id: cell.id,
                        text: labelText(cell.value),
                        style: cell.style,
                        data: cell.data,
                        sourceId: cell.source || undefined,
                        targetId: cell.target || undefined,
                    });
                }
            }

            // Reading order: down the page, then across. A diagram has no document order worth
            // reporting (cells are written in creation order, and an arrow is often first), so
            // an agent reading a list needs it laid out the way a person scans the picture.
            // Rows are banded at 40px so shapes side by side stay on the same line.
            page.shapes.sort((a, b) => {
                const ay = a.geometry ? Math.round(a.geometry.y / 40) : 0;
                const by = b.geometry ? Math.round(b.geometry.y / 40) : 0;
                if (ay !== by) return ay - by;
                return (a.geometry ? a.geometry.x : 0) - (b.geometry ? b.geometry.x : 0);
            });
            for (const edge of page.edges) {
                edge.source = edge.sourceId ? page.byId.get(edge.sourceId) : undefined;
                edge.target = edge.targetId ? page.byId.get(edge.targetId) : undefined;
            }
            return page;
        }

        function parseFile() {
            parsed = null;
            parseError = null;
            const xml = ctx.getSourceXml();
            if (!xml || !xml.trim()) return;
            const doc = new DOMParser().parseFromString(xml, "application/xml");
            if (doc.querySelector("parsererror")) {
                parseError = "The file is not valid XML.";
                return;
            }
            const diagrams = Array.from(doc.getElementsByTagName("diagram"));
            if (diagrams.length === 0) {
                parseError = "The file contains no <diagram> page.";
                return;
            }
            parsed = { pages: diagrams.map(parsePage) };
        }

        function model() {
            if (!parsed && !parseError) parseFile();
            if (parseError) throw new Error(parseError);
            if (!parsed) throw new Error("No diagram is open in this board yet.");
            return parsed;
        }

        // ── References ──────────────────────────────────────────────────────────────────
        /** A page reference: a 1-based number, a page name, or nothing for the current page.
         *  0 / "all" means every page, which only some reads accept. */
        function resolvePage(ref, options) {
            const pages = model().pages;
            const allowAll = options && options.allowAll;
            if (ref === undefined || ref === null || ref === "") {
                return pages[Math.min(ctx.getPageIndex(), pages.length - 1)] || pages[0];
            }
            if (allowAll && (ref === 0 || ref === "all" || ref === "*")) return null;
            if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
                const n = Number(ref);
                if (!Number.isInteger(n) || n < 1 || n > pages.length) {
                    throw new Error("Page " + ref + " does not exist; this file has "
                        + pages.length + " page" + (pages.length === 1 ? "" : "s")
                        + ": " + pages.map((p) => p.number + '="' + p.name + '"').join(", ") + ".");
                }
                return pages[n - 1];
            }
            const text = String(ref).trim();
            const hits = pages.filter((p) => p.name === text);
            const loose = hits.length > 0 ? hits : pages.filter((p) => p.name.toLowerCase() === text.toLowerCase());
            if (loose.length === 1) return loose[0];
            throw new Error('No page is named "' + text + '". The pages are: '
                + pages.map((p) => p.number + '="' + p.name + '"').join(", ") + ".");
        }

        /** A shape reference: an id, or the shape's text. Ids in a hand-written file are
         *  readable ("orders"), but drawio generates ids like "2_HGaZ8rQZ-xVyPUt0K-3", so text
         *  is what an agent actually has. Two boxes may legitimately say the same thing, so an
         *  ambiguous text is REFUSED with the ids — never resolved to whichever came first. */
        function resolveShape(ref, page) {
            if (ref === undefined || ref === null || ref === "") {
                throw new Error("Pass a shape id or the text of the shape.");
            }
            const text = String(ref).trim();
            const direct = page.byId.get(text);
            if (direct) return direct;
            const exact = page.shapes.filter((s) => s.text === text);
            const hits = exact.length > 0
                ? exact
                : page.shapes.filter((s) => oneLine(s.text).toLowerCase() === text.toLowerCase());
            if (hits.length === 1) return hits[0];
            if (hits.length > 1) {
                throw new Error('Page ' + page.number + ' has ' + hits.length + ' shapes reading "'
                    + text + '" — their ids are ' + hits.map((s) => '"' + s.id + '"').join(", ")
                    + ". Pass the id of the one you mean.");
            }
            const sample = page.shapes.filter((s) => s.text).slice(0, 8).map((s) => '"' + oneLine(s.text) + '"');
            throw new Error('Page ' + page.number + ' ("' + page.name + '") has no shape with id or text "'
                + text + '".' + (sample.length > 0
                    ? " Shapes there include " + sample.join(", ") + "."
                    : " Every shape on that page is unlabelled — read it with savePageImage()."));
        }

        /** An absolute path is required for every write: a relative one would resolve against
         *  the board's own folder, quietly dropping files into a published board. */
        function requireAbsolutePath(path, what) {
            if (typeof path !== "string" || path.trim() === "") {
                throw new Error("Pass an absolute file path to write the " + what + " to.");
            }
            const absolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
            if (!absolute) {
                throw new Error('"' + path + '" is not an absolute path. Pass a full path such as '
                    + "C:\\Users\\you\\Documents\\diagram.png — a relative path would be written "
                    + "inside the board's own folder.");
            }
            return path;
        }

        // ── Shaping ─────────────────────────────────────────────────────────────────────
        /** Drop keys whose value is `undefined`. A property left undefined arrives at the agent
         *  as an explicit `null`, so a result built out of optional fields reads as a wall of
         *  nulls — "this shape has no data, no container, no label" — when the truth is that the
         *  field does not apply. A deliberate `null` (an arrow attached to nothing) survives. */
        function compact(value) {
            if (Array.isArray(value)) return value.map(compact);
            if (value && typeof value === "object") {
                const out = {};
                for (const key of Object.keys(value)) {
                    if (value[key] === undefined) continue;
                    out[key] = compact(value[key]);
                }
                return out;
            }
            return value;
        }

        const textCharsOf = (page) =>
            page.shapes.reduce((n, s) => n + s.text.length, 0)
            + page.edges.reduce((n, e) => n + e.text.length, 0);

        function shapeOut(shape, page) {
            return compact({
                id: shape.id,
                text: shape.text || undefined,
                kind: shape.kind,
                page: page.number,
                in: shape.parentId ? oneLine((page.byId.get(shape.parentId) || {}).text || "") || shape.parentId : undefined,
                x: shape.geometry ? shape.geometry.x : undefined,
                y: shape.geometry ? shape.geometry.y : undefined,
                width: shape.geometry ? shape.geometry.width : undefined,
                height: shape.geometry ? shape.geometry.height : undefined,
                data: shape.data,
            });
        }

        /** An end of an arrow. `null` is deliberate and meaningful: drawio lets an arrow float
         *  with one end attached to nothing, and reporting that is more useful than hiding it. */
        function endOut(shape) {
            if (!shape) return null;
            return { id: shape.id, text: oneLine(shape.text) || undefined };
        }

        function edgeOut(edge, page) {
            return compact({
                id: edge.id,
                label: edge.text || undefined,
                page: page.number,
                from: endOut(edge.source),
                to: endOut(edge.target),
                dashed: /dashed=1/.test(edge.style) || undefined,
            });
        }

        /** The name to use for a shape in prose. Unlabelled shapes are everywhere in diagrams,
         *  and "(unlabelled ellipse)" reads better than an empty string or a raw id. */
        function nameOf(shape) {
            if (!shape) return "(nothing)";
            return oneLine(shape.text) || "(unlabelled " + shape.kind + ")";
        }

        function describePage(page, options) {
            const opts = options || {};
            const withIds = opts.ids !== false;
            const lines = [];
            lines.push("## Page " + page.number + ": " + page.name);
            if (page.decodeError) {
                lines.push("", "This page could not be read: " + page.decodeError);
                return lines.join("\n");
            }
            const textChars = textCharsOf(page);
            lines.push("", page.shapes.length + " shapes, " + page.edges.length + " connections"
                + (textChars === 0 ? " — NO TEXT AT ALL: this page is a picture, read it with savePageImage()." : "."));

            const children = new Map();
            for (const shape of page.shapes) {
                if (!shape.parentId || !page.byId.has(shape.parentId)) continue;
                if (!children.has(shape.parentId)) children.set(shape.parentId, []);
                children.get(shape.parentId).push(shape);
            }

            const bullet = (shape, depth) => {
                const tag = withIds ? " [" + shape.id + "]" : "";
                const kids = children.get(shape.id);
                // nameOf() already names the kind when a shape has no text, so only a LABELLED
                // shape gets the kind in brackets — "(unlabelled ellipse) (ellipse)" reads as a bug.
                const kind = shape.text ? " (" + shape.kind + ")" : "";
                return "  ".repeat(depth) + "- " + nameOf(shape) + kind + tag
                    + (kids ? " — contains " + kids.length + ":" : "");
            };

            if (page.shapes.length > 0) {
                lines.push("", "### Shapes");
                for (const shape of page.shapes) {
                    if (shape.parentId && page.byId.has(shape.parentId)) continue; // listed under its container
                    lines.push(bullet(shape, 0));
                    for (const kid of children.get(shape.id) || []) lines.push(bullet(kid, 1));
                }
            }
            if (page.edges.length > 0) {
                lines.push("", "### Connections");
                for (const edge of page.edges) {
                    lines.push("- " + nameOf(edge.source) + " -> " + nameOf(edge.target)
                        + (edge.text ? ': "' + oneLine(edge.text) + '"' : "")
                        + (/dashed=1/.test(edge.style) ? " (dashed)" : ""));
                }
            }
            return lines.join("\n");
        }

        function bound(text, maxChars) {
            const limit = Number(maxChars) > 0 ? Math.min(Number(maxChars), 100000) : MAX_CHARS;
            if (text.length <= limit) return text;
            return text.slice(0, limit)
                + "\n\n…truncated at " + limit + " of " + text.length + " characters. "
                + "Read one page at a time with describe(page), or narrow with search().";
        }

        // ── Images ──────────────────────────────────────────────────────────────────────
        async function renderToPng(page, options) {
            const opts = options || {};
            const scale = Math.min(Math.max(Number(opts.scale) || DEFAULT_SCALE, 0.2), MAX_SCALE);
            return ctx.renderPagePng(page.number - 1, scale);
        }

        function imageResult(path, rendered, page) {
            const bytes = Math.floor((rendered.base64.length * 3) / 4);
            return compact({
                path,
                page: page.number,
                pageName: page.name,
                width: rendered.width,
                height: rendered.height,
                bytes,
                note: "Open this file to read the diagram with your own vision.",
            });
        }

        function joinPath(directory, name) {
            const trimmed = directory.replace(/[\\/]+$/, "");
            return trimmed + (trimmed.includes("\\") ? "\\" : "/") + name;
        }

        /** A page name is user text and lands in a file name — strip what a file system will
         *  not take, and keep the page number so the files sort in tab order. */
        function pageFileName(page, count, ext) {
            const width = String(count).length;
            const safe = page.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40);
            return "page-" + String(page.number).padStart(width, "0") + (safe ? "-" + safe : "") + "." + ext;
        }

        // ── Pointing at a shape ─────────────────────────────────────────────────────────
        /** The ring is drawn from the RENDERED graph, not from the parsed geometry. mxGraph
         *  applies its own scale and translate when it lays a page out, and a shape's model
         *  coordinates are not where it ends up on screen — asking the live graph for the cell's
         *  state is the only mapping that is right for every diagram. */
        async function focus(shape, page, options) {
            const opts = options || {};
            if (ctx.getPageIndex() !== page.number - 1) await ctx.showPage(page.number - 1);
            const rect = ctx.getCellRect(shape.id);
            if (!rect) {
                throw new Error('"' + shape.id + '" is in the file but is not drawn on screen '
                    + "(it may be hidden or collapsed inside a container), so there is nothing to ring.");
            }
            ctx.focusRect(rect, { zoom: opts.zoom });
            ctx.setRing(rect, shape.id);
            return compact({
                page: page.number,
                shape: shapeOut(shape, page),
                zoom: Math.round(ctx.getZoom() * 100) / 100,
                note: "Zoomed to the shape and ringed it on screen. Call clearHighlight() to remove the ring.",
            });
        }

        // ── Curated on-screen controls ──────────────────────────────────────────────────
        // Unlike the PDF board (whose controls live in a nested frame this overlay cannot
        // reach), every control here is in the board's own document, so highlight() works.
        const declarations = [
            { name: "page-tabs", view: "main",
              purpose: "The page tabs of a multi-page diagram — click one to switch pages.",
              where: "Centred in the top bar. Hidden when the file has only one page.",
              selector: "#tabs" },
            { name: "save-image", view: "main",
              purpose: "Save the current page as an image — opens a menu offering SVG or PNG.",
              where: "Top-right of the top bar, the download arrow with a caret.",
              selector: "#save" },
            { name: "copy-image", view: "main",
              purpose: "Copy the current page to the clipboard as a PNG.",
              where: "Top-right of the top bar, the rightmost icon.",
              selector: "#copy" },
            { name: "open-in-drawing", view: "main",
              purpose: "Open the current page as an editable copy in Persephone's Drawing editor.",
              where: "Top-right of the top bar, the pencil icon.",
              selector: "#editdraw" },
            { name: "zoom-pill", view: "main",
              purpose: "The zoom percentage; clicking it resets the view to fit the page.",
              where: "Bottom-right corner of the diagram area.",
              selector: "#zoom" },
        ];
        const elementParts = aiVision.createElements(declarations);

        // ── The model ───────────────────────────────────────────────────────────────────
        const app = {
            aiVision: {
                kind: "DrawioBoard",
                summary: "The DrawIO Viewer board's live model of the open .drawio diagram.",
                overview: "Call getStats() first: pages, shape and connection counts, and how much text each page has.\n"
                    + "describe(page) is the main read — shapes in reading order and the connections as \"A -> B\".\n"
                    + "A page with textChars 0 is a picture: savePageImage(path, page) and read it with your own vision.\n"
                    + "focusShape(ref) zooms to a shape and rings it, so the user can see what you mean.",
                help: HELP,
                members: [...MEMBERS, ...elementParts.members],
                elements: declarations,
                provide: elementParts.provide,
                summarize: () => {
                    const summary = {
                        kind: "DrawioBoard",
                        fileName: ctx.getFileName() || undefined,
                        filePath: ctx.getFilePath() || undefined,
                        isLoaded: ctx.isLoaded(),
                    };
                    try {
                        const pages = model().pages;
                        summary.pageCount = pages.length;
                        summary.pageNames = pages.map((p) => p.name);
                        summary.currentPage = Math.min(ctx.getPageIndex() + 1, pages.length);
                        summary.shapes = pages.reduce((n, p) => n + p.shapes.length, 0);
                        summary.connections = pages.reduce((n, p) => n + p.edges.length, 0);
                        summary.hint = "describe() reads the current page; getStats() sizes the whole file.";
                    } catch (err) {
                        summary.problem = err && err.message ? err.message : String(err);
                    }
                    return summary;
                },
            },

            get fileName() { return ctx.getFileName() || ""; },
            get filePath() { return ctx.getFilePath() || ""; },
            get isLoaded() { return ctx.isLoaded(); },
            get pageCount() { return model().pages.length; },
            get pageNames() { return model().pages.map((p) => p.name); },
            get currentPage() { return Math.min(ctx.getPageIndex() + 1, model().pages.length); },
            set currentPage(value) { ctx.showPage(resolvePage(value).number - 1); },
            get isCompressed() { return model().pages.some((p) => p.compressed); },
            get zoom() { return Math.round(ctx.getZoom() * 100) / 100; },

            getStats() {
                const pages = model().pages;
                const empty = [];
                const out = {
                    kind: "DrawioStats",
                    fileName: ctx.getFileName() || undefined,
                    pageCount: pages.length,
                    compressed: pages.some((p) => p.compressed),
                    totalShapes: pages.reduce((n, p) => n + p.shapes.length, 0),
                    totalConnections: pages.reduce((n, p) => n + p.edges.length, 0),
                    currentPage: Math.min(ctx.getPageIndex() + 1, pages.length),
                    pages: pages.map((p) => {
                        const textChars = textCharsOf(p);
                        if (textChars === 0 && p.shapes.length > 0) empty.push(p.number);
                        return {
                            page: p.number,
                            name: p.name,
                            shapes: p.shapes.length,
                            connections: p.edges.length,
                            textChars,
                            unreadable: p.decodeError,
                        };
                    }),
                };
                if (empty.length > 0) {
                    out.pagesWithoutText = empty;
                    out.note = "Page" + (empty.length === 1 ? " " : "s ") + empty.join(", ")
                        + " carr" + (empty.length === 1 ? "ies" : "y") + " no label text at all — "
                        + "shapes and arrows only. There is nothing to read there: render with "
                        + "savePageImage(path, page) and look at the image.";
                }
                if (out.compressed) {
                    out.compressedNote = "This file stores its pages compressed, so reading it from "
                        + "disk yourself would give you base64 blobs. getXml() returns the decoded XML.";
                }
                return compact(out);
            },

            describe(page, options) {
                const opts = options || {};
                const one = resolvePage(page, { allowAll: true });
                const pages = one ? [one] : model().pages;
                const header = "# " + (ctx.getFileName() || "Diagram")
                    + (pages.length > 1 ? " — " + pages.length + " pages" : "");
                return bound([header, ...pages.map((p) => describePage(p, opts))].join("\n\n"), opts.maxChars);
            },

            getShapes(page) {
                const p = resolvePage(page);
                return p.shapes.map((s) => shapeOut(s, p));
            },

            getConnections(page) {
                const p = resolvePage(page);
                return p.edges.map((e) => edgeOut(e, p));
            },

            getShape(ref, page) {
                const p = resolvePage(page);
                const shape = resolveShape(ref, p);
                const touching = p.edges.filter((e) => e.sourceId === shape.id || e.targetId === shape.id);
                const contained = p.shapes.filter((s) => s.parentId === shape.id);
                return compact({
                    ...shapeOut(shape, p),
                    style: shape.style,
                    contains: contained.length > 0 ? contained.map((s) => endOut(s)) : undefined,
                    outgoing: touching.filter((e) => e.sourceId === shape.id).map((e) => edgeOut(e, p)),
                    incoming: touching.filter((e) => e.targetId === shape.id).map((e) => edgeOut(e, p)),
                });
            },

            getText(page) {
                const one = resolvePage(page, { allowAll: true });
                const pages = one ? [one] : model().pages;
                const parts = [];
                for (const p of pages) {
                    if (pages.length > 1) parts.push("--- page " + p.number + ": " + p.name + " ---");
                    for (const shape of p.shapes) if (shape.text) parts.push(shape.text);
                    for (const edge of p.edges) if (edge.text) parts.push(edge.text);
                }
                const text = parts.join("\n");
                if (text.trim() === "") {
                    return "This diagram has no label text at all — it is a picture. "
                        + "Render it with savePageImage(path, page) and read the image instead.";
                }
                return bound(text);
            },

            getXml(page) {
                const one = resolvePage(page, { allowAll: true });
                if (!one) return bound(ctx.getSourceXml() || "");
                if (!one.xml) throw new Error("Page " + one.number + " could not be decoded"
                    + (one.decodeError ? ": " + one.decodeError : "."));
                return bound(one.xml);
            },

            search(query, options) {
                if (typeof query !== "string" || query === "") throw new Error("Pass the text to search for.");
                const opts = options || {};
                const maxHits = Number(opts.maxHits) > 0 ? Number(opts.maxHits) : 100;
                const flags = opts.caseSensitive ? "" : "i";
                let pattern;
                try {
                    pattern = opts.regex
                        ? new RegExp(query, flags)
                        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
                } catch (err) {
                    throw new Error("Invalid regular expression: " + (err && err.message ? err.message : String(err)));
                }
                const one = opts.page === undefined ? null : resolvePage(opts.page, { allowAll: true });
                const pages = one ? [one] : model().pages;
                const hits = [];
                for (const p of pages) {
                    for (const shape of p.shapes) {
                        if (shape.text && pattern.test(shape.text)) {
                            hits.push({ type: "shape", ...shapeOut(shape, p) });
                        }
                    }
                    for (const edge of p.edges) {
                        if (edge.text && pattern.test(edge.text)) {
                            hits.push({ type: "connection", ...edgeOut(edge, p) });
                        }
                    }
                }
                return compact({
                    query,
                    hitCount: hits.length,
                    pages: [...new Set(hits.map((h) => h.page))],
                    truncated: hits.length > maxHits,
                    hits: hits.slice(0, maxHits),
                    note: hits.length === 0
                        ? "Nothing matched. Labels may be pictures rather than text — check getStats() "
                          + "for a page with textChars 0."
                        : "focusShape(id) rings one of these on screen for the user.",
                });
            },

            getView() {
                const pages = model().pages;
                const index = Math.min(ctx.getPageIndex(), pages.length - 1);
                const size = ctx.getNaturalSize();
                return compact({
                    kind: "DrawioView",
                    page: index + 1,
                    pageName: pages[index] ? pages[index].name : undefined,
                    pageCount: pages.length,
                    zoom: Math.round(ctx.getZoom() * 100) / 100,
                    fitZoom: Math.round(ctx.getFitZoom() * 100) / 100,
                    diagramSize: size && size.width ? { width: size.width, height: size.height } : undefined,
                    ringedShape: ctx.getRingId() || undefined,
                });
            },

            async savePageImage(path, page, options) {
                const p = resolvePage(page);
                requireAbsolutePath(path, "image");
                const rendered = await renderToPng(p, options);
                await P.writeFile(path, rendered.base64, { encoding: "base64" });
                return imageResult(path, rendered, p);
            },

            async savePageSvg(path, page) {
                const p = resolvePage(page);
                requireAbsolutePath(path, "SVG");
                const svg = await ctx.renderPageSvg(p.number - 1);
                await P.writeFile(path, svg.text, { encoding: "utf8" });
                return { path, page: p.number, pageName: p.name, width: svg.width, height: svg.height, chars: svg.text.length };
            },

            async savePageImages(directory, options) {
                const pages = model().pages;
                requireAbsolutePath(directory, "images");
                const files = [];
                for (const p of pages) {
                    const rendered = await renderToPng(p, options);
                    const target = joinPath(directory, pageFileName(p, pages.length, "png"));
                    await P.writeFile(target, rendered.base64, { encoding: "base64" });
                    files.push(imageResult(target, rendered, p));
                }
                return { directory, count: files.length, files };
            },

            async goToPage(page) {
                const p = resolvePage(page);
                await ctx.showPage(p.number - 1);
                return { page: p.number, pageName: p.name, shapes: p.shapes.length, connections: p.edges.length };
            },

            async focusShape(ref, options) {
                const opts = options || {};
                // Look on the current page first, then anywhere else in the file: an agent that
                // found a shape through search() has a page number, but one working from
                // describe() often just has the text.
                const pages = model().pages;
                const current = pages[Math.min(ctx.getPageIndex(), pages.length - 1)];
                let page = current;
                let shape = null;
                try {
                    shape = resolveShape(ref, current);
                } catch (err) {
                    const text = String(ref).trim();
                    const elsewhere = pages.filter((p) => p !== current
                        && (p.byId.has(text) || p.shapes.some((s) => oneLine(s.text).toLowerCase() === text.toLowerCase())));
                    if (elsewhere.length !== 1) throw err;
                    page = elsewhere[0];
                    shape = resolveShape(ref, page);
                }
                return focus(shape, page, opts);
            },

            clearHighlight() {
                ctx.setRing(null);
                return { ringed: false };
            },

            zoomToFit() {
                ctx.fit();
                return { zoom: Math.round(ctx.getZoom() * 100) / 100 };
            },

            setZoom(scale) {
                const value = Number(scale);
                if (!Number.isFinite(value) || value <= 0) {
                    throw new Error("Pass a zoom factor, where 1 is 100% (e.g. 1.5). Got: " + scale);
                }
                ctx.setZoom(value);
                return { zoom: Math.round(ctx.getZoom() * 100) / 100 };
            },

            async reload() {
                await ctx.reload();
                return { reloaded: true, note: "Re-read from Persephone's content host and re-rendered "
                    + "page 1 at fit zoom. Any ring is gone." };
            },

            async openTextPage(page) {
                const text = app.describe(page, { maxChars: 100000 });
                const name = ctx.getFileName() || "Diagram";
                return P.openContent({ editor: "md-view", language: "markdown", title: name, content: text });
            },

            async openInDrawing() {
                await ctx.openInDrawing();
                const pages = model().pages;
                const index = Math.min(ctx.getPageIndex(), pages.length - 1);
                return { opened: true, page: index + 1,
                    note: "Opened a COPY of this page as a new drawing. The .drawio file is untouched." };
            },
        };

        let remote = null;

        return {
            register() {
                remote = aiVision.expose(app);
            },
            /** The content changed (a new file, or an edit arriving from the host), so the parse
             *  and everything derived from it belong to the previous document. */
            contentChanged() {
                parsed = null;
                parseError = null;
                if (remote && typeof remote.refresh === "function") remote.refresh();
            },
        };
    };
})();
