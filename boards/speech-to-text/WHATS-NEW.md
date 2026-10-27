## 1.3.0
- Redesigned the main screen with collapsible setup and license panels and a central live or record-then-type test control.
- Default language hints now follow Persephone's UI language, with English as a fallback.
- Languages can now be selected with a checkbox multi-select while retaining the `app,en` default.

## 1.2.0
- Live dictation now types words every second or so while you keep speaking, not only at pauses.

## 1.1.0
- Added whisper-runtime r2 with the streaming VAD helper.
- Added opt-in live segmentation with draft previews and committed utterances.

## 1.0.1
- The **Languages** setting now applies to every caller, including Persephone voice typing and Agent Chat. Short phrases detected as another language are transcribed again in one of the listed languages.
- Saved settings (GPU, idle unload, caller policy, vocabulary) now take effect after a restart instead of only after they are changed.

## 1.0.0
- Added local whisper.cpp transcription, verified downloads, and a microphone test recorder.
