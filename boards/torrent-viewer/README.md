# Torrent Viewer board skeleton

This board is the US-1523 foundation for EPIC-114. It resolves a magnet link or a local
`.torrent` path to torrent metadata, deselects every file, and displays the file names, lengths,
and indexes in a small proof page. It deliberately does not read content bytes, create streams,
write files, download files, or register a content-provider implementation.

The manifest declares the future `torrent/viewer` provider contract with `schemes: ["torrent"]`.
It does not claim `magnet`: the opaque-link editor fallback from EPIC-114 D11 belongs to US-1525.
The `.torrent` file mask is the second entry point and opens this simple board with
`persephone.getFilePath()` supplying the path.

## Build

From this directory:

```text
npm install
npm run build
```

The build vendors WebTorrent **3.0.21** and `memory-chunk-store` **1.3.5** into
`lib/webtorrent.bundle.mjs` using esbuild **0.28.1**. The bundle passes the memory store as a
class to WebTorrent, leaves `bufferutil`, `utf-8-validate`, `node-datachannel`, and `utp-native`
external, and carries the `createRequire` banner required by WebTorrent's dynamic filesystem
dependency. `node_modules/` is development-only and excluded from board publishing.

## Service protocol

`scripts/service.mjs` uses Persephone's module-service parent-port handshake (`init`, `probe`,
`request`, `shutdown`). `resolve` starts a short RPC job and returns a request id; polling
`status` returns the metadata result or a serialized failure. Resolution itself has a 30-second
metadata deadline, a four-job cap, 15-second no-poll cancellation, and 60-second abandoned-result
expiry. `cancel`, `remove`, and shutdown destroy incomplete torrents with their memory stores.

The service normalizes WebTorrent's Windows file paths from backslashes to forward slashes at the
service boundary. It retains only metadata and never registers `readBinary`, `readRange`, or `stat`;
US-1524 owns that provider and the self-contained `torrent://...?magnet=...` link.

## Scope handoff

The proof page is intentionally not the production two-pane torrent UI. US-1524 adds the provider
and bounded reads; US-1525 adds the torrent/file list, open-file actions, download exception, and
the D11 platform change plus `magnet` declaration. US-1526 owns lifecycle and cold-start restore.
The board is not publishable until US-1525 or US-1527 supplies `WHATS-NEW.md`, `guides/`, and
`screenshot.png`.
