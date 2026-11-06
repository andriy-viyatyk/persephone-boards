# Wake Word

Wake Word provides a local `speech.wake@1` provider and an enrollment page for wake and stop phrases. It uses query-by-example: each phrase is enrolled from separate short recordings, then a clean Google speech embedding model compares the live microphone stream with those saved examples.

## Setup

Open and trust this board in Persephone 5.0.18 or newer. The model and the single-threaded ONNX Runtime Web WASM backend ship with the board, so inference works offline and does not start a download. Allow microphone access when enrolling or listening. The provider itself does not need microphone access; Persephone owns capture and sends ordered mono 16 kHz signed 16-bit PCM to the provider.

Choose a phrase, wake or stop kind, and person, then record separate samples of about 2.5 seconds. Aim for about five accepted samples per phrase and person, spoken naturally with small variations. Quality feedback rejects silence, clipping, very short clips, and very low levels. Use the sample list to remove one example, all examples for a person, or a phrase and kind across people.

The live panel listens to the selected microphone and reports detections with a similarity score and time from the start of that stream. The starting threshold is 0.85, equivalent to cosine-DTW distance 0.15 near the operating point. It is provisional; calibrate it with the live recordings you actually use. Similarity is not a probability. Higher scores are closer matches.

## Data and privacy

Audio stays on this computer. The page streams audio to the local board service; enrollment clips are transient and are discarded when processing ends. The board stores only versioned normalized embedding sequences and phrase/person metadata under `%LOCALAPPDATA%/Persephone/board-data/wake-word/`. Embeddings retain voice information, so treat this folder as sensitive. Delete examples in the board or remove that folder when you no longer need them. Nothing is copied to app storage or written to logs.

The board requests microphone permission for its enrollment and live page, plus service permission to provide the interface. It does not request internet, filesystem, app scripting, or program execution access. The caller policy defaults to `accept-granted`, which accepts the reserved Persephone `speech.wake@1` caller and the board's own page. `same-board-only` refuses the host caller.

## Engine and limitations

The model is Google's Apache-2.0 `speech_embedding` TF1 v1 release exported to ONNX. JavaScript implements its documented 16 kHz log-mel frontend. The runtime uses the single-threaded WASM CPU backend. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for model provenance and runtime notices.

The model produces voice embeddings, not a speech transcript. Similarity, microphone-only film triggers, and threshold calibration need to be checked with your voices and environment. This board cannot capture system loopback; Persephone's voice assistant work owns two-stream film comparisons, simultaneous speech and film, and loopback-to-microphone timing. User-assisted live enrollment and film checks are not claimed as completed by the board authoring run.
