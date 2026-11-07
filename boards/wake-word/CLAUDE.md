# Wake Word — board notes

This service board implements `speech.wake@1`; the normative contract is
`guides.agents["speech-wake"]`. The page uses private service channels for the same operations,
and `audio.devices()` for microphone IDs. It does not capture audio itself. Service, microphone,
computerAudio and `uses: audio@1` grants are required. The caller policy allows the private page;
`same-board-only` rejects every external call and channel. Diagnostics are private to the page.

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
