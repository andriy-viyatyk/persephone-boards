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
- Whisper returns a full language name. Language probabilities stay disabled to avoid a second encoder pass.
- Models and runtime are downloaded only after an explicit click. The active model is stored only in `persephone.storage`.

For the bridge API, see the canonical `persephone://guides/boards` reference and `assets/guides/agents/speech-transcribe.md` for the provider contract.
