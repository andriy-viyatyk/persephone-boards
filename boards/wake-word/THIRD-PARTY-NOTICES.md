# Third-party notices

## Google speech_embedding

The bundled `model/speech-embedding.onnx` is an ONNX export of **speech_embedding** by Google, published through Kaggle / TensorFlow Hub as the TensorFlow 1 model, version 1 (`versionId: 1535`). The source release declares Apache License 2.0. Source archive SHA-256: `0f626c42009c1eb916401b7b2800229a211e43100115bc591b9afbf1b60da27f`. The exported ONNX file is 1,332,551 bytes; SHA-256: `afba79cbf9a64b9281573bb1f8cba1925f8942b40da206a26cb6e81dd6d32234`.

The source is described as a 16 kHz float waveform model with internal log-mel preprocessing. The board supplies the log-mel frontend in `scripts/engine.mjs`. Research reference: Lin et al. (2020), [Training Keyword Spotters with Limited and Synthesized Speech Data](https://arxiv.org/abs/2002.01322).

Licensed under the Apache License, Version 2.0. The full license text is included at `model/LICENSE-Apache-2.0.txt`; an online copy is at https://www.apache.org/licenses/LICENSE-2.0. The license applies to the Google model release and this derived export. No openWakeWord model files are included.

## Silero VAD 6.2.3

The bundled `model/silero-vad.onnx` is the voice-activity-detection model from
[snakers4/silero-vad](https://github.com/snakers4/silero-vad), taken from the `v6.2.3` tag at
`src/silero_vad/data/silero_vad.onnx`. The file is 2,327,524 bytes; SHA-256:
`1A153A22F4509E292A94E67D6F9B85E8DEB25B4988682B7E174C65279D8788E3`.

It is used to tell speech from any other loud sound before the keyword matcher runs, so that typing, a
tap on the desk or fan noise cannot open the detection gate. At 16 kHz it takes a 512-sample frame
prefixed with the previous 64 samples, together with a carried `[2, 1, 128]` state.

Licensed under the MIT License; the full text is included at `model/LICENSE-MIT-silero-vad.txt`.

## ONNX Runtime Web 1.22.0

The board vendors the Node-compatible entry and the ONNX Runtime WebAssembly binary from `onnxruntime-web` 1.22.0, in `vendor/onnxruntime-web/`. The package is licensed under the MIT License; its full notice is in `vendor/onnxruntime-web/LICENSE`.

## ONNX Runtime Common 1.22.0

`onnxruntime-web` imports its companion package `onnxruntime-common`, so the board vendors that package's ESM build in `vendor/onnxruntime-common/` (from the npm tarball `onnxruntime-common-1.22.0.tgz`, sha512 `vcuaNWgtF2dGQu/EP5P8UI5rEPEYqXG2sPPe5j9lg2TY/biJF8eWklTMwlDO08iuXq48xJo0awqIpK5mPG+IxA==`). Only `dist/esm/*.js`, `dist/esm/package.json` (the `{"type":"module"}` marker Node needs), `package.json` and `README.md` are kept — no CommonJS build, type declarations or source maps. The ESM build has no further dependencies. `onnxruntime-common` 1.22.0 is published under the MIT License as part of the same ONNX Runtime project as `onnxruntime-web`; the notice in `vendor/onnxruntime-web/LICENSE` covers it. The npm package ships no separate licence file.

### Local modification to `vendor/onnxruntime-web/dist/ort.node.min.mjs`

The upstream bundle imports its companion package by bare specifier (`from"onnxruntime-common"`), which only resolves through `node_modules`. A published board has none, so all **6** such specifiers were rewritten to the relative path `"../../onnxruntime-common/dist/esm/index.js"`. No other bytes were changed.

- upstream sha256: `273e8419cf818639498388b3b199e72c6838887f7d35730da0e7b5f79ca5908f`
- vendored sha256: `429e4d37413d100d58c479af252c8e2b078fb70e8adf0273ad92964222ec0eba`

Re-apply this rewrite when upgrading ONNX Runtime, and keep both packages on the same version.
