# Wake Word — board notes

This service board implements `speech.wake@1`; the normative contract is
`guides.agents["speech-wake"]`. The page uses private service channels for the same operations,
and `audio.devices()` for microphone IDs. It does not capture audio itself; the service sends the page a transient clip for review and in-memory playback. Service, microphone,
computerAudio and `uses: audio@1` grants are required. The caller policy allows the private page;
`same-board-only` rejects every external call and channel. Diagnostics are private to the page.

A phrase is reported **once per utterance**, not once per enrolled person (BT-093): both the per-window
`matches` map and the `operation.refractory` key omit `person`, so the best-scoring person wins and rides
along on the hit. Person-free keying is deliberate in both places — one utterance legitimately matches
every template enrolled for that phrase. The winning `person` is a weak hint, not speaker identification;
`speech_embedding` is a keyword model. A second speaker within `REFRACTORY_MS` is suppressed.

The detection gate is **Silero VAD** (BT-094), not a level: `updateSpeech()` buffers to 512-sample frames,
carries the per-session state, and applies 0.5 / 0.35 hysteresis — the same values `speech-to-text` uses.
Gating on loudness is the wrong question, because typing and a tap on the desk are genuinely loud; they
opened the old gate, and `speech_embedding` has no not-speech output to stop them matching. **The
64-sample context prefix in `vadProbability()` is mandatory** — the ONNX graph's input axis is dynamic, so
a bare 512-sample frame runs and returns plausible but wrong numbers (p peaked at 0.269 on real speech
versus 1.000 with context), which would wedge the gate shut instead of open. Re-verify both directions on
any model upgrade, with real speech: synthetic audio is rejected by Silero and cannot test the positive
path.

The adaptive level gate (BT-091) survives only as the fallback when the VAD model will not load:
`gateLevel()` takes a low percentile of recent chunk RMS and requires `GATE_NOISE_FACTOR` above it, with
`GATE_RMS` as an absolute floor. Its history behaviour is why both bugs were so severe — the match history
is cleared only when the gate CLOSES, so anything that holds the gate open lets DTW score an unbounded
stretch of audio until the refractory becomes the only rate limit. BT-092 proposes making the thresholds
tunable; until then the board's live readout (`level` / `speech`) is how to check them.

The service shares audio capture and matching work between compatible listeners and enrollment.
Microphone listening also spots computer audio, even if computer detections are not requested.
Detection times and conservative start estimates use the audio epoch clock. Gaps reset the
frontend; epoch changes clear matching and suppression state. The decision-4 tuning constants and
their delivery-delay rationale live together in `scripts/service.mjs`. Suppression is provisional:
missed computer detections, late delivery and imperfect echo cancellation can allow false triggers.

The page defaults phrase IDs by kind to `agent-wake` and `agent-stop`, and offers a microphone
and echo cancellation setting for enrollment and listening. Device IDs come from the audio origin,
can change, and labels may be unavailable. Use the same echo cancellation setting for both operations.
Phrase IDs are exact names, not an ownership boundary.

The versioned enrollment migration preserves sample IDs, embeddings, and custom phrase names;
legacy `wake` and `stop` defaults become `agent-wake` and `agent-stop` and are marked as
pre-change capture with echo cancellation off. Only current frontend versions are matched; older
samples remain listable and deletable. New samples record echo cancellation. Audio is transient;
only metadata and sensitive embeddings persist in
`%LOCALAPPDATA%/Persephone/board-data/wake-word/enrollments-v1.json`.

The model `model/speech-embedding.onnx` is Google's Apache-2.0 `speech_embedding` TF1 v1, exported
by the repository's `scripts/speech-embedding-export/`. Do not replace it with openWakeWord's
CC-BY-NC-SA copies. `scripts/engine.mjs` implements Google's 32-band log-mel frontend, 96-dimensional
embeddings at 80 ms steps and end-anchored subsequence DTW; the default similarity threshold 0.85
and onset estimate need live calibration. The vendored ONNX Runtime Web WASM backend is offline.
See `THIRD-PARTY-NOTICES.md` for licenses.

The runtime is vendored as **two** packages: `vendor/onnxruntime-web/` and `vendor/onnxruntime-common/`
(the companion package `ort.node.min.mjs` imports). The bundle's 6 bare `"onnxruntime-common"`
specifiers are rewritten to a relative path, because a published board has no `node_modules` to
resolve them through — `node_modules` is in `.gitignore` **and** in `publish-board.mjs`'s `EXCLUDE`
set, so a dependency placed there works in dev, never reaches git, and never reaches the release
ZIP. Keep both packages on the same version and re-apply the rewrite on upgrade; the sha256 of the
bundle before and after is recorded in `THIRD-PARTY-NOTICES.md`. Verify an upgrade by importing
`scripts/engine.mjs` and running `logMel` → `embed` outside the app: a working runtime returns a
96-dimension, L2-normalized vector.

BT-100: The private page reviews a VAD-suggested crop before committing; public enrollment remains automatic. PCM is transient and must never enter logs or storage. The page exposes `persephone.wake-configure@1` for provider-bound Agent Chat configuration. Existing sample durations are approximate, derived only from current-version embedding counts. Playback uses the shared audio capture stream; host cleaning can be disabled or fall back.
