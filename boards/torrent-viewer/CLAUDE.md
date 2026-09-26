# Torrent Viewer board notes

## Purpose

`torrent-viewer` is the EPIC-114 metadata-only viewer. Its simple editor association accepts
`.torrent` paths, and its D11-aware manifest claims both `torrent` and `magnet`. The board exposes
the stable `torrent/viewer` provider contract and requires bridge `1.14.0` for `getSourceUrl()`.

## Key files

- `board-manifest.json` — service, provider declaration, `.torrent` association, and identity.
- `index.html` / `app.js` — themed two-pane session torrent/file page; render paths consume metadata
  only and explicit file actions own opening, copying, and saving.
- `scripts/service.mjs` — parent-port service, WebTorrent resolver, job limits, and teardown.
- `scripts/webtorrent-entry.mjs` — bundle entry exporting WebTorrent and the memory-store class.
- `scripts/build-webtorrent.mjs` — reproducible esbuild command for `lib/webtorrent.bundle.mjs`.
- `lib/` — committed runtime bundle plus third-party notices; `node_modules/` is not shipped.
- `board-base.css` — scaffolded themed base stylesheet; keep it linked first.

## Run and test

From `boards/torrent-viewer/`, run `npm install` and `npm run build`. Open the trusted board in
Persephone and add the public Sintel magnet from EPIC-114, or open a `.torrent` editor page. The
page starts a service job and polls it instead of holding one service RPC for the 30-second
metadata deadline; an opened source arrives through `persephone.getSourceUrl()` without
materialization. After edits, reload the board through `pages[i].editor.reload()`.

## Gotchas

- `WS_NO_BUFFER_UTIL` and `WS_NO_UTF_8_VALIDATE` are assigned before the dynamic bundle import;
  the service supervisor's environment allowlist does not carry them.
- WebTorrent 3.0.21 requires `store: MemoryChunkStore` as a class. The esbuild `createRequire`
  banner and all four native-module externals are load-bearing D3 requirements.
- Resolution calls every file's `deselect()` before constructing metadata. No resolver path calls
  `select()`, creates a read stream, writes a file, or downloads content bytes.
- Rendering never calls `content.open()` or reads a provider range. Download checks the 256 MiB
  bridge ceiling, opens the save dialog, and only then opens/fetches/writes the selected file.
- WebTorrent may expose Windows paths with `\`; `service.mjs` publishes only forward slashes.
- The four in-flight-job cap, 30-second metadata timer, 15-second no-poll timer, result expiry,
  and shutdown destruction are deliberate bounds. Do not replace them with an unbounded wait.
- This task does not register providers. US-1524 owns `readBinary`, `readRange`, `stat`, piece
  prioritisation, and the self-contained torrent link; US-1525 owns D11 and the `magnet` claim.

The canonical bridge reference is Persephone's `persephone://guides/boards` guide.
