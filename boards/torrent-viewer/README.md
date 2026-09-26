# Torrent Viewer board

This EPIC-114 board resolves a magnet link or a local `.torrent` path to metadata, deselects every
file, and displays session torrents in a themed two-pane page. Files open through self-contained
`torrent://` links; the only whole-file action is the explicit, size-guarded Download this file
menu item.

The manifest claims the `torrent` and `magnet` schemes, declares the stable `torrent/viewer`
provider contract, and requires bridge `1.14.0` for the non-materializing `getSourceUrl()` source
handoff. The `.torrent` file mask is the second D10 entry point.

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
`status` returns metadata including the canonical magnet URI. Resolution has a 30-second metadata
deadline, a four-job cap, 15-second no-poll cancellation, and 60-second abandoned-result expiry.
`cancel`, `remove`, and shutdown destroy incomplete torrents with their memory stores.

The service normalizes WebTorrent's Windows file paths from backslashes to forward slashes and
registers `torrent/viewer` with `stat`, `readRange`, and `readBinary`. Provider links carry the
encoded path and canonical magnet so they restore without the board page.

## UI rules

The page polls one `snapshot` at a time and renders only service metadata. Rendering never selects
a file, reads a range, or opens content. Open and double-click call `openRawLink`; Copy link uses
the native clipboard; Download checks the 256 MiB whole-buffer bridge ceiling, opens the save
dialog, then calls `content.open`, `fetch`, and binary `writeFile` in that order.
