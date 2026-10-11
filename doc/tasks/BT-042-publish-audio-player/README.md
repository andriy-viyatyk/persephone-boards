# BT-042: Publish Audio Player

## Status

**Status:** Planned  
**Priority:** High  
**Board id:** `audio-player`  
**Started:**  
**Completed:**

## Goal

Prepare the completed Audio Player board for its first published release with consistent version metadata, `WHATS-NEW.md`, a catalog screenshot, and the same English plus 17 translated language packs shipped by the reference boards. This task covers the board release only.

## Background

- Follow `CLAUDE.md` in this repo: `board-manifest.json` is the version source of truth; top `WHATS-NEW.md` heading must match it; every board declares a bare `screenshot.png`; task docs stay under `doc/tasks/`, outside the shipped ZIP.
- Follow publishable board patterns from `boards/torrent-viewer/board-manifest.json`, `boards/torrent-viewer/WHATS-NEW.md`, `boards/torrent-viewer/i18n.js`, `boards/torrent-viewer/lang/en.json`, and `boards/torrent-viewer/screenshot.png`.
- Ship the 17 non-English packs used by the reference boards: `be`, `de`, `es`, `et`, `fr`, `hu`, `it`, `ja`, `ko`, `lt`, `lv`, `pl`, `pt-BR`, `ro`, `sk`, `uk`, `zh-CN`, plus default English `en`.
- The site page and demo video have already been completed by Claude; keep only a pointer to those deliverables in the task/release tracking. They are not board files or acceptance work here.
- The board's final bridge floor is 1.38.0 (US-1689 source context at 1.37.0; US-1690 listing/remembered grants at 1.38.0). Set `minAppVersion` to the Persephone app release that ships bridge 1.38.0; current docs/live guide baseline is bridge 1.36.0, app 5.0.11, and is not the release target.

## Implementation Plan

- [ ] Finalize `boards/audio-player/board-manifest.json`: stable board identity/name/author/repository, `version: "1.0.0"` for initial publication, `screenshot: "screenshot.png"`, `minBridgeVersion: "1.38.0"`, `minAppVersion` from the Persephone release that includes bridge 1.38.0, stream-host/singleInstance and all final file masks/permissions/language declaration.
- [ ] Finalize `boards/audio-player/WHATS-NEW.md` with `## 1.0.0` at the top and one concise line summarizing the player, catalog, queue/playlists, equalizer and agent model. Ensure the heading exactly matches manifest `version`.
- [ ] Complete and compare `boards/audio-player/lang/en.json` plus all 17 translations. Every pack has identical message keys, same placeholder names and correct CLDR plural forms. Include manifest translations where used; preserve English as manifest source values and add localized `manifest.*` strings in translated packs.
- [ ] Capture `boards/audio-player/screenshot.png` from the running Persephone page after the player is populated with non-personal sample audio. Capture the content area below the page-tab strip, including board sidebar, editor switch and status footer, resize to 1120×700 (16:10), keep under about 300 KB, and declare the bare filename only.
- [ ] Check package contents for board-required files and licenses: local `music-metadata` MIT license/version, no CDN or network dependency, and no `ui.log`, `node_modules`, build cache or other development artifact intended for release.
- [ ] Recheck manifest masks: audio suffixes and `*.music.link.json` have Audio Player priority; `*.m3u` / `*.pls` are import claims; `*.m3u8` remains unclaimed.
- [ ] Confirm theme tokens style all board chrome (background, controls, panels and text), original visualizer palettes remain intact, and all board-visible text is translated; update board-specific `boards/audio-player/CLAUDE.md` with release file map and known WMA/permission/merge limitations.
- [ ] Verify release consistency before publishing: manifest version equals top changelog heading, no `audio-player-v1.0.0` release tag already exists, and screenshot manifest value is a separator-free filename. Publishing itself follows the develop → main automation documented in repo `CLAUDE.md`; do not hand-edit repository manifests.
- [ ] Keep the completed site page and demo video as a pointer only in tracking: “Claude — Persephone EPIC-128 site page and demo video (completed separately).”

## UI Layout

The screenshot should show a realistic populated player/catalog state: current track with themed album art or visualizer, transport/volume, a visible queue or catalog track list, and mode control. Capture the host app content below its tab strip so the image also includes Persephone's editor switch/sidebar/status context; avoid personal paths, profile names and private audio metadata.

## Data Shapes

The released catalog remains the A6 Link Editor structure. `state.audioPlayer` contains collection content only (for example, saved playlists); device preferences live in `persephone.storage`, and A9 queue snapshots/cursors live in `persephone.pageState`, with no release-specific schema migration:

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

Catalog link fields keep A6 types: `category: string`, `tags: string[]`, `artist/album: string`, `year: integer|null`, `rating: 0..5`, `playCount: integer >= 0`, `lastPlayed/addedAt: ISO timestamp|null`, `duration: seconds|null`; `imgSrc` is optional. Example `persephone.storage` preferences include `volume`, `muted`, `shuffle`, `repeat`, `visualizer`, equalizer/crossfade/gapless, `catalogPath`, `musicFolders`, and `lastMode`. Store each mode's queue snapshot/cursor through `persephone.pageState`; do not put preferences, catalogPath, or queues in the user catalog.

## Concerns / Open Questions

- Use an implementation-time manifest `minAppVersion` matching the Persephone release that ships bridge 1.38.0; do not infer it from the running 5.0.11 baseline.
- A screenshot is public catalog decoration. Use only safe sample metadata and paths; no user profile path or private content.
- Language pack completeness and `en-XA` extraction need the live board and Persephone. Fix untranslated visible strings before release; pack key/placeholder comparison can also be reviewed from files.
- The new board must have its own `WHATS-NEW.md` before the release ZIP is generated. The file ships inside the ZIP; screenshot is loaded from catalog and excluded from the ZIP by the publish script.
- Site page and demo video are already complete by Claude and remain pointer-only; no board task should duplicate them.

## Acceptance Criteria

- [ ] `board-manifest.json` names version `1.0.0`, minBridgeVersion `1.38.0`, correct release minAppVersion, language declaration and bare `screenshot.png`.
- [ ] Top `WHATS-NEW.md` heading is `1.0.0` and summarizes the initial board release.
- [ ] English plus 17 translated packs contain the same keys and placeholders; no invalid plural form or untranslated visible string remains.
- [ ] Screenshot is a non-personal 1120×700 PNG under about 300 KB showing real player/catalog content and the expected host chrome.
- [ ] All parser/license files are included; the board works offline and no development artifacts enter the board folder ZIP.
- [ ] Mask/priority check preserves `.m3u8` for Video Player while Audio Player claims audio, `.music.link.json`, `.m3u` and `.pls` as specified.
- [ ] Manifest version and top changelog heading match; release tag is not already present; generated manifests remain machine-owned.
- [ ] Site page and demo video are listed as the completed Claude pointer only. No unit tests are added.
- [ ] Release catalog sample stores collection content only in `state.audioPlayer`; device preferences are in `persephone.storage` and A9 queue snapshots/cursors are in `persephone.pageState`.
- [ ] **Live Persephone (Claude):** open the completed board on bridge 1.38.0, inspect rendered UI and `ui.log`, switch light/dark themes, and capture/inspect the screenshot framing.
- [ ] **Live Persephone (Claude):** check language extraction under `en-XA` and at least one non-English locale; ensure all 17 packs load without validation warnings.
- [ ] **Live Persephone (Claude):** verify the installed-board card, manifest masks/editor switch and catalog file round-trip before the release tag is created.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/board-manifest.json` | Final release identity/version, screenshot, bridge/app minimums, masks, permissions and packs. |
| `boards/audio-player/WHATS-NEW.md` | Initial `1.0.0` changelog shipped with the board. |
| `boards/audio-player/screenshot.png` | Public catalog screenshot at 1120×700. |
| `boards/audio-player/lang/en.json` | Final English source UI pack. |
| `boards/audio-player/lang/{be,de,es,et,fr,hu,it,ja,ko,lt,lv,pl,pt-BR,ro,sk,uk,zh-CN}.json` | 17 translated packs aligned with English keys. |
| `boards/audio-player/CLAUDE.md` | Final board-specific operations/release notes and known constraints. |
| Claude deliverables pointer | Persephone EPIC-128 site page and demo video are completed separately; pointer only. |
