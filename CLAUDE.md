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
how-to/                     board-building recipes (esp. Persephone integration cases); repo
                            docs only, never shipped in a board ZIP. See how-to/README.md
scripts/publish-board.mjs   zip + release + manifest updater (CI and local fallback)
.github/workflows/publish-boards.yml   runs the publish script on push to main
doc/                        task tracking (repo docs only, never shipped in a board ZIP)
  active-work.md            dashboard — Active / Planned board tasks
  tasks/                    one folder per task with a README.md; completed.md, backlog.md
    _template/README.md     task-document template
```

## Releasing a board version (the important part)

A board's own `boards/<id>/board-manifest.json` **`version`** is the single source of truth.
There is no separate "build" step to trigger — publishing is driven entirely by that version
string versus the existing release tags.

To cut a new release:

1. On **`develop`**, make the board changes under `boards/<id>/`.
2. **Record the change in `boards/<id>/WHATS-NEW.md`** — one terse line under a heading for the
   next version you'll release, e.g. `## 1.0.2` (create the file if it's missing). See [Rules](#rules).
3. **Bump `version`** in `boards/<id>/board-manifest.json` (semver) to match that `WHATS-NEW.md`
   heading. This is what tells the automation there is something new to release.
4. Commit and push `develop`.
5. **Verify version consistency:** `board-manifest.json` `version` == the top `WHATS-NEW.md`
   heading, and no `‹id›-v‹version›` release tag exists yet (see [Rules](#rules)).
6. **Merge `develop` → `main`** (this is the publish trigger).

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
- **Every board must have a `WHATS-NEW.md`** — a short human changelog, one line per change
  (e.g. `- Added zooming and panning.`). Create it if missing, and create one for every new
  board. Record pending changes under a heading for the next version you'll release (e.g.
  `## 1.0.2`), and bump `board-manifest.json` `version` to match at release — no placeholder to
  rename. See `boards/drawio-viewer/WHATS-NEW.md` for the format. It **ships inside the release
  ZIP** (not in the publish script's exclude list), so the app can show it on a board's
  properties screen — do not exclude it.
- **Check version consistency before releasing.** Before merging `develop → main`, the top
  version heading in `boards/<id>/WHATS-NEW.md` MUST match `version` in
  `boards/<id>/board-manifest.json`, and that version MUST NOT already have a `‹id›-v‹version›`
  release tag. A mismatch desyncs the shipped changelog from the released version; a stale
  version silently ships nothing. If they disagree, fix them before publishing.
- Board content is what lands in the ZIP — keep dev-only junk out (the excludes above cover the
  usual cases).
- Vendored third-party components carry their own license files inside the board folder
  (e.g. `boards/drawio-viewer/lib/LICENSE`, `VERSION.txt`).

## Task tracking

Board work is tracked in [`doc/`](doc/) (mirrors Persephone's own scheme, scaled down):

- **[`doc/active-work.md`](doc/active-work.md)** — the dashboard. **Active** = in progress,
  **Planned** = queued. Each entry links to a task document.
- **[`doc/tasks/BT-XXX-short-name/README.md`](doc/tasks/)** — one folder per task. Copy
  [`doc/tasks/_template/README.md`](doc/tasks/_template/README.md) to start one.
- **[`doc/tasks/completed.md`](doc/tasks/completed.md)** — one-line evidence per finished task
  (survives after the task folder is deleted).
- **[`doc/tasks/backlog.md`](doc/tasks/backlog.md)** — ideas not yet planned.

Task IDs are `BT-XXX` (Board Task) — repo-local and sequential, independent of Persephone's
`US-XXX`. Lifecycle: create under **Planned** → move to **Active** when work starts → mark `[x]`,
log to `completed.md`, and remove from the dashboard when done. These docs are repo-only — they
live outside `boards/<id>/`, so they never land in a board's release ZIP.

## Authoring a board

**The running Persephone app (its MCP server) is a REQUIRED tool for board work — it is the
documentation source, the scaffolder, and the test harness.** The generic board authoring
reference — the `persephone.*` bridge, the `--p-*` theme contract, CSP rules, the reload/test
loop, custom-editor wiring — lives in the Persephone app, not in this repo.

**If the Persephone MCP is not available** (its tools are missing or fail to respond): **STOP
and ask the user** to start Persephone or reconnect its MCP. Do not proceed without it — do not
author a board "blind" from repo examples alone.

Required workflow for a new board:

1. **Read the docs FIRST.** Call the **`read_guide("boards")`** MCP tool before designing
   anything. Do NOT design a board by only reverse-engineering existing boards in this repo —
   that gives a partial picture of the board surface and repeatedly leads to overcomplicated
   designs for problems the documented `persephone.*` bridge already solves simply (file access,
   custom-editor association, theming, backend scripts, shared state, dialogs, …).
2. **Scaffold with the `create_board` MCP tool** (`dir` = this repo's `boards/` folder). Never
   hand-create a board folder from scratch: the scaffold is a working starter with correct
   `board-manifest.json`, `board-base.css`, and shim wiring — and a board created this way is
   auto-trusted, so the whole create → open → develop loop runs without user prompts.
3. **Set `minAppVersion` to the running Persephone version.** For a NEW board, read the
   current app version with the `get_app_info` MCP tool and put it in the scaffolded
   `board-manifest.json` as `minAppVersion` — that is the version the board is actually built
   and tested against. When *updating an existing* board, leave `minAppVersion` alone — bump it
   only when the change starts using a Persephone feature that shipped in a newer version (then
   set it to the version that introduced that feature).
4. **Develop and test through the MCP**: `open_board` to open it, then iterate with
   edit files → `board_refresh` → `browser_*` tools (`browser_snapshot`, `browser_click`,
   `browser_evaluate`, `browser_take_screenshot` — always passing the board's `pageId` from
   `list_pages`). Verify UI changes visually with a screenshot, and check the board's `ui.log`
   for errors before declaring it working.

Existing boards and the `how-to/` recipes are the *secondary* reference — good for repo
conventions and solved integration cases, never a substitute for step 1. A board's own
`boards/<id>/CLAUDE.md` (see `boards/drawio-viewer/CLAUDE.md`) documents only what's specific
to that board.
