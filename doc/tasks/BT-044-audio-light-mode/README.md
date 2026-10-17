# BT-044: Audio Player light mode (EPIC-128 A11)

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `audio-player`  
**Started:** 2026-10-18  
**Completed:**

## Goal

Add a light Audio Player page for audio files opened from Explorer, Link Editor, Open dialog, or drag-and-drop, while retaining the full singleton player for board, catalog, and playlist opens. Keep catalog edits and play counts merge-safe, and refresh the full player's catalog through the bridge watch API.

## Background

### Addendum A — light pages navigate per track (user decision 2026-10-18)

The Persephone bridge 1.40.0 contract, currently being built, adds
`persephone.source.navigate(href) -> Promise<void>`. It navigates the page hosting the board to
another item in its initial `persephone.source.initialSourceContext.items`; Persephone moves the
Explorer/Link Editor selection and rebuilds the page as a fresh light board for that file, which
starts playing it. The promise rejects when `href` is outside that initial context.

For light mode only, Next, Previous, track-end auto-advance, repeat-all wrap-around, and media
session previous/next choose their target from the source queue and call `source.navigate()`.
Repeat-track replays in place. Shuffle picks a random item other than the current item, with no
bag because each navigation creates a fresh page. If navigation is missing or rejects, continue
with the existing in-page track change and log the fallback once. Once navigation is called,
ignore further transport and ended events on that page to prevent duplicate navigation.

Light mode does not preload another deck or start crossfade/gapless transitions. Keep the stored
crossfade and gapless values unchanged so they continue to apply in full mode. The effects
popover may show those controls as disabled in light mode; equalizer controls remain active.
Full-mode playback and transitions are unchanged.

### Addendum B — stop the visualizer while the page is hidden (user decision 2026-10-18)

The Persephone bridge 1.40.0 contract exposes `persephone.page.visible` (boolean) and
`persephone.page.onVisibilityChange((visible) => void) -> disposer`. In both full and light mode,
the visualizer draws only while the page is visible, the visualizer intersects the viewport, and
an effect is selected. On hide, cancel its RAF and clear the canvas; on show, remeasure and sync to
restart drawing. Keep this behavior inside `visualizer.js`; do not pause playback, the AudioContext,
or the analyser graph. Initialize visibility from `persephone.page.visible`, defaulting to true
when absent. If `onVisibilityChange` is missing, retain the existing behavior, and dispose the
subscription with the visualizer.

- EPIC-128 decision A11 is the product spec. Persephone US-1700 supplies `singleInstanceMasks` routing and initial source context on each in-place page; assume it is available. A light page restored from a file remains light. Opening another audio file in Explorer rebuilds the page as a new board instance; Persephone handles that navigation.
- `boards/audio-player/app.js` currently creates the catalog toolbar and footer controls before startup mode is known, always exposes AiVision, restores both queues and the saved catalog list, and routes any later source open into its queue. Startup currently distinguishes `.music.link.json` and `.m3u`/`.pls` sources only to open/import them. There is no bridge API to set the page-tab title (`persephone.page` has `setModified`/`setMuted`); the track title follows playback inside the board above the visualizer, while the page tab keeps the opened file name.
- `boards/audio-player/source-queue.js` stores source and catalog queue snapshots plus mode under `persephone.pageState` key `audio-queues`; `save()` is called from queue cursor/mode/list changes and after successful track activation.
- Shared `persephone.storage` key `audio-player` contains volume, mute, shuffle, repeat, visualizer, EQ/crossfade/gapless settings, `catalogPanel`, `playingList`, `catalogSection`, recent folders, and `catalogPath`. `persistPrefs()` must merge writes onto the stored object so a light-page write cannot overwrite newer full-player values. A light page may persist `visualizer` and `equalizer` only; it never writes `catalogPath` or transition settings. Volume, mute, shuffle, and repeat changes in light mode are in-memory only. Crossfade and gapless stay at their stored values for full-mode playback.
- `catalog-view.js`'s `restorePlaying()` restores the saved catalog list and `renderPlaying()` writes `playingList` (and `showPlaying()` may write `catalogSection`). Skip `queue.restore()`, `catalogView.restoreQueue()`, and `catalogView.restorePlaying()` in light mode; build the queue from `initialSourceContext` plus the initial `sourceUrl` only. A restored light page therefore restarts from its initial track. Light mode never calls `queue.save()` or `persephone.pageState.set("audio-queues", ...)`. Catalog file mutations, including play counts and the existing empty-tag fill behavior, remain allowed and must continue through `catalog-store.js`.
- `catalog-store.js` currently polls every 4 seconds while visible and refreshes on window focus and document visibility. Its write path rereads the latest JSON, applies queued operations, then writes, preserving merge-safe behavior (the bridge does not provide compare-and-swap).
- The board shell already has the visualizer, track chip/title, transport, and `#add-current`; `catalog-view.js` hides the add/edit button when there is no catalog document. The shell also contains the catalog panel/toggle/list, catalog and import dialogs, and playlist import dialog.
- `boards/audio-player/lang/` has 18 packs: `be`, `de`, `en`, `es`, `et`, `fr`, `hu`, `it`, `ja`, `ko`, `lt`, `lv`, `pl`, `pt-BR`, `ro`, `sk`, `uk`, and `zh-CN`. Prefer existing translation keys; add any new key to all 18 packs.
- Live Persephone board guide findings: `initialSourceContext` contains the captured source panel items and index and is restored with the page; later `source.onOpen()` events include a per-open `context`. `persephone.watch(path, callback, options?)` returns an async disposer; events contain `changes`, optional `rescan`, and optional `ended` (`removed`, `error`, or `revoked`). Exact-file watch requires read access; `not-found` means the target is missing, and the guide says to watch its containing folder while waiting for it to appear. Watch subscriptions end on teardown or revocation.
- `board-manifest.json` remains `1.0.0`, with `minBridgeVersion: "1.40.0"` from US-1700, `singleInstance: true`, and `singleInstanceMasks` for catalog and playlist files. `WHATS-NEW.md` has only `1.0.0`; the board is unpublished and has no release tag. Keep the board version at `1.0.0`.

## Implementation Plan

- [x] In `boards/audio-player/app.js`, determine mode before installing mode-specific controls: light mode is exactly when `P.getSourceUrl()` resolves to an href that is not a catalog (`*.music.link.json`) or playlist (`.m3u`/`.pls`) source. A page with no source URL is full mode even if `pageState` contains a queue. Build a light queue only from `P.source.initialSourceContext` plus that initial source URL. Light pages ignore `source.onOpen()` and register no handler; the platform does not route later opens to them. Let the platform rebuild the page on a later Explorer audio open.
- [x] In `boards/audio-player/app.js`, `boards/audio-player/index.html`, and `boards/audio-player/styles.css`, implement light-mode visibility: retain visualizer, transport, current in-board track title above the visualizer, and `#add-current`; hide `#catalog-nav`, `#catalog-toggle`, `#catalog-overlay` (including playing-list/double-click behavior), toolbar search/Import/catalog button (use a reduced or empty `persephone.toolbar.set()` catalog), and catalog/import/playlist dialogs. The tab keeps the opened file name because there is no bridge API to change it. Keep `#add-current` hidden without a catalog and never offer Open/New catalog from a light page. Update the in-board track title when the playing source-context track changes.
- [x] In `boards/audio-player/app.js`, define the light page's minimal footer as the transient status/error text only; hide the catalog track-count and bulk-edit Undo controls. Do not show a catalog list count or agent-oriented action in light mode.
- [x] In `boards/audio-player/app.js`, skip `aiVisionModel.expose()` entirely in light mode. Keep play-count recording for catalog members and keep catalog mutations on the existing merge-safe store path.
- [x] In `boards/audio-player/app.js`, `boards/audio-player/source-queue.js`, `boards/audio-player/catalog-view.js`, and `boards/audio-player/catalog-store.js`, use one `light` flag at the write points. A light page never writes shared `catalogPath` or calls `queue.save()`/`P.pageState.set("audio-queues", ...)`; preference writes are merged and limited to `visualizer` and `equalizer`. Volume/mute/shuffle/repeat changes are in-memory only; crossfade/gapless remain unchanged and disabled in the light UI. Skip `queue.restore()`, `catalogView.restoreQueue()`, and `catalogView.restorePlaying()` in light mode; after restoring a light page, playback starts from its initial track and source context. Continue reading the remembered catalog path and loading its document; catalog-file writes such as add/edit and play-count updates remain allowed through the merge-safe store.
- [x] In `boards/audio-player/catalog-store.js`, replace polling in both full and light modes with the same `persephone.watch(catalogPath)` path so in-catalog/edit state updates in either page when the full player or Link Editor changes the file. Remove the 4-second timer and focus/visibility refresh listeners. On `changed` or `rescan: true`, call `refresh()`. On `ended: "removed"` or a `not-found` result, watch the parent folder with `recursive: false`; when a `created` or `changed` entry for the catalog file arrives, dispose the folder watch and subscribe to the exact file again. On `ended: "revoked"` or `ended: "error"`, stop watching, keep the current document, and do not retry in a loop. Dispose the active watch when the catalog path changes and on page teardown (`pagehide`). Preserve serialized merge-safe writes.
- [x] In `boards/audio-player/board-manifest.json`, add `"singleInstanceMasks": ["*.music.link.json", "*.m3u", "*.pls"]` next to `"singleInstance": true`; set `minBridgeVersion` to `1.40.0` as US-1700 specifies. Keep audio-file masks available for the light page.
- [x] In `boards/audio-player/CLAUDE.md`, document full/light startup routing, light-mode controls and persistence restrictions, and watch-based catalog synchronization.
- [x] In `boards/audio-player/WHATS-NEW.md`, add a terse light-mode/watch change line under the existing `1.0.0` heading. Keep `boards/audio-player/board-manifest.json` `version` at `1.0.0`; do not create a new version heading or bump the version for this unpublished board.
- [x] Review translation changes in `boards/audio-player/lang/*.json`; no new translation strings were needed.
- [x] Implement Addendum A source-context navigation for light-mode transport, end advance, repeat-all wrap, shuffle, and media-session skip; retain in-page repeat-track and fallback behavior.
- [x] Disable light-mode preload/transitions without changing stored crossfade/gapless settings; preserve full-mode effects and equalizer operation.
- [x] In `boards/audio-player/visualizer.js`, stop drawing and clear the canvas while the page is hidden in both modes; resume with a fresh measurement when visible, without changing audio playback or the Web Audio graph.
- [x] Run `node --check` on each edited JavaScript file; do not add tests or harnesses.
- [ ] Verify the platform contract through US-1700: board/catalog/playlist opens route to the full singleton and audio files route in place with context. Check Explorer and Link Editor source contexts, restored audio-file pages, watch changes/rescan/not-found/ended behavior, and that light pages do not alter shared player preferences or queue state. Confirm that a restored light page starts at its initial track/context, title follows in-board playback while the tab retains the opened filename, and no source handler is registered in light mode. Check both modes' UI and board `ui.log` for errors/CSP violations; the board remains fully offline.

## Concerns / Open Questions

- The live Persephone build reports bridge `1.39.0`; US-1700's `1.40.0` routing contract cannot be exercised in that runtime.
- A light page's `light` flag must guard preference and queue writes centrally: merge only `visualizer`/`equalizer`, never write transition settings or `catalogPath`, and never call `queue.save()`/write `audio-queues` page state. Catalog document writes for add/edit/play count remain enabled.
- Watch callbacks may request a full rescan rather than name a changed file, especially after atomic replacement. Treat `rescan` as `refresh()`. A removed or missing catalog falls back to a non-recursive parent-folder watch; revoked/error subscriptions stop without a retry loop and leave the current document visible.
- Two pages can play simultaneously by design; there is no cross-page pause. Each light page still records successful catalog-track activations.
- No new translation string is currently required by the specified UI; if implementation adds one, update all 18 packs.

## Acceptance Criteria

- [ ] Audio-file sources open in light mode with the captured Explorer or Link Editor sibling queue; full-player opens remain singleton for board, catalog, and playlist sources.
- [ ] Light mode shows the visualizer, transport, track title, and catalog add/edit button only when a catalog is loaded; previous/next and title follow the current source-context track.
- [ ] Light mode hides catalog browsing, double-click list behavior, toolbar catalog/search/import, catalog dialogs, and AiVision exposure; footer shows only status/error text.
- [ ] Light mode records play counts and permits the current-track add/edit action when a catalog exists, persists only merged `visualizer`/`equalizer` changes, never writes `catalogPath` or `audio-queues` page state, and skips queue restoration to start at the initial track/context.
- [ ] Both modes watch the catalog through the same `persephone.watch()` implementation, update on changes from other pages, handle path replacement/removal/recreation and event rescan/ended signals as specified, and retain merge-safe writes.
- [ ] In light mode the in-board track title follows playback; the page tab retains the opened file name.
- [ ] All 18 translation packs remain aligned for any added strings.
- [ ] `ui.log` is clean (no CSP violations).
- [ ] Fully offline (no CDN / network).
- [x] In light mode, track-changing transport and ended events navigate to the selected source-context item; repeat-track remains in-page, repeat-all wraps, and shuffle selects a different random item.
- [x] Light mode suppresses preload and transition playback and leaves stored crossfade/gapless settings available to full mode.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/app.js` | Select mode at startup; conditionally configure controls, footer, AiVision, persistence, and source-context playback. |
| `boards/audio-player/index.html` | Add mode hooks or hideable catalog-only UI as needed. |
| `boards/audio-player/styles.css` | Hide catalog/full-player chrome in light mode. |
| `boards/audio-player/source-queue.js` | Suppress light-page `audio-queues` page-state writes. |
| `boards/audio-player/player-settings.js` | Keep equalizer active while light-mode transition controls are disabled. |
| `boards/audio-player/catalog-view.js` | Skip saved-list restore and `playingList`/`catalogSection` writes in light mode. |
| `boards/audio-player/catalog-store.js` | Use the same watch-based refresh in both modes; suppress shared `catalogPath` writes from light pages while preserving merge-safe catalog writes. |
| `boards/audio-player/board-manifest.json` | Add `singleInstanceMasks`; set `minBridgeVersion` to US-1700's version; keep `version` at `1.0.0`. |
| `boards/audio-player/CLAUDE.md` | Record the new mode and synchronization behavior. |
| `boards/audio-player/visualizer.js` | Gate drawing on page visibility in both modes and dispose the visibility subscription on teardown. |
| `boards/audio-player/WHATS-NEW.md` | Add the light-mode/watch change line under the existing `1.0.0` heading. |
| `boards/audio-player/lang/*.json` | Only if new UI strings are needed; keep all 18 packs aligned. |
| `doc/active-work.md` | Link planned BT-044 to this document. |
| `doc/tasks/BT-044-audio-light-mode/README.md` | Track implementation and remaining platform verification. |

## Notes

- Verified from the live `guides.agents.boards`: source-panel snapshots carry `kind`, `sourcePath`, category/tag, label, ordered items, and index (bounded to 5,000 items / 1 MiB); the initial snapshot restores with the page, while later event context is transient. Exact-file watches need read access; a missing exact target returns `not-found`, for which the containing folder can be watched until the file reappears.
- Existing add/edit affordance already remains hidden when there is no catalog document. Preserve this behavior and do not expose catalog open/create flows in light mode.
- 2026-10-18 (user request): light mode shows the visualizer effect picker and the audio-effects button/popover. A light page persists only `visualizer` and `equalizer`, merged onto the stored `audio-player` value; transition settings remain unchanged.
