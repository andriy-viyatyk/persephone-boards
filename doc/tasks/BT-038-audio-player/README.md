# BT-038: Audio Player — player, queue, volume, visualizer, source mode

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `audio-player`  
**Started:** 2026-10-11  
**Completed:**

## Goal

Create the single-instance Audio Player board that plays audio sources, keeps a source-context queue from Explorer or Link Editor category/tag opens, and provides seek, volume, shuffle, and the ported bars/circular visualizer. The board owns the live player and queue; BT-039 adds the catalog and the switch to catalog mode.

## Background

- Follow the singleton and language-pack manifest pattern in `boards/torrent-viewer/board-manifest.json`, its `lang/en.json`, `i18n.js`, `board-base.css`, and `WHATS-NEW.md`. Use the 17 translated pack codes shipped there plus English: `be`, `de`, `es`, `et`, `fr`, `hu`, `it`, `ja`, `ko`, `lt`, `lv`, `pl`, `pt-BR`, `ro`, `sk`, `uk`, `zh-CN`.
- Use the shared source snapshot supplied by Persephone bridge 1.37.0 (US-1689): `persephone.source.initialSourceContext` and each `source.onOpen(({ sourceUrl, context }) => ...)` event. Its context is captured from the clicked source page before singleton routing; do not inspect the reused player page's sidebar to rebuild it. Bridge 1.38.0 (US-1690) adds source read grants: initial/runtime delivered source URLs and context item hrefs are readable for the session under `fileSystem: "board"`.
- Use the Audio Player drawing and interaction behavior as the port source: `C:/projects/persephone/src/renderer/editors/video/AudioPlayer.ts`, `AudioControls.ts`, `AudioVisualizer.ts`, `effects/BarsEffect.ts`, `effects/CircularEffect.ts`, and `effects/types.ts`. Preserve canvas geometry, analyser smoothing, particle/trail behavior, resize handling, and disposal; replace Persephone-only `VanillaView`/UIKit dependencies with board DOM/CSS and themed tokens.
- `C:/projects/persephone/src/renderer/editors/video/video-types.ts` defines the audio suffixes to claim: `.mp3`, `.wav`, `.aac`, `.flac`, `.m4a`, `.wma`, `.ogg`, `.opus`. Chromium does not decode WMA; retain the row in the queue and report it as unsupported.
- Persephone bridge docs: `C:/projects/persephone/assets/guides/agents/boards.md` and `C:/projects/persephone/assets/board-template/CLAUDE.md`. `content.open(link)` returns an origin-local `board://` URL that accepts Range requests; use it for each source href. The single-instance stream-host contract is in EPIC-128 A2.
- Source-context implementation contract and bounds: `C:/projects/persephone/doc/tasks/US-1689-board-source-context/README.md`. It carries `kind: "folder" | "link-category" | "link-tag"`, source identity, ordered sibling items and current index, capped at 5,000 items / 1 MiB.

Implementation note: `content.open()` URLs are revoked by the host when the board frame or page is
torn down; the bridge has no per-track revoke method. Track changes clear the audio element's
source and the board never persists those temporary URLs.

## Implementation Plan

- [x] Add `boards/audio-player/board-manifest.json` with `editorKind: "stream-host"`, `singleInstance: true`, `editorPriority: 150` (the US-1688 probe confirms this beats the built-in Video Player), `editorName: "Audio Player"`, audio `fileMasks` matching the suffix list above, `languages: { "folder": "lang", "default": "en" }`, `fileSystem: "board"` from this task onward (source read grants are required for delivered context/runtime tracks), and no `service`, `execute`, or network permission. Require `minBridgeVersion: "1.38.0"` from the start for source read grants and folder listing. Set `minAppVersion` to the Persephone app release that ships bridge 1.38.0 (`5.0.11` in the working tree).
- [x] Add `boards/audio-player/index.html`, `board-base.css`, `styles.css`, `i18n.js`, and `app.js`. Keep `board-base.css` first in the document and style board chrome (background, controls, panels and text) from `--p-*`; never hardcode chrome colors. Theme changes update chrome only; preserve the original visualizer palettes and colors.
- [x] Add `boards/audio-player/player.js` to own one `<audio>` element, source resolution with `persephone.content.open(href)`, loading/error/ended events, media-session metadata/actions, volume and mute, seek, queue progression and cleanup. Persist original hrefs, never temporary `board://` URLs.
- [x] Add `boards/audio-player/source-queue.js` to normalize initial/runtime `BoardSourceContext`, preserve provider order, set the current item from `index`, replace source mode's queue on a context from a different source, and support next/shuffle. File opens with no context play as a one-item queue; later `source.onOpen` events replace/play into the singleton queue.
- [x] Add `boards/audio-player/visualizer.js` and `boards/audio-player/effects/bars.js`, `circular.js`, `effect-types.js`. Port the drawing algorithms and original palettes/color behavior from the Persephone sources unchanged; visualization palettes are content, like a chart's data colors. Theme tokens style board chrome only (background, text, controls and panels). `none` clears the canvas and shows title/artist metadata. Keep one `AudioContext`/`AnalyserNode` connected to the media element, suspend animation when hidden, and dispose observers, RAF, analyser and context on unload.
- [x] Add `boards/audio-player/lang/en.json` and the 17 translated `lang/<code>.json` packs. Route all visible copy through `persephone.i18n.t()` in `i18n.js` and keep the 18 packs key-aligned. The repository checker could not start because esbuild raised `spawn EPERM`; manually validated UTF-8, locale set, JSON parsing and key parity.
- [x] Add `boards/audio-player/WHATS-NEW.md` with the initial release heading and a terse player/visualizer entry. Add `CLAUDE.md` with board-specific file map, mode/queue gotchas and a pointer to the canonical Persephone guide.

## UI Layout

- A compact top row contains the current mode indicator (`Source` in this task), a queue/source label, and controls for mode switch (wired in BT-039), shuffle, and queue visibility.
- The main area centers the track title and artist over a full-width canvas. A small effect picker selects Bars, Circular, or Off; controls fade in on hover, as in the reference player.
- A bottom transport row shows previous/next where available, play/pause, elapsed time, seek slider, duration, volume slider, and mute. The queue is a themed side panel or lower drawer with current/next rows and the source label.
- Empty state explains that opening an audio file starts playback. Unsupported decode errors stay visible in the queue and do not crash playback or remove sibling items.

## Data Shapes

The bridge source context is read-only input to source mode; retain the queue snapshot and index in `persephone.pageState`. This is an example of the 1.37.0 context contract:

```json
{
  "kind": "link-tag",
  "sourcePath": "C:/Music/collection.link.json",
  "tag": "ambient",
  "label": "ambient",
  "items": [
    { "id": "track-01", "title": "First Light", "href": "C:/Music/first-light.flac", "category": "Ambient", "tags": ["ambient"] },
    { "id": "track-02", "title": "Night Signal", "href": "C:/Music/night-signal.mp3", "category": "Ambient", "tags": ["ambient"] }
  ],
  "index": 1
}
```

Keep device preferences in `persephone.storage`, source/catalog queue snapshots and cursors in `persephone.pageState`, and collection content only in the catalog file's `state.audioPlayer`. `persephone.pageState` values are serialized strings (10 MiB per key); do not persist temporary `board://` URLs. Example device preferences:

```json
{
  "volume": 0.8,
  "muted": false,
  "shuffle": false,
  "repeat": "off",
  "visualizer": "bars",
  "catalogPath": "C:/Music/library.music.link.json",
  "musicFolders": ["C:/Music"],
  "lastMode": "source"
}
```

The `persephone.storage` object above is a device preference value. BT-041 adds `equalizer`, `crossfadeSeconds`, and `gapless` to it. Queue snapshot/cursor value, stored with `persephone.pageState.set("audio-queues", JSON.stringify(value))`:

```json
{
  "source": { "sourcePath": "C:/Music/collection.link.json", "kind": "link-tag", "items": [{ "href": "C:/Music/first-light.flac", "openAgainToPlay": false }, { "href": "C:/Music/night-signal.mp3", "openAgainToPlay": true }], "nextIndex": 1 },
  "catalog": { "sourcePath": "all", "kind": "all", "items": [], "nextIndex": 0 }
}
```

Queues store original hrefs, not temporary content URLs. Catalog-file `state.audioPlayer` contains collection content only, such as saved playlists (BT-040), never preferences, queues/cursors, or `catalogPath`. The active track continues independently when the mode changes; A9 keeps separate snapshots/cursors in page state.

Queue items delivered only through a runtime `source.onOpen` event are readable for that session. After restart that grant is gone; if the persisted item is outside a remembered Music folder, mark it “open again to play” and require the user to reopen it. Persephone re-grants initial source/context on restart. For an initial stream-host source use `persephone.host.streamUrl()`; use `content.open()` for other granted hrefs.

The catalog's canonical link record (fully specified in BT-039) is a Link Editor `LinkItem` plus Audio Player fields:

```json
{
  "id": "track-01",
  "isDirectory": false,
  "title": "First Light",
  "href": "C:/Music/first-light.flac",
  "category": "Ambient",
  "tags": ["ambient", "instrumental"],
  "imgSrc": "C:/Music/first-light-cover.jpg",
  "artist": "Aster Vale",
  "year": 2024,
  "album": "Quiet Machines",
  "rating": 4,
  "playCount": 0,
  "lastPlayed": null,
  "addedAt": "2026-10-11T12:00:00.000Z",
  "duration": 238.4
}
```

## Concerns / Open Questions

- `content.open()` may reject for inaccessible or unsupported links; report the track-level failure and keep the rest of the queue usable.
- WMA is a known listed-but-undecodable format in Chromium. Surface “Unsupported format” rather than silently advancing or treating the file as missing.
- Preserve the single audio element across source changes so playback remains in one page and volume/session state is stable. Do not open a new page for each sibling.
- Preserve the original visualizer palettes/color behavior unchanged; theme tokens apply only to board chrome. Visualization palettes are content, like a chart's data colors.
- US-1688 already confirmed background playback and media keys (including while the board is inactive and Persephone unfocused); retain these as regression checks only and add no platform workaround.
- Mode-switch semantics and independent queue cursors are fixed by EPIC-128 A9: the active track does not stop; a mode change chooses its next queue after the active href when present; returning to a mode restores that mode's saved snapshot/cursor.

## Acceptance Criteria

- [ ] Opening audio from Explorer, Link Editor, Open dialog or drop reaches one Audio Player page and resolves bytes through `persephone.content.open()`.
- [ ] Manifest uses `fileSystem: "board"` and minBridgeVersion 1.38.0; content reads work only for delivered source/context files, this-session dialog picks, files under remembered Music folders, or the initial stream-host source through `persephone.host.streamUrl()`.
- [ ] Folder, link-category and link-tag opens seed an ordered queue from `source.initialSourceContext`; a later singleton open uses that event's captured context rather than the player page's current panels.
- [ ] Next and shuffle operate on source siblings; an open without context works as a one-item queue.
- [ ] Play/pause, current time, seek, duration, volume and mute reflect the single media element; unsupported WMA is reported without breaking the queue.
- [x] Bars, Circular and None render; canvas resizing, hidden-page animation suspension and disposal work; Bars/Circular retain original palettes/color behavior while board chrome follows theme tokens.
- [ ] Queue snapshots and independent source/catalog cursors follow A9; mode changes leave the current track playing and switching back restores the saved mode queue.
- [ ] Volume, mute, shuffle, repeat, visualizer effect, catalogPath, Music folders and last mode persist through `persephone.storage`; source/catalog queue snapshots and cursors persist in `persephone.pageState`, never in the catalog file.
- [ ] Initial source/context access is available again after app restart; a persisted queue item delivered only through a runtime `source.onOpen` is marked “open again to play” after restart instead of silently failing.
- [x] Board chrome uses `--p-*` theme tokens; visualizer content colors preserve the original effect palettes.
- [x] Language files are declared and all visible text uses board-pack i18n.
- [x] No unit tests are added.
- [ ] **Live Persephone (Claude):** verify source context arrives for Explorer, Link Editor category and tag opens, and successive opens reuse the same board page.
- [ ] **Live Persephone (Claude):** regression-check background playback and hardware media keys (both already confirmed by US-1688); investigate only if the board regresses.
- [ ] **Live Persephone (Claude):** inspect the visualizer in at least light and dark themes, check theme switching and `ui.log` for load/CSP/runtime errors.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/board-manifest.json` | New — singleton stream-host audio editor, masks, permissions, language packs and bridge/app minimums. |
| `boards/audio-player/index.html` | New — themed player shell and local script/style entry points. |
| `boards/audio-player/app.js` | New — app startup, mode/queue projection, source-event wiring and i18n. |
| `boards/audio-player/player.js` | New — single media element, content URL resolution, transport, volume and media session. |
| `boards/audio-player/source-queue.js` | New — source context normalization and source-mode queue behavior. |
| `boards/audio-player/visualizer.js` | New — AudioContext/analyser, original effect palettes, RAF and canvas lifecycle. |
| `boards/audio-player/effects/bars.js` | New — ported bars and particle drawing with original palette behavior. |
| `boards/audio-player/effects/circular.js` | New — ported circular bands, sparks and trails with original palette behavior. |
| `boards/audio-player/effects/effect-types.js` | New — effect selection and shared draw contract. |
| `boards/audio-player/board-base.css` | New — standard Persephone board base, linked first. |
| `boards/audio-player/styles.css` | New — player, transport and queue layout using theme tokens. |
| `boards/audio-player/i18n.js` | New — small board-pack translation and DOM-message adapter. |
| `boards/audio-player/lang/en.json` | New — English strings for player controls and states. |
| `boards/audio-player/lang/{be,de,es,et,fr,hu,it,ja,ko,lt,lv,pl,pt-BR,ro,sk,uk,zh-CN}.json` | New — translated packs matching the reference boards' 17 non-English languages. |
| `boards/audio-player/WHATS-NEW.md` | New — initial release notes. |
| `boards/audio-player/CLAUDE.md` | New — board-specific author notes and bridge-guide pointer. |
