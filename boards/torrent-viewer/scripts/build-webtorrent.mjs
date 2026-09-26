import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const boardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(boardRoot, "lib");
const outputFile = path.join(outputDirectory, "webtorrent.bundle.mjs");

await mkdir(outputDirectory, { recursive: true });

await build({
    entryPoints: [path.join(boardRoot, "scripts", "webtorrent-entry.mjs")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    external: ["bufferutil", "utf-8-validate", "node-datachannel", "utp-native"],
    banner: {
        js: 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);',
    },
});
