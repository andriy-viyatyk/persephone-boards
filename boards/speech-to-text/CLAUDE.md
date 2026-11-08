# Speech to Text board

This board provides the reserved `speech.transcribe` v1 service and a local microphone test page. Audio is sent only to a loopback whisper.cpp server.

## Layout

- `index.html`, `app.js`, and `app.css` render the model manager and test recorder; `audio-capture-worklet.js` captures microphone samples.
- `scripts/service.mjs` owns the service channels, FIFO transcription queue, whisper-server lifecycle, persistent downloads, verification, and management snapshots.
- `scripts/whisper-languages.mjs` maps whisper.cpp v1.9.5 language names to ISO codes.
- Runtime and model files live under `%LOCALAPPDATA%\Persephone\board-data\speech-to-text`, never in the board folder or `persephone.storage`.
- `board-manifest.json` declares service and microphone permissions, exact interface version, settings, and English messages.

## Run and check

Open the board in Persephone. Install the runtime and a model from the model panel, select a microphone, then record and stop to transcribe. Reload edited files with `pages[pageId].editor.reload()`; inspect `ui.log` for service and page errors.

## Gotchas

- Cross-board opens are authorized from `info.interface`, never `info.page.boardId`. The exact `speech.transcribe` v1 interface and caller policy are checked before request details are read.
- The board page uses only local scripts and styles. Downloads happen in the Node service; `network: false` stays declared.
- Whisper returns a full language name. Language probabilities stay disabled to avoid a second encoder pass; a detection outside the allowed languages is corrected by forced re-runs ranked by token-weighted `avg_logprob` (see `infer` in `scripts/service.mjs`).
- The service reads every setting once at startup (`settingsReady`); `onChange` reports only later edits.
- `whisper-server` is always started with an explicit `-dev N`. Its own default is device 0, and on switchable graphics the Vulkan backend enumerates the **integrated** GPU first — measured on `large-v3-turbo-q5_0`, 35 s of audio took 6.21 s on an Intel Iris Xe against 2.17 s on a GTX 1650, so the default silently picked the card that is roughly three times slower. Build the engine key with `engineFingerprint()` rather than inline interpolation, so every call site restarts the server when the model, `use-gpu` **or** the device changes; keep the model file first in it, because `stopEngine` and the asset watcher recover the name with `split(":")[0]`.
- The device is `persephone.storage` (`GPU_DEVICE_KEY`), beside the active model — **not** a manifest setting. A manifest setting renders as a bare number box on the Settings page, and a device index is meaningless without the card's name next to it. The names exist only after `whisper-server` has run, so the parsed list is cached under `GPU_DEVICES_KEY` and the page can show a real picker on the next start; until two devices are known the row stays hidden behind `gpu.hint`. The child's stderr is piped and drained for its whole life to parse the opening `ggml_vulkan:` lines — it was `"ignore"` before, and an unread pipe eventually blocks the writer. Log the list with `console.warn`: only warn and error reach the board log, so `console.log` would make the numbers undiscoverable.
- Models and runtime are downloaded only after an explicit click. The active model is stored only in `persephone.storage`.

For the bridge API, see the canonical `persephone://guides/boards` reference and `assets/guides/agents/speech-transcribe.md` for the provider contract.
