# BT-075: Beat detection for the Circular visualizer

## Status

**Status:** In Progress
**Priority:** Medium
**Board id:** `audio-player`
**Started:** 2026-11-04
**Completed:**

## Goal

Make the Circular visualizer's inner ring pulse on the actual drum hits ("boom, boom") even when a
loud vocal or a heavily compressed master keeps the low band full. Do this with onset detection on a
narrow kick band (spectral flux plus an adaptive threshold), not by separating instruments.

## Background

Current behaviour, in `boards/audio-player/visualizer.js` and `effects/circular.js`:

- **One shared analyser.** `FFT_SIZE = 256` and `smoothingTimeConstant = 0.8`
  (`visualizer.js`, `ensureGraph`). This gives 128 bins of about 172–188 Hz each.
- **Inner ring band too wide.** The ring (`BANDS[0]`, `startFrac 0 → endFrac .06`) averages bins
  0–7, about 0–1.3 kHz. That mixes the kick (40–120 Hz, all inside bin 0) with the bass line and
  the singer's fundamentals and low harmonics.
- **Size follows level, not change.** `smoothedEnergy = prev * .62 + level * .38`, then
  `ringR = baseR + energy² * EXPANSION`.
  - A loud, compressed track keeps the level near the top, so the ring stays large and barely moves.
  - The analyser smoothing (0.8) plus the 0.62 blend removes most of a hit's attack.
- **Decibel scale.** `getByteFrequencyData` returns dB (log-compressed), which flattens the
  difference between "loud" and "loud + kick".
- **Shared signature.** `effect.draw(ctx, analyser, W, H, isDark)` is the effect signature, used by
  both `bars.js` and `circular.js`. The Bars effect must look exactly as it does today.

Technique: **spectral-flux onset detection.**

- Per frame, flux is the sum, over the kick band, of the *increase* in linear magnitude since the
  previous frame: `Σ max(0, mag_t − mag_t−1)`.
- A sustained vocal or bass note adds almost no flux. A drum hit adds a spike.
- A hit is declared when flux exceeds an adaptive threshold (`mean + K·std` over the last ~0.75 s),
  so the detector follows quiet and loud tracks alike.

## Implementation Plan

- [ ] **Dedicated beat analyser** in `visualizer.js` `ensureGraph`.
  - Create a second `AnalyserNode` with `fftSize = 2048` and `smoothingTimeConstant = 0`, connected
    as `master → beatAnalyser`.
  - Analysers are pass-through, automatically pulled nodes, so it needs no connection to the
    destination.
  - Leave the existing 256-bin analyser and its 0.8 smoothing untouched, so Bars and the
    Circular outer rings look the same.
  - Disconnect it in `dispose()`.
- [ ] **New `beat-detector.js`** (board root), loaded in `index.html` before `effects/bars.js`.
  - Expose `window.AudioBeatDetector.create(analyser)` → `{ update(nowSeconds), features, reset() }`.
  - **Bins.** Read `getFloatFrequencyData` (dB) and convert to linear magnitude with
    `10 ** (dB / 20)`. Compute the bin range from `analyser.context.sampleRate`:
    `bin = round(freq / (sampleRate / fftSize))`. Never hard-code bins.
  - **Kick band.** Default 40–150 Hz. Compute its flux and keep a ring buffer of recent flux values
    (≈0.75 s, counted in seconds, not frames).
  - **Onset rule.** An onset is declared when all three hold:
    - `flux > mean + K·std`;
    - `flux > absolute floor`, so silence and fade-outs do not trigger;
    - at least the refractory gap (~110 ms) has passed since the last onset.
  - **`features.kick` pulse (0..1).** On an onset, set it to `min(1, flux / threshold − 1)` scaled
    into a 0.6..1 range, so strong hits pulse bigger. Otherwise it decays as
    `pulse *= exp(−dt / DECAY)`, with DECAY ≈ 0.14 s, using the real frame `dt`.
  - **`features.kickLevel` (0..1).** The kick-band magnitude normalised by a slowly decaying
    running maximum (an automatic gain), so the ring can still "breathe" between clear hits.
  - **Constants.** Keep all tuning values in one commented constants block at the top: band edges,
    history seconds, K, floor, refractory, decay, and the AGC decay.
  - `reset()` clears history and pulse. Call it on track change and when the page is hidden, so a
    new track does not start with a stale threshold.
- [ ] **Wire it into the draw loop** in `visualizer.js`.
  - Create the detector in `ensureGraph`.
  - In `draw()`, call `detector.update(performance.now() / 1000)` before `effect.draw`, and pass
    `detector.features` as a new 6th argument:
    `effect.draw(ctx, analyser, W, H, isDark, features)`.
  - `bars.js` ignores the extra argument; no change there.
- [ ] **Drive the inner ring in `effects/circular.js` from the pulse.**
  - For `BANDS[0]` only: compute the ring radius from
    `drive = max(features.kick, features.kickLevel * LEVEL_SHARE)` instead of the averaged-energy
    term. `LEVEL_SHARE` is about 0.35, so steady level gives gentle breathing and hits give the
    jump.
  - Sparks and alpha for that ring should also follow `drive`, so a sustained vocal no longer
    keeps the ring bright and sparking.
  - The spike shapes (`smoothedBins`) and rings 1–2 stay as they are.
  - If `features` is missing (older call), fall back to the current behaviour.
- [ ] Add a line to `boards/audio-player/WHATS-NEW.md` under a new `## 1.0.2` heading and bump
  `board-manifest.json` `version` to `1.0.2`. This is done when the task closes, not before the user
  has tested.
- [ ] Update `boards/audio-player/CLAUDE.md`: add `beat-detector.js` to the "Key files" visualizer
  line.

## Concerns / Open Questions

- **Tuning is by ear.** The defaults above are starting points, and the user will judge them on
  their own tracks. That is why they live in one constants block.
  - If hits are missed on dense mixes, lower K (1.5 → 1.2).
  - If hi-hats or bass slides trigger it, raise the band floor or the refractory gap.
- **Latency.** A 2048-sample window is ~43 ms at 48 kHz, which is acceptable for visuals. A
  1024-sample window would react faster but separate the kick band less well. Keep 2048 unless
  testing shows lag.
- **Cost.** One extra 2048-point FFT per animation frame (done natively by the browser) is
  negligible.
- **Scope.** Snare or hi-hat bands for the other rings are possible with the same detector (it
  could compute several bands), but they are left out of this task. BT-076 covers richer
  per-instrument features.

## Acceptance Criteria

- [ ] On a track with a loud vocal over a steady kick, the middle and outer rings' radii visibly jump on each kick
  and settles between kicks.
- [ ] A vocal-only or pad-only passage does not make those rings jump.
- [ ] Quiet and loud tracks both pulse without manual adjustment (the threshold adapts).
- [ ] The Bars visualizer and all Circular rings look unchanged apart from the middle and outer rings' kick jumps.
- [ ] No pulse carries over across a track change or a hidden/visible page switch.
- [ ] `ui.log` is clean.
- [ ] Fully offline (no CDN / network).

## Files Changed

| File | Change |
|------|--------|
| `boards/audio-player/beat-detector.js` | New — spectral-flux kick detector |
| `boards/audio-player/visualizer.js` | Beat analyser, detector update per frame, `features` argument |
| `boards/audio-player/effects/circular.js` | Inner ring driven by the kick pulse |
| `boards/audio-player/index.html` | Load `beat-detector.js` |
| `boards/audio-player/CLAUDE.md` | Key-files line |
| `boards/audio-player/WHATS-NEW.md`, `board-manifest.json` | 1.0.2 (at completion) |

## Notes

- 2026-11-04, after user testing: driving the inner ring from the pulse showed the kicks clearly
  but looked worse. Final design: every ring renders exactly as before, and only the **middle
  (green) ring's radius** uses `max(bandEnergy, features.kick)`. Its brightness, sparks and spikes
  stay on band energy. The user then asked for the same on the **outer (blue) ring's radius**
  (`KICK_BANDS` in `circular.js`). The instant jump looked strobe-like, so the kick value is eased
  per frame in `circular.js` (`KICK_ATTACK` .07 s rise, `KICK_RELEASE` .4 s fall). `LEVEL_SHARE` was removed; `features.kickLevel` is still computed for later
  effects (BT-076).
