# Speech to Text

Speech to Text records a microphone input and transcribes it on this computer with whisper.cpp. It also provides the `speech.transcribe` version 1 service for other trusted boards.

## `speech.transcribe` contract

The provider advertises `live` and `translate` for every model. `translate` means the service accepts an additive `translate: true` request and produces English text; it does not guarantee that Whisper's dedicated translate task is used. For translation requests, the provider still detects and settles the spoken source language, then decodes text with `language=en`. If the source pass already reports English, that pass is reused. Live sessions latch the source language and send later segment passes directly to English. Requests that omit `translate` keep the existing transcription behavior.

The optional whisper-server `translate=true` form field is separate from English decoding. The service only considers it for translation requests and models marked as supporting Whisper's translate task; `USE_TRANSLATE_TASK_FOR_SUPPORTED_MODELS` is currently `false` pending the pinned-runtime quality comparison. Large v3 Turbo advertises `translate` because English-language decoding works, while its model metadata correctly marks the dedicated task unsupported. The board keeps the `speech.transcribe` interface at version 1.

## First use

1. Open the board and explicitly download the whisper.cpp runtime and one model.
2. Select a microphone and use **Record**, then **Stop and transcribe**.
3. Choose **Use** beside a model to make it the provider's active model.

The runtime and model weights are stored in `%LOCALAPPDATA%\Persephone\board-data\speech-to-text`. Each download is checked against its pinned size and SHA-256. Downloads continue if the board page closes; partial files can resume.

## Privacy and licenses

Audio stays on this computer and is sent only to the local whisper.cpp server. Nothing is uploaded. The Whisper model is licensed by OpenAI under MIT. whisper.cpp is licensed by the ggml authors under MIT; runtime notices are shown in the board after installation. Users download model weights directly from Hugging Face; Persephone and persephone-boards do not host model weights.

## Settings

Use **Settings → Boards → Speech to Text** to choose allowed languages with the checkbox multi-select, plus the vocabulary prompt, GPU use, idle unload time, and cross-board caller policy. **Languages** defaults to `app,en`: `app` follows Persephone's current UI language when it maps to a supported Whisper language, and `en` remains the default fallback. Select additional languages to allow them too, or clear every choice to allow any language. The setting remains a comma-separated string (default `app,en`) for callers that omit their own list; a valid non-empty caller list takes precedence. When automatic detection picks a language outside the allowed list, as it often does for a short phrase, the board transcribes again with each listed language forced (the first three) and keeps the most confident result. Changing the manifest default does not migrate or overwrite saved setting values; users with an existing saved value keep it until they change or reset the setting.
