# BT-025: Torrent viewer skeleton and content provider

## Status

**Status:** In Progress
**Priority:** High
**Board id:** `torrent-viewer`
**Epic:** [EPIC-114](../../../../persephone/doc/epics/EPIC-114.md)
**Started:** 2026-09-26

## Goal

Deliver the metadata-only torrent-viewer board skeleton and its `torrent/viewer` content provider:
the manifest, reproducible WebTorrent bundle, bounded module-service resolver, provider link format,
and bounded on-demand reads. The production two-pane UI remains US-1525.

## Background

- EPIC-114 decisions D1–D11 require metadata-only resolution, WebTorrent 3.0.21, an in-memory
  class-based store, TCP-only optional-native handling, forward-slash paths, and no `magnet`
  scheme claim until US-1525 lands D11.
- The board is trusted and scaffolded by Persephone; `board-base.css` and bridge wiring are kept.
- The service follows `_test/range-provider-test/scripts/service.mjs` for the parent-port
  init/probe/request/shutdown handshake. Board service requests are short, so metadata resolution
  is exposed as resolve/start plus polled status with a 30-second internal deadline.
- The provider is registered from the same service module. It restores cold links from their
  embedded magnet, reuses the existing resolver, never calls `file.select()`, and owns a bounded
  `createReadStream` iterator whose selection is destroyed on every completion, error, or abort.

## Implementation Plan

- [x] Fill `boards/torrent-viewer/board-manifest.json` with the service, declaration-only
      `torrent/viewer` provider contract, `torrent` scheme, `.torrent` mask, simple editor metadata,
      and catalog identity fields. Do not claim `magnet`, `guides`, or `screenshot`.
- [x] Add the pinned `package.json`, install lockfile, WebTorrent entry, esbuild build script,
      committed bundle, and third-party version/license notices under `lib/`.
- [x] Implement `scripts/service.mjs` with metadata resolution, deselection, normalized paths,
      four-job admission, 15-second no-poll cancellation, 30-second resolver timeout, result expiry,
      remove, complete shutdown cleanup, and the `torrent/viewer` stat/range/whole-file provider
      with self-contained link parsing, cancellation, active-reader accounting, and D1 cleanup.
- [x] Replace the starter proof page with an offline `index.html`/`app.js` resolve/status UI that
      can consume an editor-supplied `.torrent` path without opening or selecting the file.
- [x] Add board-specific `README.md` and `CLAUDE.md` documentation.
- [x] Run deterministic builds, syntax checks, and the throwaway Sintel resolver check. Live MCP
      verification belongs to the user and the later production tasks.

## Concerns / Open Questions

- `magnet` remains intentionally unclaimed. EPIC-114 D11 assigns the opaque-link editor routing
  change and the declaration to US-1525.
- `memory-chunk-store` has no eviction; RSS measurement while streaming belongs to epic acceptance
  and must not be replaced with disk storage here.
- The skeleton is not publishable until US-1525 or US-1527 supplies `WHATS-NEW.md`, `guides/`,
  and `screenshot.png`.

## Acceptance Criteria

- [ ] The exact WebTorrent bundle builds twice with identical hashes and includes D3's banner and
      four native-module externals.
- [ ] The service resolves the public Sintel magnet to metadata, normalizes paths, and reports all
      files deselected without selecting bytes, while the provider serves exact bounded ranges and
      whole-file buffers without disk writes.
- [ ] Service job limits, timeout, cancellation, result expiry, remove, and shutdown are bounded.
- [ ] The proof page uses only local assets and `persephone.service.request()`.
- [ ] No Persephone source, root catalog manifest, commit, or production torrent UI is added.

## Files Changed

| File | Change |
|------|--------|
| `boards/torrent-viewer/` | Manifest, WebTorrent build/runtime, proof page, provider service, and board docs. |
| `doc/tasks/BT-025-torrent-viewer-skeleton/README.md` | This board-repository task record. |
| `doc/active-work.md` | Active dashboard link. |

## Notes

The reviewed implementation plan is `C:/projects/persephone/doc/tasks/US-1523-torrent-board-skeleton/README.md`.
The live Persephone MCP verification in plan step 5 is intentionally left to the user.
The managed shell blocks esbuild's child service with `spawn EPERM`; the pinned native esbuild CLI
produced the same bundle twice with identical hashes, and the service syntax/direct resolver checks
passed.
