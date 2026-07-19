// PE Viewer — frontend logic.
//
// A "simple" custom-editor board: Persephone hands us a file PATH, we read the bytes, parse the
// PE structure (pe-parser.js, offline), compute hashes (Web Crypto + vendored MD5), and render a
// tabbed read-only report. There is no write path. See CLAUDE.md for board notes and
// read_guide("boards") for the persephone.* bridge reference.

const P = window.persephone;

const nameEl = document.getElementById("name");
const reloadBtn = document.getElementById("reload");
const stateEl = document.getElementById("state");
const tabsEl = document.getElementById("tabs");
const panelEl = document.getElementById("panel");

let currentPath = "";
let currentPe = null;      // last parsed result
let currentHashes = null;  // null while hashes are still computing (rendered as "computing…")

// ── small DOM helpers ───────────────────────────────────────────────────────────────────────

// el("div", {class:"x", onClick:fn}, child, child…) — children are strings (→ text nodes, safe
// from injection) or Nodes. Untrusted file strings (dll names, cert CNs, pdb paths) go in as text.
function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
        for (const k in props) {
            const v = props[k];
            if (v == null) continue;
            if (k === "class") e.className = v;
            else if (k === "html") e.innerHTML = v;
            else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, v);
        }
    }
    for (const c of children.flat()) {
        if (c == null || c === false) continue;
        e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    return e;
}

// A label→value definition table. rows = [[label, value], …]; null values are skipped.
function kv(rows) {
    const t = el("table", { class: "kv" });
    for (const [k, v] of rows) {
        if (v == null || v === "") continue;
        t.appendChild(el("tr", null, el("th", null, k), el("td", null, typeof v === "object" ? v : String(v))));
    }
    return t;
}

// A header + body data table. headers = [str…]; rows = [[cell…]…] (cells: string or Node).
function table(headers, rows) {
    const thead = el("thead", null, el("tr", null, ...headers.map((h) => el("th", null, h))));
    const tbody = el("tbody", null, ...rows.map((r) => el("tr", null, ...r.map((c) => el("td", null, typeof c === "object" ? c : String(c))))));
    return el("table", { class: "data" }, thead, tbody);
}

function chip(text, kind) {
    return el("span", { class: "chip" + (kind ? " " + kind : "") }, text);
}

function section(title, ...body) {
    return el("section", { class: "card" }, el("h3", null, title), ...body.filter(Boolean));
}

// ── formatters ──────────────────────────────────────────────────────────────────────────────

const hex = (n, pad) => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(pad || 0, "0");
const hexBig = (b) => "0x" + b.toString(16).toUpperCase();

function formatBytes(n) {
    if (n < 1024) return n + " B";
    const units = ["KB", "MB", "GB"];
    let v = n, i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
    return v.toFixed(v < 10 ? 2 : 1) + " " + units[i] + " (" + n.toLocaleString() + " B)";
}

function fileName(p) {
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
}

function entropyCell(e) {
    const pct = Math.min(100, (e / 8) * 100);
    const hot = e > 7.2;
    return el("div", { class: "ent" },
        el("div", { class: "ent-bar" }, el("div", { class: "ent-fill" + (hot ? " hot" : ""), style: "width:" + pct + "%" })),
        el("span", { class: "ent-num" }, e.toFixed(2)),
    );
}

// ── state overlay ───────────────────────────────────────────────────────────────────────────

function showState(message, isError) {
    stateEl.textContent = message;
    stateEl.classList.toggle("error", !!isError);
    stateEl.classList.add("show");
    tabsEl.classList.remove("show");
    panelEl.textContent = "";
}
function hideState() { stateEl.classList.remove("show", "error"); }

// ── tabs ────────────────────────────────────────────────────────────────────────────────────

let tabDefs = [];
let activeTab = null;

function renderTabs() {
    tabsEl.textContent = "";
    tabsEl.classList.add("show");
    for (const def of tabDefs) {
        const b = el("button", {
            class: "tab" + (def.id === activeTab ? " active" : ""),
            onClick: () => selectTab(def.id),
        }, def.label);
        if (def.badge != null) b.appendChild(el("span", { class: "tab-badge" }, String(def.badge)));
        tabsEl.appendChild(b);
    }
}

function selectTab(id) {
    activeTab = id;
    renderTabs();
    const def = tabDefs.find((d) => d.id === id);
    panelEl.textContent = "";
    panelEl.scrollTop = 0;
    if (def) panelEl.appendChild(def.render());
}

// ── tab builders ────────────────────────────────────────────────────────────────────────────

function buildOverview(pe) {
    const vi = pe.versionInfo;
    const S = (vi && vi.strings) || {};
    const wrap = el("div", { class: "overview" });

    // Identity card: icon + headline fields.
    const idBody = el("div", { class: "id-row" });
    if (pe.iconDataUrl) idBody.appendChild(el("img", { class: "app-icon", src: pe.iconDataUrl, alt: "icon" }));
    else idBody.appendChild(el("div", { class: "app-icon placeholder" }, "PE"));

    const badges = el("div", { class: "badges" });
    badges.appendChild(chip(pe.format.split(" ")[0], "info"));
    badges.appendChild(chip(pe.coff.machineName.split(" ")[0]));
    if (pe.isDotNet) badges.appendChild(chip(".NET", "accent"));
    if (pe.security.isDll) badges.appendChild(chip("DLL"));
    badges.appendChild(pe.signature.present ? chip("Signed", "ok") : chip("Unsigned", "warn"));
    if (pe.packerHints.length) badges.appendChild(chip("Packed: " + pe.packerHints.join(", "), "warn"));

    idBody.appendChild(el("div", { class: "id-text" },
        el("div", { class: "id-title" }, S.ProductName || S.FileDescription || friendlyType(pe)),
        S.FileDescription && S.FileDescription !== S.ProductName ? el("div", { class: "id-sub" }, S.FileDescription) : null,
        badges,
    ));
    wrap.appendChild(el("section", { class: "card" }, idBody));

    // File & version.
    wrap.appendChild(section("File",
        kv([
            ["Type", friendlyType(pe)],
            ["File version", vi && vi.fixed ? vi.fixed.fileVersion : S.FileVersion],
            ["Product version", vi && vi.fixed ? vi.fixed.productVersion : S.ProductVersion],
            ["Company", S.CompanyName],
            ["Original name", S.OriginalFilename],
            ["Internal name", S.InternalName],
            ["Copyright", S.LegalCopyright],
            ["Comments", S.Comments],
            ["Size", formatBytes(pe.file.size)],
            ["Compiled", pe.coff.compileTime ? pe.coff.compileTime.toUTCString() : "—"],
            ["Overall entropy", entropyCell(pe.entropy)],
        ]),
    ));

    // Security posture — mitigation chips.
    const sec = pe.security;
    const secChips = el("div", { class: "chips" },
        mitChip("ASLR", sec.aslr),
        mitChip("DEP/NX", sec.dep),
        mitChip("Control Flow Guard", sec.cfg),
        mitChip("High-Entropy VA", sec.highEntropyVa),
        mitChip("Force Integrity", sec.forceIntegrity),
        mitChip("SafeSEH", !sec.noSeh),
    );
    wrap.appendChild(section("Security mitigations", secChips,
        pe.highEntropyExec ? el("p", { class: "note warn-text" }, "⚠ A high-entropy executable section was detected — the binary may be packed or encrypted.") : null,
    ));

    // Key fingerprints (full list is on the Hashes tab).
    wrap.appendChild(section("Fingerprint",
        kv([
            ["SHA-256", hashCell("sha256")],
            ["Imphash", mono(pe.imphash)],
        ]),
    ));

    return wrap;
}

// A hash value cell that reflects the async hashing lifecycle: "computing…" while hashes are in
// flight, the value once ready, or a "skipped" note for the full-file MD5 on very large files.
function hashCell(key) {
    if (currentHashes === null) return el("span", { class: "note" }, "computing…");
    const v = currentHashes[key];
    if (v == null) {
        if (key === "md5" && currentHashes.md5Skipped) return el("span", { class: "note" }, "skipped (large file)");
        return "—";
    }
    return mono(v);
}

function mitChip(label, on) {
    return el("span", { class: "chip " + (on ? "ok" : "off") }, (on ? "✓ " : "✕ ") + label);
}
function mono(text) {
    return text ? el("code", { class: "mono copyable", title: "Click to copy", onClick: () => copy(text) }, text) : "—";
}
function friendlyType(pe) {
    const s = pe.optional.subsystemName;
    let base;
    if (pe.security.isDll) base = pe.coff.machineName.indexOf("Native") >= 0 ? "Driver / DLL" : "Dynamic-Link Library (DLL)";
    else if (pe.optional.subsystem === 1) base = "Native application / driver";
    else if (pe.optional.subsystem === 2) base = "Windows GUI application";
    else if (pe.optional.subsystem === 3) base = "Console application";
    else if (s.indexOf("EFI") >= 0) base = s;
    else base = "Executable";
    return (pe.isDotNet ? ".NET " : "") + base;
}

function buildHeaders(pe) {
    const o = pe.optional;
    const wrap = el("div", null);
    wrap.appendChild(section("COFF header",
        kv([
            ["Machine", pe.coff.machineName + " (" + hex(pe.coff.machine, 4) + ")"],
            ["Sections", pe.coff.numberOfSections],
            ["Timestamp", pe.coff.timeDateStamp + (pe.coff.compileTime ? " — " + pe.coff.compileTime.toUTCString() : "")],
            ["Characteristics", pe.coff.characteristicsFlags.join(", ") || "—"],
        ]),
    ));
    wrap.appendChild(section("Optional header",
        kv([
            ["Magic", pe.format],
            ["Linker version", o.majorLinkerVersion + "." + o.minorLinkerVersion],
            ["Entry point", hex(o.addressOfEntryPoint, 8)],
            ["Image base", hexBig(o.imageBase)],
            ["Section alignment", hex(o.sectionAlignment)],
            ["File alignment", hex(o.fileAlignment)],
            ["Size of image", formatBytes(o.sizeOfImage)],
            ["Size of headers", formatBytes(o.sizeOfHeaders)],
            ["Checksum", hex(o.checkSum, 8)],
            ["Subsystem", o.subsystemName + " (" + o.subsystem + ")"],
            ["OS version", o.osVersion],
            ["Image version", o.imageVersion],
            ["Subsystem version", o.subsystemVersion],
            ["DLL characteristics", o.dllCharacteristicsFlags.join(", ") || "—"],
        ]),
    ));
    const dd = pe.dataDirectories.filter((d) => d.rva || d.size);
    wrap.appendChild(section("Data directories",
        table(["Directory", "RVA", "Size"],
            dd.map((d) => [d.name, hex(d.rva, 8), d.size.toLocaleString() + " B"])),
    ));
    return wrap;
}

function buildSections(pe) {
    const rows = pe.sections.map((s) => [
        el("code", { class: "mono" }, s.name || "(unnamed)"),
        hex(s.virtualAddress, 8),
        s.virtualSize.toLocaleString(),
        s.sizeOfRawData.toLocaleString(),
        el("span", { class: "perm" }, permStr(s)),
        entropyCell(s.entropy),
    ]);
    return el("div", null, section("Sections (" + pe.sections.length + ")",
        table(["Name", "Virtual addr", "Virtual size", "Raw size", "Perms", "Entropy"], rows),
        el("p", { class: "note" }, "Entropy near 8.0 (highlighted) suggests compressed or encrypted data — common in packed binaries."),
    ));
}
function permStr(s) {
    return (s.flags.indexOf("READ") >= 0 ? "R" : "-") +
        (s.flags.indexOf("WRITE") >= 0 ? "W" : "-") +
        (s.flags.indexOf("EXECUTE") >= 0 ? "X" : "-") +
        (s.flags.indexOf("CODE") >= 0 ? " code" : "");
}

function buildImports(pe) {
    if (!pe.imports.length) return el("div", null, section("Imports", el("p", { class: "note" }, "No import table (statically linked, or resolved another way).")));
    const wrap = el("div", null);
    const total = pe.imports.reduce((n, i) => n + i.functions.length, 0);
    wrap.appendChild(el("p", { class: "note" }, pe.imports.length + " libraries, " + total + " imported symbols. Click a library to expand."));
    for (const imp of pe.imports) {
        const list = el("div", { class: "imp-fns" },
            ...imp.functions.map((f) => el("div", { class: "imp-fn" }, f.name || ("Ordinal #" + f.ordinal))));
        const det = el("details", { class: "imp" },
            el("summary", null,
                el("code", { class: "mono" }, imp.dll),
                el("span", { class: "count" }, imp.functions.length + " fn")),
            list);
        wrap.appendChild(det);
    }
    return wrap;
}

function buildExports(pe) {
    const ex = pe.exports;
    if (!ex || !ex.functions.length) {
        return el("div", null, section("Exports", el("p", { class: "note" }, "No exported functions" + (pe.security.isDll ? "." : " (typical for an .exe)."))));
    }
    const rows = ex.functions
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((f) => [f.ordinal, el("code", { class: "mono" }, f.name || "(no name)"), hex(f.rva, 8)]);
    return el("div", null, section("Exports — " + (ex.dllName || "") + " (" + ex.functions.length + ")",
        table(["Ordinal", "Name", "RVA"], rows)));
}

function buildSignature(pe) {
    const s = pe.signature;
    const wrap = el("div", null);
    if (!s.present) {
        wrap.appendChild(section("Digital signature",
            el("div", { class: "big-status warn" }, "✕ Not digitally signed"),
            el("p", { class: "note" }, "This binary has no embedded Authenticode signature. (A file can also be signed via an external security catalog, which cannot be detected from the file alone.)")));
        return wrap;
    }
    wrap.appendChild(section("Digital signature",
        el("div", { class: "big-status ok" }, "✓ Embedded Authenticode signature present"),
        kv([
            ["Certificate type", s.certTypeName],
            ["Revision", s.revision],
            ["Signature size", formatBytes(s.size)],
            ["Offset in file", hex(s.offset, 8)],
        ]),
    ));
    if (s.certNames && s.certNames.length) {
        wrap.appendChild(section("Certificate names (best-effort)",
            el("ul", { class: "cn-list" }, ...s.certNames.map((n) => el("li", null, el("code", { class: "mono" }, n)))),
            el("p", { class: "note" }, "Common names scanned from the certificate blob — usually the publisher plus the CA chain. This is not a cryptographic validity check.")));
    }
    return wrap;
}

function buildHashes(pe) {
    return el("div", null, section("Hashes",
        kv([
            ["MD5", hashCell("md5")],
            ["SHA-1", hashCell("sha1")],
            ["SHA-256", hashCell("sha256")],
            ["Imphash", mono(pe.imphash)],
        ]),
        el("p", { class: "note" }, "Click a value to copy. Imphash fingerprints the import table (used to group related binaries); MD5/SHA are over the whole file. The full-file MD5 is skipped for very large files to keep the viewer responsive — SHA-256 (hardware-accelerated) still covers integrity checks.")));
}

function buildDetails(pe) {
    const wrap = el("div", null);

    // Version-info string table (everything the resource carries).
    const vi = pe.versionInfo;
    if (vi && vi.strings && Object.keys(vi.strings).length) {
        wrap.appendChild(section("Version info (all strings)",
            table(["Key", "Value"], Object.keys(vi.strings).map((k) => [k, vi.strings[k]]))));
    }

    // Rich header.
    if (pe.richHeader && pe.richHeader.entries.length) {
        wrap.appendChild(section("Rich header (build provenance)",
            el("p", { class: "note" }, "Undocumented Microsoft toolchain markers (linker/compiler product & build ids). XOR key " + pe.richHeader.key + "."),
            table(["Product id", "Build", "Count"],
                pe.richHeader.entries.map((e) => [hex(e.prodId, 4), e.buildId, e.count]))));
    }

    // Debug / PDB.
    if (pe.debug && pe.debug.length) {
        const pdb = pe.debug.find((d) => d.pdbPath);
        wrap.appendChild(section("Debug",
            kv([
                ["Entries", pe.debug.map((d) => d.typeName).join(", ")],
                ["PDB path", pdb ? el("code", { class: "mono" }, pdb.pdbPath) : null],
                ["PDB age", pdb ? pdb.age : null],
            ])));
    }

    // Embedded application manifest (XML).
    if (pe.manifest) {
        wrap.appendChild(section("Application manifest",
            el("pre", { class: "xml" }, pe.manifest)));
    }

    if (!wrap.childNodes.length) wrap.appendChild(section("Details", el("p", { class: "note" }, "No version-info, manifest, debug, or Rich-header data found in this binary.")));
    return wrap;
}

// ── clipboard ───────────────────────────────────────────────────────────────────────────────

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        P.notify("Copied", "success");
    } catch (err) {
        P.notify("Copy failed: " + (err && err.message ? err.message : err), "error");
    }
}

// ── hashes ──────────────────────────────────────────────────────────────────────────────────

// Above this size the pure-JS MD5 (which blocks the main thread) is skipped — SHA-1/SHA-256 go
// through crypto.subtle, which is hardware-accelerated and runs off the main thread, so they stay
// cheap even on 100s of MB. imphash (a tiny MD5 of the import list) is always computed in the parser.
const MD5_MAX_BYTES = 96 * 1024 * 1024;

async function computeHashes(bytes) {
    const out = { md5: null, sha1: null, sha256: null };
    const subtle = window.crypto && window.crypto.subtle;
    if (subtle) {
        const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
        try { out.sha256 = toHex(await subtle.digest("SHA-256", bytes)); } catch (e) { /* ignore */ }
        try { out.sha1 = toHex(await subtle.digest("SHA-1", bytes)); } catch (e) { /* ignore */ }
    }
    if (bytes.length <= MD5_MAX_BYTES) {
        try { out.md5 = window.md5hex(bytes); } catch (e) { /* ignore */ }
    } else {
        out.md5Skipped = true;
    }
    return out;
}

// Fast base64 → bytes. A plain indexed charCodeAt loop is dramatically faster than
// Uint8Array.from(atob(b64), fn) (which invokes the callback per element through the iterator
// protocol) — the latter takes *minutes* and freezes the frame on a 200 MB binary.
function decodeBase64(b64) {
    const bin = atob(b64);
    const n = bin.length;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// ── load ────────────────────────────────────────────────────────────────────────────────────

async function load() {
    try {
        showState("Loading…");
        reloadBtn.disabled = true;

        const path = await P.getFilePath();
        currentPath = path || "";

        if (!currentPath) {
            nameEl.textContent = "PE Viewer";
            showState("No file open.\nOpen an .exe, .dll, .sys, .ocx or .scr file to inspect it here.");
            return;
        }

        nameEl.textContent = fileName(currentPath);
        showState("Loading…");
        reloadBtn.disabled = false;

        // Force a paint of the "Loading…" overlay before the (synchronous, multi-second on a large
        // binary) read + decode + parse, so a big file shows "Loading…" rather than a gray flash.
        await new Promise((r) => requestAnimationFrame(() => r()));

        const b64 = await P.readFile(currentPath, { encoding: "base64" });
        const bytes = decodeBase64(b64);

        const pe = window.PEParser.parse(bytes);
        currentPe = pe;
        currentHashes = null; // "computing…" until the async pass below completes

        // Render the structure IMMEDIATELY — parsing only reads headers/tables, so it's fast even
        // for a 200 MB binary. Hashing the whole file is deferred so the UI never freezes.
        hideState();
        tabDefs = [
            { id: "overview", label: "Overview", render: () => buildOverview(pe) },
            { id: "headers", label: "Headers", render: () => buildHeaders(pe) },
            { id: "sections", label: "Sections", badge: pe.sections.length, render: () => buildSections(pe) },
            { id: "imports", label: "Imports", badge: pe.imports.length || null, render: () => buildImports(pe) },
            { id: "exports", label: "Exports", badge: pe.exports ? pe.exports.functions.length : null, render: () => buildExports(pe) },
            { id: "signature", label: "Signature", render: () => buildSignature(pe) },
            { id: "hashes", label: "Hashes", render: () => buildHashes(pe) },
            { id: "details", label: "Details", render: () => buildDetails(pe) },
        ];
        selectTab("overview");

        // Compute hashes after a paint so the tabs are already interactive. Guard against a newer
        // load() (e.g. Reload spam) overwriting fresher results.
        await new Promise((r) => requestAnimationFrame(() => r()));
        const token = currentPath;
        const hashes = await computeHashes(bytes);
        if (currentPath !== token) return; // a newer load superseded this one
        currentHashes = hashes;
        if (activeTab === "overview" || activeTab === "hashes") selectTab(activeTab);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        showState("Could not open this file.\n" + message, true);
        P.notify(message, "error");
    }
}

reloadBtn.addEventListener("click", load);
load();
