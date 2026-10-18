# BT-041: Audio Player — equalizer, crossfade, gapless

## Status

**Status:** Active
**Priority:** Medium
**Board id:** `audio-player`
**Started:** 2026-10-11
**Completed:**

## Goal

Add a user-adjustable graphic equalizer, optional track crossfade, and gapless preloading to the Audio Player. Keep the feature offline and implement it in the board's Web Audio/player graph without a service or external audio library.

## Background

- Player and source/catalog queue lifecycle are described in [`BT-038`](../BT-038-audio-player/README.md); catalog collection persistence and merge layer are described in [`BT-039`](../BT-039-audio-catalog/README.md).
- The existing audio graph and analyser are in `C:/projects/persephone/src/renderer/editors/video/AudioVisualizer.ts`; its current `MediaElementAudioSourceNode → AnalyserNode → destination` graph must become an equalizer/mixer graph while preserving the visualizer API and original effect palette behavior (see BT-038).
- Theme and player controls use tokens/CSS from `boards/torrent-viewer/board-base.css` and `boards/torrent-viewer/board-manifest.json` conventions. Keep all board UI on Persephone `--p-*` tokens.
- Web Audio (`AudioContext`, `BiquadFilterNode`, `GainNode`) and HTMLMediaElement are browser primitives; no extra permissions, package, backend service, or network access is needed.

## Implementation Plan

- [x] Refactor `boards/audio-player/player.js` to own two media decks and a shared `AudioContext` graph: each deck source → per-deck gain → ten biquad filters → master volume → analyser → destination. Connect each media element to `createMediaElementSource()` once and dispose nodes/listeners with the page.
- [x] Add `boards/audio-player/equalizer.js` to create ten `BiquadFilterNode`s at 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k and 16k Hz. Use low-shelf on the first band, high-shelf on the last, peaking filters for the middle bands, `Q = 1.4`, and clamp each gain to −12..+12 dB. Neutral preset is all zeros; provide Flat, Bass, Treble and Vocal presets as explicit band values.
- [x] Add `boards/audio-player/crossfade.js` to pre-open the next playable item and schedule outgoing/incoming deck gain ramps against `AudioContext.currentTime`. `crossfadeSeconds` range is 0–12 in 0.5-second steps; zero bypasses fades. Avoid overlapping more than two tracks, preserve current queue cursor, and cancel/replace stale scheduled ramps on skip or queue change.
- [x] Add `boards/audio-player/gapless.js` to preload the next queue item before the active track ends, wait for `canplay`, and swap immediately on `ended` when possible. Keep the crossfade scheduler separate so gapless mode can be on with zero crossfade.
- [x] Update `boards/audio-player/visualizer.js` to attach the analyser after EQ/mix/master gain, use the active analyser while both decks blend, and keep the source graph connected exactly once. Keep the theme-bound canvas effect colors unchanged by audio routing.
- [x] Add `equalizer`, `crossfadeSeconds`, and `gapless` controls in `boards/audio-player/player-settings.js` and `catalog-view.js`; store device preferences in `persephone.storage` (not the catalog) and update them when edited.
- [x] Add a 10-slider EQ panel with value labels, preset selector, master bypass, and Reset-to-Flat. Add a crossfade duration slider/toggle and a Gapless toggle near playback settings. All labels/tooltips use board i18n.
- [x] Update the 18 language packs, `WHATS-NEW.md`, and `CLAUDE.md` with settings/defaults, overlap behavior, and browser decoder limitations.

## UI Layout

- Put Equalizer in a compact collapsible panel below or beside the player, with a preset selector, Enable toggle, 10 vertical band sliders, and a Reset button.
- Put Gapless and Crossfade controls in playback settings. Crossfade shows its current duration (Off, then 0.5–12 seconds); Gapless shows whether the next decoder is preloaded.
- Keep the active track controls and queue visible while settings are open. When the next track cannot be decoded or preloaded, show a brief themed status message and fall back to ordinary `ended`/next handling.

## Data Shapes

Catalog records continue to use the exact A6 Link Editor record fields in `links[]`; catalog `state.audioPlayer` contains collection content only. Example device preferences in `persephone.storage`:

```json
{
  "volume": 0.8,
  "muted": false,
  "shuffle": false,
  "repeat": "off",
  "visualizer": "bars",
  "catalogPath": "C:/Music/library.music.link.json",
  "musicFolders": ["C:/Music"],
  "lastMode": "catalog",
  "equalizer": { "enabled": false, "bandsDb": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "preset": "flat" },
  "crossfadeSeconds": 0,
  "gapless": true
}
```

`bandsDb` has exactly ten finite numbers clamped to −12..+12; `preset` is `flat`, `bass`, `treble`, `vocal`, or `custom`. `crossfadeSeconds` is 0–12; `gapless` and `equalizer.enabled` are booleans. A9 source/catalog queue snapshots and cursors are JSON strings in `persephone.pageState`; they are not in the catalog file. `state.audioPlayer` remains collection content only. Existing A6 fields remain: rating 0–5, playCount non-negative integer, UTC ISO timestamps, duration finite seconds/null.

## Concerns / Open Questions

- Crossfade requires two decodable sources at once. Unsupported formats, sources that do not preload, and network-backed sources that stall must fall back to a normal track transition without blocking controls.
- MediaElementAudioSourceNode can be created only once per media element. Keep a fixed pair of deck elements and own them for the page lifetime; do not recreate a source node on each track change.
- Rewire the analyser after equalizer and deck gains so visualizer output reflects the actual combined signal, while preserving `AudioContext` resume handling after a user gesture.
- Crossfade temporarily plays two items; play statistics should record the incoming track only when it becomes the active playback item, not when preloading begins.
- US-1688 already confirmed background playback and media keys; keep them as regression checks only, with no broad app workaround in this task.

## Acceptance Criteria

- [x] Equalizer has 10 bands at the documented center frequencies, clamps range, supports Flat/Bass/Treble/Vocal presets and bypass, and survives reload through `persephone.storage`.
- [ ] Zero crossfade preserves ordinary transitions; 0.5–12-second crossfade audibly ramps between two decks and does not change queue order.
- [ ] Gapless preloads the next supported source and starts it at end with no intentional timer gap; failed preload degrades cleanly.
- [ ] Shuffle, mode changes, skip, seek, pause and repeated source opens cancel/recompute pending fade/preload without stale audio leaking.
- [ ] Visualizer analyser hears the EQ/master output and remains functional across deck swaps; board chrome updates from theme tokens and the effect palettes remain unchanged.
- [x] Settings and status copy use all language packs; colors use `--p-*`; no unit tests are added.
- [x] EQ, crossfade and gapless values are persisted in `persephone.storage`; source/catalog queue snapshots and cursors remain in `persephone.pageState`, not catalog `state.audioPlayer`.
- [ ] **Live Persephone (Claude):** audition flat vs presets/bands, zero/short/long crossfade, gapless and rapid skip in at least two supported formats.
- [ ] **Live Persephone (Claude):** regression-check playback while the board tab is inactive and media-key behavior (both already confirmed by US-1688); inspect `ui.log` for audio-context, CSP and promise errors.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/equalizer.js` | New — ten-band Web Audio filters and presets. |
| `boards/audio-player/crossfade.js` | New — two-deck gain scheduling and cancellation. |
| `boards/audio-player/gapless.js` | New — next-item preload and zero-gap swap. |
| `boards/audio-player/player-settings.js` | New — persisted audio settings, validation and UI projection. |
| `boards/audio-player/player.js` | Updated — fixed dual-deck media graph and per-deck EQ routing. |
| `boards/audio-player/visualizer.js` | Updated — analyser after mix/EQ/master output. |
| `boards/audio-player/catalog-view.js` | Updated — EQ, gapless and crossfade panels. |
| `boards/audio-player/catalog-store.js` | Updated — persist effect settings via merge layer. |
| `boards/audio-player/lang/*.json` | Updated — EQ, preset, gapless and crossfade strings. |
| `boards/audio-player/WHATS-NEW.md` | Updated — equalizer, crossfade and gapless notes. |
| `boards/audio-player/CLAUDE.md` | Updated — Web Audio graph, defaults and deck lifecycle. |
