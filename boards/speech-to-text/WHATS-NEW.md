## 1.4.0
- Added English translation requests to the `speech.transcribe` v1 service while preserving source-language detection and ordinary transcription.
- Added the optional Large v3 model (about 1.1 GB): the best translation to English, slower than the default Large v3 Turbo.

## 1.3.0
- Interface languages: Belarusian, Chinese (Simplified), Estonian, French, German, Hungarian, Italian, Japanese, Korean, Latvian, Lithuanian, Polish, Portuguese (Brazil), Romanian, Slovak, Spanish and Ukrainian.
- Redesigned the main screen with collapsible setup and license panels and a central live or record-then-type test control.
- Default language hints now follow Persephone's UI language, with English as a fallback.
- Languages can now be selected with a checkbox multi-select while retaining the `app,en` default.
- Live transcription runs for an hour or more: no five-minute limit, flat memory, and previews dropped first when the engine falls behind.
- Live language detection is fixed: Ukrainian heard as Russian no longer falls back to the first listed language, and every sentence re-checks the language.

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
