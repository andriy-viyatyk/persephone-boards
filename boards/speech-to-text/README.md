# Speech to Text

Speech to Text records a microphone input and transcribes it on this computer with whisper.cpp. It also provides the `speech.transcribe` version 1 service for other trusted boards.

## First use

1. Open the board and explicitly download the whisper.cpp runtime and one model.
2. Select a microphone and use **Record**, then **Stop and transcribe**.
3. Choose **Use** beside a model to make it the provider's active model.

The runtime and model weights are stored in `%LOCALAPPDATA%\Persephone\board-data\speech-to-text`. Each download is checked against its pinned size and SHA-256. Downloads continue if the board page closes; partial files can resume.

## Privacy and licenses

Audio stays on this computer and is sent only to the local whisper.cpp server. Nothing is uploaded. The Whisper model is licensed by OpenAI under MIT. whisper.cpp is licensed by the ggml authors under MIT; runtime notices are shown in the board after installation. Users download model weights directly from Hugging Face; Persephone and persephone-boards do not host model weights.

## Settings

Use **Settings → Boards → Speech to Text** to choose the recorder's language hints, vocabulary prompt, GPU use, idle unload time, and cross-board caller policy. Contract callers with no language hint use automatic language detection.
