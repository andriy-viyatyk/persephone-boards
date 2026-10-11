import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const target = resolve(root, "lib/music-metadata.js");
await build({
  entryPoints: [resolve(root, "scripts/metadata-entry.mjs")], bundle: true, minify: true, treeShaking: true,
  platform: "browser", format: "iife", globalName: "MusicMetadataBundle", target: "es2020",
  outfile: target, legalComments: "none", define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: "/* MIT: music-metadata; see LICENSE.music-metadata and VERSION.txt */" },
  footer: { js: "window.MusicMetadata = { parseFromTokenizer: MusicMetadataBundle.parseFromTokenizer, AbstractTokenizer: MusicMetadataBundle.AbstractTokenizer, EndOfStreamError: MusicMetadataBundle.EndOfStreamError };" },
});
const output = await readFile(target), compressed = gzipSync(output, { level: 9 });
if (output.byteLength > 2 * 1024 * 1024 || compressed.byteLength > 700 * 1024) {
  throw new Error(`Bundle limit exceeded: ${output.byteLength} bytes, gzip ${compressed.byteLength} bytes`);
}
const buildDate = new Date().toISOString().slice(0, 10);
await writeFile(resolve(root, "lib/VERSION.txt"), [
  `music-metadata ${pkg.devDependencies["music-metadata"]}`,
  `esbuild ${pkg.devDependencies.esbuild}`,
  "Source: npm package music-metadata browser entry; bundled exports: parseFromTokenizer, AbstractTokenizer, EndOfStreamError",
  "Command: npm install && npm run build:metadata",
  `Built: ${buildDate}`,
  `Size: ${output.byteLength} bytes minified; ${compressed.byteLength} bytes gzip`,
].join("\n") + "\n", "utf8");
console.log(`Built ${target}: ${output.byteLength} bytes minified; ${compressed.byteLength} bytes gzip`);
