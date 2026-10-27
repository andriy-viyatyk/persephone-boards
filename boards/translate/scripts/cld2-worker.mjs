import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.resolve(here, "../vendor/cld2");
const pending = new Set();
let readyResolve;
let readyReject;
let initialized = false;
let detector;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
ready.catch(() => {});
const context = vm.createContext({
  console, process, require: createRequire(import.meta.url), Buffer, __dirname: vendor,
  setTimeout, clearTimeout, Uint8Array, ArrayBuffer, WebAssembly,
  Module: {
    onRuntimeInitialized: () => { initialized = true; readyResolve(); },
    memoryInitializerPrefixURL: `${vendor}${path.sep}`,
    read: (filename, binary) => {
      const actual = String(filename).endsWith("cld-worker.js.mem") ? path.join(vendor, "cld2__cld-worker.js.mem") : filename;
      const value = readFileSync(actual);
      return binary ? value : value.toString();
    },
  },
  postMessage: (value) => { if (value === "ready") { initialized = true; readyResolve(); } },
});
try {
  vm.runInContext(readFileSync(path.join(vendor, "cld2__cld-worker.js"), "utf8"), context, { filename: "cld2__cld-worker.js" });
} catch (error) { readyReject(error); }

parentPort.on("message", async (message) => {
  if (message?.type === "cancel") { pending.delete(message.id); return; }
  if (message?.type === "close") { parentPort.close(); return; }
  if (message?.type !== "detect" || !Number.isSafeInteger(message.id)) return;
  pending.add(message.id);
  try {
    if (!detector) {
      let timer;
      try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CLD2 initialization timed out.")), 10_000); timer.unref?.(); })]); }
      finally { clearTimeout(timer); }
      detector = (text) => {
        const guess = context.W.g(text, true);
        try {
          const languages = Array.from({ length: 3 }, (_, index) => {
            const item = guess.S(index);
            return { languageCode: item.m(), percent: item.P() };
          }).filter((item) => item.languageCode !== "un" || item.percent > 0);
          return { language: guess.m(), reliable: guess.N(), candidates: languages };
        } finally { context.c.destroy(guess); }
      };
    }
    const result = detector(message.text);
    if (pending.has(message.id)) parentPort.postMessage({ id: message.id, result });
  } catch (error) {
    if (pending.has(message.id)) parentPort.postMessage({ id: message.id, error: error?.message || "CLD2 failed." });
  } finally { pending.delete(message.id); }
});
