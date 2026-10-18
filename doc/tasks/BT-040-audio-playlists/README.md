# BT-040: Audio Player — play counts, smart and saved playlists, M3U/PLS

## Status

**Status:** Active
**Priority:** Medium  
**Board id:** `audio-player`  
**Started:** 2026-10-11
**Completed:**

## Goal

Record play statistics, provide built-in smart lists and user-saved playlists, and import `.m3u` / `.pls` playlist files into the music catalog. The board claims `.m3u` and `.pls` only for import; it does not claim `.m3u8`.

## Background

- EPIC-128 A6 stores `playCount`, `lastPlayed`, and `addedAt` on each catalog LinkItem, with the catalog itself in Link Editor `{ type, links, state }` format. See [`BT-039`](../BT-039-audio-catalog/README.md) for the exact track JSON and read/merge/write decision.
- EPIC-128 A7 is explicit: import `*.m3u` and `*.pls`; never claim `*.m3u8`, because Video Player uses that extension for HLS. Use the player/queue foundation in [`BT-038`](../BT-038-audio-player/README.md).
- Reuse board-pack translations and manifest conventions from `boards/torrent-viewer/board-manifest.json`, `boards/torrent-viewer/lang/en.json`, and `boards/torrent-viewer/i18n.js`.
- Bridge access remains `fileSystem: "board"`; load playlist bytes with `readFile(path)`. A `.m3u` / `.pls` imported from outside the board folder must come from `openFileDialog()` and requires `rememberFile()` if its path is retained or reread after restart (US-1690, bridge 1.38.0). Catalog writes go through BT-039's operation-based merge path.

## Implementation Plan

- [x] Add `boards/audio-player/play-counts.js`; count once per actual play activation for a catalog track, set `lastPlayed` to its UTC ISO timestamp, and do not increment repeatedly for duplicate `playing` events, seeks, pause/resume of the same activation, or source-only tracks. Send an additive increment through `catalog-store.js` so an external play count is not overwritten.
- [x] Add `boards/audio-player/smart-playlists.js` for Top Rated (rating > 0, descending rating), Most Played (descending playCount), Recently Added (descending addedAt), and Recently Played (descending lastPlayed). Tie-break stably by title then id. Each view resolves to a catalog-mode queue snapshot.
- [x] Add `boards/audio-player/saved-playlists.js` for create, rename, reorder, add/remove tracks and delete. Store user playlists under `state.audioPlayer.savedPlaylists`; playlist members are stable catalog `LinkItem.id` values, not copied link objects. Preserve order and skip/report references to deleted/missing tracks.
- [x] Add `boards/audio-player/playlist-import.js` and `boards/audio-player/playlist-format.js`. Parse UTF-8 BOM/CRLF safely. For M3U, ignore blank lines and `#` comments, recognize `#EXTINF:<seconds>,<title>` and associate its title/duration with the following file. For PLS, parse `[playlist]`, `NumberOfEntries`, and indexed `FileN`, optional `TitleN`, `LengthN`; ignore `Version` and unrelated keys. Resolve relative file entries against the playlist's parent folder; preserve absolute paths and URLs; do not interpret comments as tracks.
- [x] Import matches existing catalog tracks by normalized href and updates no existing user fields unless the user chooses an explicit update action. New records use playlist title when present, otherwise filename; category is empty and tags are empty. PLS/M3U track durations seed `duration` only when missing.
- [x] Add `*.m3u` and `*.pls` to `fileMasks` and keep `*.m3u8` out. Keep `editorPriority: 150` for the Audio Player's audio and catalog masks; US-1688 confirmed the probe at 150 beats the Video Player, while 200 is unnecessary category-view priority. Playlist import should be offered in Open with where a built-in has a stronger claim.
- [x] Add saved/smart playlist browsing to `boards/audio-player/catalog-view.js` and queue generation to `catalog-search.js` or a focused `playlist-queues.js`; opening a playlist selects catalog mode without stopping the current track. Save playlist definitions in catalog `state.audioPlayer`; store mode preference in `persephone.storage` and queue snapshot/cursor in `persephone.pageState`.
- [x] Add strings to `lang/en.json` and all 17 translated packs; update `WHATS-NEW.md` and `CLAUDE.md` with smart/saved playlist and import semantics.

## UI Layout

- Add a Playlists section above or below catalog categories, with built-in smart lists grouped separately from Saved Playlists.
- A saved playlist opens in catalog mode and shows an editable ordered track list, count, duration total when known, and a compact menu for rename, reorder, remove track and delete playlist.
- Import Playlist opens the native file dialog filtered to `.m3u` / `.pls`, previews found tracks and duplicates, then offers Add to catalog, Play now, or Cancel. Errors are attached to the import summary, not shown as a blocking JavaScript alert.
- Track rows show play count and last-played date where space allows. Import and stats actions use themed `--p-*` styling.

## Data Shapes

Play statistics remain on the catalog link record; this is the canonical field form from A6:

```json
{
  "type": "link-editor",
  "links": [
    {
      "id": "track-01",
      "isDirectory": false,
      "title": "First Light",
      "href": "C:/Music/first-light.flac",
      "category": "Ambient",
      "tags": ["ambient"],
      "imgSrc": "C:/Music/cover.jpg",
      "artist": "Aster Vale",
      "year": 2024,
      "album": "Quiet Machines",
      "rating": 4,
      "playCount": 12,
      "lastPlayed": "2026-10-11T12:00:00.000Z",
      "addedAt": "2026-09-02T08:30:00.000Z",
      "duration": 238.4
    }
  ],
  "state": {
    "audioPlayer": {
      "savedPlaylists": [
        { "id": "playlist-road", "name": "Road Trip", "trackIds": ["track-01"] }
      ]
    }
  }
}
```

`playCount` is a non-negative integer; `lastPlayed` and `addedAt` are ISO 8601 UTC strings or null for never played / legacy records; `duration` is finite seconds or null. A smart playlist is derived at read time and is not duplicated into persistent storage. A saved playlist is `{ id: string, name: string, trackIds: string[] }`; its order is the `trackIds` order. The catalog file's `state.audioPlayer` contains saved playlist definitions and collection content only. Device preferences (including mode) live in `persephone.storage`; both mode queue snapshots and cursors live in `persephone.pageState` as JSON strings (10 MiB per key). Preserve unrelated `state` and link properties when persisting.

Playlist parse results before import use this shape:

```json
{
  "sourcePath": "C:/Music/road-trip.m3u",
  "entries": [
    { "href": "C:/Music/first-light.flac", "title": "First Light", "duration": 238 },
    { "href": "C:/Music/night-signal.mp3", "title": null, "duration": null }
  ],
  "format": "m3u"
}
```

## Concerns / Open Questions

- **Play count meaning:** count the start of a successful playback activation once, rather than waiting for natural end; this includes short previews users actually started and avoids counting an open that never plays.
- Relative playlist entries are resolved against the imported playlist's parent. Entries that resolve to missing files remain in the preview with a missing marker and are not silently rewritten.
- URL entries can play through `content.open()` but their catalog identity remains the original URL. Do not fetch external metadata or add a network permission.
- Saved playlist ids survive renames and are intentionally independent of link order. Deleting a track leaves it out of future playback and produces a stale-id note until the user removes it.
- This task imports M3U/PLS. Export is not in EPIC-128 A7 and is out of scope.

## Acceptance Criteria

- [x] A catalog track increments `playCount` once per playback activation and gets a UTC `lastPlayed`; pause/resume and seeks do not double-count that activation.
- [x] Top Rated, Most Played, Recently Added and Recently Played use deterministic order and produce catalog mode queues.
- [x] Saved playlists persist ordered track IDs in `state.audioPlayer`, can be created/renamed/reordered/edited/deleted, and handle missing ids without crashing.
- [x] Saved playlist definitions are the only player state written to catalog `state.audioPlayer`; preferences use `persephone.storage` and A9 mode queue snapshots/cursors use `persephone.pageState`.
- [x] M3U parses BOM, CRLF, comments, EXTINF title/duration and relative paths; PLS parses indexed files/titles/lengths.
- [x] `.m3u` and `.pls` are claimed for import; `.m3u8` is not in the manifest masks.
- [x] Duplicate playlist entries are identified and do not create duplicate catalog links; uncatalogued entries can be imported or played from the preview.
- [x] Stats and playlist writes use the BT-039 fresh-read merge path and preserve unrelated file changes.
- [x] All visible strings use board language packs; no unit tests are added.
- [ ] **Live Persephone (Claude):** verify `.m3u` / `.pls` Open with/default resolution and that `.m3u8` still opens as HLS in Video Player.
- [ ] **Live Persephone (Claude):** import a playlist with relative paths, duplicates, missing entries, comments and UTF-8 titles; inspect playback and catalog file output.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/play-counts.js` | New - once-per-activation play statistics. |
| `boards/audio-player/smart-playlists.js` | New - deterministic derived smart lists. |
| `boards/audio-player/saved-playlists.js` | New - saved playlist CRUD and stable track references. |
| `boards/audio-player/playlist-import.js` | New - file picker, preview, duplicate handling, and catalog import/play. |
| `boards/audio-player/playlist-format.js` | New - M3U/PLS parsing and path resolution. |
| `boards/audio-player/playlist-queues.js` | New - playlist-to-catalog-queue projection. |
| `boards/audio-player/catalog-view.js` | Updated - playlist browsing and play statistics. |
| `boards/audio-player/app.js`, `player.js` | Updated - playlist integration and successful activation ids. |
| `boards/audio-player/index.html`, `styles.css` | Updated - themed playlist controls and import preview. |
| `boards/audio-player/board-manifest.json` | Updated - M3U/PLS masks, excluding M3U8. |
| `boards/audio-player/lang/*.json` | Updated - aligned strings in all 18 packs. |
| `boards/audio-player/WHATS-NEW.md`, `CLAUDE.md` | Updated - release note and board semantics. |
| `doc/tasks/BT-040-audio-playlists/README.md` | Updated - active status, checklist, and changed files. |
