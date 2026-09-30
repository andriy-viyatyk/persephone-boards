# Torrent Viewer board notes

## Purpose

`torrent-viewer` is the EPIC-114 metadata-only viewer. Its simple editor association accepts
`.torrent` paths, and its D11-aware manifest claims both `torrent` and `magnet`. The board exposes
the stable `torrent/viewer` provider contract, claims browser `.torrent` downloads, and requires
bridge `1.27.0` for singleton source delivery, `getSourceUrl()`, service-backed provider
status, and status-bar items.
It owns one page per window; all claimed sources are delivered through `source.onOpen()` and the
app-wide service snapshot remains shared across windows.

## Key files

- `board-manifest.json` — service, provider declaration, `.torrent` association, and identity.
- `index.html` / `app.js` — themed two-pane (splitter) service-inventory torrent/file page with Explorer-style rows, stats badges, and Persephone status-bar items; render paths consume metadata
  only and explicit file actions own opening, copying, and saving.
- `scripts/service.mjs` — parent-port service, WebTorrent resolver, observe-only provider status,
  job limits, and teardown.
- `scripts/webtorrent-entry.mjs` — bundle entry exporting WebTorrent, the memory-store class, and
  the proxy setters.
- `scripts/network.mjs` — the network setting (BT-028): validation, proxy-mode client options,
  the public view, and the `testNetwork` SOCKS5 probe.
- `scripts/proxy-net.mjs`, `scripts/proxy-fetch.mjs`, `scripts/socks-v1-compat.mjs` — bundle-time
  stand-ins for `net` (WebTorrent peers), `cross-fetch-ponyfill` (all fetches), and `socks` (UDP
  trackers) that route through the SOCKS5 proxy.
- `scripts/build-webtorrent.mjs` — reproducible esbuild command for `lib/webtorrent.bundle.mjs`.
- `lib/` — committed runtime bundle plus third-party notices; `node_modules/` is not shipped.
- `board-base.css` — scaffolded themed base stylesheet; keep it linked first.

## Run and test

From `boards/torrent-viewer/`, run `npm install` and `npm run build`. Open the trusted board in
Persephone to inspect its UI. Automated provider-status checks must use a controlled fake/no-network
producer; do not open a real torrent or join a swarm during autonomous verification. The user runs
any real-torrent check. The page starts a service job and polls it instead of holding one service
RPC for the 30-second metadata deadline; an opened source arrives through `persephone.getSourceUrl()`
without materialization. After edits, reload the board through `pages[i].editor.reload()`.

## Gotchas

- `WS_NO_BUFFER_UTIL` and `WS_NO_UTF_8_VALIDATE` are assigned before the dynamic bundle import;
  the service supervisor's environment allowlist does not carry them.
- WebTorrent 3.0.21 requires `store: MemoryChunkStore` as a class. The esbuild `createRequire`
  banner and all four native-module externals are load-bearing D3 requirements.
- Resolution calls every file's `deselect()` before constructing metadata. No resolver path calls
  `select()`, creates a read stream, writes a file, or downloads content bytes.
- Normal rendering never reads a provider range. A claimed browser `.torrent` source uses
  `content.open()` and fetches its board-scoped pipe URL into memory before entering the existing
  resolver. Download checks the 256 MiB bridge ceiling, opens the save dialog, and only then
  opens/fetches/writes the selected file.
- WebTorrent may expose Windows paths with `\`; `service.mjs` publishes only forward slashes.
- The four in-flight-job cap, 30-second metadata timer, 45-second no-poll timer, result expiry,
  and shutdown destruction are deliberate bounds. Do not replace them with an unbounded wait.
- The `torrent/viewer` provider implements `readBinary`, `readRange`, `stat`, and
  `status(config, emit)`. Status only looks up an already-indexed info hash; it must not resolve a
  magnet, create a WebTorrent client, add a torrent, or read file content. With no indexed torrent
  it emits nothing and retries the lookup each second. For an indexed torrent it reports metadata
  connection, then changed peer count, download speed, and requested-file byte progress; it emits
  one final `done` when that file completes. Its disposer clears the timer and torrent error
  listener. US-1524 owns the read operations, piece prioritisation, and self-contained torrent
  link; US-1525 owns D11 and the `magnet` claim.
- `persephone.service.status()` is read-only and must be used before snapshot polling so an empty
  stopped board does not start the service merely to render.
- Restorable shared state contains only accepted source strings. Prune a source only when its info
  hash disappears during the same service instance; a changed instance or non-running status is a
  service reset, so retain and re-resolve persisted sources. An explicit remove from this page
  prunes its source immediately.
- Remove never checks whether a page is reading the torrent. `removedInfoHashes` makes later reads
  fail, and it lives only in the service process, so the page must not stop the service after a
  remove: a request would restart it without the marks, and the reader would re-add the torrent.
- Ready snapshots carry only the canonical magnet and normalized `{ path, length, index }` file
  descriptors. Terminal job outcomes remain readable until their bounded TTL and must not trigger a
  notification on pages that did not start the job.

- Proxy mode must **fail closed**. An unreadable or invalid `network` setting makes `getClient()`
  throw, and no shim may fall back to a direct socket or the built-in fetch while a proxy is set.
  Treating anything unknown as direct would leak the user's IP to the swarm.
- The `net` and `socks` aliases in `build-webtorrent.mjs` are importer-scoped on purpose. Aliasing
  `net` for `socks` itself would route the proxy's own connection through the proxy. After a
  rebuild, check that `peer.conn = proxy_net_default.connect(opts)` and
  `socks_v1_compat_default.createConnection(proxyOpts, onGotConnection)` are in the bundle.
- `bittorrent-tracker`'s UDP proxy path is written for socks v1. Without
  `socks-v1-compat.mjs`, UDP trackers never use the proxy.
- The service reads the network setting only at start. Apply a change by storing it and stopping
  the service, never by patching a running client.
- The setting lives in `persephone.storage`, not `persephone.settings`: the service can run with
  no page open and cannot read board settings.

The canonical bridge reference is Persephone's `persephone://guides/boards` guide.
