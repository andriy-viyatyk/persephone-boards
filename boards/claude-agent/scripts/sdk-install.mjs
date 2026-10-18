import { createHash, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const SDK_VERSION = "0.3.302";
export const TARBALL_URL = "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.302.tgz";
export const TARBALL_SRI = "sha512-VUxgraOIxnu4COhS9IkP3AF21kh9KOOF8oyU7pc6q0PfzMPlarbnhXvuhCNIPPYddhIev+17LLq1nZ700GdLBg==";
export const SDK_SHA256 = "BAF41BB694A59DF1A1AC2577B06D759C5CD81F4F13953161C1A91C4B54434D6B";
const ALLOWED = new Set(["package/sdk.mjs", "package/LICENSE.md", "package/package.json"]);

function userDataRoot(env = process.env) {
  if (!env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) throw new Error("LOCALAPPDATA is not available; cannot safely install the SDK.");
  const root = path.resolve(env.LOCALAPPDATA, "Persephone", "board-data", "claude-agent", "sdk");
  const base = path.resolve(env.LOCALAPPDATA);
  if (!root.toLowerCase().startsWith(`${base.toLowerCase()}${path.sep}`)) throw new Error("SDK path escaped LOCALAPPDATA.");
  return { base, root, versionDir: path.join(root, SDK_VERSION) };
}

function safeName(name) {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) return null;
  return normalized;
}

function readTar(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const fullName = prefix ? `${prefix}/${name}` : name;
    const normalized = safeName(fullName);
    if (!normalized) throw new Error("SDK archive contains an unsafe path.");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const type = header[156];
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid SDK archive entry size.");
    const start = offset + 512;
    const end = start + size;
    if (end > buffer.length) throw new Error("SDK archive entry is truncated.");
    if (ALLOWED.has(normalized) && (type === 0 || type === 48)) files.set(normalized, Buffer.from(buffer.subarray(start, end)));
    offset = start + Math.ceil(size / 512) * 512;
  }
  for (const name of ALLOWED) if (!files.has(name)) throw new Error(`SDK archive is missing ${name}.`);
  return files;
}

async function integrityMatches(file) {
  try {
    const digest = createHash("sha256").update(await readFile(file)).digest("hex").toUpperCase();
    return timingSafeEqual(Buffer.from(digest), Buffer.from(SDK_SHA256));
  } catch { return false; }
}

async function safeVersionDir(env = process.env, create = false) {
  const { base, root, versionDir } = userDataRoot(env);
  if (create) await mkdir(versionDir, { recursive: true });
  else await access(versionDir);
  const baseReal = await realpath(base);
  const dirReal = await realpath(versionDir);
  if (!dirReal.toLowerCase().startsWith(`${baseReal.toLowerCase()}${path.sep}`)) throw new Error("SDK directory resolves outside LOCALAPPDATA.");
  return { root, versionDir: dirReal };
}

export async function sdkIsInstalled(env = process.env) {
  try {
    const { versionDir } = await safeVersionDir(env);
    return await integrityMatches(path.join(versionDir, "sdk.mjs"));
  } catch { return false; }
}

export async function installSdk(env = process.env) {
  const { base, root, versionDir } = userDataRoot(env);
  await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  const baseReal = await realpath(base);
  if (!rootReal.toLowerCase().startsWith(`${baseReal.toLowerCase()}${path.sep}`)) throw new Error("SDK root resolves outside LOCALAPPDATA.");
  const response = await fetch(TARBALL_URL, { redirect: "error" });
  if (!response.ok) throw new Error(`SDK download failed (${response.status}).`);
  const archive = Buffer.from(await response.arrayBuffer());
  const expected = Buffer.from(TARBALL_SRI.slice("sha512-".length), "base64");
  const actual = createHash("sha512").update(archive).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("SDK archive integrity check failed.");
  const files = readTar(gunzipSync(archive));
  const staging = path.join(rootReal, `.install-${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: false });
  try {
    for (const [name, bytes] of files) {
      const targetName = path.basename(name);
      await writeFile(path.join(staging, targetName), bytes, { flag: "wx" });
    }
    if (!(await integrityMatches(path.join(staging, "sdk.mjs")))) throw new Error("Pinned SDK file hash did not match.");
    await rm(versionDir, { recursive: true, force: true });
    await rename(staging, versionDir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { installed: true, version: SDK_VERSION };
}

export async function loadSdk(env = process.env) {
  let safe;
  try { safe = await safeVersionDir(env); }
  catch { throw Object.assign(new Error("Claude Agent SDK is not installed."), { code: "sdk-not-installed" }); }
  const sdkPath = path.join(safe.versionDir, "sdk.mjs");
  if (!(await integrityMatches(sdkPath))) {
    await rm(safe.versionDir, { recursive: true, force: true });
    throw Object.assign(new Error("The stored Claude Agent SDK failed its integrity check. Accept the download again."), { code: "sdk-not-installed" });
  }
  return import(pathToFileURL(sdkPath).href);
}
