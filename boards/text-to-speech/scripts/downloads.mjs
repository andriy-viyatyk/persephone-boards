import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeFiles = JSON.parse(await readFile(path.join(here, "runtime-files.json"), "utf8"));
const revision = "cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4";
const modelBase = `https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/${revision}`;
const model = [
  ["duration_predictor.int8.onnx",3700147,"c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db"],
  ["text_encoder.int8.onnx",36416150,"c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff"],
  ["vector_estimator.int8.onnx",78400833,"20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd"],
  ["vocoder.int8.onnx",25991073,"e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152"],
  ["tts.json",8253,"42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09"],
  ["unicode_indexer.bin",262144,"8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30"],
  ["voice.bin",517168,"67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8"],
  ["LICENSE",1070,"0dfe0d0ba84416fe3879d9a34f4909d8d0137c78d1e95834177b0414ac096fa2"],
];
const packages = [
  { name: "sherpa-onnx-node", unpacked: 64153, integrity: "1PSACfQgPXAD7ExwCv1QW09EXTjcNlpZKBqDY+jxSdIzlyOSq0M13SILBoUQUfeJqiTTXnqp6Ha9jjMUQ6efXg==" },
  { name: "sherpa-onnx-win-x64", unpacked: 23161917, integrity: "7vwdAw9PGEb0JLSpK7UFxAdp1vabBHK9Nhw2jFRBWSFgtslUPHIB0T6syJfRgiUGyCeNW9fJvcFAk2F2u7hBEw==" },
];
export function dataRoot() {
  const local = process.env.LOCALAPPDATA;
  if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) throw new Error("LOCALAPPDATA is unavailable or invalid.");
  return path.join(local, "Persephone", "board-data", "text-to-speech");
}
export const installedRoot = () => path.join(dataRoot(), "installed");
export const supported = () => process.platform === "win32" && process.arch === "x64";
const digest = (algorithm, data, encoding = "hex") => createHash(algorithm).update(data).digest(encoding);
async function fileHash(file, signal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
async function checkFile(file, bytes, hash, signal) {
  const info = await stat(file);
  return info.isFile() && info.size === bytes && await fileHash(file, signal) === hash;
}
async function verifyRoot(root, signal) {
  try {
    for (const [name, bytes, hash] of model) if (!await checkFile(path.join(root, "model", name), bytes, hash, signal)) return false;
    for (const pkg of packages) for (const [name, [bytes, hash]] of Object.entries(runtimeFiles[pkg.name])) if (!await checkFile(path.join(root, "runtime", pkg.name, name), bytes, hash, signal)) return false;
    for (const name of ["supertonic-3-OpenRAIL-M.txt", "sherpa-conversion-MIT.txt", "Apache-2.0.txt", "ONNX-Runtime-MIT.txt"]) {
      const bundled = await readFile(path.join(here, "..", "licenses", name));
      if (digest("sha256", await readFile(path.join(root, name === "supertonic-3-OpenRAIL-M.txt" || name === "sherpa-conversion-MIT.txt" ? "model" : "runtime", "licenses", name))) !== digest("sha256", bundled)) return false;
    }
    return true;
  } catch { return false; }
}
export async function isReady(signal) { return supported() && await verifyRoot(installedRoot(), signal); }
async function download(url, destination, expectedBytes, algorithm, expectedHash, signal, onBytes) {
  const response = await fetch(url, { signal, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  let received = 0;
  const hash = createHash(algorithm);
  const max = expectedBytes ?? 64 * 1024 * 1024;
  const meter = new Transform({ transform(chunk, _encoding, done) {
    received += chunk.length;
    if (received > max) return done(new Error("Download exceeds its size limit."));
    hash.update(chunk); onBytes(chunk.length, Number(response.headers.get("content-length")) || 0); done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(destination, { flags: "wx" }), { signal });
  if (expectedBytes !== null && received !== expectedBytes) throw new Error(`Size mismatch: ${url}`);
  if (hash.digest(algorithm === "sha512" ? "base64" : "hex") !== expectedHash) throw new Error(`Integrity mismatch: ${url}`);
}
function octal(buffer, start, length) {
  const value = buffer.toString("ascii", start, start + length).replace(/\0.*$/, "").trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("Invalid tar number.");
  return value ? parseInt(value, 8) : 0;
}
// Parse and validate the entire archive before writing any entry. Only pinned regular files and directories are accepted.
async function extract(archive, pkg, target, signal) {
  const tar = gunzipSync(await readFile(archive), { maxOutputLength: pkg.unpacked + 4 * 1024 * 1024 });
  const entries = [], seen = new Set(); let offset = 0, total = 0, ended = false;
  while (offset + 512 <= tar.length) {
    if (signal.aborted) throw signal.reason;
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) { ended = true; break; }
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== octal(header, 148, 8)) throw new Error("Invalid tar checksum.");
    const field = (a, b) => header.toString("utf8", a, b).replace(/\0.*$/, "");
    const prefix = field(345, 500), name = (prefix ? `${prefix}/` : "") + field(0, 100);
    const type = header[156], size = octal(header, 124, 12);
    if (!name.startsWith("package/") || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some(part => part === ".." || part === ".")) throw new Error("Unsafe tar path.");
    const relative = name.slice(8).replace(/\/$/, "");
    if (relative && relative.split("/").some(part => !part || /[:*?<>|]/.test(part))) throw new Error("Unsafe tar path.");
    if (type !== 0 && type !== 48 && type !== 53) throw new Error("Tar links and special entries are forbidden.");
    if (type === 53) { if (size !== 0 || (relative && !Object.keys(runtimeFiles[pkg.name]).some(file => file.startsWith(relative + "/")))) throw new Error("Unexpected directory entry."); }
    else {
      const expected = runtimeFiles[pkg.name][relative];
      if (!expected || seen.has(relative) || size !== expected[0] || offset + size > tar.length) throw new Error("Unexpected tar entry.");
      const contents = tar.subarray(offset, offset + size);
      if (digest("sha256", contents) !== expected[1]) throw new Error("Runtime file hash mismatch.");
      seen.add(relative); total += size; entries.push({ relative, contents });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended || total !== pkg.unpacked || seen.size !== Object.keys(runtimeFiles[pkg.name]).length) throw new Error("Incomplete runtime archive.");
  for (const entry of entries) {
    if (signal.aborted) throw signal.reason;
    const dest = path.join(target, ...entry.relative.split("/"));
    await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, entry.contents, { flag: "wx" });
  }
}
export async function install({ signal, onProgress }) {
  if (!supported()) throw new Error("Only Windows x64 is supported.");
  const root = dataRoot(), stage = path.join(root, "staging"), target = installedRoot(), backup = path.join(root, "previous");
  await mkdir(root, { recursive: true }); await rm(stage, { recursive: true, force: true }); await mkdir(stage);
  let loaded = 0; const total = model.reduce((sum, item) => sum + item[1], 0) + packages.reduce((sum, item) => sum + item.unpacked, 0);
  const progress = (phase, amount = 0) => { loaded += amount; onProgress({ phase, loaded: Math.min(loaded, total), total }); };
  try {
    for (const pkg of packages) {
      const archive = path.join(stage, `${pkg.name}.tgz`);
      progress("downloading");
      let received = 0, credited = 0;
      await download(`https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-2.0.1.tgz`, archive, null, "sha512", pkg.integrity, signal, (bytes, length) => {
        received += bytes;
        const next = length ? Math.min(pkg.unpacked, Math.floor(received / length * pkg.unpacked)) : 0;
        progress("downloading", next - credited); credited = next;
      });
      progress("extracting"); await extract(archive, pkg, path.join(stage, "runtime", pkg.name), signal); await rm(archive); progress("downloading", pkg.unpacked - credited);
    }
    await mkdir(path.join(stage, "model"), { recursive: true });
    for (const [name, bytes, hash] of model) await download(`${modelBase}/${name}`, path.join(stage, "model", name), bytes, "sha256", hash, signal, n => progress("downloading", n));
    for (const name of ["supertonic-3-OpenRAIL-M.txt", "sherpa-conversion-MIT.txt", "Apache-2.0.txt", "ONNX-Runtime-MIT.txt"]) {
      const folder = name === "supertonic-3-OpenRAIL-M.txt" || name === "sherpa-conversion-MIT.txt" ? "model" : "runtime";
      const dest = path.join(stage, folder, "licenses"); await mkdir(dest, { recursive: true }); await copyFile(path.join(here, "..", "licenses", name), path.join(dest, name));
    }
    if (signal.aborted) throw signal.reason;
    progress("verifying");
    if (!await verifyRoot(stage, signal)) throw new Error("Staged files failed verification.");
    if (signal.aborted) throw signal.reason;
    progress("installing"); await rm(backup, { recursive: true, force: true });
    const existed = await stat(target).then(() => true, () => false);
    if (existed) await rename(target, backup);
    try { await rename(stage, target); } catch (error) { if (existed) await rename(backup, target); throw error; }
    await rm(backup, { recursive: true, force: true });
  } finally { await rm(stage, { recursive: true, force: true }); }
}
export async function remove() { await rm(installedRoot(), { recursive: true, force: true }); }
