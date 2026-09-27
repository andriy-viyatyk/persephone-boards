# BT-025: Torrent viewer skeleton, provider, production page, lifecycle, and browser URL sources

## Status

**Status:** Completed (2026-09-27, with EPIC-114)
**Priority:** High
**Board id:** `torrent-viewer`
**Epic:** [EPIC-114](../../../../persephone/doc/epics/EPIC-114.md)
**Started:** 2026-09-26

## Goal

Deliver the torrent-viewer board and its `torrent/viewer` content provider: the manifest,
reproducible WebTorrent bundle, bounded module-service resolver, provider link format, bounded
on-demand reads, shared service snapshot inventory, and the EPIC-114 production two-pane page from
US-1525.

## Background

- EPIC-114 decisions D1–D11 require metadata-only resolution, WebTorrent 3.0.21, an in-memory
  class-based store, TCP-only optional-native handling, forward-slash paths, and no `magnet`
  scheme claim until US-1525 lands D11.
- The board is trusted and scaffolded by Persephone; `board-base.css` and bridge wiring are kept.
- US-1529 extends the board-frame bridge with read-only `persephone.service.status()`; this board
  requires bridge `1.16.0` and uses status before snapshot polling.
- The service follows `_test/range-provider-test/scripts/service.mjs` for the parent-port
  init/probe/request/shutdown handshake. Board service requests are short, so metadata resolution
  is exposed as resolve/start plus polled status with a 30-second internal deadline and a
  45-second no-poll grace period.
- The provider is registered from the same service module. It restores cold links from their
  embedded magnet, reuses the existing resolver, never calls `file.select()`, and owns a bounded
  `createReadStream` iterator whose selection is destroyed on every completion, error, or abort.

## Implementation Plan

- [x] Fill `boards/torrent-viewer/board-manifest.json` with the service, declaration-only
      `torrent/viewer` provider contract, `torrent` and `magnet` schemes, `.torrent` mask, simple
      editor metadata, catalog identity fields, and the required bridge version.
- [x] Add the pinned `package.json`, install lockfile, WebTorrent entry, esbuild build script,
      committed bundle, and third-party version/license notices under `lib/`.
- [x] Implement `scripts/service.mjs` with metadata resolution, deselection, normalized paths,
      four-job admission, 45-second no-poll cancellation, 30-second resolver timeout, result expiry,
      remove, complete shutdown cleanup, and the `torrent/viewer` stat/range/whole-file provider
      with self-contained link parsing, cancellation, active-reader accounting, and D1 cleanup.
- [x] Replace the starter proof page with the themed two-pane `index.html`/`app.js` page: shared
      torrents, metadata-only status dots, sorted files, exact self-contained links, menus, and
      the explicit save action with its size-first/dialog-first ordering.
- [x] Extend service metadata with the canonical magnet URI so `.torrent` sources produce D5 links.
- [x] Update the board README, pending `1.1.0` changelog, bridge requirement, and dashboard
      record for the production page.
- [x] Add board-specific `README.md` and `CLAUDE.md` documentation.
- [x] Run deterministic builds, syntax checks, and the throwaway Sintel resolver check. Live MCP
      verification belongs to the user and the later production tasks.
- [x] Apply the reviewed US-1526 lifecycle changes: derive the no-poll watchdog from the metadata
      bound, translate known failure reasons, provide manual retry, refuse removal with active readers,
      and stop only after an explicit last remove has a fresh empty snapshot.
- [x] Keep service lifetime independent of page teardown and update the board's bridge requirement and
      lifecycle documentation.
- [x] Add D12's independent browser URL masks, read claimed HTTP(S) `.torrent` sources through the
      board content pipe into memory, and feed the bytes through the existing resolver with the
      existing legible reason mapping.
- [x] Apply US-1529's shared service snapshot model: ready metadata includes only canonical magnet
      and normalized `{ path, length, index }` file descriptors; active and TTL-retained terminal
      jobs reconcile into rows; page-local selection/stall state and own-job notification ownership
      remain local.

## Concerns / Open Questions

- The `magnet` scheme is claimed with the D11-aware bridge: `getSourceUrl()` supplies the raw
  persisted source without materialization, and the manifest requires bridge `1.16.0` for the added
  `service.stop()` call.
- `memory-chunk-store` has no eviction; RSS measurement while streaming belongs to epic acceptance
  and must not be replaced with disk storage here.
- The board is not publishable until the release documentation pass supplies `guides/` and
  `screenshot.png`.
- `minBridgeVersion` is now `1.16.0`: the board uses the read-only service status API to avoid
  starting a stopped service merely to render an empty list.

## Acceptance Criteria

- [ ] The exact WebTorrent bundle builds twice with identical hashes and includes D3's banner and
      four native-module externals.
- [ ] The service resolves the public Sintel magnet to metadata, normalizes paths, and reports all
      files deselected without selecting bytes, while the provider serves exact bounded ranges and
      whole-file buffers without disk writes.
- [ ] Service job limits, timeout, cancellation, result expiry, remove, and shutdown are bounded.
- [ ] The production page uses only local assets and board bridge/service APIs; no render path
      selects a file or reads a range, and the claimed URL path reads only through the board
      content pipe.
- [ ] No Persephone source, root catalog manifest, commit, or unrelated platform change is added.

## Files Changed

| File | Change |
|------|--------|
| `boards/torrent-viewer/` | Manifest, WebTorrent build/runtime, production two-pane page, provider service, browser URL source handling, and board docs. |
| `doc/tasks/BT-025-torrent-viewer-skeleton/README.md` | This board-repository task record. |
| `doc/active-work.md` | Active dashboard link. |

The lifecycle follow-up also changes `boards/torrent-viewer/app.js`,
`boards/torrent-viewer/scripts/service.mjs`, `boards/torrent-viewer/board-manifest.json`,
`boards/torrent-viewer/WHATS-NEW.md`, and `boards/torrent-viewer/README.md`.

## Notes

The reviewed implementation plan is `C:/projects/persephone/doc/tasks/US-1523-torrent-board-skeleton/README.md`.
The live Persephone MCP verification in plan step 5 is intentionally left to the user.
The managed shell blocks esbuild's child service with `spawn EPERM`; the pinned native esbuild CLI
produced the same bundle twice with identical hashes, and the service syntax/direct resolver checks
passed.
The US-1526 live lifecycle, RSS, and D6/D8 measurements remain for the user; this change was checked
out of app as requested. The browser-download route was also checked out of app per the task
request; no commit was created.
