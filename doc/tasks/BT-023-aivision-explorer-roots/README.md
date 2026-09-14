# BT-023: AiVision Explorer - root picker for board and web-page models

## Status

**Status:** Planned
**Priority:** High
**Board id:** `aivision-explorer`
**Started:** -
**Completed:** -

## Goal

Extend the BT-022 AiVision Explorer with a root picker that switches the same viewer
between Persephone's own model, another board's published `.app` model, and a web
page's published `.app` model. Preserve and visibly render the origin labels on
web-page-authored data rather than normalising them away.

## Background

- This task is BT-023 in `C:\projects\persephone\doc\epics\EPIC-101.md` and depends on
  BT-022. The epic verifies that a board's `persephone.call` sees the whole `pages`
  collection while remaining single-window, and that both `BoardEditorFacade` and
  `BrowserEditorFacade` expose an `app` member for a page's published model.
- The three roots are: the empty path `""` for Persephone's object model, and
  `pages["<id>"].editor.app` for another board or web page. `main.*` and `windows[i].*`
  remain unreachable and must not appear as picker choices.
- `boards/force-graph/CLAUDE.md:80-90` and `boards/force-graph/graph-aivision.js:70-75,502-517`
  show the actual board-side publication pattern: `persephone.aiVision.expose(...)`
  publishes a live model at `pages[i].editor.app`, and the model is refreshed when its
  shape changes. `boards/todo/CLAUDE.md:80-87` likewise describes its live `.app` model.
  BT-023 consumes these published models; it does not add or alter another board's model.
- A web-page model is deliberately origin-labelled: `$describe.kind` is prefixed with
  `page:` on every node; `[Page-authored data]` is prepended to the root `summary`; and the
  origin note is appended to `help` through the proxy. The viewer must display each marker in
  the field where it arrives. It must not strip the prefix, move the stamp into help, replace
  the stamp with a generic board label, or silently rewrite third-party summaries.
- Remote `.app` proxy descriptors are verified: a live Todo board returned `kind`, `summary`,
  a full `members` list including `caution` and `writable` flags, `overview`, `help`, and
  `children` from `$describe`. This is established behavior, not an open BT-023 risk.
- BT-022's descriptor rule remains authoritative: live `children[]` entries provide absolute
  paths to use directly, while only static `members[]` entries with `node: true` become tree
  rows. The picker should discover page/editor/app nodes through descriptors rather than
  parsing `$help` or constructing page paths from guessed indices.
- `boards/force-graph/index.html:6-12,58-70` and `boards/force-graph/graph-theme.js:119-137`
  establish the repository precedents for local-only scripts/styles and live theme updates.
  The root picker is UI state in the same offline board and does not introduce a network
  client or external library.
- Work belongs on the `develop` branch. Do not create a second board folder, switch branches,
  commit, or hand-edit `boards-manifest.json`/`versions-manifest.json` while implementing this
  task.
- BT-023 inherits BT-022's compatibility floor and must not lower
  `"minAppVersion": "5.0.3"`; the root picker also depends on the `$describe` support introduced
  by that Persephone release.

## Implementation Plan

- [ ] Start only after BT-022's `boards/aivision-explorer/` board and descriptor walker are
      available. Continue on `develop`, use the board MCP refresh/open workflow, and keep the
      root path as data passed to the existing viewer rather than forking a second renderer.
- [ ] Preserve `"minAppVersion": "5.0.3"` in
      `boards/aivision-explorer/board-manifest.json`; do not lower the BT-022 compatibility
      floor while adding root selection.
- [ ] Extend `boards/aivision-explorer/index.html` with a root-picker control in the board
      chrome. Provide one clearly labelled Persephone option and a grouped list of discovered
      board and web-page `.app` models, with the active root and source type visible.
- [ ] Extend `boards/aivision-explorer/app.js` with root discovery. Enumerate pages through
      the Persephone root and describe each page's `editor` node. Treat the presence of an
      `app` member with `node: true` in that `editor.$describe.members[]` as the authoritative
      signal that the page has actually published a model; offer exactly one picker entry for
      each such page, with no probing call to discover availability. Retain the absolute path
      supplied by every live `children[]` record. Use the existing AiVision path syntax only
      for a static `node: true` member; never rebuild a live child path from an array index or
      page title.
- [ ] Represent each picker entry with its display name, absolute model root path, source
      type, and the latest raw descriptor metadata needed by the label. Identify a web-page
      model from its documented origin markers (`kind` beginning `page:` on every node,
      `[Page-authored data]` prepended to the root `summary`, and the origin note appended to
      `help`); keep those values intact in the picker and center header. Label board-authored
      models as boards without erasing any descriptor `kind`, summary, help, or identity data.
- [ ] On root switch, set the active root path, clear the selected path and expanded-path
      state, invalidate root/path descriptor and value caches, and load the new root's
      `$describe` before showing its tree. Keep the events feed available, but prevent stale
      tree/result requests from the old root from updating the new root's panes.
- [ ] Keep the BT-022 trust-first behavior for every root. If trust is absent or revoked,
      show the friendly trust-required state rather than a blank tree/raw resolver error;
      Retry must re-run discovery/preflight. Keep four scoped failure states distinct:
      trust-required board, unavailable/missing published model, `restricted()` page node,
      and page-access refusal (private/incognito/Tor refusal or stale-document/tab-switch
      refusal). An ordinary bad path/argument remains an operation error and must not be
      mistaken for any of those states.
- [ ] Render web-page provenance in all relevant surfaces: picker row, active-root header,
      selected descriptor header, root `summary`, `help`, and restricted/error context where
      present. Preserve line breaks and exact marker text; escape it as text for DOM safety,
      but do not normalise, move, or omit the `page:` kind prefix on each node, the root
      summary stamp, or the help origin note.
- [ ] Ensure the root picker cannot expose `main.*` or `windows[i].*`, and that selecting
      another page cannot accidentally fall back to the hosting page's rebound `page` member.
      All model operations must continue through `persephone.call` with the selected absolute
      root/path.
- [ ] Extend `boards/aivision-explorer/style.css` for picker grouping, active/source badges,
      page provenance, unavailable/restricted entries, and narrow-pane overflow using the
      live palette from `persephone.getTheme()`/`onThemeChange()`, `--p-*` theme tokens, and
      the existing base stylesheet; add no hardcoded colours.
- [ ] Update `boards/aivision-explorer/WHATS-NEW.md` under the next release heading and
      refresh `boards/aivision-explorer/screenshot.png` only with representative public
      sample content at 1120x700. Bump only the board's own manifest version when releasing;
      leave generated manifests to the publish workflow.
- [ ] Verify through the running app MCP: discover and switch to the Persephone root, a
      board `.app`, and a web-page `.app`; expand/read each, confirm every web origin marker
      in its correct field, switch rapidly between roots, test unavailable/restricted/page-
      access-refused pages and trust revocation, then inspect
      `boards/aivision-explorer/ui.log` for CSP/runtime errors. Do not add tests or a harness.

## Concerns / Open Questions

- Optional descriptor fields remain optional, but remote `.app` proxy `$describe` itself is
  verified against a live Todo board and is not an open concern. A missing `app` member in a
  page editor descriptor is the authoritative indication that no published model is available
  for that page.
- Page display names and origin metadata may be third-party text. Keep the raw descriptor
  values for rendering and use text nodes/escaped text; do not infer trust from a page's
  summary or help. Board trust is the host trust gate, not a label supplied by the page.
- Private/incognito/Tor and stale-document/tab-switch refusals are page-access failures, not
  trust failures or `restricted()` descriptors; preserve their separate scoped status.
- A root switch changes only the Explorer's inspection root. It must not mutate the inspected
  model, invoke a method, or read a property as a side effect of populating the picker; use
  `$describe` for discovery and explicit controls for all reads/writes/invocations.
- The bridge's result-only envelope still provides no truncation metadata. This task should
  not broaden the call transport; preserve the selected model's returned value as-is and
  retain the BT-022 result-display limitation.

## Acceptance Criteria

- [ ] The picker offers Persephone's root plus discovered board and web-page `.app` roots in
      one Explorer board, and switching roots reuses the same tree/detail/actions UI.
- [ ] Discovery and picker rendering use `$describe`; live child absolute paths are used
      directly, and no guessed `pages` index/path joining is used for live children.
- [ ] The web-page root visibly retains the `page:` kind prefix on every node, the
      `[Page-authored data]` stamp in the root `summary`, and the origin note in `help`, each
      in the picker/detail surfaces where that field is shown.
- [ ] Root switches clear stale selection/expansion and cannot leak results or descriptor
      rows from the previous root; events remain usable.
- [ ] `main.*` and `windows[i].*` are not offered, and the Explorer remains single-window.
- [ ] Trust-required, unavailable/missing-model, restricted, and page-access-refused states
      are distinguishable; untrusted startup never displays an empty tree with a raw resolver
      error.
- [ ] No root discovery or navigation auto-invokes a method, assigns a property, or reads a
      caution getter; BT-022's per-operation caution confirmations remain in force.
- [ ] The added UI remains fully offline, uses live `--p-*` theme tokens, and introduces no
      Persephone application code or MCP Inspector dependency.
- [ ] `WHATS-NEW.md` and the public screenshot are updated for the released board version.
- [ ] `ui.log` is clean (no CSP violations)
- [ ] Fully offline (no CDN / network)

## Files Changed

| File | Change |
|------|--------|
| `boards/aivision-explorer/index.html` | Add the root-picker control and source groups to the BT-022 shell |
| `boards/aivision-explorer/app.js` | Add descriptor-driven root discovery, switching, provenance, and stale-request guards |
| `boards/aivision-explorer/style.css` | Add themed picker/source/provenance states |
| `boards/aivision-explorer/WHATS-NEW.md` | Record the root-picker release change |
| `boards/aivision-explorer/screenshot.png` | Refresh the catalog screenshot with a public sample root |
| `boards/aivision-explorer/board-manifest.json` | Bump the board version at release only |

## Notes

- BT-023 is planned for `develop` and depends on BT-022.
- No board folder is created by this task-document change; the files above are the future
  implementation surface.
