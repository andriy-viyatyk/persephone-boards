import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.resolve(here, "../vendor/bergamot");
const ALIGNMENTS = Object.freeze({ model: 256, lex: 64, vocab: 64, srcvocab: 64, trgvocab: 64 });
let wasmPromise, wasm, service;
const models = new Map();

async function loadWasm() {
  if (wasmPromise) return wasmPromise;
  wasmPromise = (async () => {
    const js = await readFile(path.join(vendor, "bergamot-translator.js"), "utf8");
    const context = vm.createContext({
      console, process, require: createRequire(import.meta.url), Buffer, Uint8Array,
      ArrayBuffer, WebAssembly, setTimeout, clearTimeout, performance,
    });
    vm.runInContext(`${js}\n globalThis.loadBergamot = loadBergamot;`, context, { filename: "bergamot-translator.js" });
    const glue = context.loadBergamot;
    const binary = await readFile(path.join(vendor, "bergamot-translator-4.0.wasm"));
    const module = await new Promise((resolve, reject) => {
      let instance;
      try {
        instance = glue({ INITIAL_MEMORY: 41_943_040, wasmBinary: binary, print: () => {}, printErr: console.error,
          onAbort: (reason) => reject(new Error(`Bergamot WASM abort: ${reason}`)), onRuntimeInitialized: () => resolve(instance) });
      } catch (error) { reject(error); }
    });
    wasm = module;
    service = new wasm.BlockingService({ cacheSize: 0 });
    return module;
  })();
  try { return await wasmPromise; } catch (error) { wasmPromise = null; throw error; }
}

async function loadModel(pair) {
  const key = `${pair.from}-${pair.to}@${pair.version}`;
  if (models.has(key)) return models.get(key);
  const b = await loadWasm();
  const buffers = {};
  for (const [type, entry] of Object.entries(pair.files)) {
    const bytes = await readFile(entry.path);
    if (bytes.byteLength !== entry.size) throw new Error(`Verified model file changed before load: ${type}.`);
    const memory = new b.AlignedMemory(bytes.byteLength, ALIGNMENTS[type]);
    memory.getByteArrayView().set(bytes);
    buffers[type] = memory;
  }
  const vocabs = new b.AlignedMemoryList();
  if (buffers.vocab) vocabs.push_back(buffers.vocab);
  else { vocabs.push_back(buffers.srcvocab); vocabs.push_back(buffers.trgvocab); }
  const modelFile = pair.files.model.filename;
  const configValues = {
    "beam-size": "1", normalize: "1.0", "word-penalty": "0", "max-length-break": "128",
    "mini-batch-words": "1024", workspace: process.env.BERGAMOT_WORKSPACE || "128", "max-length-factor": "2.0",
    "skip-cost": "true", "cpu-threads": "0", quiet: "true", "quiet-translation": "true",
    "gemm-precision": modelFile.endsWith("intgemm8.bin") ? "int8shiftAll" : "int8shiftAlphaAll", alignment: "soft",
  };
  const config = `\n${Object.entries(configValues).map(([name, value]) => `            ${name}: ${value}\n`).join("")}            `;
  const model = new b.TranslationModel(pair.from, pair.to, config, buffers.model, buffers.lex ?? null, vocabs, null);
  const loaded = { model, buffers, vocabs, pair };
  models.set(key, loaded);
  return loaded;
}

function translateBatch(messagesIn, modelA, modelB, html) {
  if (!messagesIn.length) return [];
  const b = wasm, messages = new b.VectorString(), options = new b.VectorResponseOptions();
  for (const message of messagesIn) {
    messages.push_back(message);
    options.push_back({ qualityScores: false, alignment: true, html: !!html });
  }
  let responses;
  try {
    responses = modelB
      ? service.translateViaPivoting(modelA.model, modelB.model, messages, options)
      : service.translate(modelA.model, messages, options);
    return Array.from({ length: responses.size() }, (_, index) => responses.get(index).getTranslatedText());
  } finally {
    responses?.delete();
    messages.delete();
    options.delete();
  }
}

async function execute(message) {
  const { direct, first, second, items, html } = message;
  const modelA = await loadModel(direct || first);
  const modelB = first && second ? await loadModel(second) : null;
  const output = [];
  for (let offset = 0; offset < items.length;) {
    const batch = [];
    let units = 0;
    while (offset < items.length && batch.length < 8) {
      const item = items[offset];
      const count = item.text.length;
      if (batch.length && units + count > 8192) break;
      if (count > 8192) throw new Error("One translation item exceeds the 8,192 UTF-16 code unit limit.");
      batch.push(item); units += count; offset++;
    }
    const translated = translateBatch(batch.map((item) => item.text), modelA, modelB, html);
    batch.forEach((item, index) => output.push({ key: item.key, part: item.part, text: translated[index] }));
  }
  return output;
}

parentPort.on("message", async (message) => {
  if (!message || typeof message.id !== "number") return;
  try {
    const result = await execute(message);
    parentPort.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: error?.message || "Bergamot translation failed." });
  }
});
