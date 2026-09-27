# BT-026: Torrent viewer single-instance source routing and restart persistence

## Status

**Status:** Completed (2026-09-27, with EPIC-114)
**Priority:** High
**Board id:** `torrent-viewer`
**Epic:** EPIC-114
**Started:** 2026-09-27

## Goal

Make Torrent Viewer a single-instance board per Persephone window and deliver later claimed
sources into the existing page. Persist only accepted source strings, replacing resolved HTTP(S)
`.torrent` sources with canonical magnets, so the viewer can re-resolve its torrents after restart
without storing torrent metadata or content.

## Background

- The platform half is US-1530: the board relies on `persephone.source.onOpen()` and the existing
  `persephone.getSourceUrl()` initial-source handoff.
- `persephone.state.init({ acceptedSources: [] }, { restorableKeys: ["acceptedSources"] })` is
  the shared restorable-state contract. The service snapshot remains the sole torrent inventory.
- EPIC-114 D1 requires metadata-only resolution with `deselect: true`; D5 requires complete
  self-contained `torrent://` links; D14 requires one page per window and one app-wide service
  snapshot shared across windows.
- The board uses its existing `scripts/service.mjs` and vendored WebTorrent bundle. No second
  client, disk store, eviction, selection, or provider payload is part of this task.

## Implementation Plan

- [ ] Opt `board-manifest.json` into `singleInstance`, require bridge `1.17.0`, and bump the board
      version for the single-instance release.
- [ ] Initialize restorable `acceptedSources`, subscribe to `source.onOpen()` before startup
      loading, and route all accepted source strings through the existing resolver.
- [ ] Restore `getSourceUrl()` plus persisted sources with canonical-string and info-hash
      deduplication; serialize unknown-hash restores and refresh the authoritative snapshot before
      comparing the next source.
- [x] Keep HTTP(S) `.torrent` sources transient until resolution succeeds, then replace them with
      the canonical magnet from the authoritative service snapshot; never persist unresolved or
      failed HTTP sources.
- [ ] Prune sources only when their info hash disappears within the same service instance. A
      changed `pid`/`startedAt`/`restartCount` identity or any non-running status is a service
      reset: retain the persisted sources and re-resolve them. Explicit removal from this page
      prunes its source immediately.
- [ ] Update board documentation, changelog, dashboard, and this task record.

## Concerns / Open Questions

- The app-wide service can be reset by a supervisor restart or clean stop, both of which can make
  a snapshot empty without meaning that torrents were removed. Instance-aware pruning is required
  to avoid silently losing persisted sources.
- The running app is the verification harness; this implementation is limited to static checks as
  requested by the user.

## Acceptance Criteria

- [ ] The manifest declares `singleInstance: true`, `minBridgeVersion: "1.17.0"`, and the current
      board release is version `1.5.0`.
- [ ] Multiple claimed sources in one window reach one page through `source.onOpen()` without a
      reload, while different windows continue to share the service snapshot.
- [ ] Restorable state contains only canonical source strings and restores the initial source plus
      later accepted sources without duplicate resolves for one info hash.
- [ ] Same-instance disappearance prunes a source; service reset retains and re-resolves it; local
      explicit removal prunes immediately.
- [ ] No render path selects a file, reads a range, starts a read, or persists metadata/buffers.
- [ ] `node --check` passes for every changed JavaScript module; no unit tests or commit are added.

## Files Changed

| File | Change |
|------|--------|
| `boards/torrent-viewer/board-manifest.json` | Opt into singleton routing and bridge 1.17.0; bump version. |
| `boards/torrent-viewer/app.js` | Subscribe, persist, restore, deduplicate, and instance-aware-prune source strings. |
| `boards/torrent-viewer/WHATS-NEW.md` | Add the 1.4.0 entry. |
| `boards/torrent-viewer/README.md` | Document D14, source delivery, persistence, and reset handling. |
| `boards/torrent-viewer/CLAUDE.md` | Keep board author notes aligned with the new bridge and lifecycle. |
| `doc/active-work.md` | Keep the BT-026 dashboard entry under Active while this work is in progress. |

## Notes

The reviewed platform plan is `C:/projects/persephone/doc/tasks/US-1530-single-instance-boards/README.md`.
The platform implementation is being delivered in parallel; this task uses its stated 1.17.0
source-event contract and does not modify Persephone platform code.
