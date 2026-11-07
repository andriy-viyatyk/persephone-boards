# Text to Speech

Text to Speech provides local `speech.synthesize@1` speech through Supertonic 3 int8 and sherpa-onnx. Install the runtime and model explicitly from the board page; requests never trigger downloads. After installation, synthesis runs offline. The initial runtime targets Windows x64 and requires Persephone 5.0.18 or newer. The board uses the service permission; synthesis text and audio stay on the computer.

The installer downloads sherpa-onnx-node and sherpa-onnx-win-x64 2.0.1 from npm and model files from [the pinned conversion revision](https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tree/cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4). It checks the npm SHA-512 integrity and the model files' sizes and SHA-256 hashes. Assets are stored under `%LOCALAPPDATA%/Persephone/board-data/text-to-speech/`, outside the board package. Use Delete on the board page to remove them.

The provider advertises 31 languages and ten voices, numbered 0–9. English and Ukrainian alone were listening-verified during research. Number pronunciation, including times and decimals, remains to be checked by listening. No number normalization is performed.

The `speech.synthesize@1` capability provides `speak(text, { lang?, voice?, speed? })`
and `stop()`. Speech plays through Persephone's audio service; a new speak replaces the current
one, and the result reports `finished` or `interrupted`. The default language is Ukrainian
for text containing Cyrillic and English otherwise; the default voice comes from board settings.
There is no board-imposed text-length limit. The page's Speak and Stop controls exercise the same
playback path.

## Licences and restrictions

The Supertonic 3 weights are subject to [Supertone's OpenRAIL-M licence](licenses/supertonic-3-OpenRAIL-M.txt), including its use restrictions and redistribution conditions. For example, the restrictions address impersonation without consent, harmful misinformation, certain discriminatory uses, medical advice, and disclosure of machine-generated content. Read the complete licence and Attachment A before use or redistribution. The model conversion has its own [MIT licence](licenses/sherpa-conversion-MIT.txt), which is not the weights licence. Both notices are copied to the installed model.

The sherpa-onnx npm packages are Apache-2.0; [Apache 2.0](licenses/Apache-2.0.txt) and [ONNX Runtime MIT](licenses/ONNX-Runtime-MIT.txt) texts accompany the installed runtime.
