# BT-039: Audio Player — music catalog and catalog mode

## Status

**Status:** Active
**Priority:** High  
**Board id:** `audio-player`  
**Started:** 2026-10-11
**Completed:**

## Goal

Add a user-owned music catalog using Persephone's Link Editor JSON format, with categories, tags, artist/year/album/rating, add-on-open, folder import, search and catalog playback mode. Catalog edits, import, and mode switching share one merge-safe persistence path and keep the source/catalog queues independent.

## Background

- EPIC-128 A6 is the contract: any `.link.json` may be opened as the catalog; the board claims `*.music.link.json` above Link Editor; catalog data is `{ "type": "link-editor", "links": [...], "state": {...} }`; player metadata stays on each LinkItem; `state.audioPlayer` holds collection content only (including saved playlists), while device preferences use `persephone.storage` and queues/cursors use `persephone.pageState` per BT-038/A9.
- Persephone types: `C:/projects/persephone/src/renderer/editors/link-editor/linkTypes.ts` (`LinkEditorData`, `LinkItem`) and `C:/projects/persephone/src/renderer/api/types/io.tree.d.ts` (`ILink`: `id`, `title`, `href`, `category`, `tags`, `imgSrc`, plus link metadata). `LinkEditor` retains unknown per-link fields while changing known fields but discards unknown top-level keys; it preserves `state` as a whole.
- Reuse the existing Link Editor organization and singleton/i18n patterns from `boards/torrent-viewer/board-manifest.json`, `boards/torrent-viewer/lang/en.json`, `boards/torrent-viewer/i18n.js`, and `boards/torrent-viewer/board-base.css`. Use `av-grid` only if a true editable table is selected; Persephone recommends the vendored grid in `C:/projects/persephone/assets/board-template/CLAUDE.md`.
- Bridge dependencies: `persephone.openFileDialog()`, `saveFileDialog()`, `openFolderDialog()`, `readFile()`, `writeFile()`, `rememberFile()`, `rememberFolder()`, and paged `listFolder()` from US-1690 / bridge 1.38.0. `fileSystem: "board"` is required. Delivered files, picked-this-session files, files under remembered folders, and the initial stream-host file via `persephone.host.streamUrl()` are readable under the source read-grant rules; only a remembered exact-file grant enables catalog writes. Music folders are remembered folder grants and their path list is in `persephone.storage`.
- Source queue and initial `state.audioPlayer` shape: [`BT-038`](../BT-038-audio-player/README.md). Folder siblings use the already-captured US-1689 context; catalog mode is a board-derived queue.
- Tag parser decision: vendor MIT `music-metadata` 12.1.0 and its MIT license. Its published package is ESM and pulls Node-oriented dependencies, so do not load the npm package directly in the board frame. Add `boards/audio-player/scripts/build-metadata-bundle.mjs` using esbuild to bundle the parser's browser entry and only needed exports (`parseFromTokenizer`) into a browser IIFE at `boards/audio-player/lib/music-metadata.js`; the board-owned range tokenizer issues Range requests against the `board://` URL from `persephone.content.open()`. Pin exact `music-metadata` and esbuild versions in `package.json` and the lockfile; commit generated output and `lib/VERSION.txt` recording exact versions, command, source and build date. Keep the minified bundle at or below 2 MiB and gzip at or below 700 KiB; report measured sizes when generated. Disable full-file duration scans (`duration: false`) and bound tag/art bytes. No deprecated `music-metadata-browser`, CDN, or network permission.

## Implementation Plan

- [x] Add `boards/audio-player/catalog.js` as the single Link Editor-format parser and merge layer. Keep unknown per-link fields and unrelated state keys; serialize the canonical `{ type: "link-editor", links, state }` shape.
- [x] Add `boards/audio-player/catalog-store.js` for remembered path, exact-file grants, serialized read/merge/write, operation replay, and visible/focus external refresh.
- [x] Implement the stated merge rules: stable ids, normalized-href deduplication, field-only patches, latest-count increments, latest `lastPlayed`, stable `addedAt`, and tag fill-only-on-empty behavior. Read/merge/write still has the documented final read-to-write race because bridge 1.38.0 has no compare-and-swap.
- [x] Add catalog Open/New and direct-source flows. User-picked catalogs request exact-file grants before writes; direct `*.music.link.json` files stay read-only until `rememberFile(sourcePath)` is accepted, without another picker.
- [x] Add remembered Music-folder settings and paged recursive folder import with audio masks, progress, cancellation, deduplication and WMA reporting.
- [x] Add the Range tokenizer, metadata adapter, and pinned browser-bundle build script. The sandbox cannot install npm packages; the generated parser bundle and lockfile remain for Claude's online build.
- [x] Add catalog browse/search, category/tag/artist/year/decade/smart filters, editable track details, add-current action, and out-of-folder access flow.
- [x] Add Source/Catalog mode with separate persisted queue snapshots/cursors; mode switches do not stop the active track.
- [x] Extend all 18 language packs with aligned catalog, grant, folder, metadata, search and status strings.
- [x] Add the 1.1.0 changelog entry, board-specific catalog notes, MIT notice and parser version/build note.

## UI Layout

- The mode strip shows Source/Catalog, current queue origin and catalog name. The active track remains in the main player surface while changing the upcoming queue. Header/settings panel includes a compact Music folders list with Add folder and Remove actions.
- Catalog mode has a browse rail for category tree, tags, artists, year/decade and smart lists; the main pane shows a searchable track list with title, artist, album, year, rating and play count.
- Track details/edit panel shows cover image, editable title/artist/album/year, category, tags and 0–5 rating. A track that is not yet catalogued gets one Add action that opens a small native `<dialog>` for category/tags and metadata.
- Header actions include Open catalog, New catalog, Add tracks from folder, and Search. Exact-file/folder grant status and read-only state are visible near the catalog title. Add tracks from folder always offers to remember the picked folder. For a delivered catalog item outside the remembered Music folders, show a “no access” row/state with an “Add its folder to Music folders” action that launches the folder dialog at the item's containing folder then confirms `rememberFolder()`. Source-mode Add to catalog warns when the track's folder is outside Music folders.
- Source and catalog queues retain separate order/cursors; the transport stays shared and playback never stops on mode switch.

## Data Shapes

The catalog file is exactly the Link Editor root format. A track is a `LinkItem` with required Link Editor fields, plus the Audio Player fields named in EPIC-128 A6. The following example is valid JSON; `lastPlayed` is `null` until first play, times are ISO 8601 UTC strings, rating is 0–5, duration is seconds, and `imgSrc` is an image path/URL:

```json
{
  "type": "link-editor",
  "links": [
    {
      "id": "track-01",
      "isDirectory": false,
      "title": "First Light",
      "href": "C:/Music/first-light.flac",
      "category": "Ambient/Focus",
      "tags": ["ambient", "instrumental"],
      "imgSrc": "C:/Music/Quiet Machines/cover.jpg",
      "artist": "Aster Vale",
      "year": 2024,
      "album": "Quiet Machines",
      "rating": 4,
      "playCount": 0,
      "lastPlayed": null,
      "addedAt": "2026-10-11T12:00:00.000Z",
      "duration": 238.4
    }
  ],
  "state": {
    "audioPlayer": { "savedPlaylists": [] }
  }
}
```

`category` is the Link Editor category path string (empty string for uncategorized/root); `tags` is `string[]`; `imgSrc` is optional; `artist`/`album` are strings; `year` is an integer or null; `rating` is numeric 0–5; `playCount` is a non-negative integer; `lastPlayed` is an ISO timestamp or null; `addedAt` is an ISO timestamp; `duration` is finite seconds or null. Preserve other link properties unknown to the board. Preserve unrelated root state; `state.audioPlayer` describes collection content only (for example, saved playlists). Device preferences including `catalogPath`, mode and Music folders live in `persephone.storage`; source/catalog queue snapshots and cursors live in `persephone.pageState` as serialized strings (10 MiB/key). Mode names are `source` / `catalog`; catalog queue kinds include `all`, `category`, `tag`, `artist`, `year`, `decade`, `search`, and `smart`.

Device preference example stored in `persephone.storage`:

```json
{"volume":0.8,"muted":false,"shuffle":false,"repeat":"off","visualizer":"bars","catalogPath":"C:/Music/library.music.link.json","musicFolders":["C:/Music"],"lastMode":"catalog","equalizer":{"enabled":false,"bandsDb":[0,0,0,0,0,0,0,0,0,0],"preset":"flat"},"crossfadeSeconds":0,"gapless":true}
```

Queue snapshots/cursors are stored in `persephone.pageState` (`set("audio-queues", JSON.stringify(value))`), independently for `source` and `catalog`, with original hrefs and `nextIndex`. They never go in the catalog file.

## Concerns / Open Questions

- **Merge without CAS:** the board bridge can reread and merge immediately before writes but cannot atomically compare a file revision. Serialize local writes and refresh external edits while visible/on focus, then merge local patches onto the newest read. A truly simultaneous write in the final read-to-write interval can still win; expose a conflict/reload message if detected on the next read.
- **Polling cost:** no board bridge file-watch method is declared for a remembered exact file. Poll/read only while visible, debounce and compare content before reparsing; always reread before writes. Revisit only if actual catalog sizes make this costly.
- The Link Editor drops unknown top-level keys. Keep only collection content in `state.audioPlayer`; use the host storage/page-state APIs for preferences and queues. Do not add a `playerSettings` root property.
- No writes to audio metadata tags are in scope. Catalog metadata is separate from file tags; parser data only fills empty fields and embedded art is not copied into the catalog JSON.
- The parser bundle is built and pinned as specified above; verify its committed size is at most 2 MiB minified / 700 KiB gzip. Keep the range tokenizer on the same board origin, require valid partial-content response semantics, and bound tag/cover bytes so malformed metadata cannot allocate unbounded memory.
- A `*.music.link.json` opened directly via editor association is readable as the delivered host source. Request the US-1690 `rememberFile(sourcePath)` extension for this board's own delivered source file only (not context siblings); on first edit call it and rely on Persephone's confirmation. Until confirmed, remain read-only. No extra picker is shown.
- Folder grants permit list/read only; catalog files still need the separate exact-file grant for writes.

## Acceptance Criteria

- [ ] A picked `.link.json` or `.music.link.json` loads as the `{type, links, state}` Link Editor format and can be reviewed in Link Editor.
- [ ] `*.music.link.json` opens in Audio Player by default above Link Editor; the editor switch still permits Link Editor review.
- [x] Link records contain the exact A6 fields and accepted types; unknown per-link keys and unrelated `state` keys survive board writes.
- [ ] Open/New catalog uses exact-file `rememberFile()` consent; grant denial/cancel keeps the catalog read-only, and a remembered catalog reopens after app restart.
- [ ] Editing a catalog opened directly from Explorer calls `rememberFile(sourcePath)` on first edit, gets host confirmation without an extra file picker, and stays read-only if declined.
- [x] Add-on-open reports catalog membership and adds one track with user-selected category/tags; existing hrefs are not duplicated.
- [x] Add tracks from folder uses `listFolder()` pagination and audio masks, adds tracks uncategorized, skips duplicates, and surfaces WMA unsupported state.
- [x] Music folders can be added/removed in the settings panel; persisted paths are in `persephone.storage`, and added folders are remembered through `rememberFolder()`. Add tracks from folder always offers to remember the selected folder.
- [x] Delivered catalog tracks outside Music folders can play while delivered; Catalog mode shows “no access” and offers “Add its folder to Music folders” via a folder dialog started there then `rememberFolder()`. Source-mode Add to catalog warns if the track folder is outside Music folders.
- [x] Categories, tags, artist, album, year/decade, rating, search, and smart list queues populate catalog mode; mode switching leaves the active track running and each mode restores its own saved queue/cursor.
- [x] Preferences (including `catalogPath`, Music folders and last mode) are in `persephone.storage`; A9 queue snapshots/cursors are in `persephone.pageState`; catalog `state.audioPlayer` contains collection content only.
- [x] Editing a subset of fields preserves untouched current/unknown fields; play counts increment against the latest count; metadata parsing never overwrites nonempty user values.
- [ ] Parser is vendored with license/version notices, built by the pinned esbuild script from exact package versions recorded in `lib/VERSION.txt`; committed browser output is at most 2 MiB minified / 700 KiB gzip, reads `board://` via Range requests, and uses no CDN or online metadata service.
- [x] Every write serializes locally, rereads the latest catalog before merging, and preserves unrelated external edits where possible; observed external changes reload the UI.
- [x] All UI strings use board language packs; no unit tests are added.
- [ ] **Live Persephone (Claude):** verify bridge 1.38.0 `listFolder`, `rememberFolder`, and `rememberFile` behavior with accepted/cancelled confirmation, including direct-open catalog `rememberFile(sourcePath)` confirmation and no extra picker; verify remembered grants survive restart / appear in Board Info.
- [ ] **Live Persephone (Claude):** verify Music folder add/remove, source-mode warning for an outside-folder track, and catalog-mode no-access/folder-add flow for a delivered track after its session grant expires.
- [ ] **Live Persephone (Claude):** open the same catalog in Link Editor and Audio Player, edit from both, and confirm external changes appear and unrelated fields/links are preserved after each write.
- [ ] **Live Persephone (Claude):** test an audio file and catalog opened by mask, user-picked catalog, recursive folder import, Range-based tag/art reads, and `ui.log`.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/catalog.js` | New — Link Editor format parsing and catalog operations. |
| `boards/audio-player/catalog-store.js` | New — remembered path, serialized read/merge/write, external-refresh strategy and conflict handling. |
| `boards/audio-player/catalog-dialogs.js` | New — catalog picker/create flows and exact-file grant requests. |
| `boards/audio-player/folder-import.js` | New — paged folder scan, duplicate detection and uncategorized adds. |
| `boards/audio-player/metadata.js` | New — parse and map common audio tags/art into empty catalog fields. |
| `boards/audio-player/lib/music-metadata.js` | Pending — generated browser bundle; npm registry is unavailable in this sandbox. |
| `boards/audio-player/scripts/build-metadata-bundle.mjs` | New — pinned esbuild browser bundle build step. |
| `boards/audio-player/package.json` | New — exact parser and esbuild build-tool pins. |
| `boards/audio-player/package-lock.json` | Pending — generate with `npm install` when Claude runs the bundle build. |
| `boards/audio-player/lib/board-range-tokenizer.js` | New — Range-backed tokenizer over the content.open board URL. |
| `boards/audio-player/lib/LICENSE.music-metadata` | New — upstream MIT license. |
| `boards/audio-player/lib/VERSION.txt` | New — vendored parser version/source and build details. |
| `boards/audio-player/catalog-view.js` | New — category/tag/artist/year browsing and track edit UI. |
| `boards/audio-player/catalog-search.js` | New — text search and catalog predicates. |
| `boards/audio-player/player.js` | Updated — mode switching, catalog membership and add-on-open integration. |
| `boards/audio-player/source-queue.js` | Updated — maintain independent source/catalog queue slots. |
| `boards/audio-player/app.js` | Updated — catalog loading, view routing, i18n and mode UI wiring. |
| `boards/audio-player/lang/*.json` | Updated — catalog, import, metadata and grant strings in English and 17 translations. |
| `boards/audio-player/board-manifest.json` | Updated — `*.music.link.json` association and catalog description; existing bridge/app minimums and file permission were already sufficient. |
| `boards/audio-player/WHATS-NEW.md` | Updated — catalog and catalog-mode release entry. |
| `boards/audio-player/CLAUDE.md` | Updated — catalog schema, grant and merge-policy notes. |
