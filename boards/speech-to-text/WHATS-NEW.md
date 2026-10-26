## 1.1.0
- Added whisper-runtime r2 with the streaming VAD helper.
- Added opt-in live segmentation with draft previews and committed utterances.

## 1.0.1
- The **Languages** setting now applies to every caller, including Persephone voice typing and Agent Chat. Short phrases detected as another language are transcribed again in one of the listed languages.
- Saved settings (GPU, idle unload, caller policy, vocabulary) now take effect after a restart instead of only after they are changed.

## 1.0.0
- Added local whisper.cpp transcription, verified downloads, and a microphone test recorder.
