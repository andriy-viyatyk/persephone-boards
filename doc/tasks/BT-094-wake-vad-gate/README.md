# BT-094: Wake Word — gate detection on speech, not loudness (Silero VAD)

## Status

**Status:** Done
**Priority:** High
**Board id:** `wake-word`
**Started:** 2026-11-08
**Completed:** 2026-11-08

## Goal

Run the keyword matcher only while the microphone is actually hearing **speech**, so that typing, a tap on
the desk, or fan noise cannot produce a wake-word detection.

## Background

BT-091 made the level gate adaptive, which fixed steady fan noise. Live testing immediately surfaced the
deeper problem: the gate only ever asked *"is there sound?"*, and keystrokes and desk taps are genuinely
loud. Measured live, typing reached `level 0.1285` against a gate of `0.0351` — the gate opened, correctly,
and detections followed at 87–91%.

Two things then conspire:

- `speech_embedding` has **no not-speech output**. Fed a keystroke it still emits a normal 96-dimension
  vector, which `subsequenceDistance` happily aligns against a template. Because that search takes the
  **best** alignment over a rolling 100-embedding history, it is a minimum over many comparisons — the more
  it scans, the likelier a spurious high score.
- The history is cleared **only when the gate closes**. Each transient re-arms `GATE_HOLD_MS = 400`, and
  typing at 5–10 keys/s never lets it close, so unrelated impulses accumulate into one continuous history
  and get stitched into a pseudo-utterance. The same wedged-open state as the fan bug, entered through
  transients instead of steady noise.

No threshold fixes this: taps score in the same 87–91% band as a genuine wake word. The missing piece is a
speech/not-speech decision.

Silero VAD answers exactly that question, is 2.3 MB, MIT-licensed, and runs on the ONNX Runtime the board
**already vendors** — no extra process, no cross-board dependency. The repo already trusts this family:
`boards/speech-to-text/scripts/live.mjs` drives `ggml-silero-v6.2.0.bin` with `speechOnProbability: 0.5` /
`speechOffProbability: 0.35`, and those are the hysteresis values reused here.

Rejected alternatives: exposing a `speech.vad` capability from Speech to Text (adds a cross-board runtime
dependency and a new contract for one consumer) and Whisper confirmation via `speech.transcribe` (far
heavier and slower to answer a question a 2.3 MB classifier answers directly).

## Implementation Plan

- [x] **1. Vendor the model** — `model/silero-vad.onnx` from the `v6.2.3` tag of `snakers4/silero-vad`,
      plus `model/LICENSE-MIT-silero-vad.txt`; size and SHA-256 recorded in `THIRD-PARTY-NOTICES.md`.
- [x] **2. `scripts/engine.mjs`** — extract a shared `runtime()` so both models configure `env.wasm` once
      (configuring it twice would race), add `loadSession(file)`, and export `VAD_FRAME_SAMPLES`,
      `createVadState()` and `vadProbability(vad, frame)`.
- [x] **3. `scripts/service.mjs`** — add `updateSpeech()`: buffer to Silero's fixed frame size, carry the
      per-capture-session state, apply 0.5/0.35 hysteresis, and drive `gateUntil` from the speech verdict
      instead of RMS. Keep `GATE_HOLD_MS` so pauses inside a phrase still bridge.
- [x] **4. Keep the level gate as the fallback** when the VAD model cannot be loaded, reported once to the
      console — a missing model must not take detection offline entirely.
- [x] **5. Diagnostics** — carry `speech` on the diagnostic message; the board's live readout shows
      `speech` in place of the now-fallback-only `gate` (18 language packs).
- [x] **6. Live verification** — see Acceptance Criteria.
- [x] **7. `WHATS-NEW.md`, `CLAUDE.md`, `THIRD-PARTY-NOTICES.md`.**

## Concerns / Open Questions

- **The 64-sample context is mandatory, and omitting it fails silently.** Silero v5+ prefixes each
  512-sample frame with the previous 64 samples. The ONNX graph has a dynamic input axis, so a bare
  512-sample frame *runs and returns plausible numbers* — just wrong ones. Measured on a 4.33 s real-speech
  WAV: bare frames peaked at **p=0.269** and never crossed 0.5, while the same audio with context peaked at
  **1.000** and scored ≥0.5 in 97 of 135 frames. Shipped without the context, the gate would have wedged
  **shut** and the wake word would simply never fire — a worse failure than the one being fixed, and
  invisible to any test that only checks that noise is rejected. Anyone upgrading the model must re-verify
  both directions.
- **Synthetic audio cannot validate the positive path.** A harmonic stack built to look like speech scored
  p=0.001 — Silero correctly rejects it. Verification needs real speech; this task used a Windows SAPI WAV,
  the same approach BT-087 used for Speech to Text.
- **VAD now sits in the per-chunk path.** It is one small inference per 512 samples (~31/s) on an already
  loaded runtime, but it adds an `await` before the gate decision; the epoch/closed checks after it must
  stay or a closing session can act on a stale epoch.
- **Lower bound on margin.** Worst measured non-speech was a desk tap at p=0.249 against the 0.5 entry
  threshold — roughly 2×. Comfortable but not enormous; a different microphone could narrow it, which is an
  argument for BT-092 exposing the thresholds.
- **This supersedes most of BT-092.** With a real VAD in front, `gate-floor-rms`, `gate-noise-factor` and
  `gate-noise-window-ms` only matter on the fallback path. BT-092 should be re-scoped to the VAD
  thresholds, `refractory-ms` and `default-threshold` before it is picked up.
- **The RMS gate is now dead weight on the main path.** Kept deliberately as the fallback, but it means two
  gating mechanisms exist and only one is live. Worth revisiting once the VAD has proven itself.

## Acceptance Criteria

- [x] Typing, desk taps and fan noise score below the entry threshold and never open the gate
- [x] Real speech opens the gate (SAPI WAV: maxP 1.000, mean 0.732, open in 73% of frames)
- [x] A missing or unloadable VAD model degrades to the level gate instead of disabling detection
- [x] The live readout shows the speech probability
- [x] Live: typing hard for 30 s with nobody speaking produces **zero** detections
- [x] Live: tapping the desk produces **zero** detections
- [x] Live: the enrolled wake word is still detected, once, with normal latency
- [x] `ui.log` is clean (no CSP violations)
- [x] Fully offline (model vendored; no CDN / network at runtime)

## Files Changed

| File | Change |
|------|--------|
| `boards/wake-word/model/silero-vad.onnx` | New — vendored VAD model (2.3 MB) |
| `boards/wake-word/model/LICENSE-MIT-silero-vad.txt` | New — MIT licence |
| `boards/wake-word/scripts/engine.mjs` | Shared `runtime()`, `loadSession()`, VAD exports |
| `boards/wake-word/scripts/service.mjs` | `updateSpeech()`; VAD drives the gate; RMS fallback |
| `boards/wake-word/app.js` | Live readout shows speech probability |
| `boards/wake-word/lang/*.json` | `live.score` string (18 packs) |
| `boards/wake-word/THIRD-PARTY-NOTICES.md` | Silero VAD section |
| `boards/wake-word/CLAUDE.md` | Gate rules |
| `boards/wake-word/WHATS-NEW.md` | Changelog entry |

## Notes

Verified offline with `temp/vad-smoke.mjs` (synthetic typing / desk tap / fan) and `temp/vad-speech-test.mjs`
(SAPI-generated real speech). Ships in `wake-word` 1.1.1 alongside BT-090, BT-091 and BT-093.
