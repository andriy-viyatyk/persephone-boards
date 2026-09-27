# BT-027: Torrent Viewer — Remove on a failed row deletes its saved source for good

**Status:** Implemented 2026-09-27 in Torrent Viewer 1.7.0, awaiting user testing. Gap 1 did not reproduce in the order tried (two back-to-back reloads), but the fallback was applied anyway and verified by dropping the page's own record: Retry was still offered, Remove forgot the saved junk magnet, and the next reload did not resolve it. Gap 2 (info-hash-less failed paths) is fixed in code, not verified live.

## Goal

Choosing **Remove** on a "Resolution failed" row must remove the row at once, and must also drop
its source from the page's saved list. The source must not come back on the next Reload board or
app restart. Confirm this in the running app, and fix any gap found.

## Background

1.6.0 added Retry and Remove to a failed row (`boards/torrent-viewer/app.js`, `torrentMenuItems`).
Remove calls `dismissFailed(requestId)`:

- It reads the row's source from `failedSources` (requestId → source). That map is filled ONLY in
  `resolveSourceInternal`'s catch, for resolves this page instance started.
- It calls `forgetAcceptedSource(source)`, which deletes from `acceptedSources` and persists
  through `P.state.merge({ acceptedSources })`.
- It sends the service `{ op: "dismiss", requestId }`, which expires every failed or cancelled
  outcome with the same info hash (`scripts/service.mjs`, `handleRequest` case `"dismiss"`).
- It deletes the row locally.

The case that has not been exercised live: a failed row whose source came from the saved list on
restore (`loadOpenedSources` / `restoreAcceptedSources`), such as a malformed magnet saved by
mistake. That is the user's real case: an accidental saved source, `magnet:?xt=urn:btih:0123…&dn=Fail+Testmagnet:?xt=urn:btih:1FCB…`,
which fails every 30 seconds after each reload.

### Known gaps to check

1. **The row shown may not be this page's request.** The page shows one failed row per info hash,
   the NEWEST (`reconcileSnapshot`, the `failedInfoHashes` loop). If that outcome came from an
   earlier page instance (a Reload board while resolving), `failedSources` has no entry for its
   requestId. Then Remove dismisses the row but does NOT forget the source, and the source comes
   back on the next reload. Retry is also missing from the menu in that case.
2. **Failed rows for sources without an info hash** (a local `.torrent` path or an http URL that
   failed before metadata) have `infoHash: null` in the snapshot. They are not deduplicated and are
   keyed only by requestId.

## Implementation plan

1. **Verify live first.** Put a dead magnet (for example
   `magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567`) in the saved list, reload the
   board, wait for the 30-second failure, and choose Remove. Check that the row is gone,
   `(await persephone.state.get()).acceptedSources` no longer holds it, and a second Reload board
   shows no row for it. Then repeat with a Reload board in the middle of the resolve (gap 1).
2. **If gap 1 reproduces**, make the source recoverable without the page-local map:
   - In the service, include the job's `source` in `completedMetadata` for failed jobs when it is
     a string (magnets and paths; never `.torrent` bytes). Metadata-only rule D1 is kept: it is
     the source string the page already persisted, not torrent content.
   - In the page, when adding a failed row in `reconcileSnapshot`, set `row.source` from the result.
     `torrentMenuItems` / `dismissFailed` then use `failedSources.get(requestId) ?? row.source`,
     for both Retry and forgetting the source.
   - When forgetting, also run `removeAcceptedSourcesForInfoHash(infoHash)` if the row has an info
     hash, so an equivalent magnet with different trackers goes too.
3. **Gap 2**: key info-hash-less failed rows by their string source when there is one, so a reload
   does not show two rows for the same path.
4. Bump the board version (1.6.1), and update `WHATS-NEW.md` and the README's failed-row paragraph.

## Concerns

- Showing the source string in the snapshot exposes it to every page of the board. That is the
  same data each page already persists in shared state, so it adds no new exposure.
- Do not auto-remove failed saved sources. A failure can be transient (no peers right now), and
  keeping the source for restart is the documented behaviour.

## Acceptance criteria

1. A failed row restored from the saved list, including one whose failing attempt came from a
   previous page instance, disappears on Remove, and its source is no longer in `acceptedSources`.
2. After Reload board and after an app restart, the removed source does not resolve again.
3. Retry is offered on a restored failed row whenever its source is known.
4. A failed local `.torrent` path shows one row across reloads.

## Files changed

| File | Change |
|---|---|
| `boards/torrent-viewer/scripts/service.mjs` | `source` on failed `completedMetadata` entries (if gap 1 reproduces) |
| `boards/torrent-viewer/app.js` | `row.source` fallback in the menu and in `dismissFailed`; key for info-hash-less failed rows |
| `boards/torrent-viewer/board-manifest.json`, `WHATS-NEW.md`, `README.md` | 1.6.1 |
