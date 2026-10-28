"use strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const RUNTIME = Object.freeze({
  id: "whisper-runtime-1.9.5-r2",
  displayVersion: "1.9.5",
  url: "https://github.com/andriy-viyatyk/persephone-boards/releases/download/whisper-runtime-1.9.5-r2/whisper-runtime-windows-x64-v1.9.5-r2.zip",
  bytes: 20893369,
  sha256: "cceaef497b5d666e669a7cb75c5c537acc153614640d7ce2dd308337eebc88fb",
});

export const MODELS = Object.freeze([
  { file: "ggml-large-v3-turbo-q5_0.bin", supportsWhisperTranslateTask: false, bytes: 574041195, sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin" },
  { file: "ggml-small-q5_1.bin", supportsWhisperTranslateTask: true, bytes: 190085487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin" },
  { file: "ggml-base-q5_1.bin", supportsWhisperTranslateTask: true, bytes: 59707625, sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin" },
  { file: "ggml-medium-q5_0.bin", supportsWhisperTranslateTask: true, bytes: 539212467, sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin" },
  { file: "ggml-large-v3-q5_0.bin", supportsWhisperTranslateTask: true, bytes: 1081140203, sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin" },
]);

export function dataRoot(env = process.env) {
  const local = env.LOCALAPPDATA;
  if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) throw new Error("LOCALAPPDATA is unavailable or invalid.");
  return path.resolve(local, "Persephone", "board-data", "speech-to-text");
}

export async function sha256File(file, signal) {
  const hash = createHash("sha256");
  const stream = (await import("node:fs")).createReadStream(file);
  for await (const chunk of stream) {
    if (signal?.aborted) throw signal.reason || new Error("Cancelled");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function atomicReplace(source, destination) {
  const backup = `${destination}.previous`;
  await rm(backup, { recursive: true, force: true });
  const existing = await stat(destination).catch(() => null);
  if (existing) await rename(destination, backup);
  try {
    await rename(source, destination);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (existing) await rename(backup, destination).catch(() => {});
    throw error;
  }
}

export async function downloadVerified({ url, part, destination, bytes, sha256, signal, onProgress = () => {}, onPhase = () => {} }) {
  await mkdir(path.dirname(destination), { recursive: true });
  let offset = await stat(part).then((info) => info.size).catch(() => 0);
  if (offset > bytes) { await rm(part, { force: true }); offset = 0; }
  if (offset === bytes && await sha256File(part, signal) === sha256) {
    await atomicReplace(part, destination);
    return;
  }
  if (offset === bytes) { await rm(part, { force: true }); offset = 0; }
  let response = await fetch(url, { signal, redirect: "follow", headers: offset ? { Range: `bytes=${offset}-` } : {} });
  if (offset && (response.status !== 206 || !new RegExp(`^bytes ${offset}-\\d+/${bytes}$`, "i").test(response.headers.get("content-range") || ""))) {
    await response.body?.cancel();
    await rm(part, { force: true });
    offset = 0;
    response = await fetch(url, { signal, redirect: "follow" });
  }
  if (response.status !== (offset ? 206 : 200) || !response.body) throw new Error(`Download returned HTTP ${response.status}.`);
  const output = createWriteStream(part, { flags: offset ? "a" : "w" });
  let loaded = offset, lastReport = 0;
  const meter = new (await import("node:stream")).Transform({
    transform(chunk, _encoding, callback) {
      loaded += chunk.length;
      if (loaded > bytes) return callback(new Error("Downloaded file is larger than its pinned size."));
      const now = Date.now();
      if (now - lastReport >= 200) { onProgress(loaded, bytes); lastReport = now; }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, output, { signal });
  if (loaded !== bytes) throw new Error(`Download size mismatch: expected ${bytes}, received ${loaded}.`);
  onProgress(loaded, bytes);
  onPhase("verifying");
  const actual = await sha256File(part, signal);
  if (actual !== sha256) { await rm(part, { force: true }); throw new Error("SHA-256 verification failed; partial file was removed."); }
  await atomicReplace(part, destination);
}

function run(executable, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; });
    child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
    const abort = () => { void stopProcessTree(child); };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(signal.reason || new Error("Cancelled"));
      if (code !== 0) return reject(new Error(`${path.basename(executable)} failed (${code}): ${stderr.slice(-1000)}`));
      resolve(stdout);
    });
  });
}

export async function stopProcessTree(child, budgetMs = 1400) {
  if (!child?.pid) return;
  if (child.exitCode !== null || child.signalCode) return;
  const deadline = Date.now() + budgetMs;
  if (process.platform !== "win32") child.kill();
  await Promise.race([new Promise((resolve) => child.once("close", resolve)), new Promise((resolve) => setTimeout(resolve, 250))]);
  if (process.platform === "win32" && Date.now() < deadline) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const timeout = setTimeout(() => { killer.kill(); resolve(); }, Math.max(50, deadline - Date.now()));
      killer.once("close", () => { clearTimeout(timeout); resolve(); });
      killer.once("error", () => { clearTimeout(timeout); resolve(); });
    });
  }
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((resolve) => child.once("close", resolve)), new Promise((resolve) => setTimeout(resolve, Math.max(20, deadline - Date.now())))]);
}

// BT-055 writes { upstreamTag, upstreamCommit, files: [{ path, sha256 }] }; the list excludes manifest.json itself.
function manifestFiles(manifest) {
  return Array.isArray(manifest?.files) && manifest.files.length ? manifest.files : null;
}

export async function installRuntime({ root, signal, onPhase = () => {}, onProgress = () => {} }) {
  const directory = path.join(root, "runtime");
  const destination = path.join(directory, RUNTIME.id);
  const archive = path.join(directory, "runtime.zip.part");
  const staging = path.join(directory, `${RUNTIME.id}.staging`);
  await mkdir(directory, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  const zip = path.join(directory, "runtime.zip");
  const archiveInfo = await stat(zip).catch(() => null);
  const archiveReady = Boolean(archiveInfo?.size === RUNTIME.bytes && await sha256File(zip, signal).then((hash) => hash === RUNTIME.sha256).catch(() => false));
  if (!archiveReady) {
    onPhase("downloading");
    await downloadVerified({ url: RUNTIME.url, part: archive, destination: zip, bytes: RUNTIME.bytes, sha256: RUNTIME.sha256, signal, onProgress, onPhase });
  }
  onPhase("verifying");
  const tar = "C:\\Windows\\System32\\tar.exe";
  try {
    const listing = (await run(tar, ["-tf", zip], { signal })).split(/\r?\n/).filter(Boolean);
    if (listing.length > 1000) throw new Error("Runtime archive has too many entries.");
    for (const entry of listing) {
      const normalized = entry.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!normalized) continue;
      if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").some((part) => part === ".." || part === "")) throw new Error("Runtime archive contains an unsafe path.");
    }
    onPhase("extracting");
    await mkdir(staging, { recursive: true });
    await run(tar, ["-xf", zip, "-C", staging], { signal });
    const manifestFile = path.join(staging, "manifest.json");
    const manifest = manifestFiles(JSON.parse((await readFile(manifestFile, "utf8")).replace(/^\uFEFF/, "")));
    if (!manifest) throw new Error("Runtime file manifest is invalid.");
    const expected = new Set(["manifest.json"]);
    for (const item of manifest) {
      if (!item || typeof item.path !== "string" || !/^[0-9a-f]{64}$/i.test(item.sha256)) throw new Error("Runtime manifest entry is invalid.");
      const relative = item.path.replace(/\\/g, "/");
      if (relative.startsWith("/") || /^[a-z]:/i.test(relative) || relative.split("/").some((part) => part === ".." || !part) || expected.has(relative)) throw new Error("Runtime manifest contains an unsafe or duplicate path.");
      expected.add(relative);
      const file = path.resolve(staging, relative);
      if (!file.startsWith(path.resolve(staging) + path.sep) || await sha256File(file, signal) !== item.sha256.toLowerCase()) throw new Error(`Runtime file verification failed: ${relative}`);
    }
    const actual = new Set();
    async function walk(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name), relative = path.relative(staging, file).replace(/\\/g, "/");
        if (entry.isSymbolicLink()) throw new Error("Runtime archive contains a link.");
        if (entry.isDirectory()) await walk(file); else actual.add(relative);
      }
    }
    await walk(staging);
    if (actual.size !== expected.size || [...actual].some((file) => !expected.has(file))) throw new Error("Runtime archive payload does not match its manifest.");
    await atomicReplace(staging, destination);
    await rm(zip, { force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (!await verifyRuntime(root, signal)) throw new Error("Installed Whisper runtime failed verification.");
}

export async function assetSnapshot(root) {
  const runtimePath = path.join(root, "runtime", RUNTIME.id);
  const runtimeInstalled = await verifyRuntime(root).catch(() => false);
  const modelsPath = path.join(root, "models");
  const models = {};
  for (const model of MODELS) models[model.file] = await stat(path.join(modelsPath, model.file)).then((item) => item.size === model.bytes).catch(() => false);
  let licenses = [];
  if (runtimeInstalled) {
    async function walk(folder, base = "") {
      for (const item of await readdir(folder, { withFileTypes: true })) {
        const relative = path.posix.join(base, item.name);
        if (item.isDirectory()) await walk(path.join(folder, item.name), relative);
        else if (relative.toLowerCase().startsWith("licenses/")) licenses.push(relative);
      }
    }
    await walk(runtimePath);
  }
  return { runtime: runtimeInstalled, models, licenses };
}

export async function verifyRuntime(root, signal) {
  const directory = path.join(root, "runtime", RUNTIME.id);
  const manifest = manifestFiles(JSON.parse((await readFile(path.join(directory, "manifest.json"), "utf8")).replace(/^\uFEFF/, "")));
  if (!manifest) return false;
  const expected = new Set(["manifest.json"]);
  for (const item of manifest) {
    if (typeof item?.path !== "string" || !/^[0-9a-f]{64}$/i.test(item.sha256)) return false;
    const relative = item.path.replace(/\\/g, "/");
    if (relative.startsWith("/") || /^[a-z]:/i.test(relative) || relative.split("/").some((part) => !part || part === "..")) return false;
    if (expected.has(relative)) return false;
    expected.add(relative);
    const file = path.resolve(directory, relative);
    if (!file.startsWith(path.resolve(directory) + path.sep) || await sha256File(file, signal) !== item.sha256.toLowerCase()) return false;
  }
  const actual = new Set();
  async function walk(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name), relative = path.relative(directory, file).replace(/\\/g, "/");
      if (item.isSymbolicLink()) throw new Error("Runtime contains a link.");
      if (item.isDirectory()) await walk(file); else actual.add(relative);
    }
  }
  await walk(directory);
  const valid = expected.has("whisper-server.exe") && expected.has("whisper-vad-helper.exe") &&
    actual.size === expected.size && [...actual].every((file) => expected.has(file));
  if (valid) {
    for (const entry of await readdir(path.join(root, "runtime"), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("whisper-runtime-") && entry.name !== RUNTIME.id) {
        // Best effort: a running server from an older revision locks its folder; retry on the next check.
        await rm(path.join(root, "runtime", entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  return valid;
}
