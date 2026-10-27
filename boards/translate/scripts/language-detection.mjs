import { Worker } from "node:worker_threads";

const workerFile = new URL("./cld2-worker.mjs", import.meta.url);
const aliases = Object.freeze({ zh: "zh-Hans", iw: "he", in: "id", no: "nb", jw: "jv", fil: "tl" });

export function normalizeDetectedCode(raw, registryCodes) {
  if (typeof raw !== "string" || !raw || raw === "un") return null;
  if (aliases[raw] && registryCodes.has(aliases[raw])) return aliases[raw];
  if (registryCodes.has(raw)) return raw;
  try {
    const canonical = Intl.getCanonicalLocales(raw)[0];
    if (canonical && registryCodes.has(canonical)) return canonical;
    if (canonical) return canonical;
  } catch {}
  return raw;
}

export function normalizeHtmlLang(raw, registryCodes) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let canonical;
  try { canonical = Intl.getCanonicalLocales(raw.trim().replaceAll("_", "-"))[0]; } catch { return null; }
  if (!canonical) return null;
  const parts = canonical.split("-");
  const language = parts[0].toLowerCase();
  const script = parts.find((part) => /^[A-Z][a-z]{3}$/.test(part));
  if (language === "zh") {
    if (script === "Hans" || ["CN", "SG"].includes(parts.find((part) => /^[A-Z]{2}$/.test(part)))) return "zh-Hans";
    if (script === "Hant" || ["TW", "HK", "MO"].includes(parts.find((part) => /^[A-Z]{2}$/.test(part)))) return "zh-Hant";
  }
  if (script) {
    const exact = `${language}-${script}`;
    if (registryCodes.has(exact)) return exact;
  }
  const alias = aliases[language] || language;
  return registryCodes.has(alias) ? alias : null;
}

export class LanguageDetection {
  constructor() {
    this.worker = new Worker(workerFile, { execArgv: process.execArgv.filter((arg) => !arg.startsWith("--input-type")) });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.on("message", ({ id, result, error }) => {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      request.signal?.removeEventListener("abort", request.abort);
      error ? request.reject(new Error(error)) : request.resolve(result);
    });
    this.worker.on("error", (error) => this.#fail(error));
    this.worker.on("exit", (code) => { if (code && this.pending.size) this.#fail(new Error(`CLD2 worker exited with code ${code}.`)); });
  }
  #fail(error) { for (const request of this.pending.values()) { request.signal?.removeEventListener("abort", request.abort); request.reject(error); } this.pending.clear(); }
  async detect(text, registryCodes, { signal } = {}) {
    const sample = String(text ?? "").slice(0, 4096);
    if (signal?.aborted) throw signal.reason || new Error("Detection cancelled.");
    const id = this.nextId++;
    const raw = await new Promise((resolve, reject) => {
      const request = { resolve, reject, signal, abort: null };
      request.abort = () => { this.worker.postMessage({ type: "cancel", id }); this.pending.delete(id); signal?.removeEventListener("abort", request.abort); reject(signal.reason || new Error("Detection cancelled.")); };
      this.pending.set(id, request);
      signal?.addEventListener("abort", request.abort, { once: true });
      this.worker.postMessage({ type: "detect", id, text: sample });
    });
    const language = normalizeDetectedCode(raw.language, registryCodes);
    const candidates = (raw.candidates || []).map((candidate) => ({ language: normalizeDetectedCode(candidate.languageCode, registryCodes), score: Math.max(0, Math.min(1, Number(candidate.percent) / 100)) }))
      .filter((candidate) => candidate.language && Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    return { language, confidence: raw.reliable ? "high" : "low", sampleChars: sample.length, candidates };
  }
  async close() { this.#fail(new Error("CLD2 worker closed.")); await this.worker.terminate(); }
}
