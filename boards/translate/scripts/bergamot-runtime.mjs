import { Worker } from "node:worker_threads";
import path from "node:path";
import { TranslationAssets, dataRoot } from "./translation-assets.mjs";

const workerFile = new URL("./bergamot-worker.mjs", import.meta.url);
const MAX_UNITS = 8192;
const boundedMinutes = (value) => Math.max(1, Math.min(120, Number.isFinite(Number(value)) ? Number(value) : 3));

function splitPlain(text) {
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_UNITS, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + MAX_UNITS / 2) end = boundary + 1;
    }
    if (end <= start) end = Math.min(start + MAX_UNITS, text.length);
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

function splitOuterWhitespace(text) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return { leading: match[1], core: match[2], trailing: match[3] };
}

export class BergamotRuntime {
  constructor({ root = dataRoot(), idleMinutes = 3, logger = console, onProgress = () => {}, fetchImpl, assets } = {}) {
    this.root = path.resolve(root);
    this.assets = assets || new TranslationAssets({ root: this.root, fetchImpl, logger: (...args) => logger.warn(...args) });
    this.idleMinutes = boundedMinutes(idleMinutes);
    this.logger = logger;
    this.onProgress = onProgress;
    this.worker = null;
    this.pending = new Map();
    this.inflight = 0;
    this.nextId = 1;
    this.idleTimer = null;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  setIdleUnloadMinutes(value) {
    this.idleMinutes = boundedMinutes(value);
    this.#scheduleIdle();
    return this.idleMinutes;
  }

  async listModels() { return this.assets.inspectInstalled(); }
  async discoverModels(options) { return this.assets.discover(options); }

  async resolveInstalledRoute(from, to, { selection } = {}) {
    const chosen = selection || await this.assets.discover();
    if (from === to) return { kind: "identity", from, to, selection: chosen, direct: null, first: null, second: null };
    let route;
    if (chosen.has(`${from}-${to}`)) route = { kind: "direct", from, to, direct: await this.assets.getInstalledPair(from, to, { selection: chosen }) };
    else if (from !== "en" && to !== "en" && chosen.has(`${from}-en`) && chosen.has(`en-${to}`)) {
      const [first, second] = await Promise.all([
        this.assets.getInstalledPair(from, "en", { selection: chosen }),
        this.assets.getInstalledPair("en", to, { selection: chosen }),
      ]);
      route = { kind: "pivot", from, to, first, second };
    } else return null;
    if (route.kind === "direct" && !route.direct) return null;
    if (route.kind === "pivot" && (!route.first || !route.second)) return null;
    return { ...route, selection: chosen };
  }

  download(from, to, options = {}) {
    return this.assets.getPair(from, to, { ...options, onProgress: options.onProgress || this.onProgress });
  }

  cancelDownload(pair, version) { return this.assets.cancel(pair, version); }

  async remove(from, to, version) {
    const key = `${from}-${to}@${version}`;
    if (this.worker && this.loadedPairs?.has(key)) await this.#terminateWorker();
    return this.assets.remove(from, to, version);
  }

  async translate({ from, to, items, html = false, signal, onProgress, route: suppliedRoute, selection } = {}) {
    if (this.closed) throw new Error("Bergamot runtime is closed.");
    if (typeof from !== "string" || typeof to !== "string" || !Array.isArray(items)) throw new Error("Translation requires source/target language codes and an items array.");
    if (from === to) return items.map((item, index) => ({ key: item && typeof item === "object" ? item.key ?? index : index, text: typeof item === "string" ? item : String(item?.text ?? "") }));
    if (signal?.aborted) throw signal.reason || new Error("Translation cancelled.");
    const route = suppliedRoute || await this.resolveInstalledRoute(from, to, { selection });
    if (!route) throw new Error(`Installed translation route ${from} → ${to} is unavailable.`);
    const { direct, first, second } = route;
    const report = onProgress || this.onProgress;

    const outputs = new Map();
    const work = [];
    for (let index = 0; index < items.length; index++) {
      const item = typeof items[index] === "string" ? { key: index, text: items[index] } : items[index];
      const key = item?.key ?? index;
      if (!item || typeof item.text !== "string") throw new Error(`Translation item ${index} must have a string text field.`);
      const { leading, core: rawCore, trailing } = splitOuterWhitespace(item.text);
      const core = rawCore.replaceAll("\u00ad", "");
      if (!core) { outputs.set(key, item.text); continue; }
      if (html && core.length > MAX_UNITS) throw new Error(`HTML translation item ${String(key)} exceeds the 8,192 UTF-16 code unit limit; HTML fragments cannot be split safely.`);
      const parts = html ? [core] : splitPlain(core);
      outputs.set(key, { leading, trailing, parts: new Array(parts.length) });
      parts.forEach((text, part) => work.push({ key, part, text }));
    }
    if (work.length) {
      const result = await this.#enqueue(() => this.#request({ direct, first, second, items: work, html, signal }));
      for (const item of result) outputs.get(item.key).parts[item.part] = item.text;
    }
    return [...outputs].map(([key, value]) => typeof value === "string"
      ? { key, text: value }
      : { key, text: value.leading + value.parts.join("") + value.trailing });
  }

  #enqueue(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  async #request(payload) {
    if (payload.signal?.aborted) throw payload.signal.reason || new Error("Translation cancelled.");
    const worker = this.#ensureWorker();
    clearTimeout(this.idleTimer);
    const id = this.nextId++;
    this.inflight++;
    const pairs = [payload.direct, payload.first, payload.second].filter(Boolean);
    this.loadedPairs ||= new Set();
    pairs.forEach((pair) => this.loadedPairs.add(`${pair.from}-${pair.to}@${pair.version}`));
    return await new Promise((resolve, reject) => {
        const entry = { resolve, reject, signal: payload.signal, abort: null, cancelled: false, settled: false };
        entry.abort = () => {
          entry.cancelled = true;
          entry.cancelReason = payload.signal.reason || new Error("Translation cancelled.");
          void this.#terminateWorker();
        };
        this.pending.set(id, entry);
        payload.signal?.addEventListener("abort", entry.abort, { once: true });
        try { worker.postMessage({ id, ...payload, signal: undefined }); }
        catch (error) {
          this.pending.delete(id);
          payload.signal?.removeEventListener("abort", entry.abort);
          this.inflight = Math.max(0, this.inflight - 1);
          entry.settled = true;
          reject(error);
          this.#scheduleIdle();
        }
    });
  }

  #ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(workerFile, { execArgv: process.execArgv.filter((arg) => !arg.startsWith("--input-type")) });
    worker.on("message", (message) => {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      entry.signal?.removeEventListener("abort", entry.abort);
      this.inflight = Math.max(0, this.inflight - 1);
      if (!entry.settled) {
        entry.settled = true;
        if (entry.cancelled) entry.reject(entry.cancelReason);
        else if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.result);
      }
      this.#scheduleIdle();
    });
    worker.on("error", (error) => this.#failWorker(error));
    worker.on("exit", (code) => {
      if (this.worker === worker) {
        this.worker = null; this.loadedPairs = new Set();
        if (code !== 0) this.#failWorker(new Error(`Bergamot worker exited with code ${code}.`));
      }
    });
    this.worker = worker;
    return worker;
  }

  #failWorker(error) {
    for (const [id, entry] of this.pending) {
      entry.signal?.removeEventListener("abort", entry.abort);
      if (!entry.settled) { entry.settled = true; entry.reject(entry.cancelled ? entry.cancelReason : error); }
      this.pending.delete(id);
      this.inflight = Math.max(0, this.inflight - 1);
    }
    this.#scheduleIdle();
  }

  #scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.worker || this.inflight || this.closed) return;
    this.idleTimer = setTimeout(() => {
      if (!this.inflight) void this.#terminateWorker();
    }, this.idleMinutes * 60_000);
    this.idleTimer.unref?.();
  }

  async #terminateWorker() {
    clearTimeout(this.idleTimer);
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.loadedPairs = new Set();
    this.#failWorker(new Error("Bergamot worker was terminated."));
    await worker.terminate();
  }

  async close() {
    this.closed = true;
    clearTimeout(this.idleTimer);
    await this.queue.catch(() => {});
    await this.#terminateWorker();
  }
}

export function createBergamotRuntime(options) { return new BergamotRuntime(options); }
