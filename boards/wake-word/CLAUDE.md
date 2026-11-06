# Wake Word — board notes

A Persephone **service board** that provides the platform interface `speech.wake@1`
(contract: Persephone's `guides.agents["speech-wake"]`): enrollment-based wake and stop phrases,
matched by query-by-example. Persephone's voice assistant (EPIC-139) streams microphone audio to
`listen` and receives `wake` / `stop` events.

> The generic board authoring reference (the `persephone.*` bridge, the `--p-*` theme contract,
> CSP rules, reload/test flow) is available via `guides.agents.boards` in Persephone's MCP. This
> file documents only what is specific to this board.

## How it works

- **Model:** `model/speech-embedding.onnx` is Google's Apache-2.0 `speech_embedding` (Kaggle
  `google/speech-embedding`, TF1 v1), exported by `scripts/speech-embedding-export/` at the repo
  root. Never replace it with openWakeWord's packaged copies (CC-BY-NC-SA).
- **Front end:** the 32-bin log-mel features (25 ms window, 10 ms hop, 60–3800 Hz) are computed in
  JS in `scripts/engine.mjs`; they reproduce Google's own preprocessing exactly.
- **Runtime:** `onnxruntime-web` (WASM) vendored under `vendor/onnxruntime-web/` — about 5.7% of
  one core per active stream; no native addon.
- **Matching:** each enrolled sample is a sequence of 96-dimensional embeddings (every 80 ms);
  live audio is matched by subsequence DTW over cosine distance. Score = `1 - distance`;
  `defaultThreshold` 0.85 is provisional until calibrated with real voices.
- **Enrollment clips are padded** with one model window of silence before embedding: a quickly
  called name is shorter than the 775 ms the model needs for its first embedding.
- **Storage:** only embeddings and phrase/person metadata, in
  `%LOCALAPPDATA%/Persephone/board-data/wake-word/enrollments-v1.json`. No audio is stored.
- **Caller policy:** a channel without `info.interface` is the board's own page
  (`isOwnPage()` in `scripts/service.mjs`; `info.page.boardId` is the page instance id, not the
  folder name). Other callers must arrive through `speech.wake@1` and pass the
  `caller-approval-policy` setting. The `diagnostics` channel (live scores) is own-page only.

## Not in this board

The microphone-plus-loopback rule (ignore a name the computer itself played) lives in the
Persephone app: a board cannot capture loopback audio.
