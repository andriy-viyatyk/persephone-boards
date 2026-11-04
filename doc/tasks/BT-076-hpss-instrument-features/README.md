# BT-076: Harmonic/percussive separation for new visualizers

## Status

**Status:** Planned
**Priority:** Low
**Board id:** `audio-player`
**Started:**
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

- [ ] **`hpss.js`** (board root), or extend `beat-detector.js` if it stays small.
  - Run on the beat analyser's linear-magnitude frame.
  - Keep a frame ring buffer (N_h ≈ 17 frames, about 0.28 s at 60 fps).
  - Median along frequency with w ≈ 8 bins.
  - Produce `harmonic` and `percussive` `Float32Array`s.
  - Restrict processing to roughly 30 Hz – 8 kHz to keep the median cost low (see Concerns).
- [ ] **Features**, added to the shared `features` object:
  - `drums` — onset pulse from percussive-only spectral flux, full range. Optionally
    `drumsLow` (kick) and `drumsHigh` (snare and hats) as separate pulses.
  - `bass` — harmonic energy, 40–250 Hz, automatically gain-normalised.
  - `vocals` — harmonic energy, ~250 Hz – 4 kHz (a "voice-range harmonic" proxy, not true vocal
    isolation).
  - `harmonicSpectrum` / `percussiveSpectrum` — the raw arrays, for effects that want to draw them.
- [ ] **Optional:** switch BT-075's kick detector to percussive-only flux if it proves cleaner.
- [ ] **New effect(s)** in `effects/`, registered in `effects/effect-types.js`, with a picker button
  and translated labels in all `lang/` packs.
  - The visual design is to be agreed with the user before implementation. Starting idea: one
    element per group, e.g. a drum shockwave ring, a bass "floor" wave and a vocal ribbon.
- [ ] `CLAUDE.md` key-files line; WHATS-NEW and version bump at completion.

## Concerns / Open Questions

- **Visual design of the new effect(s) is open.** Decide this with the user before implementing.
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

- [ ] `drums` pulses on hits and stays quiet on sustained vocal/pad passages.
- [ ] `bass` and `vocals` follow their parts audibly (checked by ear on a few tracks).
- [ ] The new effect runs smoothly (no visible frame drops) on a typical track.
- [ ] Existing Bars/Circular effects are unchanged.
- [ ] `ui.log` is clean.
- [ ] Fully offline.

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/hpss.js` | New — HPSS + group features |
| `boards/audio-player/effects/<new>.js` | New effect(s) |
| `boards/audio-player/effects/effect-types.js`, `index.html`, `lang/*` | Register the effect, picker label |

## Notes
