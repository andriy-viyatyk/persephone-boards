# Torrent Viewer board notes

## Purpose

`torrent-viewer` is the EPIC-114 metadata-only skeleton. Its simple editor association accepts
`.torrent` paths; its proof page also accepts a magnet or torrent identifier. The manifest claims
only `torrent`, never `magnet`, and declares `torrent/viewer` as the forward provider contract.

## Key files

- `board-manifest.json` — service, provider declaration, `.torrent` association, and identity.
- `index.html` / `app.js` — offline resolve/status proof page; all output uses text nodes.
- `scripts/service.mjs` — parent-port service, WebTorrent resolver, job limits, and teardown.
- `scripts/webtorrent-entry.mjs` — bundle entry exporting WebTorrent and the memory-store class.
- `scripts/build-webtorrent.mjs` — reproducible esbuild command for `lib/webtorrent.bundle.mjs`.
- `lib/` — committed runtime bundle plus third-party notices; `node_modules/` is not shipped.
- `board-base.css` — scaffolded themed base stylesheet; keep it linked first.

## Run and test

From `boards/torrent-viewer/`, run `npm install` and `npm run build`. Open the trusted board in
Persephone, enter the public Sintel magnet from EPIC-114, and press **Resolve metadata**. The page
starts a service job and polls it instead of holding one service RPC for the 30-second metadata
deadline. A `.torrent` editor opening supplies its path through `persephone.getFilePath()`.
After edits, reload the board through `pages[i].editor.reload()`.

## Gotchas

- `WS_NO_BUFFER_UTIL` and `WS_NO_UTF_8_VALIDATE` are assigned before the dynamic bundle import;
  the service supervisor's environment allowlist does not carry them.
- WebTorrent 3.0.21 requires `store: MemoryChunkStore` as a class. The esbuild `createRequire`
  banner and all four native-module externals are load-bearing D3 requirements.
- Resolution calls every file's `deselect()` before constructing metadata. No resolver path calls
  `select()`, creates a read stream, writes a file, or downloads content bytes.
- WebTorrent may expose Windows paths with `\`; `service.mjs` publishes only forward slashes.
- The four in-flight-job cap, 30-second metadata timer, 15-second no-poll timer, result expiry,
  and shutdown destruction are deliberate bounds. Do not replace them with an unbounded wait.
- This task does not register providers. US-1524 owns `readBinary`, `readRange`, `stat`, piece
  prioritisation, and the self-contained torrent link; US-1525 owns D11 and the `magnet` claim.

The canonical bridge reference is Persephone's `persephone://guides/boards` guide.
