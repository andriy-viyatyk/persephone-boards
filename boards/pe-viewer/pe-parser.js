// pe-parser.js — a pure, offline parser for the Windows PE (Portable Executable) format.
//
// Takes the raw file bytes (Uint8Array) and returns a structured object describing the binary:
// COFF/optional headers, data directories, sections (+ entropy), imports/exports, version-info
// resources, embedded icon, application manifest, debug/PDB info, digital-signature presence,
// the Rich header, packer hints, and the imphash. No network, no dependencies except md5.js
// (loaded first) for the imphash. Everything is best-effort and wrapped defensively — a
// malformed sub-structure degrades that one field rather than failing the whole parse.
//
// Format references: PE/COFF spec (Microsoft), and the usual field-offset tables. Exposes
// window.PEParser.parse(bytes).

(function (global) {
    "use strict";

    // ── Lookup tables ────────────────────────────────────────────────────────────────────────

    const MACHINE = {
        0x0: "Unknown",
        0x14c: "x86 (Intel 386)",
        0x8664: "x64 (AMD64)",
        0xaa64: "ARM64",
        0x1c0: "ARM",
        0x1c4: "ARM Thumb-2",
        0x1c2: "ARM Thumb",
        0x200: "Itanium (IA-64)",
        0x5032: "RISC-V 32",
        0x5064: "RISC-V 64",
        0x5128: "RISC-V 128",
        0xebc: "EFI Byte Code",
        0x166: "MIPS R4000",
        0x1f0: "PowerPC",
        0x1f1: "PowerPC (FP)",
    };

    const SUBSYSTEM = {
        0: "Unknown",
        1: "Native",
        2: "Windows GUI",
        3: "Windows Console",
        5: "OS/2 Console",
        7: "POSIX Console",
        8: "Native Windows 9x driver",
        9: "Windows CE GUI",
        10: "EFI Application",
        11: "EFI Boot Service Driver",
        12: "EFI Runtime Driver",
        13: "EFI ROM",
        14: "Xbox",
        16: "Windows Boot Application",
    };

    const DIR_NAMES = [
        "Export", "Import", "Resource", "Exception", "Certificate", "Base Relocation",
        "Debug", "Architecture", "Global Ptr", "TLS", "Load Config", "Bound Import",
        "IAT", "Delay Import", "CLR Runtime", "Reserved",
    ];

    // COFF header Characteristics flags.
    const COFF_FLAGS = [
        [0x0001, "RELOCS_STRIPPED"],
        [0x0002, "EXECUTABLE_IMAGE"],
        [0x0004, "LINE_NUMS_STRIPPED"],
        [0x0008, "LOCAL_SYMS_STRIPPED"],
        [0x0020, "LARGE_ADDRESS_AWARE"],
        [0x0100, "32BIT_MACHINE"],
        [0x0200, "DEBUG_STRIPPED"],
        [0x0400, "REMOVABLE_RUN_FROM_SWAP"],
        [0x0800, "NET_RUN_FROM_SWAP"],
        [0x1000, "SYSTEM"],
        [0x2000, "DLL"],
        [0x4000, "UP_SYSTEM_ONLY"],
    ];

    // Optional-header DllCharacteristics — the security/hardening flags.
    const DLL_FLAGS = [
        [0x0020, "HIGH_ENTROPY_VA"],
        [0x0040, "DYNAMIC_BASE"],
        [0x0080, "FORCE_INTEGRITY"],
        [0x0100, "NX_COMPAT"],
        [0x0200, "NO_ISOLATION"],
        [0x0400, "NO_SEH"],
        [0x0800, "NO_BIND"],
        [0x1000, "APPCONTAINER"],
        [0x2000, "WDM_DRIVER"],
        [0x4000, "GUARD_CF"],
        [0x8000, "TERMINAL_SERVER_AWARE"],
    ];

    const SECTION_FLAGS = [
        [0x00000020, "CODE"],
        [0x00000040, "INITIALIZED_DATA"],
        [0x00000080, "UNINITIALIZED_DATA"],
        [0x02000000, "DISCARDABLE"],
        [0x04000000, "NOT_CACHED"],
        [0x08000000, "NOT_PAGED"],
        [0x10000000, "SHARED"],
        [0x20000000, "EXECUTE"],
        [0x40000000, "READ"],
        [0x80000000, "WRITE"],
    ];

    const DEBUG_TYPES = {
        0: "Unknown", 1: "COFF", 2: "CodeView", 3: "FPO", 4: "Misc", 5: "Exception",
        6: "Fixup", 7: "OMAP to Src", 8: "OMAP from Src", 9: "Borland", 10: "Reserved",
        11: "CLSID", 12: "VC Feature", 13: "POGO", 14: "ILTCG", 15: "MPX", 16: "Repro",
        20: "Ex DLL Characteristics",
    };

    const CERT_TYPES = {
        0x0001: "X.509", 0x0002: "PKCS#7 SignedData", 0x0003: "Reserved", 0x0004: "PKCS1 Sign",
    };

    // Section-name → known packer/protector.
    const PACKER_SIGS = {
        "UPX0": "UPX", "UPX1": "UPX", "UPX2": "UPX", "UPX!": "UPX",
        ".aspack": "ASPack", ".adata": "ASPack", "ASPack": "ASPack",
        ".nsp0": "NsPack", ".nsp1": "NsPack", ".nsp2": "NsPack",
        "FSG!": "FSG", ".petite": "Petite",
        "MPRESS1": "MPRESS", "MPRESS2": "MPRESS",
        ".themida": "Themida", ".winlice": "Themida/WinLicense",
        ".vmp0": "VMProtect", ".vmp1": "VMProtect", ".vmp2": "VMProtect",
        ".enigma1": "Enigma", ".enigma2": "Enigma",
        ".pklstb": "PKLite", "pec1": "PECompact", "PEC2": "PECompact",
        ".taz": "PESpin", ".gentee": "Gentee", ".mackt": "ImpRec",
        ".y0da": "yoda's Crypter", ".Upack": "Upack", "kkrunchy": "kkrunchy",
    };

    // ── Byte reader ──────────────────────────────────────────────────────────────────────────

    function makeReader(bytes) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const n = bytes.length;
        return {
            u8: (o) => (o >= 0 && o < n ? dv.getUint8(o) : 0),
            u16: (o) => (o >= 0 && o + 2 <= n ? dv.getUint16(o, true) : 0),
            u32: (o) => (o >= 0 && o + 4 <= n ? dv.getUint32(o, true) : 0),
            u64: (o) => (o >= 0 && o + 8 <= n ? dv.getBigUint64(o, true) : 0n),
            // NUL-terminated ASCII.
            asciiZ: (o, max) => {
                let s = "";
                const lim = max == null ? 4096 : max;
                for (let i = 0; i < lim && o + i < n; i++) {
                    const c = dv.getUint8(o + i);
                    if (c === 0) break;
                    s += String.fromCharCode(c);
                }
                return s;
            },
            // UTF-16LE of a known length (in code units).
            utf16: (o, count) => {
                let s = "";
                for (let i = 0; i < count && o + i * 2 + 2 <= n; i++) {
                    s += String.fromCharCode(dv.getUint16(o + i * 2, true));
                }
                return s;
            },
        };
    }

    function flagList(value, table) {
        const out = [];
        for (const [bit, name] of table) if ((value & bit) !== 0) out.push(name);
        return out;
    }

    // Shannon entropy (0..8 bits/byte) over bytes[start, start+len).
    function entropyOf(bytes, start, len) {
        const end = Math.min(start + len, bytes.length);
        const count = end - start;
        if (count <= 0) return 0;
        const counts = new Uint32Array(256);
        for (let i = start; i < end; i++) counts[bytes[i]]++;
        let e = 0;
        for (let i = 0; i < 256; i++) {
            if (counts[i]) {
                const p = counts[i] / count;
                e -= p * Math.log2(p);
            }
        }
        return e;
    }

    // ── Main parse ───────────────────────────────────────────────────────────────────────────

    function parse(bytes) {
        const r = makeReader(bytes);

        if (r.u16(0) !== 0x5a4d) throw new Error("Not a PE file: missing 'MZ' DOS signature.");
        const e_lfanew = r.u32(0x3c);
        if (r.u32(e_lfanew) !== 0x00004550) {
            throw new Error("Not a PE file: missing 'PE\\0\\0' signature.");
        }

        const coffOff = e_lfanew + 4;
        const machine = r.u16(coffOff);
        const numberOfSections = r.u16(coffOff + 2);
        const timeDateStamp = r.u32(coffOff + 8);
        const sizeOfOptionalHeader = r.u16(coffOff + 16);
        const characteristics = r.u16(coffOff + 18);

        const optOff = coffOff + 20;
        const magic = r.u16(optOff);
        const isPlus = magic === 0x20b; // PE32+ (64-bit)

        const optional = {
            magic,
            majorLinkerVersion: r.u8(optOff + 2),
            minorLinkerVersion: r.u8(optOff + 3),
            sizeOfCode: r.u32(optOff + 4),
            addressOfEntryPoint: r.u32(optOff + 16),
            baseOfCode: r.u32(optOff + 20),
        };

        // ImageBase + the fields that follow diverge by 32/64-bit.
        let p;
        if (isPlus) {
            optional.imageBase = r.u64(optOff + 24);
            p = optOff + 24 + 8;
        } else {
            optional.imageBase = BigInt(r.u32(optOff + 28));
            p = optOff + 28 + 4;
        }
        optional.sectionAlignment = r.u32(p);
        optional.fileAlignment = r.u32(p + 4);
        optional.majorOsVersion = r.u16(p + 8);
        optional.minorOsVersion = r.u16(p + 10);
        optional.majorImageVersion = r.u16(p + 12);
        optional.minorImageVersion = r.u16(p + 14);
        optional.majorSubsystemVersion = r.u16(p + 16);
        optional.minorSubsystemVersion = r.u16(p + 18);
        optional.sizeOfImage = r.u32(p + 24);
        optional.sizeOfHeaders = r.u32(p + 28);
        optional.checkSum = r.u32(p + 32);
        optional.subsystem = r.u16(p + 36);
        optional.dllCharacteristics = r.u16(p + 38);
        // After DllCharacteristics (ends at p+40) come the four SizeOf{Stack,Heap}{Reserve,Commit}
        // fields — 4×uint64 for PE32+, 4×uint32 for PE32 — then LoaderFlags (uint32), then
        // NumberOfRvaAndSizes (uint32). Getting this width wrong shifts the whole data-directory
        // array and breaks imports/exports/resources/debug.
        const numRvaOff = isPlus ? p + 40 + 32 + 4 : p + 40 + 16 + 4;
        const numberOfRvaAndSizes = r.u32(numRvaOff);
        let ddOff = numRvaOff + 4;

        const dataDirectories = [];
        for (let i = 0; i < Math.min(numberOfRvaAndSizes, 16); i++) {
            dataDirectories.push({
                name: DIR_NAMES[i] || ("Dir " + i),
                rva: r.u32(ddOff),
                size: r.u32(ddOff + 4),
            });
            ddOff += 8;
        }

        // Section headers start right after the optional header.
        const sectOff = optOff + sizeOfOptionalHeader;
        const sections = [];
        for (let i = 0; i < numberOfSections; i++) {
            const so = sectOff + i * 40;
            const name = r.asciiZ(so, 8);
            const virtualSize = r.u32(so + 8);
            const virtualAddress = r.u32(so + 12);
            const sizeOfRawData = r.u32(so + 16);
            const pointerToRawData = r.u32(so + 20);
            // Characteristics is at +36 (after PointerToRelocations/Linenumbers + the two count
            // words), NOT +24 — the R/W/X and CODE flags live here.
            const chars = r.u32(so + 36) >>> 0;
            sections.push({
                name,
                virtualSize,
                virtualAddress,
                sizeOfRawData,
                pointerToRawData,
                characteristics: chars,
                flags: flagList(chars, SECTION_FLAGS),
                entropy: sizeOfRawData > 0 ? entropyOf(bytes, pointerToRawData, sizeOfRawData) : 0,
            });
        }

        const rvaToOffset = (rva) => {
            for (const s of sections) {
                const span = Math.max(s.virtualSize, s.sizeOfRawData);
                if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
                    return s.pointerToRawData + (rva - s.virtualAddress);
                }
            }
            return -1;
        };
        const dir = (i) => dataDirectories[i] || { rva: 0, size: 0 };

        // ── Imports ────────────────────────────────────────────────────────────────────────
        const imports = safe(() => parseImports(r, dir(1), rvaToOffset, isPlus), []);
        // ── Exports ────────────────────────────────────────────────────────────────────────
        const exports = safe(() => parseExports(r, dir(0), rvaToOffset), null);
        // ── Resources: version info, icon, manifest ──────────────────────────────────────────
        const res = safe(() => parseResources(bytes, r, dir(2), rvaToOffset), {});
        // ── Debug directory (CodeView / PDB path) ────────────────────────────────────────────
        const debug = safe(() => parseDebug(r, dir(6), rvaToOffset), []);
        // ── .NET / CLR ────────────────────────────────────────────────────────────────────
        const dotnet = safe(() => parseClr(r, dir(14), rvaToOffset), null);
        // ── Authenticode signature ──────────────────────────────────────────────────────────
        const signature = safe(() => parseSignature(bytes, r, dir(4)), { present: false });
        // ── Rich header (compiler/linker provenance) ─────────────────────────────────────────
        const richHeader = safe(() => parseRichHeader(r, e_lfanew), null);

        // ── Packer hints ────────────────────────────────────────────────────────────────────
        const packerHints = [];
        for (const s of sections) {
            const hit = PACKER_SIGS[s.name] || PACKER_SIGS[s.name.trim()];
            if (hit && packerHints.indexOf(hit) < 0) packerHints.push(hit);
        }
        const highEntropyExec = sections.some(
            (s) => s.entropy > 7.2 && s.flags.indexOf("EXECUTE") >= 0,
        );

        // ── imphash (pefile-compatible-ish) ─────────────────────────────────────────────────
        const imphash = safe(() => computeImphash(imports), null);

        return {
            file: { size: bytes.length },
            format: isPlus ? "PE32+ (64-bit)" : "PE32 (32-bit)",
            dosHeader: { e_lfanew },
            coff: {
                machine,
                machineName: MACHINE[machine] || ("0x" + machine.toString(16)),
                numberOfSections,
                timeDateStamp,
                compileTime: timeDateStamp ? new Date(timeDateStamp * 1000) : null,
                sizeOfOptionalHeader,
                characteristics,
                characteristicsFlags: flagList(characteristics, COFF_FLAGS),
            },
            optional: {
                ...optional,
                subsystemName: SUBSYSTEM[optional.subsystem] || ("0x" + optional.subsystem.toString(16)),
                dllCharacteristicsFlags: flagList(optional.dllCharacteristics, DLL_FLAGS),
                osVersion: optional.majorOsVersion + "." + optional.minorOsVersion,
                imageVersion: optional.majorImageVersion + "." + optional.minorImageVersion,
                subsystemVersion: optional.majorSubsystemVersion + "." + optional.minorSubsystemVersion,
                numberOfRvaAndSizes,
            },
            dataDirectories,
            sections,
            imports,
            exports,
            resources: res,
            versionInfo: res.versionInfo || null,
            iconDataUrl: res.iconDataUrl || null,
            manifest: res.manifest || null,
            debug,
            dotnet,
            isDotNet: !!dotnet,
            signature,
            richHeader,
            security: {
                aslr: (optional.dllCharacteristics & 0x0040) !== 0,
                highEntropyVa: (optional.dllCharacteristics & 0x0020) !== 0,
                dep: (optional.dllCharacteristics & 0x0100) !== 0,
                cfg: (optional.dllCharacteristics & 0x4000) !== 0,
                forceIntegrity: (optional.dllCharacteristics & 0x0080) !== 0,
                noSeh: (optional.dllCharacteristics & 0x0400) !== 0,
                isDll: (characteristics & 0x2000) !== 0,
            },
            entropy: entropyOf(bytes, 0, bytes.length),
            packerHints,
            highEntropyExec,
            imphash,
        };
    }

    // Run fn, returning fallback (and console.warn) if it throws — so one bad structure never
    // sinks the whole parse.
    function safe(fn, fallback) {
        try {
            return fn();
        } catch (err) {
            console.warn("pe-parser: sub-parse failed:", err && err.message ? err.message : err);
            return fallback;
        }
    }

    // ── Imports ─────────────────────────────────────────────────────────────────────────────

    function parseImports(r, d, rvaToOffset, isPlus) {
        const out = [];
        if (!d.rva) return out;
        let off = rvaToOffset(d.rva);
        if (off < 0) return out;

        for (let guard = 0; guard < 4096; guard++, off += 20) {
            const originalFirstThunk = r.u32(off);
            const nameRva = r.u32(off + 12);
            const firstThunk = r.u32(off + 16);
            if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) break;

            const nameOff = rvaToOffset(nameRva);
            const dll = nameOff >= 0 ? r.asciiZ(nameOff) : "(unknown)";
            const functions = [];

            let toff = rvaToOffset((originalFirstThunk || firstThunk) >>> 0);
            const step = isPlus ? 8 : 4;
            for (let g2 = 0; toff >= 0 && g2 < 8192; g2++, toff += step) {
                let isOrdinal, lowRva, ordinal;
                if (isPlus) {
                    const v = r.u64(toff);
                    if (v === 0n) break;
                    isOrdinal = (v & 0x8000000000000000n) !== 0n;
                    ordinal = Number(v & 0xffffn);
                    lowRva = Number(v & 0x7fffffffn);
                } else {
                    const v = r.u32(toff);
                    if (v === 0) break;
                    isOrdinal = (v & 0x80000000) !== 0;
                    ordinal = v & 0xffff;
                    lowRva = v & 0x7fffffff;
                }
                if (isOrdinal) {
                    functions.push({ ordinal });
                } else {
                    const ho = rvaToOffset(lowRva);
                    if (ho >= 0) functions.push({ hint: r.u16(ho), name: r.asciiZ(ho + 2) });
                    else functions.push({ name: "(unresolved)" });
                }
            }
            out.push({ dll, functions });
        }
        return out;
    }

    // ── Exports ─────────────────────────────────────────────────────────────────────────────

    function parseExports(r, d, rvaToOffset) {
        if (!d.rva) return null;
        const off = rvaToOffset(d.rva);
        if (off < 0) return null;

        const nameOff = rvaToOffset(r.u32(off + 12));
        const ordinalBase = r.u32(off + 16);
        const numberOfFunctions = r.u32(off + 20);
        const numberOfNames = r.u32(off + 24);
        const addrFuncs = rvaToOffset(r.u32(off + 28));
        const addrNames = rvaToOffset(r.u32(off + 32));
        const addrOrds = rvaToOffset(r.u32(off + 36));

        const functions = [];
        if (addrNames >= 0 && addrOrds >= 0) {
            for (let i = 0; i < Math.min(numberOfNames, 65536); i++) {
                const nOff = rvaToOffset(r.u32(addrNames + i * 4));
                const name = nOff >= 0 ? r.asciiZ(nOff) : "";
                const idx = r.u16(addrOrds + i * 2);
                const fnRva = addrFuncs >= 0 ? r.u32(addrFuncs + idx * 4) : 0;
                functions.push({ name, ordinal: idx + ordinalBase, rva: fnRva });
            }
        }
        return {
            dllName: nameOff >= 0 ? r.asciiZ(nameOff) : "",
            ordinalBase,
            numberOfFunctions,
            numberOfNames,
            functions,
        };
    }

    // ── Debug directory ─────────────────────────────────────────────────────────────────────

    function parseDebug(r, d, rvaToOffset) {
        const out = [];
        if (!d.rva || !d.size) return out;
        // The IMAGE_DEBUG_DIRECTORY array is located by mapping the directory RVA to a file offset;
        // each entry's CodeView blob is then reached via its PointerToRawData (already a file offset).
        const dirOff = rvaToOffset(d.rva);
        if (dirOff < 0) return out;
        const count = Math.floor(d.size / 28);
        for (let i = 0; i < count; i++) {
            const eo = dirOff + i * 28;
            const type = r.u32(eo + 12);
            const ptrRaw = r.u32(eo + 24);
            const entry = { type, typeName: DEBUG_TYPES[type] || ("Type " + type) };
            if (type === 2 && ptrRaw > 0 && r.u32(ptrRaw) === 0x53445352) {
                // 'RSDS' CodeView: GUID(16) + Age(4) + NUL-terminated PDB path.
                entry.age = r.u32(ptrRaw + 20);
                entry.pdbPath = r.asciiZ(ptrRaw + 24);
            }
            out.push(entry);
        }
        return out;
    }

    // ── CLR / .NET ──────────────────────────────────────────────────────────────────────────

    function parseClr(r, d, rvaToOffset) {
        if (!d.rva) return null;
        const off = rvaToOffset(d.rva);
        if (off < 0) return {};
        return {
            runtimeVersion: r.u16(off + 4) + "." + r.u16(off + 6),
            flags: r.u32(off + 16),
        };
    }

    // ── Authenticode signature ──────────────────────────────────────────────────────────────

    function parseSignature(bytes, r, d) {
        // For the Certificate directory, the "rva" field is a FILE OFFSET (not an RVA).
        if (!d.rva || !d.size) return { present: false };
        const o = d.rva;
        const length = r.u32(o);
        const revision = r.u16(o + 4);
        const certType = r.u16(o + 6);
        const sig = {
            present: true,
            offset: o,
            size: d.size,
            length,
            revision: "0x" + revision.toString(16),
            certType,
            certTypeName: CERT_TYPES[certType] || ("0x" + certType.toString(16)),
        };
        // Best-effort: scan the PKCS#7 blob for X.500 commonName (OID 2.5.4.3) values — usually
        // includes the signing publisher. Not a full ASN.1 / chain-validity parse.
        sig.certNames = scanCommonNames(bytes, o + 8, Math.min(length, 262144));
        return sig;
    }

    function scanCommonNames(bytes, start, len) {
        const names = [];
        const end = Math.min(start + len, bytes.length) - 6;
        for (let i = start; i < end; i++) {
            // OID 2.5.4.3 encoded as: 06 03 55 04 03
            if (bytes[i] === 0x06 && bytes[i + 1] === 0x03 && bytes[i + 2] === 0x55
                && bytes[i + 3] === 0x04 && bytes[i + 4] === 0x03) {
                let p = i + 5;
                const tag = bytes[p];
                let l = bytes[p + 1];
                p += 2;
                if (l & 0x80) {
                    const nb = l & 0x7f;
                    l = 0;
                    for (let k = 0; k < nb && p < bytes.length; k++) l = (l << 8) | bytes[p++];
                }
                if (l <= 0 || l > 512 || p + l > bytes.length) continue;
                let s = "";
                if (tag === 0x1e) {
                    // BMPString (UTF-16BE)
                    for (let k = 0; k + 1 < l; k += 2) s += String.fromCharCode((bytes[p + k] << 8) | bytes[p + k + 1]);
                } else {
                    // PrintableString / UTF8String / IA5String
                    for (let k = 0; k < l; k++) s += String.fromCharCode(bytes[p + k]);
                }
                s = s.replace(/[^\x20-\x7e]/g, "").trim();
                if (s && names.indexOf(s) < 0) names.push(s);
                if (names.length >= 12) break;
            }
        }
        return names;
    }

    // ── Rich header ─────────────────────────────────────────────────────────────────────────

    function parseRichHeader(r, e_lfanew) {
        // 'Rich' marker sits between the DOS stub and the PE header.
        let richOff = -1;
        for (let i = e_lfanew - 4; i >= 0x40; i -= 4) {
            if (r.u32(i) === 0x68636952) { richOff = i; break; } // 'Rich'
        }
        if (richOff < 0) return null;
        const key = r.u32(richOff + 4);

        let dansOff = -1;
        for (let i = richOff - 4; i >= 0x40; i -= 4) {
            if ((r.u32(i) ^ key) === 0x536e6144) { dansOff = i; break; } // 'DanS'
        }
        if (dansOff < 0) return null;

        const entries = [];
        for (let o = dansOff + 16; o < richOff; o += 8) {
            const comp = (r.u32(o) ^ key) >>> 0;
            const count = (r.u32(o + 4) ^ key) >>> 0;
            entries.push({
                prodId: comp >>> 16,
                buildId: comp & 0xffff,
                count,
            });
            if (entries.length > 200) break;
        }
        return { key: "0x" + key.toString(16), entries };
    }

    // ── Resources (version info, icon, manifest) ─────────────────────────────────────────────

    function parseResources(bytes, r, d, rvaToOffset) {
        const result = {};
        if (!d.rva) return result;
        const base = rvaToOffset(d.rva);
        if (base < 0) return result;

        // Resource offsets are relative to the resource section base.
        const readDir = (relOff) => {
            const dirOff = base + relOff;
            const numNamed = r.u16(dirOff + 12);
            const numId = r.u16(dirOff + 14);
            const total = numNamed + numId;
            const entries = [];
            for (let i = 0; i < total; i++) {
                const eo = dirOff + 16 + i * 8;
                const nameField = r.u32(eo) >>> 0;
                const offField = r.u32(eo + 4) >>> 0;
                let id = null, name = null;
                if (nameField & 0x80000000) {
                    const so = base + (nameField & 0x7fffffff);
                    name = r.utf16(so + 2, r.u16(so));
                } else {
                    id = nameField;
                }
                entries.push({
                    id,
                    name,
                    isSubdir: (offField & 0x80000000) !== 0,
                    offsetRel: offField & 0x7fffffff,
                });
            }
            return entries;
        };
        // IMAGE_RESOURCE_DATA_ENTRY → { dataRva, size, fileOffset }.
        const readData = (relOff) => {
            const o = base + relOff;
            const dataRva = r.u32(o);
            return { dataRva, size: r.u32(o + 4), fileOffset: rvaToOffset(dataRva) };
        };
        // All leaf data entries for a given resource type id.
        const leavesForType = (typeId) => {
            const roots = readDir(0);
            const typeEntry = roots.find((e) => e.id === typeId && e.isSubdir);
            if (!typeEntry) return [];
            const out = [];
            for (const nameEntry of readDir(typeEntry.offsetRel)) {
                if (!nameEntry.isSubdir) continue;
                for (const langEntry of readDir(nameEntry.offsetRel)) {
                    if (langEntry.isSubdir) continue;
                    out.push({ nameId: nameEntry.id, ...readData(langEntry.offsetRel) });
                }
            }
            return out;
        };

        // RT_VERSION (16)
        const versionLeaves = leavesForType(16);
        if (versionLeaves.length && versionLeaves[0].fileOffset >= 0) {
            result.versionInfo = parseVersionInfo(r, versionLeaves[0].fileOffset, versionLeaves[0].size);
        }
        // RT_MANIFEST (24)
        const manifestLeaves = leavesForType(24);
        if (manifestLeaves.length && manifestLeaves[0].fileOffset >= 0) {
            const mb = bytes.subarray(manifestLeaves[0].fileOffset, manifestLeaves[0].fileOffset + manifestLeaves[0].size);
            try { result.manifest = new TextDecoder("utf-8").decode(mb).replace(/ +$/, ""); } catch (e) { /* ignore */ }
        }
        // RT_GROUP_ICON (14) + RT_ICON (3) → build a displayable .ico.
        result.iconDataUrl = buildIcon(bytes, r, leavesForType);
        result.hasVersion = !!result.versionInfo;
        result.hasManifest = !!result.manifest;
        result.hasIcon = !!result.iconDataUrl;
        return result;
    }

    function parseVersionInfo(r, startOff, totalSize) {
        const A = (rel) => startOff + rel;
        const u16 = (rel) => r.u16(A(rel));
        const align = (rel) => (rel + 3) & ~3;
        const strings = {};
        const translations = [];
        let fixed = null;

        const readKey = (rel) => {
            let s = "";
            for (let i = 0; i < 256; i++) {
                const c = u16(rel);
                rel += 2;
                if (c === 0) break;
                s += String.fromCharCode(c);
            }
            return { key: s, next: rel };
        };

        // Root VS_VERSIONINFO node.
        const rootLen = u16(0);
        const rootValLen = u16(2);
        let k = readKey(6);
        let rel = align(k.next);
        if (rootValLen > 0 && r.u32(A(rel)) === 0xfeef04bd) {
            fixed = {
                fileVersionMS: r.u32(A(rel + 8)),
                fileVersionLS: r.u32(A(rel + 12)),
                productVersionMS: r.u32(A(rel + 16)),
                productVersionLS: r.u32(A(rel + 20)),
                fileFlags: r.u32(A(rel + 28)),
                fileOS: r.u32(A(rel + 32)),
                fileType: r.u32(A(rel + 36)),
            };
        }
        rel = align(rel + rootValLen);

        const end = Math.min(rootLen || totalSize, totalSize);
        while (rel < end) {
            rel = align(rel);
            const nodeStart = rel;
            const wLength = u16(rel);
            if (!wLength) break;
            const ck = readKey(rel + 6);
            let cp = align(ck.next);
            const nodeEnd = nodeStart + wLength;
            if (ck.key === "StringFileInfo") {
                while (cp < nodeEnd) {
                    cp = align(cp);
                    const stStart = cp;
                    const stLen = u16(cp);
                    if (!stLen) break;
                    const stk = readKey(cp + 6);
                    let sp = align(stk.next);
                    const stEnd = stStart + stLen;
                    while (sp < stEnd) {
                        sp = align(sp);
                        const sStart = sp;
                        const sLen = u16(sp);
                        if (!sLen) break;
                        const sValLen = u16(sp + 2);
                        const sk = readKey(sp + 6);
                        const vp = align(sk.next);
                        let val = "";
                        for (let i = 0; i < sValLen; i++) {
                            const c = u16(vp + i * 2);
                            if (c === 0) break;
                            val += String.fromCharCode(c);
                        }
                        if (sk.key) strings[sk.key] = val;
                        sp = sStart + sLen;
                    }
                    cp = stStart + stLen;
                }
            } else if (ck.key === "VarFileInfo") {
                while (cp < nodeEnd) {
                    cp = align(cp);
                    const vStart = cp;
                    const vLen = u16(cp);
                    if (!vLen) break;
                    const vValLen = u16(cp + 2);
                    const vk = readKey(cp + 6);
                    const vp = align(vk.next);
                    for (let i = 0; i + 4 <= vValLen; i += 4) {
                        translations.push({ lang: u16(vp + i), codepage: u16(vp + i + 2) });
                    }
                    cp = vStart + vLen;
                }
            }
            rel = nodeEnd;
        }

        const ver = (ms, ls) => [(ms >>> 16) & 0xffff, ms & 0xffff, (ls >>> 16) & 0xffff, ls & 0xffff].join(".");
        return {
            fixed: fixed
                ? {
                    fileVersion: ver(fixed.fileVersionMS, fixed.fileVersionLS),
                    productVersion: ver(fixed.productVersionMS, fixed.productVersionLS),
                    fileFlags: fixed.fileFlags,
                    fileOS: fixed.fileOS,
                    fileType: fixed.fileType,
                }
                : null,
            strings,
            translations,
        };
    }

    function buildIcon(bytes, r, leavesForType) {
        const groups = leavesForType(14); // RT_GROUP_ICON
        if (!groups.length || groups[0].fileOffset < 0) return null;
        const go = groups[0].fileOffset;
        const count = r.u16(go + 4);
        if (!count) return null;

        const iconById = {};
        for (const ic of leavesForType(3)) iconById[ic.nameId] = ic; // RT_ICON

        const entries = [];
        for (let i = 0; i < count; i++) {
            const eo = go + 6 + i * 14;
            entries.push({
                width: r.u8(eo),
                height: r.u8(eo + 1),
                colorCount: r.u8(eo + 2),
                planes: r.u16(eo + 4),
                bitCount: r.u16(eo + 6),
                bytesInRes: r.u32(eo + 8),
                id: r.u16(eo + 12),
            });
        }
        // Prefer the largest, highest-depth icon we actually have bytes for (0 dimension = 256).
        entries.sort((a, b) => {
            const aw = a.width || 256, ah = a.height || 256, bw = b.width || 256, bh = b.height || 256;
            return (bw * bh - aw * ah) || (b.bitCount - a.bitCount);
        });
        const best = entries.find((e) => iconById[e.id] && iconById[e.id].fileOffset >= 0);
        if (!best) return null;

        const src = iconById[best.id];
        const img = bytes.subarray(src.fileOffset, src.fileOffset + src.size);

        // Wrap the single image in a minimal .ico (ICONDIR + one ICONDIRENTRY) — works for both
        // classic DIB and PNG-compressed (Vista+) icon payloads.
        const ico = new Uint8Array(22 + img.length);
        const dv = new DataView(ico.buffer);
        dv.setUint16(0, 0, true);
        dv.setUint16(2, 1, true);
        dv.setUint16(4, 1, true);
        ico[6] = best.width;
        ico[7] = best.height;
        ico[8] = best.colorCount;
        dv.setUint16(10, best.planes, true);
        dv.setUint16(12, best.bitCount, true);
        dv.setUint32(14, img.length, true);
        dv.setUint32(18, 22, true);
        ico.set(img, 22);

        let bin = "";
        for (let i = 0; i < ico.length; i++) bin += String.fromCharCode(ico[i]);
        return "data:image/x-icon;base64," + btoa(bin);
    }

    // ── imphash ─────────────────────────────────────────────────────────────────────────────

    function computeImphash(imports) {
        if (!imports || !imports.length || typeof global.md5hex !== "function") return null;
        const parts = [];
        for (const imp of imports) {
            let dll = (imp.dll || "").toLowerCase().replace(/\.(dll|ocx|sys|drv|cpl)$/i, "");
            for (const f of imp.functions) {
                const fn = f.name ? f.name.toLowerCase() : ("ord" + f.ordinal);
                parts.push(dll + "." + fn);
            }
        }
        if (!parts.length) return null;
        const str = parts.join(",");
        const buf = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i) & 0xff;
        return global.md5hex(buf);
    }

    global.PEParser = { parse };
})(window);
