# BT-076: Harmonic/percussive separation for new visualizers

## Status

**Status:** In Progress
**Priority:** Low
**Board id:** `audio-player`
**Started:** 2026-11-04
**Completed:**

## Goal

Split the live spectrum into a **percussive** part (drums) and a **harmonic** part (voice, bass,
guitar, pads) in real time. Derive per-"instrument group" features from the two parts, so new
visualizer effects can draw drums, bass and vocals separately.

## Background

- **Depends on BT-075.** It adds the high-resolution beat analyser (2048-point FFT, no smoothing),
  the `features` object passed to `effect.draw(..., features)`, and the reset-on-track-change wiring.
  This task extends that pipeline. It does not create a second one.
- **HPSS (median-filtering HPSS, Fitzgerald 2010).**
  - On a spectrogram, sustained sounds form horizontal lines (constant frequency over time), and
    drums form vertical lines (broadband, short).
  - For each new frame `t` and bin `k`:
    - `H[k]` = median of `mag[k]` over the last ~N_h frames (time direction) → harmonic estimate.
    - `P[k]` = median of `mag_t[k−w..k+w]` (frequency direction) → percussive estimate.
    - Soft (Wiener) masks: `Mh = H² / (H² + P²)`, `Mp = P² / (H² + P²)`; then `harm = mag·Mh` and
      `perc = mag·Mp`.
  - It needs only a short ring buffer of past frames. The time median is causal, so the harmonic
    estimate lags by about N_h/2 frames, while the percussive output is available immediately.
- This is not full source separation. Neural models (Demucs and similar) separate vocals, drums,
  bass and other much better, but are heavy. They remain a possible later step, as an offline
  analysis of the file into a timeline. See Concerns.

## Implementation Plan

- [x] **`hpss.js`** (board root).
  - Run on the beat analyser's linear-magnitude frame.
  - Keep a frame ring buffer (N_h ≈ 17 frames, about 0.28 s at 60 fps).
  - Median along frequency with w ≈ 8 bins.
  - Produce `harmonic` and `percussive` `Float32Array`s.
  - Restrict processing to roughly 30 Hz – 8 kHz to keep the median cost low (see Concerns).
- [x] **Features:** `features.groups` contains fixed-dB-mapped, smoothed volume levels for
  percussive kick and hats and harmonic bass, vocals and other. Existing `features.kick` is unchanged.
- [x] **Instruments test effect**, registered with a picker button and English labels.
- [x] Update the `CLAUDE.md` key-files line.
- [ ] WHATS-NEW and version bump at completion, after user testing.

## Concerns / Open Questions

- **Visual design.** Instruments is a five-bar test effect; artistic effects are deferred.
- **CPU.** A per-bin time median over 1024 bins × 17 frames per frame is ~17k values to sort per
  frame. Limiting the range to ~350 bins and using a small insertion-sort median keeps it cheap. If
  it is not cheap enough, run HPSS every second frame.
- **Lag.** The harmonic estimate lags ~0.15 s. That is fine for slow-moving harmonic visuals but not
  for hits, so use the percussive side for anything rhythmic.
- **Vocals vs other instruments.** HPSS cannot tell a voice from a guitar or synth lead, since both
  are harmonic. If true vocal isolation becomes important, the next step is offline neural
  separation:
  - analyse the file once on load and cache a per-stem envelope timeline;
  - this needs a model download (tens of MB) and an ONNX/WebGPU runtime.
  - That would be a separate task.

## Acceptance Criteria

- [ ] Group levels follow their bands audibly (checked by ear on a few tracks).
- [ ] The new effect runs smoothly (no visible frame drops) on a typical track.
- [ ] Existing Bars/Circular effects are unchanged.
- [ ] `ui.log` is clean.
- [ ] Fully offline.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/hpss.js` | New — HPSS + group features |
| `boards/audio-player/visualizer.js` | Conditional analysis and reset wiring |
| `boards/audio-player/effects/instruments.js` | Five-bar test effect |
| `boards/audio-player/effects/effect-types.js`, `index.html`, `lang/en.json` | Register the effect and English labels |
| `boards/audio-player/CLAUDE.md` | Key-files line |

## Notes

- 2026-11-04, user decision: the first effect is a **test effect, "Instruments"**. It draws one
  labelled vertical bar per group, and each bar's height is that group's current volume. The
  artistic effects come later.
- 2026-11-04, user request: per-note volume (chromagram). `hpss.js` sums the harmonic spectrum
  over 400 Hz – 5 kHz into 12 pitch classes, giving `features.notes[12]`. Each note's value is its
  share of the strongest note, squared, times the overall loudness. The Instruments effect draws
  12 coloured dots (C … B) across the top, whose radius and glow grow with that note's volume.
- Note rain: a dot louder than `RAIN_MIN` (.55) emits drops of its colour, up to 30 per second at
  full volume. The drops fall under gravity and are drawn before the bars, so they pass behind them.
  The constants block is in `effects/instruments.js`.
- Ocean: the five bars were replaced by five layered waves, ordered far to near as other, vocals,
  hats, bass, kick. Each wave rises, swells and speeds up with its group's volume, and the rain
  falls into them. The note labels and group labels are no longer drawn, so the
  `visualizer.group.*` keys are unused; remove them at completion unless labels come back.
- Drops land on the wave nearest their colour (`NOTE_LAYER`). Each landing adds a ripple packet that
  runs outward along that wave's surface and fades (at most 40 per wave), plus three splash
  droplets. The constants are in `effects/instruments.js`.
- Clouds and lightning: the note dots are drawn as clouds (`CLOUD_PUFFS`). On a beat-detector kick
  onset there is a `LIGHTNING_CHANCE` of a strike, with a cooldown. It picks a loud cloud weighted by
  volume and draws a midpoint-displacement bolt with branches down to that note's wave, with a faint
  canvas flash and a splash where it hits.
