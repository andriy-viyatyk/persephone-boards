import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const boardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(boardRoot, "lib");
const outputFile = path.join(outputDirectory, "webtorrent.bundle.mjs");
const scriptsDirectory = path.join(boardRoot, "scripts");
const webtorrentLib = path.join(boardRoot, "node_modules", "webtorrent", "lib") + path.sep;

// Proxy mode (BT-028) needs WebTorrent's peer sockets and every fetch to be routable. `net` is swapped
// only for WebTorrent's own modules: the `socks` library must keep the real `net` to reach the proxy.
const proxyShims = {
    name: "proxy-shims",
    setup(context) {
        context.onResolve({ filter: /^net$/ }, (args) => {
            if (!path.resolve(args.importer).toLowerCase().startsWith(webtorrentLib.toLowerCase())) return undefined;
            return { path: path.join(scriptsDirectory, "proxy-net.mjs") };
        });
        // udp-tracker.js calls the socks v1 API, which socks v2 no longer has.
        context.onResolve({ filter: /^socks$/ }, (args) => {
            if (!/[\\/]bittorrent-tracker[\\/]lib[\\/]client[\\/]udp-tracker\.js$/i.test(args.importer)) return undefined;
            return { path: path.join(scriptsDirectory, "socks-v1-compat.mjs") };
        });
        context.onResolve({ filter: /^cross-fetch-ponyfill$/ }, () => ({
            path: path.join(scriptsDirectory, "proxy-fetch.mjs"),
        }));
    },
};

await mkdir(outputDirectory, { recursive: true });

await build({
    entryPoints: [path.join(boardRoot, "scripts", "webtorrent-entry.mjs")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    external: ["bufferutil", "utf-8-validate", "node-datachannel", "utp-native"],
    plugins: [proxyShims],
    banner: {
        js: 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);',
    },
});
