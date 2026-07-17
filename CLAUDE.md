# persephone-boards — repo guide

This repo is the **catalog source** for [Persephone](https://github.com/andriy-viyatyk/persephone)'s
Published Boards installer. Persephone periodically fetches `boards-manifest.json` from the
`main` branch and advertises the boards it lists; each board version is shipped as a ZIP asset
on a per-board GitHub **Release**.

For the user-facing overview (what this repo is, layout, licensing), see [README.md](README.md).
This file is the working reference for making changes here.

## Branches

- **`main`** — *published*. What the app sees. Only ever updated by the publish automation
  (the workflow commits the machine-written manifests back to it). **Do not commit board
  changes directly to `main`.**
- **`develop`** — *working branch*. All board edits, new boards, and version bumps land here
  first, then merge to `main` to publish.

## Layout

```
boards/                     one folder per board (folder name = board id)
  drawio-viewer/            e.g. the DrawIO Viewer board
    board-manifest.json     board identity + version — the SOURCE OF TRUTH for publishing
    CLAUDE.md               board-specific author notes (optional)
    ...board files...
    versions-manifest.json  full version history (machine-written by the publish script)
boards-manifest.json        catalog: the LATEST version of every board (machine-written)
scripts/publish-board.mjs   zip + release + manifest updater (CI and local fallback)
.github/workflows/publish-boards.yml   runs the publish script on push to main
```

## Releasing a board version (the important part)

A board's own `boards/<id>/board-manifest.json` **`version`** is the single source of truth.
There is no separate "build" step to trigger — publishing is driven entirely by that version
string versus the existing release tags.

To cut a new release:

1. On **`develop`**, make the board changes under `boards/<id>/`.
2. **Bump `version`** in `boards/<id>/board-manifest.json` (semver). This is what tells the
   automation there is something new to release.
3. Commit and push `develop`.
4. **Merge `develop` → `main`** (this is the publish trigger).

On push to `main`, the **Publish Boards** GitHub Action (`.github/workflows/publish-boards.yml`)
runs `scripts/publish-board.mjs`, which for **every** board whose `version` has no matching
`‹id›-v‹version›` release tag yet:

- zips the board folder contents (excluding `ui.log`, `versions-manifest.json`, `.git`,
  `node_modules`),
- creates the tagged GitHub Release `‹id›-v‹version›` with the ZIP asset,
- computes the asset's `size` + `sha256`,
- rewrites that board's entry in `boards-manifest.json` (latest only),
- prepends the version to `boards/<id>/versions-manifest.json` (full history),
- commits the manifest changes back to `main`.

Commits made by the workflow's `GITHUB_TOKEN` do **not** retrigger the workflow, so there is no
publish loop.

> **A version is released exactly once.** If `‹id›-v‹version›` already has a release tag, the
> board is skipped — re-merging does nothing. To ship a change you MUST bump `version`.

### Manual / local publish (fallback)

`node scripts/publish-board.mjs` does the same thing locally. Requires the
[`gh` CLI](https://cli.github.com/) authenticated with `repo` + `workflow` scopes and `git` on
PATH. The GitHub Action is the normal path; this is only a fallback.

## Rules

- **Never hand-edit `boards-manifest.json` or any `versions-manifest.json`.** They are
  machine-written by the publish script. Hand edits will be overwritten and can desync the
  `sha256`/`size` the app verifies on download.
- **Never commit board changes to `main` directly** — go through `develop` and let the merge
  publish them.
- **Always bump `version`** for any change you want users to receive; an unbumped change never
  ships.
- Board content is what lands in the ZIP — keep dev-only junk out (the excludes above cover the
  usual cases).
- Vendored third-party components carry their own license files inside the board folder
  (e.g. `boards/drawio-viewer/lib/LICENSE`, `VERSION.txt`).

## Authoring a board

The generic Persephone board authoring reference — the `persephone.*` bridge, the `--p-*` theme
contract, CSP rules, the reload/test loop — lives in the Persephone app, not here. From inside
Persephone use the **`read_guide("boards")`** MCP tool and the bundled Demo board. A board's own
`boards/<id>/CLAUDE.md` (see `boards/drawio-viewer/CLAUDE.md`) documents only what's specific to
that board.
