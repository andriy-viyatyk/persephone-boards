# Audio Player board notes

## Purpose

`audio-player` plays sources, browses user-owned music catalogs, and offers smart playlists. It claims common audio file extensions, `*.music.link.json`, `.m3u`, and `.pls`, streams through Persephone's content bridge, and keeps one player page per window. The Audio Player AiVision model exposes catalog gaps, merge-safe metadata edits, authorized folder import, and playback controls.

## Key files

- `board-manifest.json` — stream-host singleton association, audio masks, bridge and permissions.
- `index.html`, `styles.css`, `board-base.css` — player shell and themed chrome; base CSS stays first.
- `app.js`, `player.js`, `source-queue.js` — source events, two fixed media decks, playback and independent source/catalog queues.
- `catalog.js`, `catalog-store.js`, `catalog-dialogs.js`, `catalog-view.js`, `catalog-search.js` — Link Editor data, merge-safe persistence, and browsing.
- `field-inputs.js` — category and tag fields with a suggestion dropdown, modelled on Persephone's PathInput and TagsInput.
- `ai-vision.js` — main-frame-only `pages[pageId].editor.app` model for track indexing, bounded gap queries, bulk update/undo, category paths, folder scans, and playback/queue actions.
- `folder-import.js`, `metadata.js`, `lib/board-range-tokenizer.js` — recursive folder import and bounded Range-based tag parsing.
- `scripts/build-metadata-bundle.mjs`, `package.json`, `lib/VERSION.txt` — pinned, dev-only browser parser build; the board loads only its generated `lib/music-metadata.js` output.
- `visualizer.js`, `equalizer.js`, `crossfade.js`, `gapless.js`, `player-settings.js`, `effects/` — shared Web Audio graph, EQ and transition controls, canvas lifecycle, and the ported Bars/Circular visualizers.
- `i18n.js`, `lang/` — board-pack translation adapter and 18 aligned language packs.

## Source and queue behavior

- Use `persephone.source.initialSourceContext` and the context delivered with each `source.onOpen`
  event. That context was captured from the page that opened the file; the singleton player's own
  panels do not describe the click origin.
- Persist original hrefs and queue cursors in `persephone.pageState`. Do not persist temporary
  `board://` URLs. Device preferences belong in `persephone.storage`.
- The manifest requests `fileSystem: "full"`, granted once when the user trusts the board, so every
  local track is playable and the board has no per-path access UI or folder list. (Under `"full"`,
  `rememberFolder`/`rememberFile` resolve `true` without a prompt.)
- The catalog is ordinary Link Editor JSON. `catalog-store.js` checks `persephone.getFileAccess(path)`
  on open and refresh; a read-only catalog then means the file itself is read-only on disk. Use the
  store for every mutation so each write rereads and merges the latest file. External edits are
  refreshed while visible and on focus.
- One screen, no Source/Catalog tabs: `#catalog-toggle` (top-left of the visualizer, hover-revealed)
  shows the `#catalog-nav` panel (`prefs.catalogPanel`); a panel entry or any toolbar search change
  opens `#catalog-overlay`, the track list over 96% of the visualizer, closed by its × button. The
  view never changes the playing queue; starting playback from a list does.
- Page chrome lives in Persephone, not the board: the toolbar holds the catalog button
  (`placement: "start"`, labelled with the catalog file name or "No catalog"; it opens
  `#catalog-dialog` with catalog stats and Open/New), the search input and the Import menu; the
  footer holds the track count and the bulk-edit Undo. Folder import without a catalog opens the
  same dialog with `needed`.
- The bridge has no file compare-and-swap, so two simultaneous writers can still race between the
  final read and write. The next refresh reports an observed external change and reloads that file.
- `state.audioPlayer` is collection content only. Preferences are in `persephone.storage`; the
  source and catalog queue snapshots/cursors are separate entries in `persephone.pageState`.
- Folder imports use paged recursive `listFolder()` and skip files whose normalized path is already
  in the catalog, so importing the same folder again adds only new files. The pinned metadata
  parser bundle is built with `npm install && npm run build:metadata`; if it is absent, playback
  and catalog editing still work while tag import waits for that local build.
- The initial stream-host source is read with `persephone.host.streamUrl()`; sibling and later
  sources use `persephone.content.open(href)`.
- Each new source open replaces the active source queue with that open's snapshot and starts its
  selected item. Keep the audio element alive across track changes.
- Chromium does not decode WMA. Keep its row and show the unsupported-format message.

## Visualizer

Keep the original effect palettes and canvas geometry. Theme changes affect board chrome and the
original effects' light/dark palette selection, not their colors. `none` clears the canvas and shows
track metadata. The visualizer owns the page's single AudioContext and fixed graph: each deck source
→ deck gain → ten EQ filters → master gain → analyser → destination. The analyser follows the
combined post-EQ/master signal. Each media element gets one source node for its lifetime. EQ defaults
to bypassed Flat (ten zero dB bands); crossfade defaults to 0 seconds; gapless defaults on. Device
effect settings live in `persephone.storage`. Crossfade overlaps at most two tracks and makes the
incoming item active when its fade begins; preloading alone does not count a play. Skip, queue/mode
change, seek, and pause cancel pending work. Gapless can preload with crossfade off. Unsupported or
stalled next sources report a status and fall back to ordinary end/next handling. Decoder support
follows Chromium; WMA remains unsupported. The visualizer suspends RAF while hidden and disposes its
observers, RAF, effects, nodes, and shared audio context on page teardown.

The canonical bridge reference is `persephone://guides/boards`; agent-facing author guidance is
`C:/projects/persephone/assets/guides/agents/boards.md`.

## Playlists and import

- Play counts increment after a successful playback activation for a catalog track. Pause/resume and seeks do not create new activations. Statistics use the catalog store's additive play operation.
- Smart playlists are derived from catalog links: Top Rated (rating above zero), Most Played, Recently Added, and Recently Played. Sorting ties use title then stable link id.
- User preferences stay in `persephone.storage`; queue snapshots and cursors stay in `persephone.pageState`.
- Import accepts `.m3u` and `.pls`, resolves relative entries against the playlist folder, and deduplicates catalog links by normalized href. The board does not claim `.m3u8`, which belongs to Video Player. An imported playlist path is not retained after the import.

## AiVision model

The trusted board publishes one model from the main frame at `pages[pageId].editor.app`. Start with
`pages[pageId].editor.app.$help` or `$describe`. The model does not require `appScripting`.

- `tracks` is an indexable collection of plain Link Editor metadata. Each track id is its stable
  Link Editor `id`; `href` is the original path or URL, never a temporary `board://` stream URL.
- `missingCategory()`, `missingArtist()`, and `missingYear()` return bounded, cursor-paged
  results. `listTracks(options)` also filters by text, category, tag, artist, and year. The page size defaults to 50 and cannot exceed 100.
- `updateTracks(ids, patch)` validates every id and field before writing, merges through
  `catalog-store.js`, and creates one single-step undo. The visible Undo action is cleared if an
  external edit changes a field covered by the undo preimage.
- Category paths use `/`; rename and move update every descendant track path in one merged write.
- `addTracksFromFolder(path)` scans a folder without opening a picker.
- `play`, `pause`, `next`, `setMode`, and `setQueue` operate on the current player and report the
  resulting mode, cursor, and track.

Sample calls:

```js
missingArtist({ limit: 50 })
listTracks({ text: "First Light", limit: 20 })
updateTracks(["track-01"], { artist: "Aster Vale", year: 2024 })
undoLastBulkEdit()
```
