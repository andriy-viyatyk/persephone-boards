# BT-092: Make the Wake Word detection gate tunable from board settings

## Status

**Status:** Planned
**Priority:** Medium
**Board id:** `wake-word`
**Started:** —
**Completed:** —

## Goal

Expose the wake-detection gate and rate-limit constants in `scripts/service.mjs` as board settings, so a
machine whose noise floor differs from the shipped assumption can be calibrated without editing board
source.

## Background

BT-091 replaced the fixed absolute level gate with an adaptive one (noise floor × factor). While tuning it
on a loud-fan laptop the factor had to be raised from enrollment's 2.4 to **3.5**, because at 2.4 that
fan still pushed 1.24% of windows over the bar — roughly six gate openings per 10 s, each latching for
`GATE_HOLD_MS`. That is the whole argument for this task: **a single shipped constant cannot fit every
machine**, and today the only remedy is editing `service.mjs` inside an installed board.

Measured on that laptop (10 s, 484 windows, fan spun up) — keep as the calibration reference:

| | value |
|---|---|
| p20 (noise floor) | 0.00438 |
| median | 0.00456 |
| p99 / max | 0.01148 / 0.0127 |
| factor 2.4 → gate 0.0105 | **1.24%** of windows above |
| factor 3.0 → gate 0.01313 | 0% |
| factor 3.5 → gate 0.01532 | 0% |

The same fan measured between 13.9% and 90.3% of windows above the old fixed 0.006 gate depending on fan
speed, which is why the floor must stay adaptive rather than become a user-entered absolute number.

**Precedent to follow — `boards/translate`:** a `type: "number"` manifest setting (`idle-unload-minutes`),
read through an `applySetting(id, value)` that clamps with `Math.max(min, Math.min(max, n))` and falls back
to the shipped default, wired to both `persephone.settings.onChange(...)` and an initial
`persephone.settings.get(...)` (`boards/translate/scripts/service.mjs:273-281`).

**Already in this board:** one setting, `caller-approval-policy`, read at `scripts/service.mjs:61-64`.

**Measurement surface:** the board page already renders `Best score {score} · level {level} · gate {gate}`
(`live.score`, 18 packs) from the diagnostics channel, so a user can watch level against gate while tuning.

## Implementation Plan

- [ ] **1. Add settings to `boards/wake-word/board-manifest.json`**, alongside `caller-approval-policy`.
      Defaults MUST equal the currently shipped constants so behaviour is unchanged out of the box.

      | setting id | type | default | clamp | replaces |
      |---|---|---|---|---|
      | `gate-noise-factor` | number | 3.5 | 1.5 – 8 | `GATE_NOISE_FACTOR` |
      | `gate-floor-rms` | number | 0.006 | 0.001 – 0.05 | `GATE_RMS` |
      | `gate-hold-ms` | number | 400 | 100 – 2000 | `GATE_HOLD_MS` |
      | `gate-noise-window-ms` | number | 5000 | 1000 – 20000 | `GATE_NOISE_WINDOW_MS` |
      | `default-threshold` | number | 0.85 | 0 – 1 | `DEFAULT_THRESHOLD` |
      | `refractory-ms` | number | 1500 | 250 – 10000 | `REFRACTORY_MS` |

- [ ] **2. Add a settings module to `scripts/service.mjs`** mirroring `translate`: a `settingIds` array, a
      `settings` object seeded with the shipped defaults, an `applySetting(id, value)` that clamps every
      value, and `onChange` + initial `get` wiring. Keep the `const` declarations as the named default
      values so the defaults live in exactly one place.

- [ ] **3. Replace the constant reads** at their use sites: `gateLevel()` (factor, floor), `processChunk()`
      (hold, window, floor), `handleHit()` (refractory), and the `listen` open path
      (`operation.threshold = open.threshold ?? settings.defaultThreshold`).

- [ ] **4. Apply changes to live sessions.** The gate values are read per chunk, so they take effect
      immediately — except `gate-noise-window-ms` **shrinking**, which leaves stale entries in
      `session.levels`; trim the buffer in `applySetting`. Growing is self-healing.

- [ ] **5. Decide the label/description language** — see Concerns; every existing board uses plain English
      in manifest settings.

- [ ] **6. Optional, decide separately: a "Calibrate" action on the board page.** Sample ambient audio for
      ~10 s with nobody speaking, compute p20 and the peak, and either suggest or write a factor giving a
      stated margin over that peak. This is the feature that actually helps the affected user; raw numbers
      help only someone who already knows what they mean.

- [ ] **7. `WHATS-NEW.md` entry + `board-manifest.json` version bump.**

- [ ] **8. Update `boards/wake-word/CLAUDE.md`** — the BT-091 note currently says the factor is a constant
      to edit; point it at the settings instead.

## Concerns / Open Questions

- **A bad value can re-create the BT-091 bug.** Factor ≈ 1 or a floor of 0 makes the gate pass everything:
  it latches open, the match history never clears, DTW grinds an unbounded noise window and detections
  saturate to the refractory rate. Clamping is a correctness requirement, not polish — never use a raw
  setting value. The proposed 1.5 minimum factor is a guess and deserves a sanity check.
- **These MUST stay board-global, not per-`listen` arguments.** Capture sessions are shared between
  consumers via `sessionKey(source, deviceId, echoCancel)`, so the gate is capture-level: if Agent Chat and
  the board's own test listen each passed a different gate, one would silently win. `threshold` is the
  exception — it is already per-listen and per-consumer, and must stay that way.
- **`default-threshold` will confuse people.** Agent Chat always sends its own `threshold` from its
  Configure dialog, so this setting changes nothing for it — it only affects callers that omit the value,
  i.e. the board's own test listen. Either label it unambiguously or leave it out of scope.
- **Manifest setting labels look untranslated.** Every board ships plain English `label`/`description`
  while the rest of the UI has 18 packs. Confirm whether Persephone resolves i18n keys there; if not,
  accept English and note the inconsistency rather than inventing a mechanism.
- **Discoverability is the real problem.** Whoever needs these settings is someone whose wake word fires
  on its own — and they have no reason to suspect a gate exists. Consider having the board page notice a
  gate that has been continuously open for many seconds with no detection and say so, pointing at the
  settings. Worth deciding before adding six numbers nobody finds.
- **Open:** expose `GATE_NOISE_PERCENTILE` (0.2) and `GATE_NOISE_MIN_WINDOWS` (20) too? Both are easy to
  set nonsensically and neither was needed during BT-091 tuning. Recommendation: leave them as constants.

## Acceptance Criteria

- [ ] All settings appear in the board's settings UI with defaults **exactly equal** to the shipped
      constants — a user who changes nothing sees identical behaviour
- [ ] Out-of-range, non-numeric, `null` and missing values clamp or fall back; no combination of settings
      can disable the gate
- [ ] Changing a setting takes effect on an already-running `listen` without reloading the board
- [ ] Shrinking `gate-noise-window-ms` trims the buffer rather than leaving stale levels
- [ ] The board's live readout shows the gate moving when the factor changes
- [ ] Verified on the loud-fan laptop: silence → zero detections; the enrolled wake word still detected
- [ ] `ui.log` is clean (no CSP violations)
- [ ] Fully offline (no CDN / network)

## Files Changed

| File | Change |
|------|--------|
| `boards/wake-word/board-manifest.json` | Add the number settings; bump `version` |
| `boards/wake-word/scripts/service.mjs` | Settings module, clamps, constant reads replaced |
| `boards/wake-word/app.js` | Optional calibrate action / gate-stuck hint |
| `boards/wake-word/lang/*.json` | Strings for any new page UI (18 packs) |
| `boards/wake-word/CLAUDE.md` | Point the BT-091 note at settings |
| `boards/wake-word/WHATS-NEW.md` | Changelog entry |

## Notes

Depends on BT-091 landing first — it introduces the adaptive gate and the `level`/`gate` readout this task
makes configurable.
