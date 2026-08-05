# BT-006: PDF Viewer board (.pdf)

## Status

**Status:** In Progress
**Priority:** High
**Board id:** `pdf-viewer`
**Started:** 2026-08-05
**Completed:**

Tracks the board side of Persephone's **EPIC-047** (move the built-in PDF viewer to a published
board). Persephone-side tasks (`US-904` … `US-911`) live in that repo; this task covers
`boards/pdf-viewer/`.

## Goal

Replace Persephone's built-in PDF editor with a board, so ~21 MB of vendored pdf.js leaves the
installer and PDF viewing becomes an opt-in catalog install.

## Background

- The built-in editor is thin: its view is an `<object>` pointing at pdf.js's stock
  `viewer.html`, served over Persephone's `app-asset://` scheme. The user-visible viewer is
  entirely pdf.js's, not Persephone's — so the board should host the **same stock viewer**, not
  reimplement one.
- Precedent for a binary-file custom editor: `boards/excel-viewer/` and `boards/pe-viewer/`
  (`editorKind: "simple"` + `persephone.readFile(path, { encoding: "base64" })`).
- Library: **pdf.js 5.4.530**, Apache-2.0. Vendored from Persephone's own pruned `assets/pdfjs/`
  copy (~11 MB after pruning; see `boards/pdf-viewer/lib/VERSION.txt`).
- This is the first board to need a **nested iframe**, a **Worker**, and **WebAssembly** inside the
  board sandbox, so v1 doubled as the CSP spike.

## Implementation Plan

- [x] Scaffold `boards/pdf-viewer/` with `create_board`
- [x] Vendor pruned pdf.js into `lib/pdfjs/` + `lib/VERSION.txt` (license, version, prune record)
- [x] `index.html` — full-bleed iframe + status overlay
- [x] `app.js` — `getFilePath()` → `readFile(base64)` → `PDFViewerApplication.open({ data })`
- [x] Capability probes (frame-src / worker-src / wasm) surfaced in the overlay
- [x] `board-manifest.json` — `fileMasks: ["*.pdf"]`, `editorKind: "simple"`, `editorPriority: 200`
- [x] `icon.svg`, `WHATS-NEW.md`, board `CLAUDE.md`
- [x] Non-local sources (archive entries, `https`) — `editorSources: "any"` + reject handling; the
      Persephone side landed in `US-907` (materialize → local path, not a binary content host)
- [x] Publish 1.0.0 to the catalog (`US-910`)
- [x] Full parity pass against the built-in viewer (`US-909`)
- [x] Drop `editorPriority` from 200 once the built-in PDF editor is removed (`US-911`) — staged
      unreleased on `develop`, NOT a version bump

## Concerns / Open Questions

- **`editorPriority` is 200 in the published 1.0.0, and it stays that way.** The built-in claimed
  `.pdf` at 100 and ties go to the built-in, so anything ≤ 100 would have installed and then never
  opened a PDF — lowering it before the built-in was removed would have broken the published board.
  Now that Persephone's `US-911` has removed the built-in editor, nothing built-in claims `.pdf`, so
  **200 keeps working indefinitely** (it clears Monaco's `0` floor and has no tie to lose). The drop to
  100 is therefore ladder hygiene only — squatting the top `category` tier leaves no room for another
  board to claim `.pdf` — and is **committed to `develop` without a version bump or a publish**. It
  ships with whatever the board's next functional release turns out to be. Publishing it alone would
  spend a version number and an update prompt for no observable change, and would reintroduce a
  `minAppVersion` sequencing constraint that not publishing avoids.
- ~~**Non-local sources are the one real functional gap.**~~ **Closed.** Not a binary content host in
  the end: Persephone materializes a non-local source into a temp cache file and `getFilePath()`
  returns that path, so all three source kinds arrive through the board's existing code path. The
  board's whole contribution is one manifest field (`editorSources: "any"`, without which Persephone
  refuses to offer a non-local source to a simple board) plus handling a `getFilePath()` **rejection**
  — a failure mode that did not exist while it was local-only.
- ~~**Print and Save-as from inside a `board://` frame are unverified.**~~ **Closed — both work.**
  Confirmed by the parity pass; no bridge support and no CSP change were needed.
- **The viewer does not follow Persephone's theme** — it keeps pdf.js's own light/dark styling.
  Acceptable, or a later restyle over the `--p-*` palette.

## Acceptance Criteria

- [x] Opens a local `.pdf` and renders it via the stock viewer
- [x] Page navigation, zoom, thumbnails sidebar, and in-document search work
- [x] Text layer intact (selection/extraction)
- [x] Real pdf.js Worker in use (no "fake worker" fallback)
- [x] `ui.log` is clean (no CSP violations)
- [x] Fully offline (no CDN / network)
- [x] Archive-embedded and remote PDFs work
- [x] Print and Save-as verified

## Files Changed

| File | Change |
|------|--------|
| `boards/pdf-viewer/board-manifest.json` | New — identity + `*.pdf` association at priority 200, `editorSources: "any"` |
| `boards/pdf-viewer/index.html` | New — iframe + status/diagnostics overlay |
| `boards/pdf-viewer/app.js` | New — bytes → `PDFViewerApplication.open`, capability probes |
| `boards/pdf-viewer/lib/pdfjs/` | New — vendored pdf.js 5.4.530 (pruned, ~11 MB) |
| `boards/pdf-viewer/lib/VERSION.txt` | New — version, license pointer, prune record |
| `boards/pdf-viewer/icon.svg` | New |
| `boards/pdf-viewer/CLAUDE.md` | Rewritten — board-specific notes |
| `boards/pdf-viewer/WHATS-NEW.md` | New — 1.0.0 |

## Notes

### 2026-08-05 — CSP spike result (the point of v1)

Measured on Persephone 4.0.18 by probing from inside the board frame:

| Capability | Directive | Before | After |
|---|---|---|---|
| Nested iframe | `frame-src` | **blocked** (frame ended at `chrome-error://chromewebdata/`) | works |
| pdf.js Worker | `worker-src` | **already worked** | works |
| WebAssembly | `script-src 'wasm-unsafe-eval'` | **blocked** | works |

- The Worker was permitted all along: `worker-src` falls back through `child-src` to
  `script-src 'self'`, which the board CSP already granted. Verified by round-tripping a message
  from `pdf.worker.mjs`, not just by constructing it.
- `frame-src 'self'` and `'wasm-unsafe-eval'` were added to Persephone's `BOARD_CSP`
  (`src/main/board-protocol-service.ts`) — both same-origin only, no remote content admitted.
  `worker-src 'self'` was also stated explicitly so the fallback can't silently break.
- Hence `minAppVersion: 4.0.18`.

### Design decisions

- **Bytes are handed to the viewer directly** via `contentWindow.PDFViewerApplication.open({ data })`
  rather than a `blob:` URL — the nested frame is same-origin, and a blob URL would need
  `connect-src blob:`, which the CSP does not grant.
- **The iframe is loaded with an empty `?file=`.** The stock viewer does
  `file = params.get("file") ?? defaultUrl` then `if (file) this.open(...)`, so an empty value
  suppresses its auto-open — necessary because the vendored copy has pdf.js's sample document
  pruned out.

### Gotchas discovered

- `app.editors.resolveId("x.pdf")` returns the **built-in** id even when the board wins the file;
  that call only consults the built-in registry. Confirm association via `list_pages` →
  `editor: "board-editor:<root>"`.
- The `board://` handler injects the theme + shim into **every** served `.html`, including the
  vendored `viewer.html`. Harmless, but the shim's context menu replaces pdf.js's own inside the
  viewer frame.
- pdf.js internals are not stable across versions: `PDFViewerApplication.pdfSidebar` and
  `pdfDocument._transport._worker` don't exist under those names in 5.4.530. Drive the viewer via
  `eventBus` and documented methods.
- Transport cost is negligible — a 1 MB PDF took 5 ms to read over the bridge + 5 ms to decode
  (1.33x base64 inflation). Relevant to the app-side Push-vs-Serve choice for the binary host: the
  argument for streaming rests on memory, not speed.

### 2026-08-05 — all three source kinds (Persephone `US-908`)

Persephone's `US-907` shipped as *materialize to a temp file*, not as a binary content host, so the
board needed almost nothing: `editorSources: "any"` in the manifest, and a `try/catch` around
`getFilePath()` because that call can now reject. Two smaller changes followed from the new timing —
the viewer frame is loaded **in parallel** with `getFilePath()` (which for a remote PDF completes only
after the whole download), and an "Opening…" status covers that window so a remote open is not a
blank frame.

Verified live, one board code path for all three:

| Source | Resolved target | Result |
|---|---|---|
| `_test/sample.pdf` | `board-editor:<root>` | 14 pages, overlay hidden |
| `_test/pdfs.zip!sample.pdf` | `board-editor:<root>` | 14 pages, overlay hidden |
| `https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf` | `board-editor:<root>` | 14 pages, overlay hidden |
| `_test/pdfs.zip!missing.pdf` | `board-editor:<root>` | "Could not read the document — File not found in archive: missing.pdf" |

`ui.log` clean on the three successes; the failure case logs exactly one error, which is the point.

Gotcha worth remembering for testing: `app.pages.openFile` **dedupes** to an existing tab, and a
manifest edit does not take effect on board reload (Persephone caches manifests until a trust change
or restart). Both cost real time during this task. Also `app.openRawLink(linkData)` did nothing from a
script — the working call is `app.events.openRawLink.sendAsync(io.createLinkData(href))`.

### 2026-08-05 — published 1.0.0 (Persephone `US-910`)

`pdf-viewer-v1.0.0` is live: 3.5 MB ZIP from an 11 MB folder, sha256-verified, and the catalog +
`versions-manifest.json` entries were machine-written by the publish workflow as designed.

Published **ahead of Persephone 4.0.18's own release**, deliberately. The board needs `frame-src` /
`wasm-unsafe-eval` in `BOARD_CSP` and the `editorSources` gate, none of which have shipped, so
`isCompatible` keeps it uninstallable until 4.0.18 goes out — at which point it becomes available
with no further action here.

Worth knowing: the publish script writes a **fixed field set** into `boards-manifest.json`, so
`editorSources` and `editorPriority` do **not** appear in the catalog entry. They travel inside the
release ZIP's own `board-manifest.json`, which is what Persephone's custom-editor registry actually
reads, so nothing is lost — but don't go looking for them in the catalog.

The icon was changed from `currentColor` to fixed Acrobat red (`#E5252A`) before publishing: it was
the only board icon still inheriting the text color, so it rendered black-on-black in dark mode.

### 2026-08-05 — parity confirmed (Persephone `US-909`)

Verified against the built-in viewer over the epic's parity checklist. Everything matches, including
the two items that were open questions rather than expectations: **print** and **Save-as** from inside
the `board://` frame both work as they do in the built-in editor — no bridge support, no CSP change.

The board is functionally complete at 1.0.0. The only outstanding item is the `editorPriority` drop,
which is blocked on Persephone's `US-911` removing the built-in editor.
