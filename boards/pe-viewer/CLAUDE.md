# PE Viewer — board notes

A Persephone **simple custom-editor board**: a read-only inspector for Windows **PE (Portable
Executable)** binaries — `.exe`, `.dll`, `.sys`, `.ocx`, `.scr`. Persephone hands the board a file
**path**; the board reads the bytes itself, parses the PE structure **entirely in offline JS**
(no network, no CDN), and renders a tabbed report. There is no write path.

> New here? The generic Persephone board authoring reference (the `persephone.*` bridge, the
> `--p-*` theme contract, CSP rules, reload/test flow) is available any time via the
> **`read_guide("boards")`** MCP tool and the bundled Demo board. This file documents only what's
> specific to *this* board.

## Purpose

Persephone opens this board as the default editor for PE files. The manifest associates it:
`fileMasks: ["*.exe","*.dll","*.sys","*.ocx","*.scr"]`, `editorName: "PE Viewer"`,
`editorKind: "simple"` (the board gets a **path**, reads the bytes itself), and
`editorPriority: 100` (PE extensions aren't claimed by any built-in editor — only Monaco at
priority 0 — so any positive priority wins; 100 is used for consistency with the other viewers).
Opened plainly (no file) it shows an empty-state message.

## How it works

1. `app.js` `load()` calls `persephone.getFilePath()`. Empty → empty-state overlay. Otherwise it
   reads the file with `persephone.readFile(path, { encoding: "base64" })`, decodes to a
   `Uint8Array`, parses it with `window.PEParser.parse(bytes)`, and computes hashes.
2. **Tabs** are built from the parsed result: **Overview · Headers · Sections · Imports · Exports ·
   Signature · Hashes · Details**. Clicking a tab renders that panel (`selectTab` → `def.render()`);
   panels are built lazily on selection.
3. **Read-only, no content host.** The only re-render triggers are the toolbar **Reload** button
   and the `board_refresh` MCP tool (which re-runs `app.js`). `load()` degrades to an error overlay
   + `notify(..., "error")` on a parse failure rather than crashing.

## What it extracts (`pe-parser.js`)

A single hand-rolled parser (~600 lines) over a `DataView`, with every optional sub-structure
wrapped in `safe()` so a malformed part degrades that one field instead of failing the whole parse:

- **Headers** — DOS/COFF/optional header, machine, subsystem, entry point, image base, timestamps,
  characteristic + DLL-characteristic flags, and the data directories.
- **Sections** — virtual/raw sizes, R/W/X + CODE permission flags, and per-section **Shannon
  entropy** (a packing indicator).
- **Imports** (per-DLL, incl. ordinal imports) and **Exports** (named, with ordinals/RVAs).
- **Resources** — version-info string table + `VS_FIXEDFILEINFO`, the embedded **icon** (rebuilt
  into a displayable `.ico` data URL), and the **application manifest** (XML).
- **Digital signature** — Authenticode presence, cert type/revision/size, and a **best-effort**
  scan of the PKCS#7 blob for X.500 commonNames (publisher + CA chain — *not* a validity check).
- **Debug** — CodeView **PDB path** + age.
- **.NET** — CLR-header detection + runtime version.
- **Rich header** — the XOR-decoded MSVC toolchain (product id / build / count) provenance.
- **Hashes** — MD5, SHA-1, SHA-256 (file) and **imphash** (import-table fingerprint).
- **Packer hints** — known packer section names (UPX, ASPack, Themida, VMProtect, …) +
  high-entropy-executable-section detection.

## Key files

| File | Role |
|------|------|
| `index.html` | Page shell: top bar (file name + Reload) · tab strip · content panel · state overlay. All board-specific CSS lives here (cards, chips, kv/data tables, entropy meters, imports accordion). Loads `lib/md5.js` → `pe-parser.js` → `app.js`. |
| `app.js` | UI: `load()` (path → bytes → parse → hashes), the tab registry + `selectTab`, per-tab `build*()` renderers, and small DOM helpers (`el`, `kv`, `table`, `chip`). Renders untrusted strings via text nodes (no injection). |
| `pe-parser.js` | The offline PE parser — `window.PEParser.parse(bytes)` → the structured object above. |
| `lib/md5.js` | Vendored compact MD5 (RFC 1321) — Web Crypto has no MD5; needed for the **imphash** and the file MD5. SHA-1/SHA-256 use `crypto.subtle`. |
| `board-manifest.json` | Custom-editor association (`fileMasks`, `editorPriority: 100`, `editorKind: "simple"`). |
| `board-base.css` | Shared Persephone board theme defaults (don't recreate). |
| `icon.svg` | Board icon (chip glyph). |
| `WHATS-NEW.md` | Short human changelog. Record changes under the next version's heading. |

## Run & test

- Open any `.exe` / `.dll` / `.sys` / `.ocx` / `.scr` in Persephone → it opens in this board by
  default; the "PE Viewer" ↔ built-in switch is in the page toolbar.
- After editing board files, reload with the in-board **Reload** button or `board_refresh` (MCP).
  Iterate: edit → `board_refresh` → drive with `browser_*`.
- **Automated render test without an association:** monkeypatch the path, then re-run `load()`:
  ```js
  persephone.getFilePath = async () => "C:\\Windows\\explorer.exe"; await load();
  ```
  (`load` and the `build*` helpers are globals — `app.js` is a classic script, not a module.)
- Good coverage set: `kernel32.dll` (many exports/imports, signed, PE32+), `explorer.exe` (icon +
  manifest + version + rich header + PDB), `notepad.exe` (unsigned — catalog-signed, so no embedded
  sig), `SysWOW64\kernel32.dll` (PE32 32-bit), a **.NET** assembly (CLR detection). `ui.log` should
  stay clean (no CSP).

## Gotchas (the non-obvious decisions)

- **Two byte-offset traps bit v1 during development** (both fixed — keep them in mind if extending):
  - `NumberOfRvaAndSizes` sits after LoaderFlags (**uint32**, not 8 bytes). Miscounting it shifts
    the whole **data-directory array** → imports/exports/resources/debug all read garbage RVAs while
    headers/sections still look fine. Offset: `p + 40 + (isPlus?32:16) + 4`.
  - Section **Characteristics** is at section-header offset **`+36`** (after the two count words),
    not `+24` (`+24` is `PointerToRelocations`) — wrong offset makes every section show no R/W/X.
- **The Certificate directory's RVA is a FILE OFFSET**, not an RVA — don't run it through
  `rvaToOffset` (see `parseSignature`).
- **Signature name extraction is best-effort**, not validation. It regex-scans the PKCS#7 blob for
  the commonName OID (`06 03 55 04 03`) and reads the following ASN.1 string; it surfaces the
  publisher plus CA-chain names but performs **no** cryptographic/chain-validity check. Labelled as
  such in the UI. A catalog-signed file (e.g. modern `notepad.exe`) has **no embedded** signature
  and correctly shows "Unsigned" — that's not the same as untrusted.
- **CSP forbids remote network.** MD5 is vendored under `lib/`; SHA uses the frame's `crypto.subtle`
  (a secure context here). If `crypto.subtle` were ever unavailable, SHA fields degrade to "—" while
  MD5/imphash still work.
- **Large binaries (100s of MB, e.g. an Electron `.exe`) must not freeze the frame.** Three things
  make this work (all in `app.js`): (1) **fast base64 decode** — a plain indexed `charCodeAt` loop
  (`decodeBase64`), NOT `Uint8Array.from(atob(b64), fn)` which invokes the callback per element via
  the iterator protocol and takes *minutes* / hangs on a 200 MB file (this was the original "Loading…
  then gray forever" bug). (2) **Render structure first, hash after a paint** — parsing only reads
  headers/tables so it's fast; `load()` renders all tabs, then `await requestAnimationFrame` and
  computes hashes, filling them in (Overview/Hashes re-render; hash cells show "computing…" meanwhile
  via `hashCell`). (3) **Skip the pure-JS full-file MD5 above `MD5_MAX_BYTES` (96 MB)** — it blocks
  the main thread; SHA-1/SHA-256 stay because `crypto.subtle` is native + off-thread. The Hashes/
  Overview show "skipped (large file)" for MD5 in that case; imphash (a tiny MD5) is unaffected.
- **Icon rebuild:** the RT_ICON payload (DIB *or* PNG) is wrapped in a minimal one-image `.ico`
  (ICONDIR + one ICONDIRENTRY) and shown as a `data:image/x-icon` URL — works for both classic and
  Vista+ PNG icons.
- **Editing the manifest doesn't refresh the association live.** The custom-editor registry re-reads
  manifests on a **trust change** (or app restart). After changing `fileMasks`/`editorPriority`,
  re-trust the board (`unregisterBoard` + `registerBoard`) or restart, or the old manifest sticks.
- **Read-only.** No write path; switch to a built-in editor to edit (you won't — these are binaries).

## Reference

- Generic board API (`persephone.*`, `--p-*`, CSP, reload/test): **`read_guide("boards")`**.
- PE/COFF format: Microsoft PE format spec (field-offset tables for COFF/optional headers, data
  directories, section headers, import/export/resource/debug directories, `WIN_CERTIFICATE`).
