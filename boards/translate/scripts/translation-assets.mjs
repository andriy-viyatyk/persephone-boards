import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";

export const RS_SERVER_ROOT = "https://firefox.settings.services.mozilla.com/v1/";
const COLLECTION = "translations-models-v2";
const ALLOWED_FILTER = "env.appinfo.OS != 'Android'";
const FILE_SETS = [["model", "lex", "vocab"], ["model", "lex", "srcvocab", "trgvocab"]];
const isVersion = (value) => typeof value === "string" && /^\d+(?:\.\d+)*$/.test(value);
const versionParts = (value) => value.split(".").map(Number);
function compareVersions(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const delta = (x[i] || 0) - (y[i] || 0);
    if (delta) return delta;
  }
  return 0;
}
const pairId = (from, to) => `${from}-${to}`;
const safePart = (value) => {
  if (typeof value !== "string" || !/^[\p{L}\p{N}_-]+$/u.test(value)) throw new Error("Invalid language pair identifier.");
  return value;
};

export function dataRoot(env = process.env) {
  const local = env.LOCALAPPDATA;
  if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) throw new Error("LOCALAPPDATA is unavailable or invalid.");
  return path.resolve(local, "Persephone", "board-data", "translate");
}

function expectedFileSets(records) {
  const files = new Map();
  for (const record of records) {
    const type = record.fileType;
    if (!["model", "lex", "vocab", "srcvocab", "trgvocab"].includes(type)) throw new Error(`Unsupported model file type: ${type}`);
    if (files.has(type)) throw new Error(`Ambiguous model records: duplicate ${type}.`);
    files.set(type, record);
  }
  const actual = [...files.keys()].sort().join("/");
  const matched = FILE_SETS.find((set) => [...set].sort().join("/") === actual);
  if (!matched) throw new Error(`Incomplete or ambiguous model file set (${[...files.keys()].join(", ")}).`);
  return Object.fromEntries(matched.map((type) => [type, files.get(type)]));
}

function eligibleRecord(record, skipped = new Set(), logger = console.warn) {
  const expression = record.filter_expression;
  if (expression === "" || expression == null) return true;
  if (expression === ALLOWED_FILTER) return true;
  if (!skipped.has(expression)) {
    skipped.add(expression);
    logger(`[translate] skipped Remote Settings filter_expression: ${expression}`);
  }
  return false;
}

export function selectModelPairs(records, { logger } = {}) {
  const skipped = new Set(), groups = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object" || !eligibleRecord(record, skipped, logger || console.warn)) continue;
    if (!isVersion(record.version) || !record.sourceLanguage || !record.targetLanguage || !record.fileType) continue;
    const id = pairId(record.sourceLanguage, record.targetLanguage);
    const key = `${id}\0${record.version}`;
    if (!groups.has(key)) groups.set(key, { from: record.sourceLanguage, to: record.targetLanguage, version: record.version, records: [] });
    groups.get(key).records.push(record);
  }
  const byPair = new Map();
  for (const group of groups.values()) {
    const best = byPair.get(pairId(group.from, group.to));
    if (!best || compareVersions(group.version, best.version) > 0) byPair.set(pairId(group.from, group.to), group);
  }
  const selected = new Map();
  selected.errors = new Map();
  for (const [id, group] of byPair) {
    try {
      const architectures = new Set(group.records.map((record) => record.architecture || ""));
      if (architectures.size > 1) throw new Error(`Ambiguous model architecture for ${id} version ${group.version}.`);
      const files = expectedFileSets(group.records);
      const filenames = new Set();
      const normalizedFiles = {};
      for (const [type, record] of Object.entries(files)) {
        const attachment = record.attachment;
        if (!attachment || typeof attachment.location !== "string" || !attachment.location || typeof attachment.filename !== "string" || !attachment.filename || !Number.isSafeInteger(attachment.size) || attachment.size <= 0) {
          throw new Error(`Invalid ${type} attachment metadata for ${id} ${group.version}.`);
        }
        if (!/^[A-Za-z0-9._-]+$/.test(attachment.filename) || attachment.filename.includes("..")) throw new Error(`Unsafe attachment filename for ${id} ${group.version} ${type}.`);
        if (filenames.has(attachment.filename)) throw new Error(`Ambiguous attachment filename for ${id} ${group.version}.`);
        filenames.add(attachment.filename);
        if (!Number.isSafeInteger(record.decompressedSize) || record.decompressedSize <= 0 || !/^[0-9a-f]{64}$/i.test(record.decompressedHash || "")) {
          throw new Error(`Missing decompressed integrity metadata for ${id} ${group.version} ${type}.`);
        }
        normalizedFiles[type] = {
          type, filename: attachment.filename.replace(/\.zst$/i, ""), location: attachment.location,
          compressedSize: attachment.size, compressedHash: attachment.hash || null,
          decompressedSize: record.decompressedSize, decompressedHash: record.decompressedHash.toLowerCase(),
          mimetype: attachment.mimetype || "",
        };
      }
      selected.set(id, { id, from: group.from, to: group.to, version: group.version, architecture: [...architectures][0], files: normalizedFiles });
    } catch (error) {
      selected.errors.set(id, error);
    }
  }
  return selected;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function hashMatches(expected, bytes) {
  if (!expected) return true;
  const hex = sha256(bytes);
  const normalized = expected.replace(/^sha256:/i, "");
  if (/^[0-9a-f]{64}$/i.test(normalized)) return hex === normalized.toLowerCase();
  return createHash("sha256").update(bytes).digest("base64") === normalized;
}
async function atomicWrite(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, bytes, { flag: "wx" });
  const backup = `${file}.previous`;
  await rm(backup, { force: true });
  const existing = await stat(file).catch(() => null);
  if (existing) await rename(file, backup);
  try { await rename(temp, file); await rm(backup, { force: true }); }
  catch (error) { if (existing) await rename(backup, file).catch(() => {}); await rm(temp, { force: true }); throw error; }
}
async function getJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Remote Settings returned HTTP ${response.status}.`);
  return response.json();
}

export class TranslationAssets {
  constructor({ root = dataRoot(), fetchImpl = fetch, logger = console.warn } = {}) {
    this.root = path.resolve(root);
    this.fetch = fetchImpl;
    this.logger = logger;
    this.capabilities = null;
    this.selection = null;
    this.downloads = new Map();
    this.loggedFilters = new Set();
    this.registryFile = path.join(this.root, "registry", "translations-models-v2.json");
  }

  async getCapabilities({ signal, refresh = false } = {}) {
    if (this.capabilities && !refresh) return this.capabilities;
    const body = await getJson(this.fetch, RS_SERVER_ROOT, signal);
    const base = body?.capabilities?.attachments?.base_url;
    if (typeof base !== "string" || !/^https:\/\//i.test(base)) throw new Error("Remote Settings did not advertise an HTTPS attachment base URL.");
    this.capabilities = { attachmentBaseUrl: base.endsWith("/") ? base : `${base}/` };
    return this.capabilities;
  }

  async readSnapshot() {
    try {
      const parsed = JSON.parse(await readFile(this.registryFile, "utf8"));
      if (Array.isArray(parsed?.records) && parsed.records.length) return parsed.records;
    } catch {}
    return null;
  }

  async discover({ signal, forceRefresh = false } = {}) {
    if (this.selection && !forceRefresh) return this.selection;
    let records;
    try {
      await this.getCapabilities({ signal, refresh: forceRefresh });
      const body = await getJson(this.fetch, new URL(`buckets/main/collections/${COLLECTION}/records`, RS_SERVER_ROOT), signal);
      if (!Array.isArray(body?.data)) throw new Error("Remote Settings model registry response is invalid.");
      records = body.data;
      await atomicWrite(this.registryFile, Buffer.from(JSON.stringify({ fetchedAt: new Date().toISOString(), records }), "utf8"));
    } catch (error) {
      records = await this.readSnapshot();
      if (!records) throw new Error(`Translation model registry is offline and no cached snapshot is available: ${error?.message || error}`);
    }
    this.selection = selectModelPairs(records, { logger: (message) => {
      const expression = message.slice(message.indexOf(": ") + 2);
      if (!this.loggedFilters.has(expression)) { this.loggedFilters.add(expression); this.logger(message); }
    } });
    return this.selection;
  }

  async #verifiedManifest(pair) {
    const manifestPath = path.join(this.root, "models", safePart(pair.from), safePart(pair.to), pair.version, "manifest.json");
    let manifest;
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { return null; }
    if (manifest.from !== pair.from || manifest.to !== pair.to || manifest.version !== pair.version || !manifest.files) return null;
    if (Object.keys(manifest.files).sort().join("/") !== Object.keys(pair.files).sort().join("/")) return null;
    for (const [type, meta] of Object.entries(pair.files)) {
      const installed = manifest.files[type];
      if (!installed || !/^[A-Za-z0-9._-]+$/.test(installed.filename || "") || installed.filename.includes("..") || installed.sha256 !== meta.decompressedHash || installed.size !== meta.decompressedSize) return null;
      const file = path.join(path.dirname(manifestPath), installed.filename);
      const bytes = await readFile(file).catch(() => null);
      if (!bytes || bytes.byteLength !== meta.decompressedSize || sha256(bytes) !== meta.decompressedHash) return null;
      installed.path = file;
    }
    return manifest;
  }

  async inspectInstalled() {
    let selected;
    try { selected = await this.discover(); } catch { selected = new Map(); }
    const installed = [];
    for (const pair of selected.values()) {
      const manifest = await this.#verifiedManifest(pair).catch(() => null);
      if (manifest) installed.push({ ...pair, files: Object.fromEntries(Object.entries(manifest.files).map(([type, file]) => [type, { ...file }])) });
    }
    return installed;
  }

  async getInstalledPair(from, to, { selection } = {}) {
    safePart(from); safePart(to);
    const chosen = selection || await this.discover();
    const pair = chosen.get(pairId(from, to));
    if (!pair) return null;
    const installed = await this.#verifiedManifest(pair);
    if (!installed) return null;
    return { ...pair, files: Object.fromEntries(Object.entries(installed.files).map(([type, file]) => [type, { ...file }])) };
  }

  async getPair(from, to, { signal, onProgress = () => {}, selection } = {}) {
    safePart(from); safePart(to);
    const chosen = selection || await this.discover({ signal });
    const pair = chosen.get(pairId(from, to));
    if (!pair) {
      const rejected = chosen.errors?.get(pairId(from, to));
      if (rejected) throw new Error(`Translation model pair ${from} → ${to} was rejected: ${rejected.message}`);
      throw new Error(`Translation model pair ${from} → ${to} is unavailable in the current registry.`);
    }
    const installed = await this.#verifiedManifest(pair);
    if (installed) return { ...pair, files: Object.fromEntries(Object.entries(installed.files).map(([type, file]) => [type, { ...file }])) };
    if (!this.capabilities) {
      try { await this.getCapabilities({ signal }); }
      catch (error) { throw new Error(`Translation model ${from} → ${to} is not cached and Remote Settings is unreachable. Connect to the internet and retry. (${error?.message || error})`); }
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason || new Error("Download cancelled."));
    const id = `${pair.id}@${pair.version}`;
    if (this.downloads.has(id)) throw new Error(`Model ${id} is already downloading.`);
    signal?.addEventListener("abort", abort, { once: true });
    this.downloads.set(id, controller);
    const directory = path.join(this.root, "models", safePart(from), safePart(to), pair.version);
    const manifestFiles = {};
    const total = Object.values(pair.files).reduce((sum, file) => sum + file.compressedSize, 0);
    let completed = 0;
    try {
      await mkdir(directory, { recursive: true });
      await rm(path.join(directory, "manifest.json"), { force: true });
      for (const [type, meta] of Object.entries(pair.files)) {
        const target = path.join(directory, meta.filename);
        const bytes = await this.#downloadFile(meta, target, controller.signal, (loaded, phase) => onProgress({ pair: pair.id, version: pair.version, fileType: type, phase, loaded: completed + loaded, total }));
        onProgress({ pair: pair.id, version: pair.version, fileType: type, phase: "decompressing", loaded: completed + meta.compressedSize, total });
        const decompressed = (meta.mimetype.toLowerCase().includes("zstd") || meta.filename.toLowerCase().endsWith(".zst"))
          ? typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync(bytes) : null
          : bytes;
        if (!decompressed) throw new Error("This Node runtime does not provide zstdDecompressSync for translation models.");
        if (decompressed.byteLength !== meta.decompressedSize || sha256(decompressed) !== meta.decompressedHash) {
          await rm(`${target}.part.zst`, { force: true });
          throw new Error(`Decompressed ${type} model failed size or SHA-256 verification.`);
        }
        const staged = `${target}.verified-${process.pid}`;
        await writeFile(staged, decompressed);
        await rm(target, { force: true });
        await rename(staged, target);
        manifestFiles[type] = { filename: meta.filename, size: decompressed.byteLength, sha256: meta.decompressedHash };
        completed += meta.compressedSize;
      }
      const manifest = { from, to, version: pair.version, architecture: pair.architecture, files: manifestFiles };
      await atomicWrite(path.join(directory, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2)));
      onProgress({ pair: pair.id, version: pair.version, phase: "ready", loaded: total, total });
      return { ...pair, files: Object.fromEntries(Object.entries(manifestFiles).map(([type, file]) => [type, { ...file, path: path.join(directory, file.filename) }])) };
    } catch (error) {
      await rm(path.join(directory, "manifest.json"), { force: true });
      onProgress({ pair: pair.id, version: pair.version, phase: controller.signal.aborted ? "cancelled" : "failed", error: error?.message || "Model download failed.", loaded: completed, total });
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.downloads.get(id) === controller) this.downloads.delete(id);
    }
  }

  async #downloadFile(meta, target, signal, progress) {
    const part = `${target}.part.zst`;
    let offset = await stat(part).then((info) => info.size).catch(() => 0);
    if (offset > meta.compressedSize) { await rm(part, { force: true }); offset = 0; }
    if (offset === meta.compressedSize) {
      const complete = await readFile(part);
      if (hashMatches(meta.compressedHash, complete)) return complete;
      await rm(part, { force: true }); offset = 0;
    }
    let url;
    try { url = new URL(`${this.capabilities.attachmentBaseUrl}${meta.location.replace(/^\/+/, "")}`); }
    catch { throw new Error(`Invalid Remote Settings attachment location for ${meta.filename}.`); }
    const baseUrl = new URL(this.capabilities.attachmentBaseUrl);
    if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) throw new Error("Remote Settings attachment location escaped the advertised base URL.");
    const headers = offset ? { Range: `bytes=${offset}-` } : {};
    let response = await this.fetch(url, { signal, redirect: "follow", headers });
    if (offset && (response.status !== 206 || !new RegExp(`^bytes ${offset}-\\d+/${meta.compressedSize}$`, "i").test(response.headers.get("content-range") || ""))) {
      await response.body?.cancel(); await rm(part, { force: true }); offset = 0;
      response = await this.fetch(url, { signal, redirect: "follow" });
    }
    if (response.status !== (offset ? 206 : 200) || !response.body) throw new Error(`Model download returned HTTP ${response.status}.`);
    let loaded = offset, reported = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      loaded += chunk.length;
      if (loaded > meta.compressedSize) return callback(new Error("Downloaded model exceeds its declared compressed size."));
      const now = Date.now(); if (now - reported >= 200) { reported = now; progress(loaded, "downloading"); }
      callback(null, chunk);
    } });
    try {
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part, { flags: offset ? "a" : "w" }), { signal });
      if (loaded !== meta.compressedSize) throw new Error(`Compressed model size mismatch for ${meta.filename}.`);
      progress(loaded, "verifying");
      const compressed = await readFile(part);
      if (!hashMatches(meta.compressedHash, compressed)) throw new Error(`Compressed model hash mismatch for ${meta.filename}.`);
      return compressed;
    } catch (error) {
      if (!signal?.aborted && /hash mismatch|size mismatch|exceeds/.test(error.message)) await rm(part, { force: true });
      throw error;
    }
  }

  async cancel(pair, version) {
    const controller = this.downloads.get(`${pair}@${version}`);
    if (controller) controller.abort(new Error("Model download cancelled."));
  }

  async remove(from, to, version) {
    safePart(from); safePart(to);
    const target = path.resolve(this.root, "models", from, to, version);
    const base = path.resolve(this.root, "models", from, to) + path.sep;
    if (!target.startsWith(base) || !isVersion(version)) throw new Error("Invalid model cache path.");
    await this.cancel(pairId(from, to), version);
    await rm(target, { recursive: true, force: true });
    const parent = path.dirname(target);
    const remaining = await readdir(parent).catch(() => []);
    if (!remaining.length) await rm(parent, { recursive: true, force: true });
    return this.inspectInstalled();
  }
}
