# Third-party notices

## Google speech_embedding

The bundled `model/speech-embedding.onnx` is an ONNX export of **speech_embedding** by Google, published through Kaggle / TensorFlow Hub as the TensorFlow 1 model, version 1 (`versionId: 1535`). The source release declares Apache License 2.0. Source archive SHA-256: `0f626c42009c1eb916401b7b2800229a211e43100115bc591b9afbf1b60da27f`. The exported ONNX file is 1,332,551 bytes; SHA-256: `afba79cbf9a64b9281573bb1f8cba1925f8942b40da206a26cb6e81dd6d32234`.

The source is described as a 16 kHz float waveform model with internal log-mel preprocessing. The board supplies the log-mel frontend in `scripts/engine.mjs`. Research reference: Lin et al. (2020), [Training Keyword Spotters with Limited and Synthesized Speech Data](https://arxiv.org/abs/2002.01322).

Licensed under the Apache License, Version 2.0. The full license text is included at `model/LICENSE-Apache-2.0.txt`; an online copy is at https://www.apache.org/licenses/LICENSE-2.0. The license applies to the Google model release and this derived export. No openWakeWord model files are included.

## ONNX Runtime Web 1.22.0

The board vendors the Node-compatible entry, ONNX Runtime WebAssembly binary, and the required `onnxruntime-common` JavaScript files from `onnxruntime-web` 1.22.0. The package is licensed under the MIT License; its full notice is in `vendor/onnxruntime-web/LICENSE`.
