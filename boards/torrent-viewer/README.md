# Torrent Viewer board

This EPIC-114 board resolves a magnet link, a local `.torrent` path, or a claimed HTTP(S)
`.torrent` download URL (the add field also takes a bare v1 info hash, 40 hex or 32 base32
characters, and turns it into a tracker-less magnet link) to metadata, deselects every file, and displays the service-owned torrent
inventory in a
themed two-pane page. URL sources are read through the board content pipe into memory; they are
never saved to disk. Files open through self-contained `torrent://` links; the only whole-file
action is the explicit, size-guarded Download this file menu item.

The manifest claims the `torrent` and `magnet` schemes, declares the stable `torrent/viewer`
provider contract, and is a single-instance board: one Torrent Viewer page receives all claimed
sources in a window, while pages in different windows render the same app-wide service snapshot
(D14). New sources arrive through `persephone.source.onOpen()` without reloading the page. The
board persists accepted source hrefs and canonical magnets in restorable shared state, replacing
resolved HTTP(S) `.torrent` URLs with the service snapshot's magnet and never persisting unresolved
or failed HTTP sources. The page can re-resolve persisted sources after restart; it never persists
metadata, files, buffers, or snapshots. The
manifest requires bridge `1.26.0` for provider status reporting, in addition to its existing
source delivery, `getSourceUrl()`, explicit service stop, and read-only service status APIs. It
claims browser downloads with both whole-URL masks
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
the board offers a manual retry after a failed resolution and never retries automatically. A ready torrent's
right-click menu has Copy magnet link, Copy info hash, Save .torrent (the `torrentFile` op returns
WebTorrent's re-encoded `.torrent` as base64), and Remove. A failed
row's right-click menu has Retry and Remove; Remove (the `dismiss` op) drops the retained outcome
at once, and forgets the saved source. **Remove all** in the Torrents header applies the row's own
action to every row in turn (Remove, Cancel for a resolving row, or dismiss). The snapshot's failed outcomes carry their `source` string
(a magnet or path, never `.torrent` bytes), so this works on a row whose attempt an earlier
instance of the page started, before a Reload board. One failed row is shown per info hash, or per
source for a path that failed before its info hash was known. A cancelled outcome is never shown: `cancel` drops the job immediately, and the page forgets
the cancelled source. `remove` also drops the torrent's retained completed results, which would
otherwise put the row back until they expired. Remove takes
effect at once, even while an open page is reading the torrent: the service marks the info hash as
removed, so that page's next read fails with `torrent-removed` instead of re-adding the torrent from
its link's magnet. Adding the torrent again from the board clears the mark. The service keeps running
after the list empties, because a stopped service would restart without the marks. It destroys its
WebTorrent client instead, releasing the DHT and tracker sockets. Page teardown does not stop the
service either.

The service normalizes WebTorrent's Windows file paths from backslashes to forward slashes and
registers `torrent/viewer` with `stat`, `readRange`, `readBinary`, and `status(config, emit)`.
Provider status is observational: it only looks up torrents already in the service's info-hash
index, emits nothing while one is absent, and never resolves a link, adds a torrent, or reads file
content. Once an independent stat or read has added it, status samples metadata and the requested
file once per second, reports changed peer, download-rate, and file-progress snapshots, then emits
one final `done`. Unsubscribing disposes the sampler and its torrent error listener. Provider links
carry the encoded path and canonical magnet so they restore without the board page.

## UI rules

Layout: a Torrents pane and a Files pane separated by a draggable splitter (the width is a
per-viewer `localStorage` convenience), one status bar at the bottom, and the magnet input with
**Add** under the torrent list. **Open .torrent** is a host toolbar button declared with
`persephone.toolbar.set` at script start (Persephone 5.0.4 holds a declaration made while the
document is still parsing until it has loaded). File rows show Persephone's own icon for each
name through `persephone.icons.forFiles` (bridge 1.18.0), with a generic glyph until it arrives;
the icons are fetched again on a theme change. Rows
follow the Explorer tree: 22px, the tree's selection colours, and arrow/Home/End keys (Enter opens a
file). Each row has a right-aligned badge: download speed and peers for a torrent ("resolving..."
while resolving), and size plus download percentage for a file. Hovering a badge shows a tooltip
with the rest of the figures. Rows are updated in place (keyed by info hash or file index), so hover
and double-click survive the 1-second snapshot poll. The snapshot carries `uploadSpeed`, `uploaded`,
`length`, `progress`, and `fileProgress` (per-file verified bytes, or `null` until anything has
been downloaded from the torrent).

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
