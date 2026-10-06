# BT-031: Certificate Viewer claims `certificate.view` and renders a chain from the request payload

## Status

**Status:** Done  
**Priority:** High  
**Board id:** `cert-viewer`  
**Started:** 2026-10-06  
**Completed:** 2026-10-06

## Goal

Have Certificate Viewer claim Persephone's `certificate.view` v1 capability and render the host-provided DER chain in the request's leaf-first order. Preserve that payload chain in per-page state so the capability page restores after an app restart, while keeping the existing file-opening path intact.

## Background

- **Binding platform contract:** `C:/projects/persephone/doc/epics/EPIC-122.md` D1 declares `{ id: "certificate.view", version: 1, alwaysOpensNewPage: true, title: "View certificate" }` (lines 42–49). D2 defines `title: string`, `certificates: string[]` as base64 DER leaf-first, and optional `source: { url: string }` (lines 51–63). D5 specifies PEM fallback when no handler exists, not board behavior (lines 83–89). D7 assigns payload rendering and `persephone.pageState` restore to this board (lines 97–103); D8 keeps `minAppVersion: "5.0.8"` (lines 105–109).
- **Final platform payload and validation:** `C:/projects/persephone/doc/tasks/US-1628-certificate-view/README.md` lines 15–27 records the final v1 payload, non-empty title and certificate list, valid canonical base64 decoding to DER beginning with `0x30`, optional string `source.url`, and 256 KiB decoded-chain cap. The host enforces these checks; the board still validates request shape and reports parser/decode failures because it owns its handler boundary. US-1628 lines 13 and 65 confirm that `permissions.capabilities` is disclosure only and that no bridge API addition is needed.
- **Current manifest:** `boards/cert-viewer/board-manifest.json:7–21` has version `1.0.0`, `minAppVersion: "5.0.8"`, `minBridgeVersion: "1.32.0"`, and all permission flags false. BT-030 landed as commit `c36281c` on `develop`; D7 records that this `1.0.0` board is unpublished and will be published once the Persephone capability ships (EPIC-122 lines 100–103). Keep the version at `1.0.0` and extend its existing `WHATS-NEW.md` entry; do not create an unreleased `1.1.0` version. Raise only `minBridgeVersion` to `1.34.0`, because `persephone.pageState` requires it (generic board guide `boards.md:902–910`; agent guide `agents/boards.md:1008–1017`).
- **Permissions:** The manifest capability array registers a handler. `permissions.capabilities` is disclosure only, and incoming `persephone.intent` handling does not require `appScripting`; no permission grant or disclosure change is needed. The generic reference distinguishes the manifest declaration from `appScripting`, which gates board-originated `persephone.call()` and capability invocation (`board-template/CLAUDE.md:247–285`; `agents/boards.md:614–639`). Preserve the current all-false object.
- **Capability precedent:** The bundled REST Client manifest uses priority `50` for `http.request.open`, with version `1`, title, and `alwaysOpensNewPage: true` (`C:/projects/persephone/assets/boards/rest-client/board-manifest.json:28–35`). Its handler validates `intent.id`, `intent.version`, and payload (`src/rest-client-model.js:90–122`); `src/main.js:81–98` registers `onRequest`, handles `get()`'s initial request, de-duplicates by `requestId`, resolves with no value on success, and rejects errors. Follow that pattern and settle each request exactly once.
- **Intent lifetime and restore:** Intents are delivered once and are not replayed on a restored page; the board must copy the small payload into page state before resolving it (`assets/guides/boards.md:421–429, 464–468`; `board-template/CLAUDE.md:317–322`). `pageState` stores strings, needs no filesystem permission, is page-scoped, and survives app restart (`assets/guides/boards.md:902–922`). One JSON value containing title, base64 certificates, and optional source URL is only a few KB, well below the 10 MiB value limit.
- **Parser handoff:** `boards/cert-viewer/cert-parser.js:272–305` has the normalized record builder `makeRecord`; `parseDer` at lines 461–475 builds one DER record. The general `parse()` path calls `orderCerts()` on multi-certificate inputs (`cert-parser.js:768–789`), so do not feed the payload as a bundle through that path: its order is already leaf-first and host order must be preserved. Add a small chain entry point that builds each record from its decoded `Uint8Array` in array order without calling `orderCerts`.
- **Existing file path and UI:** `app.js:474–511` gets `persephone.getFilePath()`, reads the exact hosted file, parses it, then calls `install()`. An empty path currently means the no-file state (`app.js:484–489`). Choose source precedence explicitly: **intent > file path > pageState > empty state**. A capability-created page has no file path and is distinguished from an ordinary empty page by the accepted intent or its saved payload state. The existing Reload toolbar and summary status bar are declared at `app.js:525–545`; preserve the host toolbar/status-bar convention documented in `boards/cert-viewer/CLAUDE.md:35–36`.
- **Agent access:** `boards/cert-viewer/app.js` currently contains no `persephone.aiVision` exposure. Adding an AiVision model is out of scope; note the limitation in the updated board notes.

## Implementation Plan

- [x] **Declare the handler and minimum bridge.** In `boards/cert-viewer/board-manifest.json`, add a `capabilities` entry with `id: "certificate.view"`, `version: 1`, `title: "View certificate"`, `priority: 50` (matching REST Client), and `alwaysOpensNewPage: true`. Set `minBridgeVersion` to `"1.34.0"` for page state. Keep `minAppVersion: "5.0.8"`, board version `1.0.0`, and the all-false permissions object; do not add `permissions.capabilities` or `appScripting`.
- [x] **Add an ordered DER-chain parser entry point.** In `boards/cert-viewer/cert-parser.js`, expose a helper (for example `parseCertificateChain(certificates, sourceName)`) that accepts decoded `Uint8Array` DER entries, calls the existing record builder for each entry, and returns the same normalized data shape expected by `install()`. Validate each result as a certificate and preserve input indexes. Do not run `orderCerts`: the capability contract is already leaf-first, including for chains whose issuer names look ambiguous. Keep `parseDer()` and the existing PEM/DER/PFX/PKCS#7 file behavior unchanged.
- [x] **Handle and settle intents in `boards/cert-viewer/app.js`.** Register `persephone.intent.onRequest(handler)` and also process `persephone.intent.get()` for the initial page-open handshake; de-duplicate the overlap by `requestId` as REST Client does. Require `id === "certificate.view"`, `version === 1`, a non-array object payload, a non-empty string `title`, a non-empty `certificates` array of base64 strings, and when present an object `source` with string `url`. Decode each base64 item to its exact `Uint8Array`, parse in payload order, and surface a clear per-request error for invalid input or DER. On success, persist the accepted chain and render it before calling `request.resolve()` with no result. On failure, call `request.reject()` with a useful message; never leave a request unsettled.
- [x] **Persist and restore capability page data.** Store a JSON object under one `persephone.pageState` key (for example `certificate-chain`) with `title`, the original `certificates` base64 array, and optional `sourceUrl`. Keep the base64 strings as the durable source so fingerprints use the exact DER after restore. During startup apply the precedence **intent > file path > pageState > empty state**. A file path continues through the current reader even if stale page state exists. With no intent and no file path, validate and restore the stored payload; if state is absent or malformed, show the existing empty/no-file state. No file APIs, network calls, or PEM reconstruction are needed for restore.
- [x] **Render payload context and keep Reload useful.** Use the existing report header and overview UI: title/header text identifies a site certificate and its `title`; the host status summary reads `Site certificate · <count> certificates · <title>` (singularize one certificate). When `source.url` exists, show an “Opened from” row as plain text, using the board's text-node rendering. Do not fetch the URL. Keep the existing descriptive-only scope note and theme styling rules (host toolbar/status bar, no panel fills, no text below 12px). For a payload page, Reload re-reads the stored chain value and re-parses/renders it; for a file page it retains the existing file reload behavior.
- [x] **Update board notes and changelog.** In `boards/cert-viewer/CLAUDE.md`, document the capability payload path, page-state restore, source precedence, `minBridgeVersion` 1.34.0, and the absence of AiVision exposure. Extend the current `## 1.0.0` entry in `boards/cert-viewer/WHATS-NEW.md` with the capability view feature; do not bump the unpublished board version.
- [x] **Reviewer live verification in Persephone (no unit tests).** After US-1628 lands, invoke `app.capabilities.invoke("certificate.view", { title, certificates, source })` with a chain from `_test/cert-viewer/chain.pem` converted to base64 DER entries. Confirm the capability opens a fresh no-file page, preserves leaf-first display order, shows the certificate count/title and source URL, and Reload renders from saved payload state. Open the same action from the browser site-info popover. Restart Persephone and confirm the capability page restores. Invoke with a bad payload and confirm the caller receives a clear rejection; also check `ui.log` for bridge/parser errors. No test files or automated tests are planned.

## Concerns / Open Questions

- **No unresolved contract questions.** US-1628 lines 15–27 makes the D2 payload and validation rules final. The browser host enforces the 256 KiB cap; the board independently checks structure, base64 decoding, and parser success.
- **Page state version gate:** `minBridgeVersion` must rise to 1.34.0 for `pageState`, despite the capability intent API itself requiring no new bridge version. The platform bridge and `minAppVersion` remain unchanged.
- **Order is contract data:** preserve the request's array order and do not call the file parser's best-effort ordering step on the capability chain. This is how the platform guarantees leaf-first display.
- **AiVision:** no model is currently exposed by Certificate Viewer; adding one is explicitly out of scope for BT-031.
- **Fixture note:** `_test/cert-viewer/` is a repo-only ignored fixture directory; its local `chain.pem` and generator are already present for reviewer use and are not board release files.

## Acceptance Criteria

- [x] Manifest declares `certificate.view` v1 with title, priority 50, and `alwaysOpensNewPage: true`; `minBridgeVersion` is 1.34.0, `minAppVersion` remains 5.0.8, board version remains 1.0.0, and permissions stay all false.
- [x] Valid payloads decode and render certificate records in the exact payload order with their original DER bytes; malformed id/version/payload/base64/DER requests reject with a clear reason, and all requests settle.
- [x] Startup precedence is intent, file path, page state, then empty state. Existing file opening is unchanged; a capability page with no file restores after app restart from its per-page saved chain.
- [x] Payload pages show `Site certificate · <count> certificates · <title>`, a site certificate title/header, and the optional source URL as plain text without network access. Reload re-renders the saved payload chain.
- [x] Existing host toolbar/status bar and styling rules remain in force; certificate data is rendered with text nodes, no panel fills, and no text below 12px.
- [x] Updated board notes/changelog describe the feature; the unpublished board stays at 1.0.0. No AiVision model, permissions, unit tests, or network access are added.
- [x] Reviewer completes live MCP invocation, browser popover, restart restore, and bad-payload rejection checks; `ui.log` has no bridge/parser errors.
- [x] Fully offline (no CDN / network).

## Files Changed

| File | Change |
|------|--------|
| `boards/cert-viewer/board-manifest.json` | Update minimum bridge to 1.34.0; declare `certificate.view` v1 at priority 50 with `alwaysOpensNewPage`; keep board version, app minimum, and false permissions. |
| `boards/cert-viewer/app.js` | Add intent validation/settlement, precedence and restore flow, payload context rendering, source URL text, and payload-aware Reload. |
| `boards/cert-viewer/cert-parser.js` | Add an ordered chain parser using the existing DER record builder without bundle reordering. |
| `boards/cert-viewer/CLAUDE.md` | Document capability handling, page-state restore, version requirement, source precedence, and AiVision scope. |
| `boards/cert-viewer/WHATS-NEW.md` | Extend the unpublished `1.0.0` entry for `certificate.view` support. |
| `doc/active-work.md` | Link BT-031 under Active (tracking update made with this task document). |
| `doc/tasks/BT-031-cert-viewer-capability/README.md` | Add this implementation-ready board task and verified findings. |

## Notes

- Accepted intents are delivered once and are not persisted by the platform. The board's one page-state value is the restore source; file pages continue to use `getFilePath()` and `readFile()`.
- Capability resolution is page-backed and occurs in the caller's window. `alwaysOpensNewPage` ensures each certificate request has an independent page and page-state namespace.
- Successful settlement has no meaningful return value; match REST Client's `request.resolve()` behavior. Invalid requests use request-bound `request.reject(reason)`.
- Keep the feature descriptive and offline. Displaying the Chromium-provided chain does not validate signatures, trust, or revocation.
- Live verification (2026-10-06): the browser popover opened a new board page titled with the host, showing the real `*.github.io` chain leaf first with the source URL and the `Site certificate · 4 certificates · <host>` summary; a frame reload and an app restart both restored it from page state; a file-opened page is unchanged. Reviewer change: the "Order is best-effort" sidebar note is hidden for a capability page, because a browser-sent chain is in Chromium's own order. The tab title needed a platform fix in Persephone (US-1628 notes).
