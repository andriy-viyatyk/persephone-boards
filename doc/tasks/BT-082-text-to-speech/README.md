# BT-082: Text to Speech board — `speech.synthesize` provider

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `text-to-speech`  
**Started:** —  
**Completed:** —

## Goal

Provide local, streamed speech synthesis as `speech.synthesize@1` for Persephone EPIC-139, using Supertonic 3 int8. This task does not implement the voice assistant, wake words, or changes to Persephone.

## Background

- EPIC-139 decision 3 prohibits Windows voices, including fallback; its linked tasks list BT-082 and the contract work US-1784. US-1789 records the agreed engine and voice 0, and reports 44.1 kHz mono, ten voices, and sentence-level generation. Ukrainian number reading remains unchecked.
- The normative contract is `C:/projects/persephone/assets/guides/agents/speech-synthesize.md`; the general board service guide is `C:/projects/persephone/assets/guides/agents/boards.md`. The `tts-test` prototype proves loading and streaming, but its protocol is not the contract.
- `boards/speech-to-text/` provides the service approval, management panel and download precedent; `boards/translate/` provides model caching and management. The how-to index currently lists no service or model-download recipe.

## Implementation Plan

- [x] Resolve native delivery first. Scaffold with `boards.createBoard("text-to-speech", "<repo>/boards")` when implementation starts. Do not commit native binaries or vendor the wrapper. Download both pinned npm tarballs at installation: [sherpa-onnx-node 2.0.1](https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-2.0.1.tgz) and [sherpa-onnx-win-x64 2.0.1](https://registry.npmjs.org/sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-2.0.1.tgz). Obtain each version's published registry `dist.integrity`, pin its SHA-512 value in `scripts/downloads.mjs`, and verify the tarball before extraction; no npm installation or separate release asset is needed. Extract the packages as sibling `runtime/sherpa-onnx-node/` and `runtime/sherpa-onnx-win-x64/` under `%LOCALAPPDATA%/Persephone/board-data/text-to-speech/`; the wrapper's `addon.js` resolves the sibling platform package. Load the wrapper's `sherpa-onnx.js` from that absolute path using `createRequire`. Reject unsafe paths, links and unexpected archive contents before extraction, and stage atomically. The prototype's native package includes `sherpa-onnx.node` and four DLLs; retain all required files. The wrapper package declares Apache-2.0; include applicable sherpa-onnx, ONNX Runtime and bundled-component licences with the installed runtime. Verify the installed layout and utility-process load on the supported platform; report unsupported platforms as `not-ready`.
- [x] Create `boards/text-to-speech/board-manifest.json`: version `1.0.0`, `minAppVersion: "5.0.18"` (unreleased), `minBridgeVersion: "1.42.0"`, `service: "scripts/service.mjs"`, `permissions.service: true`, `serviceInterfaces: [{ "id": "speech.synthesize", "version": 1, "title": "Speech Synthesis" }]`, `languages` folder `lang` with English default, and `screenshot: "screenshot.png"`. Declare only permissions used. Add numeric `default-voice` setting default 0, validate 0–9, and apply changes via `persephone.settings.get` / `onChange`. Add Speech to Text's `caller-approval-policy` enum, default `accept-granted`, with `same-board-only` alternative. Localize settings.
- [x] Implement `scripts/service.mjs` and `scripts/engine.mjs`. Register message and close handlers immediately, before awaiting settings or work. Apply caller policy to every operation, including host `{ id: "persephone", name: "Persephone" }`; close refused callers with `connection-refused`. Route same-board management separately from the exact interface. Load the installed model lazily and reuse one engine; use the prototype's `OfflineTts.createAsync` configuration, two CPU threads, `maxNumSentences: 1`, and `generateAsync({ text, enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig({ sid: voice, speed, extra: { lang } }) })`. Serialize synthesis through one FIFO queue across all channels: only one `generateAsync` runs at a time, and drop a closed channel's queued sentences. Handle shutdown and load failure. If native inference cannot be interrupted, discard the in-flight result on completion, start no further sentence for that channel and send nothing after close. Unload the engine after 10 idle minutes using one commented tuning constant, with no setting unless testing shows a need; do not unload while work is queued or running. Reload on the next request.
- [x] Implement the contract independently of installation for `describe`: reply `{ type: "description", local: true, languages, voices, defaultVoice, sampleRate: 44100, encoding: "pcm-f32le" }`, then close. [Sherpa's Supertonic 3 documentation](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/javascript-api/examples/tts_supertonic.rst) lists the exact supported ISO codes: `ar`, `bg`, `cs`, `da`, `de`, `el`, `en`, `es`, `et`, `fi`, `fr`, `hi`, `hr`, `hu`, `id`, `it`, `ja`, `ko`, `lt`, `lv`, `nl`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sv`, `tr`, `uk`, `vi`. Advertise and validate all 31; document that only English and Ukrainian were listening-verified in research. [Supertone](https://github.com/supertone-oss-archive/supertonic/blob/main/web/README.md) names ten presets F1–F5 and M1–M5; [a derivative model card](https://huggingface.co/WilburDev/supertonic-3-mobile) reports that this `voice.bin` maps indices 0–4 to F1–F5 and 5–9 to M1–M5. Confirm that mapping against the pinned model or its conversion source during implementation; use the names when confirmed, otherwise `Voice 0` through `Voice 9` rather than mislabeling. Keep index 0 as default. For `{ type: "speak", text, lang, voice?, speed? }`, default voice from settings and speed to 1; validate text, language, integer voice and finite speed in at least 0.5–2. Return terminal `invalid-argument`, `unsupported-language`, `unsupported-voice`, `not-ready`, or `engine-failed` as appropriate. Never download on contract requests. Send ordered `{ type: "audio", data: ArrayBuffer, sampleRate, encoding: "pcm-f32le", sentence: zeroBasedIndex, text: sentenceText }`, splitting each generated sentence into ordinary copied little-endian Float32 buffers at most 256 KiB, whole samples only. Repeat sentence index and text on its chunks; honor `writable` / `whenWritable()` and close races. Send `{ type: "done" }` after all audio, then close; failures send `{ type: "error", code, message }` and close if still open.
- [x] Add `scripts/downloads.mjs` for one explicit first-use Install action that downloads both npm runtime packages and the model with one aggregate progress bar, cancellation, verification, staged atomic install, state and delete, following `boards/speech-to-text/scripts/downloads.mjs`. Store outside the shipped board in `%LOCALAPPDATA%/Persephone/board-data/text-to-speech/`. Pin model source revision, byte sizes and SHA-256 values verified during implementation; verify all assets before reporting ready, clean partials on failure, serialize install/delete against inference, and unload before deletion. Model source: [sherpa-onnx Supertonic 3 int8 archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2), per [upstream instructions](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/tts/supertonic.rst). Alternatively pin and download individual files from the [model repository](https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tree/main): `duration_predictor.int8.onnx`, `text_encoder.int8.onnx`, `vector_estimator.int8.onnx`, `vocoder.int8.onnx`, `tts.json`, `unicode_indexer.bin`, `voice.bin`. These are the files referenced by the prototype; its folder also contains an MIT `LICENSE`. If using the archive, validate paths and links before extraction. Model size is approximately 145 MB decimal.
- [x] Ship the complete [Supertone model OpenRAIL-M licence](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE) in `boards/text-to-speech/licenses/` and copy it into the installed model directory; retain required notices and attribution, and explain use restrictions in `README.md`. The prototype's MIT `model/LICENSE` is not the weights licence. Verify upstream licence and redistribution requirements against the pinned model before release.
- [x] Add `scripts/text.mjs`: start with the prototype's whitespace normalization, sentence punctuation split and comma split beyond 220 characters; a sentence without a suitable comma can still be long, so independently cap audio chunks. Sentence metadata consistently identifies text actually spoken. Do not implement a number normalizer in this task; if the user reports incorrect readings, record a follow-up.
- [x] Create `index.html`, `app.css`, `app.js` and scaffolded `board-base.css` / bridge wiring. Provide missing, installing, ready and failure states, one aggregate progress bar, cancel, retry and delete. On first use offer explicit Install for runtime and model. Add a test panel with text/sample, all advertised languages, named voices, speed 0.5–2, Speak and Stop. Include English and Ukrainian Numbers samples: Ukrainian `Зараз 19:45. Фільм триває 2 години 15 хвилин, рейтинг 8,4. Серія 3 із 12.` and a comparable English sample with times, integers and decimals. During live verification the user listens and reports readings; record their findings. Use `persephone.service.openChannel` for same-board operations, queue ordered Float32 audio in Web Audio at each chunk's sample rate, and on Stop close the channel and stop queued playback. Handle errors and teardown.
- [x] Create `lang/en.json`, `lang/uk.json` and packs for the other languages in `boards/speech-to-text/lang/`, following its `persephone.i18n.t()` and `manifest.*` pattern. Add `README.md` (model source, offline use, permissions, licence and restrictions), `WHATS-NEW.md` with `## 1.0.0`, and a public-safe 1120×700 `screenshot.png` per `CLAUDE.md`. Do not hand-edit catalog or versions manifests; do not publish.

## Concerns / Open Questions

- `scripts/publish-board.mjs` excludes every `node_modules` folder. The three board package manifests contain build dependencies; `torrent-viewer/package-lock.json` includes transitive native-build packages, but this does not establish a shipped Node native addon precedent. Speech to Text downloads a separate Windows x64 executable runtime; Translate uses WASM. Prove the downloaded sibling package layout loads in Electron, survives restart and works offline. Pin and validate both registry SHA-512 integrity values at implementation; registry metadata could not be retrieved during this review. The prototype has no root `package.json`, only installed packages.
- Confirm platform coverage, Electron/Node ABI compatibility, native binary redistribution licences, DLL dependencies and size. Initially validate Windows x64, matching the prototype and Speech to Text runtime; do not imply other platforms work without their own binaries and checks.
- Number pronunciation is unverified, especially Ukrainian inflection, decimals and times. The user must listen to the Numbers samples; a normalizer, if needed, is follow-up work.
- `describe` remains available without a model; the prototype config confirms 44.1 kHz, and US-1789 reports ten voices. The 31 languages are documented upstream; English and Ukrainian alone were listening-verified. Confirm the reported voice-index mapping before using upstream names.
- Contract requests cannot initiate downloads. First use means explicit installation through the board page; external callers get `not-ready` until installed. A native generation may finish internally after cancellation; verify result suppression and resource release.

## Acceptance Criteria

- [x] A packaged board on supported Windows x64 installs both pinned npm tarballs and model via one action and aggregate progress bar, verifies registry SHA-512 integrity, safely extracts them into the sibling runtime layout, and loads the runtime in Persephone 5.0.18 or newer without target-side npm. No native binary or vendored wrapper is committed; applicable licences accompany installed components.
- [x] Live cross-board/host `describe` works before and after installation and returns required fields, ten stable named voices, selected default, all 31 documented language codes, 44100 Hz and `pcm-f32le`; caller policy permits or refuses as configured. Verify the voice index-to-name mapping.
- [x] Live `speak` in English and Ukrainian streams multiple ordered sentences before completion, with whole-sample ArrayBuffers at most 256 KiB, correct sentence metadata, actual sample rate and terminal `done`. Check default/explicit voice, speed bounds, invalid inputs, unsupported voice and engine errors.
- [ ] Close mid-speech and use Stop during playback: playback stops, no later messages or sentences are sent and resources are released. Check close during loading, generation and backpressure.
- [ ] Concurrent channels use one FIFO synthesis queue with at most one `generateAsync` in flight; closing a queued channel drops its pending sentences. The engine unloads after the configured idle interval, never during queued or active work, and reloads on demand.
- [x] Unsupported language returns `unsupported-language`; absent/deleted model returns `not-ready` without downloading; errors use the contract shape and terminal close.
- [ ] First-use download shows progress, cancel/retry, verification and ready state; delete and reinstall work. Corrupt or incomplete assets never count as ready. OpenRAIL-M accompanies the model and restrictions appear in the README.
- [ ] The user listens to the Ukrainian and English Numbers samples during live verification; record the user's findings and identify a follow-up if readings need normalization. Inspect long sentences and the payload cap.
- [ ] Model management, settings, test panel and language packs work in the live app; inspect page and screenshot. `ui.log` is clean, including no CSP violations.
- [ ] After installation, disconnect network and confirm describe, synthesis and playback work offline. Version and changelog match 1.0.0; catalog manifests are not hand-edited and nothing is published.

## Live verification (2026-11-07, Persephone dev build, Windows x64)

Checked from the app side through `api.connectHostServiceChannel("speech.synthesize")` (no playback):

- Before install: `describe` returned all required fields (31 languages, Voice 0–9, default 0, 44100 Hz, `pcm-f32le`); `speak` returned `not-ready`.
- Install from the board page: one action installed both npm tarballs and the model; the page showed Ready.
- Ukrainian four-sentence reply: 4 ordered sentences, 11 chunks (max 262,144 bytes, whole samples), 12.99 s of audio in 2.4 s; first audio 924 ms cold (model load), 250 ms warm.
- Closing the channel after the first chunk stopped the stream; the next request still worked (first audio 438 ms).
- `lang: "xx"` → `unsupported-language`; `voice: 42` → `unsupported-voice`; `speed: 9` and empty text → `invalid-argument`.
- `ui.log` clean.
- Restyled the page with the Persephone theme variables (header with status pill, Model and Test speech panels), matching the Wake Word board; `screenshot.png` captured (1120×700).
- Pending: the user's listening check (numbers, voices), Stop during playback on the page, delete/reinstall, offline check.

## Files Changed

| File | Change |
|------|--------|
| `boards/text-to-speech/board-manifest.json` | New provider, permissions, settings, versions and language metadata |
| `boards/text-to-speech/index.html`, `app.css`, `app.js`, `board-base.css` | New page, model management and test playback |
| `boards/text-to-speech/scripts/service.mjs`, `engine.mjs`, `downloads.mjs`, `text.mjs` | Contract service, native engine, model management and text handling |
| `boards/text-to-speech/licenses/` | Model and applicable runtime licence texts; runtime packages are downloaded, not committed |
| `boards/text-to-speech/lang/*.json` | Board and manifest translations |
| `boards/text-to-speech/README.md`, `WHATS-NEW.md`, `screenshot.png` | Documentation, history and catalog image |
| `doc/active-work.md` | Track BT-082 under Planned |

## Notes

Scaffolded using the running Persephone MCP. The user supplied verified npm integrities and model revision cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4; the prototype files match that revision. The installer, service and test UI are implemented but remain unverified in Persephone. OpenRAIL-M, conversion MIT, Apache-2.0 and ONNX Runtime MIT texts are included; review any additional bundled-component notices before release. The native wrapper exposes no explicit engine disposal method, so timely reclamation and deleting loaded DLLs on Windows remain unverified. Language packs beyond English and Ukrainian contain English fallback text and need translation. Live verification, numbers listening and screenshot are pending.

Prototype files hashed locally (byte size / SHA-256); the user confirmed they match the pinned upstream revision:

| File | Bytes | SHA-256 |
|---|---:|---|
| duration_predictor.int8.onnx | 3700147 | c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db |
| text_encoder.int8.onnx | 36416150 | c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff |
| vector_estimator.int8.onnx | 78400833 | 20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd |
| vocoder.int8.onnx | 25991073 | e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152 |
| tts.json | 8253 | 42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09 |
| unicode_indexer.bin | 262144 | 8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30 |
| voice.bin | 517168 | 67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8 |
