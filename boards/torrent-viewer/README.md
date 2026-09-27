# Torrent Viewer board

This EPIC-114 board resolves a magnet link, a local `.torrent` path, or a claimed HTTP(S)
`.torrent` download URL to metadata, deselects every file, and displays the service-owned torrent
inventory in a
themed two-pane page. URL sources are read through the board content pipe into memory; they are
never saved to disk. Files open through self-contained `torrent://` links; the only whole-file
action is the explicit, size-guarded Download this file menu item.

The manifest claims the `torrent` and `magnet` schemes, declares the stable `torrent/viewer`
provider contract, and is a single-instance board: one Torrent Viewer page receives all claimed
sources in a window, while pages in different windows render the same app-wide service snapshot
(D14). New sources arrive through `persephone.source.onOpen()` without reloading the page. The
board persists only accepted source hrefs and magnets in restorable shared state, so the page can
re-resolve them after restart; it never persists metadata, files, buffers, or snapshots. The
manifest requires bridge `1.17.0` for source delivery, `getSourceUrl()`, explicit service stop,
and read-only service status APIs, and claims browser downloads with both whole-URL masks
`*://*/*.torrent` and `*://*/*.torrent?*`. The `.torrent` file mask is the second D10 entry point;
the browser URL claim is separate.

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
`request`, `shutdown`). `resolve` starts a short RPC job and returns a request id; it accepts the
existing string sources or an in-memory torrent byte buffer produced by the board content pipe.
Polling
`status` returns metadata including the canonical magnet URI. Resolution has a 30-second metadata
deadline, a four-job cap, a 45-second no-poll grace period, and 60-second abandoned-result expiry.
`cancel`, `remove`, and shutdown destroy incomplete torrents with their memory stores. The abandoned
job watchdog is derived as the 30-second metadata deadline plus 15 seconds, so it cannot pre-empt D8;
the board offers a manual retry after a failed resolution and never retries automatically. Removal is
refused while an open page is reading a torrent. After an explicit remove, the board takes one fresh
snapshot and stops the service only when no torrents and no resolution jobs remain; page teardown does
not stop the service.

The service normalizes WebTorrent's Windows file paths from backslashes to forward slashes and
registers `torrent/viewer` with `stat`, `readRange`, and `readBinary`. Provider links carry the
encoded path and canonical magnet so they restore without the board page.

## UI rules

The page reads the service lifecycle through the non-starting `service.status()` call, then polls
one `snapshot` at a time while the service is running. It renders the shared service inventory,
active resolution placeholders, and bounded terminal outcomes; page selection and stalled samples
remain local. Rendering never selects a file or reads a range. Open and double-click call `openRawLink`; Copy link uses the native
clipboard. A claimed browser `.torrent` source calls `content.open`, fetches the returned pipe URL
into memory, and enters the same resolver job as a magnet. Download checks the 256 MiB whole-buffer
bridge ceiling, opens the save dialog, then calls `content.open`, `fetch`, and binary `writeFile` in
that order for the explicit user action only. A source is pruned after a same-instance authoritative
snapshot shows its info hash gone; a changed service instance or any non-running status is treated as
a reset, so persisted sources are retained and re-resolved. Explicit removal from this page prunes
its source immediately.
