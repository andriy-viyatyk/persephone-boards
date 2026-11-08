# BT-096: Wake Word — real speaker verification

## Status

**Status:** Planned
**Priority:** Medium
**Board id:** `wake-word` *(consumer change in `claude-agent`)*
**Started:** —
**Completed:** —

## Goal

Tell *who* spoke a wake phrase using a purpose-built speaker-verification model, instead of inferring
it from which keyword template happened to score best — which is not speaker identification and is
wrong often enough that Agent Chat's `[Speaker: <name>]` prefix misleads the agent.

## Background

### Why the current `person` is a guess, not a measurement

`model/speech-embedding.onnx` is Google's `speech_embedding` — a **keyword-spotting** model. It is
trained to recognise *what* was said while being invariant to *who* said it, so that one enrolled
phrase works for every speaker. Voice identity is precisely the signal it is built to discard.

The board already records this (`boards/wake-word/CLAUDE.md:12`):

> The winning `person` is a weak hint, not speaker identification; `speech_embedding` is a keyword model.

In `scripts/service.mjs:424-441`, BT-093 keys the per-window `matches` map on `[phrase, kind]` and lets
the best-scoring template ride along on the hit as `person`. When two people are enrolled for the same
phrase, both templates sit at nearly the same distance from the utterance and the winner is decided by
residual noise, mic placement and which take was recorded on a quieter day. **No threshold fixes this** —
the discriminating information is not in the embedding space.

### Why it matters more than a mislabel

`boards/claude-agent/app.js:841` injects the name as an assertion of fact:

```js
await sendPrompt(view, `[Speaker: ${speaker}]\n${text}`);
```

and the shipped `boards/claude-agent/wake-instructions.md` tells the agent to act on it:

```
- Each request comes from speech recognition and starts with `[Speaker: <name>]`. Before
  acting, read `notes/speakers/<name>.md` and `notes/sites.md` (if they exist) ...
3. **Speaker.** If the speaker stated a preference or corrected you, update
   `notes/speakers/<name>.md`.
```

So a misattribution loads the **wrong person's** language and browser profile and then writes the
current speaker's corrections into that other person's notes file. The error compounds across sessions
rather than being a one-off. See *Interim mitigation* under Concerns.

### What already exists to build on

| | where | note |
|---|---|---|
| ONNX Runtime (WASM, offline) | `vendor/onnxruntime-web/` + `vendor/onnxruntime-common/` | shared `runtime()` / `loadSession(file)` in `scripts/engine.mjs:22-42` — a second model is a one-line add, as Silero was |
| A second model already loaded this way | `model/silero-vad.onnx` (BT-094) | the precedent for everything below |
| Full enrollment audio | `finishEnrollment()` `scripts/service.mjs:637-648` | `clip` is `ENROLL_SAMPLES` = 40000 samples = **2.5 s** at 16 kHz, with `assessed.speechStart` / `speechEnd` |
| Per-sample store with migration | `scripts/enrollments.mjs` | `TEMPLATE_VERSION` gating already drops stale frontends |
| A delay window before a hit is emitted | `handleHit()` `scripts/service.mjs:588` | `LOOK_AHEAD_MS + GATE_PRE_ROLL_ALLOWANCE_MS + PROCESSING_MARGIN_MS` = 900 ms already elapses before `output()` |
| Conservative phrase onset | `hit.start.timeMs` via `phraseStartSample()` | gives the span to score |

**What does not exist: raw PCM at detection time.** `processChunk()` (`scripts/service.mjs:377-384`)
converts each chunk with `pcmToFloat` and pushes it straight into `StreamingFrontend`, which keeps only
96 log-mel rows. The float samples are discarded. A speaker model needs the waveform, so a PCM ring is
step 5.

### Model survey (sizes are the real `sherpa-onnx` release assets)

| file | bytes | notes |
|---|---:|---|
| `wespeaker_en_voxceleb_resnet34_LM.onnx` | 26,530,550 | 256-dim, WeSpeaker, VoxCeleb EN |
| `wespeaker_en_voxceleb_CAM++_LM.onnx` | 29,292,687 | 192-dim, newer architecture, usually best EER/size |
| `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx` | 29,596,978 | 3D-Speaker export of CAM++ |
| `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 28,281,164 | multilingual (zh+en) training set — may generalize better beyond English |
| `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | 26,485,263 | alternative architecture |

**Licensing — checked, and it is the good outcome.** WeSpeaker's `docs/pretrained.md` states:

> The pretrained model in WeNet follows the license of it's corresponding dataset. For example, the
> pretrained model on VoxCeleb follows `Creative Commons Attribution 4.0 International License.`

VoxCeleb's official licence text is **CC BY 4.0** — attribution, *not* non-commercial. That makes these
models usable here, unlike the openWakeWord copies the board already refuses (CC-BY-NC-SA). The licence
requires attribution in `THIRD-PARTY-NOTICES.md` and that the terms travel with any redistribution.
**Confirm the licence on the exact checkpoint before vendoring** — third-party mirrors of the same
weights have been seen labelled CC BY 4.0, CC BY-SA 4.0 and Apache-2.0.

### The input contract (from WeSpeaker's own `export_onnx.py` / `infer_onnx.py`)

```
input   feats  float32  [B, T, 80]      dynamic B and T
output  embs   float32  [B, D]
```

Features are **Kaldi fbank**, and the pre-processing is not the board's existing frontend:

```python
waveform = waveform * (1 << 15)          # float PCM scaled to int16 RANGE, not normalised
mat = kaldi.fbank(waveform, num_mel_bins=80, frame_length=25, frame_shift=10,
                  dither=0.0, sample_frequency=16000, window_type='hamming', use_energy=False)
mat = mat - torch.mean(mat, dim=0)       # CMN over time, no variance normalisation
```

Compared with `logMel()` in `scripts/engine.mjs`, the 25 ms / 10 ms framing and the 512-point FFT match,
and Kaldi's mel warp is the same `1127·ln(1 + f/700)`. **Everything else differs** and each difference
is silent — wrong numbers, not an error:

| | board `logMel()` | Kaldi fbank (WeSpeaker) |
|---|---|---|
| amplitude | `[-1, 1)` from `pcmToFloat` | `× 32768` |
| window | Hann | Hamming |
| pre-emphasis | none | 0.97 |
| DC offset | kept | removed per frame |
| spectrum | magnitude (`hypot`) | **power** (magnitude²) |
| bands / range | 32, 60–3800 Hz | 80, 20–8000 Hz |
| log floor | `log(x + 0.001)` | `log(max(x, FLT_EPSILON))` |
| normalisation | none | CMN over time |

This is the same shape of trap as the Silero 64-sample context (BT-094): plausible output, never an
exception, and only a positive-direction test catches it. Treat it as a **separate frontend**, not a
parameterisation of the existing one, and verify it numerically before trusting any similarity score.
The Kaldi defaults in the right-hand column are stated from the documented defaults and must be
confirmed against the reference implementation in step 3 rather than assumed.

## Implementation Plan

- [ ] **1. Choose and vendor the model.** Download from the `sherpa-onnx`
      `speaker-recongition-models` release, record byte size and SHA-256, and confirm the upstream
      licence on that exact checkpoint. Place at `boards/wake-word/model/speaker-embedding.onnx` with
      `model/LICENSE-CC-BY-4.0.txt`. Decide vendor-vs-download first (see Concerns).
- [ ] **2. `scripts/kaldi-fbank.mjs` (new).** Implement the Kaldi fbank above as its own module —
      `kaldiFbank(samples) -> { data: Float32Array, frames }` producing `[T, 80]` row-major, with CMN
      applied. Keep it separate from `logMel()`; do not parameterise the keyword frontend.
- [ ] **3. Verify the frontend against a reference before anything else.** `pip install
      kaldi-native-fbank` (small, no torch) and compare the JS output to the reference for the same WAV.
      Require max absolute difference < 1e-3 per bin. Record the test WAV's SHA-256 and the measured
      error in `## Notes`. **Do not proceed to step 4 until this passes** — every later number is
      meaningless if the features are wrong.
- [ ] **4. `scripts/engine.mjs` — add `speakerEmbedding(samples)`.** Reuse `loadSession()` with a
      third module-level promise (`speakerPromise`), mirroring `vadPromise`. Scale by 32768, run
      `kaldiFbank`, feed `feats` `[1, T, 80]`, read `embs`, L2-normalise the output. Export
      `SPEAKER_EMBED_VERSION = 1` alongside `TEMPLATE_VERSION`.
- [ ] **5. PCM ring in the detect session.** In `scripts/service.mjs`, keep the last ~3 s of float
      samples per session (48000 floats ≈ 192 KB) with their epoch and sample offsets, written in
      `processChunk()` beside `session.frontend.push(samples)`. Clear it on epoch change and on gap
      reset, exactly where `session.history` is cleared. Never persist it.
- [ ] **6. Voiceprint at enrollment.** In `finishEnrollment()`, after `encodeTemplate()` succeeds, call
      `speakerEmbedding(clip.subarray(speechStart, speechEnd))` — the **same span definition** used at
      detection, so the two are comparable. Store as `voiceprint` + `speakerEmbedVersion` on the sample
      in `enrollments-v1.json`. Treat a missing voiceprint as "not enrolled for verification", so
      existing samples keep working untouched.
- [ ] **7. Verify at detection.** In `handleHit()`, inside the existing 900 ms deferred-emit window,
      slice the ring from `hit.start.timeMs` to `hit.time.timeMs` (clamped to the ring), embed it, and
      cosine-compare against every stored voiceprint **for that phrase**. Attach additively:
      ```js
      speaker: { person, score, margin, verified }
      ```
      where `margin` is top-1 minus top-2 and `verified` requires both `score >= SPEAKER_MIN_SCORE` and
      `margin >= SPEAKER_MIN_MARGIN`. Leave the existing `person` field exactly as it is. On any failure
      — model absent, no voiceprints, ring too short — emit `verified: false` and **never block the hit**.
- [ ] **8. Agent Chat consumes it.** `boards/claude-agent/wake-assistant.js:538` takes
      `message.speaker?.verified ? message.speaker.person : ""`; `app.js:836-841` omits the
      `[Speaker: ...]` line entirely when the name is empty. Update `wake-instructions.md` to state that
      the prefix is present **only** when the speaker was verified, and that its absence means the
      speaker is unknown — not that it is the last known one.
- [ ] **9. Page readout.** Show the verification score and margin in the Wake Word live readout beside
      `level` / `speech`, so the thresholds in step 7 can be calibrated the way BT-091's were.
- [ ] **10. Docs.** `THIRD-PARTY-NOTICES.md` (model, licence, SHA-256, attribution), `CLAUDE.md` (the
      two-frontend rule and why they must not be merged), `WHATS-NEW.md`, manifest `version`, and the
      `speech.wake` capability description for the new detection field.

## Concerns / Open Questions

- **Accuracy will be "usually right", not "trustworthy".** Published EERs for these models are measured
  on several seconds of speech. A wake word is roughly 0.5–1 s, which is their worst operating point.
  Text-dependent verification on a fixed phrase is the favourable case (it is how phrase-based phone
  unlock works), but expect materially worse than the headline numbers. **This is why step 7 annotates
  rather than gates, and why `verified` must be a hard gate on the consumer side.** If the measured
  margin is poor, shipping *no* name is still better than a wrong one.
- **Vendor (~27 MB) or download?** The published `wake-word` ZIP is currently **4,183,410 bytes**;
  vendoring takes it to roughly 31 MB — a 7× jump for every installer. The repo has a consent-gated
  download precedent in `boards/claude-agent/scripts/sdk-install.mjs` (SRI + SHA-256 + path guards).
  **But `wake-word`'s manifest sets `"network": false`**, and the board's stated promise is that audio
  is processed locally. Adding the grant triggers a *Board permissions changed* prompt for every
  installed user and weakens that promise for a board whose whole appeal is being offline. A third
  option is int8 dynamic quantisation to roughly 7 MB, at some accuracy cost. **Recommendation: vendor
  at full precision** and accept the size; the alternative trades the board's clearest property for
  23 MB. Needs a decision before step 1.
- **Language mismatch.** The VoxCeleb checkpoints are overwhelmingly English, while the board is used
  in many interface languages and enrollment is speech in whatever language the speaker uses. Speaker
  embeddings model vocal timbre and are largely language-independent, but cross-lingual degradation is
  real. Evaluate `wespeaker_en_voxceleb_CAM++_LM` against
  `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced` on the actual enrolled voices before
  committing, and record both margins.
- **Voiceprints are biometric data.** They are a materially stronger identifier than the keyword
  templates already stored, and they land in the same
  `%LOCALAPPDATA%/Persephone/board-data/wake-word/enrollments-v1.json`. The privacy note
  (`lang/en.json` `privacy.note`) and the README must say so plainly, and deleting a person must delete
  their voiceprint with their samples — verify `delete` by person already covers the new field.
- **Verify-or-annotate is a product decision deferred, not resolved.** Gating detection on a verified
  speaker ("only my voice wakes it") is a genuinely useful security property and a natural follow-up,
  but it converts every false reject into a dead wake word. Ship annotation first, measure, then decide.
- **Interim mitigation, available now and independent of this task.** Until this lands, the
  `notes/speakers/<name>.md` read/write loop keeps amending the wrong person's preferences. The
  cheapest containment is to change `wake-instructions.md` to read per-speaker notes but **never write**
  them, leaving the prompt prefix alone. One file, no code, reversible. Raised and consciously deferred —
  noted here so it stays a choice rather than an oversight.
- **`person` keeps its current meaning.** The new field is additive so the `speech.wake@1` contract does
  not break, and `person` stays "owner of the best-scoring keyword template". The capability description
  should say that explicitly, because the name invites exactly the misreading this task exists to fix.

## Acceptance Criteria

- [ ] JS Kaldi fbank matches `kaldi-native-fbank` within 1e-3 per bin on a recorded WAV (step 3)
- [ ] `speakerEmbedding()` returns an L2-normalised vector of the model's stated dimension
- [ ] **Discrimination, measured on real voices:** with 2 speakers × 3 enrollments each, mean
      within-speaker cosine similarity exceeds mean between-speaker similarity by a margin recorded in
      `## Notes`, and a threshold exists that separates them on held-out utterances
- [ ] Live: each speaker says the wake phrase 10 times; the verified name is correct in at least 9,
      **and** no utterance is attributed to the wrong person with `verified: true`
- [ ] Live: an unenrolled speaker saying the phrase yields `verified: false` (no name), not a wrong name
- [ ] Agent Chat sends `[Speaker: ...]` only when `verified`, and omits the line entirely otherwise
- [ ] Detection latency grows by no more than ~200 ms (the work fits the existing 900 ms defer window)
- [ ] Existing enrollments without a voiceprint still detect normally, with `verified: false`
- [ ] Deleting a person removes their voiceprint
- [ ] `ui.log` is clean (no CSP violations)
- [ ] Fully offline (no CDN / network) — or the `network` grant decision above is explicitly taken

## Files Changed

| File | Change |
|------|--------|
| `boards/wake-word/model/speaker-embedding.onnx` | New — vendored speaker-verification model |
| `boards/wake-word/model/LICENSE-CC-BY-4.0.txt` | New — licence text |
| `boards/wake-word/scripts/kaldi-fbank.mjs` | New — Kaldi-compatible 80-bin fbank + CMN |
| `boards/wake-word/scripts/engine.mjs` | `speakerEmbedding()`, `SPEAKER_EMBED_VERSION` |
| `boards/wake-word/scripts/service.mjs` | PCM ring, enrollment voiceprint, `speaker` on the hit, thresholds |
| `boards/wake-word/scripts/enrollments.mjs` | `voiceprint` + `speakerEmbedVersion` on stored samples |
| `boards/wake-word/app.js`, `lang/*.json` | Live readout + privacy note |
| `boards/wake-word/board-manifest.json` | Version, capability description |
| `boards/wake-word/THIRD-PARTY-NOTICES.md`, `CLAUDE.md`, `WHATS-NEW.md` | Model notice, two-frontend rule, changelog |
| `boards/claude-agent/wake-assistant.js`, `app.js` | Use `speaker.verified`; omit the prefix otherwise |
| `boards/claude-agent/wake-instructions.md` | Prefix is conditional; absence means unknown |

## Notes

Research completed 2026-11-08 and captured above: model sizes are the real asset sizes from the
`k2-fsa/sherpa-onnx` `speaker-recongition-models` release; the ONNX signature and fbank recipe are from
WeSpeaker's own `bin/export_onnx.py` and `bin/infer_onnx.py`; the licence chain is WeSpeaker
`docs/pretrained.md` → VoxCeleb CC BY 4.0.

Python 3.13.2 is available on the dev machine for the step-3 reference check.
