# BT-060: Streaming VAD helper in the whisper runtime

## Status

**Status:** Implemented  
**Priority:** High  
**Board id:** `speech-to-text` (runtime helper consumed by this board)  
**Started:** 2026-10-26  
**Completed:** —

## Goal

Add a small CPU-only executable to a new `whisper-runtime-1.9.5-r2` package. It consumes 16 kHz mono PCM s16le and writes Silero speech probabilities while retaining the VAD LSTM state. Pin the runtime in the Speech to Text board and prepare board version 1.1.0 for the user's planned release. Live pause segmentation remains BT-061.

## Background

- This is task 1 of 6 for Persephone **EPIC-134**, phase 2, following the accepted design in `C:\projects\persephone\doc\tasks\US-1726-pause-detection-research\README.md` (Recommendation and Findings) and `C:\projects\persephone\doc\epics\EPIC-134.md`. US-1726 measured the Silero ONNX simulator against whisper.cpp. Its frame-level simulator is in Claude's local scratch folder, not this repository.
- **Verified API correction:** v1.9.5 exposes `whisper_vad_detect_speech_no_reset(struct whisper_vad_context *vctx, const float *samples, int n_samples)`, which returns compute success; probability values are read separately with `whisper_vad_n_probs()` and `whisper_vad_probs()`. `whisper_vad_detect_speech()` resets state before running detection. `whisper_vad_reset_state()` is also a public API and clears the VAD state buffer. Use `whisper_vad_context`, initialized by `whisper_vad_init_from_file_with_params()`; the earlier research note correctly named the streaming detector but omitted this reset option.
- The helper protocol deliberately has no in-band reset command: one process represents one audio stream, and starting a new process resets state. If BT-061 needs to reuse a warm process, it can send an explicit reset through the existing `whisper_vad_reset_state()` API in a separately defined protocol change.
- Source references checked at the requested v1.9.5 tag: [`include/whisper.h` VAD declarations, lines 699–750](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/include/whisper.h#L699-L750), including [`whisper_log_set`, line 763](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/include/whisper.h#L763); [`src/whisper.cpp` default VAD params, lines 4588–4595](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/src/whisper.cpp#L4588-L4595), [CPU-only VAD initialization, lines 4814–4820](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/src/whisper.cpp#L4814-L4820), [reset and streaming detection, lines 5260–5349](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/src/whisper.cpp#L5260-L5349), and [probability accessors, lines 5363–5369](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/src/whisper.cpp#L5363-L5369). The context defaults to four threads but GPU is disabled by default and forcibly disabled by the VAD initializer.
- VAD logging must be filtered. `whisper_vad_detect_speech_no_reset()` emits several `WHISPER_LOG_INFO` messages on each call, and model loading logs too. Install a `whisper_log_set()` callback before loading the model that forwards only WARN and ERROR to stderr. In this version `whisper_log_set()` also installs the same callback into ggml; call `ggml_log_set()` with that callback as well if initialization order or direct ggml load messages require it. Without filtering, high-rate diagnostics can fill the service's stderr pipe.
- The Silero v6.2.0 model uses 512-sample windows at 16 kHz (32 ms). The VAD API reads `n_window` and `n_context` from the model header. Measured after the r2 build, the GGML output matches the ONNX model fed with the 64-sample context (see Notes), so the context is handled inside the converted model; the earlier review claim that it is ignored was wrong.
- Model: `ggml-silero-v6.2.0.bin`, 885,098 bytes, from [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad/tree/main). Its [model commit](https://huggingface.co/ggml-org/whisper-vad/commit/9ffd54a1e1ee413ddf265af9913beaf518d1639b) records size 885,098 and SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`; the model collection is MIT licensed.
- **Package the model in the runtime ZIP**, under `models/ggml-silero-v6.2.0.bin`. At under 1 MB, including it makes the helper immediately runnable offline and lets the existing archive hash, per-file manifest and exact-file-set checks protect the executable and model together, with no separate required-model download lifecycle.
- Current pin and verification are in `boards/speech-to-text/scripts/downloads.mjs`: `RUNTIME` is `whisper-runtime-1.9.5-r1`, and `verifyRuntime()` checks the manifest's exact file set and SHA-256 values and requires `whisper-server.exe`. Update the pin to r2 and require `whisper-vad-helper.exe` too. After r2 verifies, remove sibling `runtime/whisper-runtime-*` directories other than the pinned runtime. `runtime.zip` is already replaced when its pinned size/hash does not match. BT-055 records the current ZIP at 19,958,389 bytes with SHA-256 `f3db3e57713053721a85ea2269221db8b2b3bfda026fcec40442911566e1d046` (`doc/tasks/completed.md`).
- `.github/workflows/build-whisper-runtime.yml` is the manual workflow. It defaults to tag `v1.9.5`, revision `1`, packages `whisper-server.exe`, DLLs, notices and `manifest.json`, and publishes the runtime tag without marking it Latest. Its current `.sha256` writer uses `Set-Content -Encoding ascii`; BT-055 records a trailing CRLF wart. The r2 checksum asset must have no trailing CR or LF.
- Build mechanics: upstream v1.9.5 root `CMakeLists.txt` adds `examples/` when `WHISPER_BUILD_EXAMPLES=ON`; `examples/CMakeLists.txt` processes its child directories. The upstream `examples/vad-speech-segments/CMakeLists.txt` defines an executable, links the `whisper` target and installs it as a runtime target. Follow that structure in the new helper directory; the workflow's current `WHISPER_BUILD_EXAMPLES=ON` configure must build the helper as part of the same graph.
- Notices: whisper.cpp/ggml MIT is already bundled. Add the Silero VAD MIT notice (copyright Silero Team) for the bundled converted model and include all new runtime files in `manifest.json`.

## Implementation Plan

- [x] Add `runtime/vad-helper/main.cpp` and `runtime/vad-helper/CMakeLists.txt`. Define target `whisper-vad-helper` linked to `whisper` and installed as a runtime executable, following the upstream example CMake pattern. Accept `--model <path>` and optional `--threads <n>`; default to **1 thread**, initialize with `whisper_vad_default_context_params()` and `whisper_vad_init_from_file_with_params()`, set `use_gpu = false`, install the log filter before model load, and free the context before exit.
- [x] Configure Windows standard streams for binary I/O with `_setmode(_fileno(stdin), _O_BINARY)` and `_setmode(_fileno(stdout), _O_BINARY)`. This prevents text-mode CRLF translation and Ctrl-Z (`0x1A`) handling from changing PCM bytes; stdout JSON records then end with literal LF.
- [x] Implement the stream contract: stdin is raw little-endian signed 16-bit mono PCM at 16,000 samples/sec with no WAV header. Read available bytes from the pipe into a buffer, retaining any incomplete frame bytes. Convert each complete 512-sample frame to float by dividing by 32768. When one or more full frames are buffered, call `whisper_vad_detect_speech_no_reset(ctx, samples, frame_count * 512)` once for that batch, require success and exactly `frame_count` probabilities, then emit one UTF-8 JSON line per frame: `{"frame":0,"speechProbability":0.012345}`. Frame indices start at zero, increase once per complete or EOF-padded frame, and output is flushed after each batch. stdout contains protocol records only.
- [x] Define EOF and reset behavior: no in-band reset command. On EOF, if trailing samples do not fill a frame, zero-pad them to 512 samples, process that last frame through the same stateful API, emit its indexed probability, and exit 0. EOF on a frame boundary exits 0 without a synthetic record. Invalid arguments, model-load failure, VAD failure or I/O failure report to stderr and exit nonzero. One process is one stream; BT-061 can start a new process for fresh state or, if warm reuse is needed, add a protocol command that calls the already-public `whisper_vad_reset_state()`.
- [x] Update the workflow build setup: copy `runtime/vad-helper/` to `C:\w\src\examples\vad-helper`, append `add_subdirectory(vad-helper)` to `C:\w\src\examples\CMakeLists.txt`, then use the existing configure with `WHISPER_BUILD_EXAMPLES=ON` and `CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`. Build `--target whisper-server whisper-vad-helper` in that same configure/build graph. Assert `whisper-vad-helper.exe` lands in `C:\w\b\bin`; package it with the same `whisper.dll` and ggml DLLs already gathered from that directory. Preserve the existing server fallback/CPU checks.
- [x] Package `models/ggml-silero-v6.2.0.bin` and `licenses/silero-vad-MIT.txt`; include them and the helper executable in `manifest.json` with per-file SHA-256. Add a self-contained workflow smoke input consisting of 1.0 s digital silence + 16 kHz mono s16le PCM decoded from `samples/jfk.wav` + 1.0 s digital silence. Require max probability below 0.5 in the first 0.8 s and last 0.8 s, and max probability above 0.8 somewhere in the speech. The workflow check uses only bundled/upstream inputs and threshold assertions; it does not run or depend on the local ONNX simulator.
- [x] Fix the r2 detached checksum writer so `.sha256` ends immediately after the checksum filename, without CR or LF. Assert its bytes and parsed ZIP SHA-256 in the workflow.
- [x] Bump `RUNTIME` in `boards/speech-to-text/scripts/downloads.mjs` to `whisper-runtime-1.9.5-r2` and its release URL, size and SHA-256. Update `verifyRuntime()` to require both `whisper-server.exe` and `whisper-vad-helper.exe` while checking the exact manifest/file set and hashes. After successful r2 verification, clean sibling `runtime/whisper-runtime-*` folders except the current pinned id.
- [x] Prepare the `speech-to-text` board for its planned pre-publication enhancement release: bump `boards/speech-to-text/board-manifest.json` from `1.0.1` to `1.1.0`; prepend `## 1.1.0` and the single line `- Added whisper-runtime r2 with the streaming VAD helper.` to `boards/speech-to-text/WHATS-NEW.md`, keeping the existing 1.0.1 and 1.0.0 notes intact.
- [x] ~~Locally build~~ No local C++ toolchain: the workflow is the build. Ran the released r2 helper locally on CPU instead (frame indexes, finite probabilities, empty stderr, partial-frame EOF, timings; see Notes).
- [x] After the r2 build, Claude ran the ONNX comparison locally on the 38.2 s TTS clip from US-1726 (`en-pauses.wav`; the JFK clip is covered by the workflow smoke test). Results in Notes.

## Concerns / Open Questions

- The protocol is one process per stream for v1. If process startup cost matters to BT-061, add a versioned reset command that invokes `whisper_vad_reset_state()` and retains the loaded model.
- *(Resolved.)* GGML and ONNX were expected to differ over `n_context`; measured, they agree (mean difference 0.001, identical speech/non-speech at 0.5).

## Acceptance Criteria

- [x] Workflow publishes `whisper-runtime-1.9.5-r2` with `whisper-server.exe`, `whisper-vad-helper.exe`, the Silero v6.2.0 model, all needed DLLs and MIT notices represented in the per-file manifest.
- [x] The helper processes buffered complete 512-sample frames with one stateful API call per batch, preserves LSTM state, emits one monotonically indexed probability per frame, and handles a partial final frame by zero-padding and exiting successfully.
- [x] Windows stdin/stdout are in binary mode. stdout is clean LF-delimited JSONL; whisper and ggml logging callbacks suppress INFO/DEBUG and forward only WARN/ERROR to stderr.
- [x] Padded JFK CPU smoke test passes: max probability is below 0.5 for each 0.8 s outer silence region and above 0.8 somewhere in speech. The workflow smoke test is self-contained and does not depend on ONNX or Claude scratch files.
- [x] Local Notes record the informational ONNX comparison, expected `n_context`-related differences, batched-vs-per-frame cost, and one-vs-four-thread timing. Sustained VAD processing is at least 10× real time on the reference CI runner.
- [x] `boards/speech-to-text/scripts/downloads.mjs` pins r2 and verifies both executables plus the exact manifest file set and hashes; successful r2 verification removes stale sibling runtime folders.
- [x] `speech-to-text` board manifest is `1.1.0`, with a new one-line 1.1.0 changelog heading and all 1.0.1/1.0.0 notes retained.
- [x] The detached `.sha256` asset has no trailing CRLF and matches the ZIP hash.
- [x] BT-061 can consume the helper's frame-indexed probability stream; BT-060 adds no segmentation, buffer, draft or commit policy.

## Files Changed

| File | Change |
|------|--------|
| `runtime/vad-helper/main.cpp` | New — stateful streaming helper, Windows binary streams, filtered logging and buffered-frame protocol |
| `runtime/vad-helper/CMakeLists.txt` | New — `whisper-vad-helper` target linked to `whisper` |
| `.github/workflows/build-whisper-runtime.yml` | Build/package helper and model; threshold smoke test; fix detached checksum newline |
| `boards/speech-to-text/scripts/downloads.mjs` | Pin r2, require helper and clean stale runtime revisions |
| `boards/speech-to-text/board-manifest.json` | Bump unpublished board to 1.1.0 |
| `boards/speech-to-text/WHATS-NEW.md` | Add 1.1.0 runtime/helper note; retain older entries |
| Runtime package `models/ggml-silero-v6.2.0.bin` | New — MIT Silero VAD model bundled with runtime |
| Runtime package `licenses/silero-vad-MIT.txt` | New — Silero model notice |

## Notes

- US-1726's recommended hybrid policy (500 ms pause draft, 1,200 ms pause commit, 1 s pre-roll, 300 ms speech padding, 250 ms minimum speech and 25 s utterance cap) is implemented in BT-061, not here. BT-060 reports probabilities only.
- Source checked against ggml-org/whisper.cpp tag `v1.9.5`, commit `d1be6fd`, including the helper integration pattern in upstream `examples/CMakeLists.txt` and `examples/vad-speech-segments/CMakeLists.txt`.

### Results (2026-10-26)

- First workflow run failed: the runtime is built with `GGML_BACKEND_DL`, so the CPU backend is a DLL that must be loaded with `ggml_backend_load_all()` (as upstream `server.cpp` and `vad-speech-segments` do) before the VAD context is created. Without it the model failed to load and the smoke test only saw a broken pipe; the smoke test now prints the helper's stderr in that case.
- Run 40380369532 published `whisper-runtime-1.9.5-r2`: `whisper-runtime-windows-x64-v1.9.5-r2.zip`, 20,893,369 bytes, SHA-256 `cceaef497b5d666e669a7cb75c5c537acc153614640d7ce2dd308337eebc88fb`. The `.sha256` asset ends without CR/LF. Not marked Latest (Latest is still `speech-to-text-v1.0.0`).
- Workflow smoke (padded JFK, 407 frames): silence maxima 0.009 / 0.0004, speech maximum 0.99998.
- Local, this laptop, 38.2 s TTS clip (1,196 frames), released helper:
  - Model load about 0.1 s. stderr empty for the whole run (log filter works).
  - Batched (whole file on stdin): 1 thread 0.176 ms/frame (182x real time); 4 threads 0.076 ms/frame (420x).
  - Lockstep (write one 512-sample frame, wait for its line): 0.25 ms/frame with 1 or 4 threads (about 128x real time). Per-call overhead dominates, so batching matters less than expected at live rates and 1 thread stays the default.
  - vs ONNX `silero_vad.onnx` with the 64-sample context: mean absolute difference 0.0011, max 0.21 on a single frame, 100% agreement at 0.5 (817 speech frames each). Without the context ONNX is unusable (0 speech frames), confirming GGML includes it.
- `verifyRuntime()` on the extracted r2 files returns true and removed a stale `whisper-runtime-1.9.5-r1` sibling.
- Not yet exercised: the board downloading r2 through its own UI (the live board has r1 installed; it will fetch r2 the next time the runtime is checked). BT-061 is the first caller of the helper.
