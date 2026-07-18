# persephone-boards

Published **boards** (custom editors / viewers) for
[Persephone](https://github.com/andriy-viyatyk/persephone) — installable from inside the app
via its Published Boards catalog.

## What this repo is

This repository is the **catalog source** for Persephone's board installer. Persephone
periodically fetches `boards-manifest.json` from the `main` branch and advertises the boards
it lists; each board version is published as a ZIP asset on a per-board GitHub **Release**.

- `main` — **published**. What the app sees. Only ever updated by the publish automation.
- `develop` — **working branch**. New boards and changes land here first; merged to `main`
  when ready.

## Layout

```
boards/                     one folder per board (folder name = board id)
  drawio-viewer/            e.g. the DrawIO Viewer board
    board-manifest.json     board identity + version (the source of truth for publishing)
    WHATS-NEW.md            short human changelog — one line per change (tracked per board)
    ...board files...
    versions-manifest.json  full version history (written by the publish script)
boards-manifest.json        catalog: the LATEST version of every board (machine-written)
how-to/                     board-building recipes (esp. Persephone integration cases); repo
                            docs only — never shipped in a board ZIP
scripts/
  publish-board.mjs         zip + release + manifest updater (CI and local fallback)
.github/workflows/
  publish-boards.yml        runs the publish script on push to main
```

## Publishing a board

The board's own `board-manifest.json` `version` is the **single source of truth**. To publish:

1. Edit the board under `boards/<id>/` on `develop`.
2. Bump `version` in `boards/<id>/board-manifest.json`.
3. Merge `develop` → `main`.

### Track changes in each board's `WHATS-NEW.md`

Every board must carry a **`WHATS-NEW.md`** — a short, human-readable changelog (one line per
change). Create it if it's missing, and create one for every **new** board. Record each change
as you make it, under a heading for the **next version** you'll release — e.g. `## 1.0.2` (the
version you'll set in `board-manifest.json`). Deciding the number up front means nothing needs
renaming at release. Keep entries terse — e.g. `- Added zooming and panning.` See
`boards/drawio-viewer/WHATS-NEW.md` for the format.

`WHATS-NEW.md` **ships inside the release ZIP** (it is not excluded by the publish script), so
Persephone can display a board's changelog on its properties screen.

The GitHub Action then, for every board whose `version` has no matching `‹id›-v‹version›`
release tag: zips the board's contents, creates the tagged Release with the ZIP asset,
computes its `sha256` + `size`, rewrites that board's entry in `boards-manifest.json`, prepends
the version to `boards/<id>/versions-manifest.json`, and commits the manifest changes back to
`main`. (Commits made with the default `GITHUB_TOKEN` do not retrigger the workflow.)

Both catalog manifests are **machine-written — never hand-edit them.**

### Manual / local publish (fallback)

`node scripts/publish-board.mjs` does the same thing locally. Requires the
[`gh` CLI](https://cli.github.com/) authenticated with `repo` + `workflow` scopes and `git` on
PATH. Intended as a fallback; the GitHub Action is the normal path.

## License / attribution

Vendored third-party components carry their own license files inside the board folder
(e.g. `boards/drawio-viewer/lib/LICENSE`, `VERSION.txt`).
