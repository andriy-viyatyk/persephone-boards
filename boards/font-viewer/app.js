"use strict";
const P = window.persephone;
const t = (key) => P.i18n.t(key);
const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 72;
let font,
    face,
    page = 0,
    mappings = new Map();
applyI18n();
function element(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (cls) el.className = cls;
    return el;
}
function nameValue(key) {
    const names = font.names.windows?.[key] || font.names.macintosh?.[key] || font.names[key];
    return (names && (names.en || Object.values(names)[0])) || t("unavailable");
}
function metadata(label, value) {
    const wrap = element("div");
    wrap.append(element("dt", t(label)), element("dd", value || t("unavailable")));
    $("metadata").append(wrap);
}
function updatePreviews() {
    const size = Number($("size").value);
    $("size-value").value = `${size} px`;
    $("previews").replaceChildren();
    for (const scale of [0.625, 1, 1.5]) {
        const line = element("div", $("sample").value, "preview-line");
        line.style.fontFamily = `"${face.family}"`;
        line.style.fontSize = `${Math.round(size * scale)}px`;
        $("previews").append(line);
    }
}
function renderGlyphs() {
    const grid = $("glyph-grid");
    grid.replaceChildren();
    const pages = Math.max(1, Math.ceil(font.numGlyphs / PAGE_SIZE));
    $("page").textContent = `${page + 1} / ${pages}`;
    $("prev").disabled = page === 0;
    $("next").disabled = page >= pages - 1;
    for (let i = page * PAGE_SIZE; i < Math.min(font.numGlyphs, (page + 1) * PAGE_SIZE); i++) {
        const glyph = font.glyphs.get(i),
            card = element("div", undefined, "glyph");
        const canvas = element("canvas");
        canvas.width = 128;
        canvas.height = 116;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = getComputedStyle(document.body).color;
        const box = glyph.getBoundingBox();
        const extent = Math.max(font.unitsPerEm, box.x2 - box.x1, box.y2 - box.y1, 1);
        const scale = 84 / extent;
        const x = (128 - (box.x2 - box.x1) * scale) / 2 - box.x1 * scale;
        const y = (116 + (box.y2 - box.y1) * scale) / 2 + box.y1 * scale;
        const outline = glyph.getPath(x, y, font.unitsPerEm * scale);
        outline.fill = getComputedStyle(document.body).color;
        outline.draw(ctx);
        const codes = mappings.get(i) || [];
        card.append(
            canvas,
            element("strong", `#${i} ${glyph.name || ""}`),
            element(
                "small",
                codes.length
                    ? codes.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`).join(", ")
                    : t("unencoded"),
            ),
        );
        grid.append(card);
    }
}
function renderCoverage() {
    const groups = new Map();
    for (const codes of mappings.values())
        for (const cp of codes) {
            let lo = 0,
                hi = unicodeBlocks.length - 1,
                found;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1,
                    b = unicodeBlocks[mid];
                if (cp < b[0]) hi = mid - 1;
                else if (cp > b[1]) lo = mid + 1;
                else {
                    found = b;
                    break;
                }
            }
            const key = found ? found[2] : t("unassigned");
            if (!groups.has(key))
                groups.set(key, { count: 0, total: found ? found[1] - found[0] + 1 : null });
            groups.get(key).count++;
        }
    const target = $("coverage");
    target.replaceChildren();
    for (const [name, info] of groups) {
        const row = element("div", undefined, "coverage-row");
        row.append(
            element("span", name),
            element("span", info.total ? `${info.count} / ${info.total}` : info.count),
        );
        target.append(row);
    }
}
async function decoder() {
    if (!window.woffReady) {
        window.woffReady = new Promise((resolve, reject) => {
            const script = element("script");
            script.src = "lib/woff-lib/woff2-decode.umd.js";
            script.onload = resolve;
            script.onerror = () => reject(new Error(t("decoderError")));
            document.head.append(script);
        });
    }
    await window.woffReady;
    return window.woffLib;
}
async function load() {
    try {
        const path = await P.getFilePath();
        if (!path) {
            $("state").textContent = t("empty");
            return;
        }
        const bytes = await P.readFile(path, { encoding: "binary" });
        if (bytes.byteLength > 64 * 1024 * 1024) throw new Error(t("tooLarge"));
        const sig = String.fromCharCode(...bytes.subarray(0, 4));
        if (!["wOF2", "wOFF", "OTTO", "true", "\u0000\u0001\u0000\u0000"].includes(sig))
            throw new Error(t("unsupported"));
        if (
            (sig === "wOF2" || sig === "wOFF") &&
            bytes.byteLength >= 20 &&
            new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16) > 64 * 1024 * 1024
        ) {
            throw new Error(t("tooLarge"));
        }
        let data = bytes;
        if (sig === "wOF2") {
            data = await (await decoder()).woff2Decode(bytes);
            if (!data) throw new Error(t("decoderError"));
        }
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        font = opentype.parse(buffer);
        const cmap = (font.tables.cmap && font.tables.cmap.glyphIndexMap) || {};
        mappings = new Map();
        for (const [key, index] of Object.entries(cmap)) {
            const cp = Number(key);
            if (
                !Number.isInteger(cp) ||
                cp < 0 ||
                cp > 0x10ffff ||
                !Number.isInteger(index) ||
                index <= 0 ||
                index >= font.numGlyphs
            )
                continue;
            if (!mappings.has(index)) mappings.set(index, []);
            mappings.get(index).push(cp);
        }
        face = new FontFace(
            `font-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        await face.load();
        document.fonts.add(face);
        $("family").textContent = nameValue("fontFamily");
        $("subtitle").textContent = nameValue("fontSubfamily");
        for (const [label, value] of [
            ["version", nameValue("version")],
            ["designer", nameValue("designer")],
            ["license", nameValue("license")],
            ["licenseUrl", nameValue("licenseURL")],
            ["glyphCount", font.numGlyphs],
            ["units", font.unitsPerEm],
        ])
            metadata(label, value);
        updatePreviews();
        renderGlyphs();
        renderCoverage();
        $("state").hidden = true;
        $("viewer").hidden = false;
        P.setStatusText(`${font.numGlyphs} ${t("glyphs")}`);
    } catch (error) {
        $("state").className = "error";
        $("state").textContent = `${t("error")}\n${error.message || error}`;
    }
}
$("sample").addEventListener("input", updatePreviews);
$("size").addEventListener("input", updatePreviews);
$("prev").addEventListener("click", () => {
    page--;
    renderGlyphs();
});
$("next").addEventListener("click", () => {
    page++;
    renderGlyphs();
});
window.addEventListener("pagehide", () => {
    if (face) document.fonts.delete(face);
});
load();
