import { createRequire } from "node:module";
import path from "node:path";
import { installedRoot } from "./downloads.mjs";
const require = createRequire(import.meta.url);
let instance;
export async function loadEngine() {
  if (instance) return instance;
  const root = installedRoot();
  const sherpa = require(path.join(root, "runtime", "sherpa-onnx-node", "sherpa-onnx.js"));
  const file = (name) => path.join(root, "model", name);
  const tts = await sherpa.OfflineTts.createAsync({ model: { supertonic: {
    durationPredictor: file("duration_predictor.int8.onnx"), textEncoder: file("text_encoder.int8.onnx"),
    vectorEstimator: file("vector_estimator.int8.onnx"), vocoder: file("vocoder.int8.onnx"),
    ttsJson: file("tts.json"), unicodeIndexer: file("unicode_indexer.bin"), voiceStyle: file("voice.bin")
  }, numThreads: 2, debug: false }, maxNumSentences: 1 });
  return instance = { sherpa, tts };
}
export function unloadEngine() { instance = undefined; }
