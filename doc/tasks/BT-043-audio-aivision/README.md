# BT-043: Audio Player — ai-vision model

## Status

**Status:** In Progress  
**Priority:** Medium  
**Board id:** `audio-player`  
**Started:** 2026-10-11  
**Completed:**

## Goal

Expose the catalog and playback as a useful AiVision model so an agent can inspect organization gaps, make single or bulk catalog edits, add a granted folder's tracks, and control playback/queues. All model writes use the same merge/undo path as the UI.

## Background

- Follow the `persephone.aiVision.expose()` model pattern and async-shape refresh rule in `boards/pdf-viewer/pdf-aivision.js` and `boards/excel-viewer/xlsx-aivision.js`: stable descriptive `MEMBERS`, bounded read methods, validated writes, a clear help string, and `remote.refresh()` once loaded and when the model shape changes.
- Persephone author rules: `C:/projects/persephone/assets/guides/agents/boards.md` (board's own `.app` model) and `C:/projects/persephone/assets/board-template/CLAUDE.md` (AiVision authoring). Agent methods complete without in-board confirm dialogs; expose direct operations and leave confirmation to the UI.
- EPIC-128 A10 defines fields, gap queries, category operations, folder adds, and controls. A6 catalog links and merge rules are documented in [`BT-039`](../BT-039-audio-catalog/README.md); playback/settings/queue state is in [`BT-038`](../BT-038-audio-player/README.md).
- Folder scanning uses `persephone.listFolder()` and depends on US-1690 bridge 1.38.0. `fileSystem: "board"` plus user folder/file grants is sufficient; do not add service, execute, appScripting, or network permissions for this model. AiVision exposure itself is available on a trusted board without `appScripting`.

## Implementation Plan

- [x] Add `boards/audio-player/ai-vision.js` with an `AudioPlayer` model exposed by `persephone.aiVision.expose(model)`. Keep it attached to the board object and register from main frame only.
- [x] Describe indexable catalog collections for `tracks`, `categories`, `tags`, `artists`, `missingMetadata`, and no-access tracks. Include the A6 track fields and return plain JSON, not DOM/Audio objects or library prototypes.
- [x] Implement bounded/paged `listTracks(options?)` and targeted missing-field queries (`missingCategory`, `missingArtist`, `missingYear`, `missingAccess`); filters cover text, category, tag, artist, year, and access. Results include totals and continuation cursors. Access reflects session-delivered files, URLs, and remembered Music folders.
- [x] Implement `getCategories()`, `getTags()`, `getArtists()`, and `getNowPlaying()` with stable IDs/values and current source/catalog mode/queue details.
- [x] Implement validated `updateTracks(ids, patch)` for category, tags, artist, year, album, and rating as one merge-safe catalog operation and one undo record.
- [x] Implement `createCategory(path)`, `renameCategory(oldPath, newPath)`, and `moveCategory(path, parentPath)` with normalized paths and consistent descendant updates.
- [x] Implement `addTracksFromFolder(folderPath, options?)` with authorized paged audio listing, optional local tag parsing, useful counts, and no model-side picker or grant request. No-access folder actions return immediately for the UI to resolve.
- [x] Implement `play(trackIdOrHref)`, `pause()`, `next()`, `setMode("source" | "catalog")`, and `setQueue(...)` with resulting mode/cursor information and no dialog waits.
- [x] Add one-step `undoLastBulkEdit()` with field preimages merged by track id; clear it when an external or subsequent edit conflicts.
- [x] Refresh the AiVision shape after asynchronous collection population and category shape changes, while leaving ordinary playback updates stable.
- [x] Add translated agent help and Undo UI strings in all 18 packs; document the model path and sample calls in `CLAUDE.md`.

## UI Layout

No new view is required. Reuse the catalog and player layout from BT-039 and BT-038. Mark the currently playing row and the curated controls with stable `data-name` values if `createElements()` is used; do not publish selectors for the nested canvas/media controls if they cannot be resolved in the board document. Show a single-step Undo action after bulk catalog edits, including edits initiated through the model.

## Data Shapes

AiVision track values use the Link Editor catalog fields from A6, returned as plain objects. This is the canonical catalog shape and a representative model result:

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
      "savedPlaylists": []
    }
  }
}
```

`missingMetadata` is a computed list of `{ id, href, title, missing: string[] }`; `missingAccess` is a computed list of `{ id, href, title, access: "no-access", folderPath, action: "open-folder-dialog" }`; `listTracks()` reports access status. `nowPlaying` contains `{ id?, href, title, artist?, mode, sourceLabel?, position, duration?, paused }`; `listTracks()` returns `{ items, total, nextCursor?, truncated }`. `updateTracks()` accepts `{ category?: string, tags?: string[], artist?: string, year?: number | null, album?: string, rating?: number }` and applies only supplied fields. Device preferences (`volume`, `muted`, `shuffle`, `repeat`, visualizer, EQ/crossfade/gapless, `catalogPath`, `musicFolders`, `lastMode`) are in `persephone.storage`. A9 source/catalog queue snapshots and cursors are in serialized `persephone.pageState` values (10 MiB per key). Catalog `state.audioPlayer` contains collection content only, including saved playlists. The model returns `href`, never ephemeral `board://` content URLs.

## Concerns / Open Questions

- Bulk edits must be one undo step even if many catalog links change. Store a single transaction record keyed by link id and field preimage, not one record per field or track.
- A user must grant folder/file access in the interactive UI. The model cannot present a native picker or confirmation dialog; it reports `missingAccess` and returns a nonblocking `needs-user-action` folder-add result that the UI turns into a folder dialog and `rememberFolder()` flow. Music folders are remembered grants, with the displayed list in `persephone.storage`.
- Track collections may be large; shape `index(0)` must exist when exposed or the model must call `refresh()` after first load, as both reference boards document.
- Category rename/move affects descendants; normalize slash separators and prevent category cycles/empty segments before applying one merged catalog write.
- Only return catalog metadata already present or parsed locally. Agent research may fill missing artist/year externally, but the board itself makes no online metadata requests.
- Playback is a side effect; describe it clearly and return the selected href/mode. AI Vision member cautions should identify play/pause/next/mode/queue changes.

## Acceptance Criteria

- [x] `pages[pageId].editor.app` exposes an Audio Player model with help/describe data and readable tracks, category tree, tags, artists, metadata gaps, and current playback.
- [x] Reads return plain JSON with all A6 link fields, plus result bounds/cursors for large catalogs.
- [x] Reads report tracks outside delivered sources and remembered Music folders as `no-access`; UI folder grants remain interactive and model calls return immediately.
- [x] Bulk metadata edits and category changes use the catalog merge layer; a bulk edit has exactly one undo action.
- [x] Category create/rename/move updates descendant paths and the catalog UI/tree.
- [x] `addTracksFromFolder()` uses authorized bridge listing only and returns useful counts without a dialog.
- [x] Agent controls play/pause/next, source/catalog mode, and queue selection.
- [x] Initial empty collections refresh after load; category shape changes refresh the model.
- [x] Model methods do not prompt, use external services, or write around the BT-039 merge layer. No unit tests were added.
- [x] Preferences remain in `persephone.storage`, source/catalog queues in `persephone.pageState`, and collection content in catalog `state.audioPlayer`.
- [ ] **Live Persephone (Claude):** inspect `pages[pageId].editor.app`, call `$help`/`$describe`, and verify indexed tracks after asynchronous catalog load.
- [ ] **Live Persephone (Claude):** exercise a bulk edit, single undo, playback control, mode/queue control, and a granted/ungranted folder scan through `persephone.call`/the agent path; verify no dialog blocks the method.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/ai-vision.js` | New — exposed catalog/playback model, validation, descriptions and bounded reads. |
| `boards/audio-player/app.js` | Updated — expose model once and refresh it when catalog shape changes. |
| `boards/audio-player/catalog.js` | Updated — shared normalized read/query/category operations. |
| `boards/audio-player/catalog-store.js` | Updated — one-transaction bulk edit, undo record and model write integration. |
| `boards/audio-player/folder-import.js` | Updated — authorized-folder scan callable without dialog. |
| `boards/audio-player/catalog-view.js` | Updated — saved category tree and playing-track marker. |
| `boards/audio-player/source-queue.js` | Updated — serializable agent source queue setter. |
| `boards/audio-player/index.html` | Updated — model script and accessible Undo control. |
| `boards/audio-player/lang/*.json` | Updated — AiVision help and user-facing model operation text. |
| `boards/audio-player/CLAUDE.md` | Updated — `.app` model paths, constraints and examples. |
