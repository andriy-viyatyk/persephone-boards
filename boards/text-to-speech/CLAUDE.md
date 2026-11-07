# Text to Speech — board notes

A Persephone **service board** that provides the platform interface `speech.synthesize@1`
(contract: Persephone's `guides.agents["speech-synthesize"]`). Callers send text and the
service plays it through Persephone's `audio@1` capability.

> The generic board authoring reference (the `persephone.*` bridge, the `--p-*` theme contract,
> CSP rules, reload/test flow) is available via `guides.agents.boards` in Persephone's MCP. This
> file documents only what is specific to this board.

## How it works

- **Engine:** Supertonic 3 int8 (ONNX) through `sherpa-onnx-node` 2.0.1, in `scripts/engine.mjs`.
  Requests must set `enableExternalBuffer: false`: Electron's utility process rejects external
  ArrayBuffers ("TTS settlement failed").
- **Nothing native is committed.** The page's Install button runs `scripts/downloads.mjs`, which
  downloads the two pinned npm tarballs (`sherpa-onnx-node`, `sherpa-onnx-win-x64`) and the model
  files from a pinned Hugging Face revision into
  `%LOCALAPPDATA%/Persephone/board-data/text-to-speech/`, verifying each against the integrity /
  SHA-256 values pinned there. Windows x64 only; other platforms report `not-ready`.
- **Playback:** `speak(text, options?)` plays local synthesis through `audio@1` and returns
  finished or interrupted. A new call replaces current speech; `stop()` interrupts it. The page
  tests the same service path. There is no board text-length limit.
- **Defaults:** Cyrillic text defaults to Ukrainian and other text to English; the default voice
  comes from settings. `scripts/text.mjs` splits sentences and long sentences at commas.
- **One synthesis at a time:** inference is serialized even after interruption. The engine unloads
  after 10 idle minutes.
- **Caller policy:** a channel without `info.interface` is the board's own page; other callers
  must arrive through `speech.synthesize@1` and pass the `caller-approval-policy` setting.

## Licences

The weights are OpenRAIL-M (`licenses/supertonic-3-OpenRAIL-M.txt`), copied into the installed
model with the conversion's MIT notice. Keep the README's description of the use restrictions.

## Changing the model or runtime version

Update the pinned URLs, sizes and hashes in `scripts/downloads.mjs` (and `runtime-files.json`),
then reinstall from the page. Never accept a download without a pinned hash.
