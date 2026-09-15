# BT-022: AiVision Explorer board - tree, path resolution, help and events

## Status

**Status:** Complete
**Priority:** High
**Board id:** `aivision-explorer`
**Started:** 2026-09-14
**Completed:** 2026-09-15

## Goal

Ship the core AiVision Explorer board: a trusted, fully offline viewer for the live
AiVision model with a descriptor-driven tree, selected-path result/help/member views,
property and method controls, search, and an events feed. The board is a public
`ai-vision` consumer, not Persephone application code and not an MCP Inspector.

## Background

- This task is BT-022 in `C:\projects\persephone\doc\epics\EPIC-101.md`. The epic verifies
  that `window.persephone.call(path, options?)` reaches the same AiVision resolver as the
  agent, returns only the plain JSON-safe result, and supports `args`, `value`, `maxLength`,
  and `timeoutMs`. A trusted board can reach `fs`, `proc`, `shell`, `script`, `boards`,
  `tools`, and `settings`; `main.*` and `windows[i].*` are not reachable.
- The prerequisite is `ai-vision` 1.2.0's terminal `$describe` segment. It returns the
  structured descriptor (`path`, `kind`, `summary`, `members`, `children`, and optional
  `overview`, `help`, `identity`, `restricted`); `children[]` includes an absolute `path`.
  Its `members[]`/`children[]` projection is side-effect free, and `$describe` describes a
  restricted node without resolving below it. Use the contract as recorded in EPIC-101;
  do not parse `$help` prose or reimplement the resolver.
- A live Todo board has verified `$describe` on a remote `pages[i].editor.app` proxy: the
  synthesized descriptor returns `kind`, `summary`, a full `members` list including
  `caution`/`writable`, `overview`, `help`, and `children`. Remote descriptor access is
  established behavior for BT-023.
- `boards/todo/index.html:7-8` links `board-base.css` before the board stylesheet and loads
  one classic `app.js`; `boards/todo/app.js:340-700` is a concrete AiVision exposure with
  descriptor `members`, `node: true` collection members, indexed nodes, and explicit
  `caution` text on destructive methods. These are precedents for the single-board shell
  and descriptor metadata, not APIs to copy blindly.
- `boards/force-graph/index.html:58-70` loads all assets locally in dependency order and
  explicitly documents that a board CSP blocks remote scripts. `boards/force-graph/CLAUDE.md:37-39`
  confirms the classic-script/no-bundler pattern. The Explorer therefore has no CDN,
  network request, or third-party runtime dependency.
- `boards/force-graph/graph-theme.js:119-137` reads the theme through
  `persephone.getTheme()`/`onThemeChange()`, while `boards/force-graph/CLAUDE.md:41-49`
  explains why board colors must use the `--p-*` contract (and concrete theme values where
  CSS variables cannot be consumed). Follow the same live-theme approach; do not hardcode
  UI colors.
- `boards/todo/app.js:760-800` and `boards/force-graph/graph-ui.js:205-286` implement
  in-frame, CSP-safe overlays rather than `window.confirm`/`prompt`. Reuse that local
  interaction pattern for caution confirmations.
- No open-source library is planned for this viewer. Use native DOM/JSON and the scaffolded
  board base styles. If implementation later adds a library, vendor it under
  `boards/aivision-explorer/lib/` with its upstream license and version file; never load it
  from a CDN.
- Work belongs on the `develop` branch. The implementation must use the running Persephone
  board workflow from `CLAUDE.md` (read the app's boards guide, scaffold with `create_board`,
  then open/refresh and inspect `ui.log`); this task document itself does not create the board
  folder.

## Implementation Plan

- [ ] Before implementation, confirm that the `ai-vision` 1.2.0 `$describe` resolver segment
      is available in the running Persephone build. On `develop`, scaffold
      `boards/aivision-explorer/` with the board MCP `create_board` tool; do not hand-create
      the board folder or edit generated catalog manifests.
- [ ] Create `boards/aivision-explorer/board-manifest.json` from the scaffold and set the
      public board name/description, `version`, and bare `screenshot` filename. Pin
      `"minAppVersion": "5.0.3"`: `$describe` arrived in `ai-vision` 1.2.0 today, and
      Persephone 5.0.2 and earlier reject every `$describe` call with a path syntax error,
      leaving the board completely unusable rather than degraded. Keep the board as a
      generic board with no content-host file association; never hand-edit
      `boards-manifest.json` or any `versions-manifest.json`.
- [ ] Build `boards/aivision-explorer/index.html` as the single board shell. Link
      `board-base.css` first and the board stylesheet second; provide a left tree and a
      center detail workspace containing the result, help, members, and events sections, plus
      a path/root header, help-search controls, and in-frame dialog/notification mount points.
      Load only local scripts.
- [ ] Implement `boards/aivision-explorer/app.js` around one bridge adapter and explicit UI
      state: active root path (initially the Persephone root), selected path, descriptor cache,
      expanded paths, result state, search state, and event-feed state. Route every operation
      through `window.persephone.call`; render JSON-safe values and rejected `Error` messages
      as operation status without inventing agent hint/warning/truncation fields that the
      board bridge does not return.
- [ ] Implement descriptor loading with `path + '.$describe'` (using the root `$describe`
      form for the empty path), and make the tree projection rule explicit in code and UI:
      each descriptor `children[]` entry becomes a navigable row and uses that entry's
      supplied absolute `path` verbatim; each `members[]` entry becomes a tree row only when
      `node === true`, using the current AiVision member path syntax for that static member.
      Ordinary properties and all methods without `node: true` are not tree rows; they appear
      only in the selected descriptor's member list. Deduplicate rows by absolute path and
      preserve `restricted` labels.
- [ ] Ensure expansion and navigation never invoke methods or getters implicitly. Expansion
      calls only `$describe`; it must not call a child path, read a member value, or read a
      `caution` getter. Selecting a property/node may perform its ordinary explicit value
      read for the result pane; selecting a method shows its signature and an Invoke control
      instead of invoking it.
- [ ] Render the selected descriptor in the center: absolute path, `kind`, summary,
      `overview`, resolved `help`, optional identity/restricted text, the JSON-safe resolved
      value when explicitly readable, and the complete member list. Show member kind,
      summary, signature, `writable`, and `caution` from `$describe` without resolving the
      member just to populate the panel.
- [ ] Add explicit member actions. A property Read control calls its member path; a writable
      property editor parses one JSON value and calls with `{ value }`; a method editor parses
      one JSON array and calls with `{ args }`. Never combine `value` and `args`. Show the
      returned value or rejected error in the operation result, keep JSON parsing errors local
      to the form, and disable assignment when `writable` is not true.
- [ ] Make `caution` a prominent part of every assignment/invocation control. Before every
      assignment or invocation whose descriptor member carries `caution`, show the full
      caution in an in-frame confirmation and require a fresh explicit confirmation for that
      one operation. Do not offer or persist a "don't ask again" choice; cancellation must
      make no bridge call. A read control must not read a caution getter.
- [ ] Add `helpSearch` UI. Submit a non-empty query through
      `persephone.call("helpSearch", { args: [query, limit] })`, render each returned
      `{ path, kind, matchedLine }`, and make a result select the path and load its descriptor
      without scraping or rewriting the returned matched line.
- [ ] Add the events feed using `events.recent()` for initial/reload history and the
      documented `events.wait()` path for subsequent events. Keep the wait loop cancellable
      on board teardown/root changes, render events as data, and show a non-blocking feed
      error without interrupting tree browsing.
- [ ] Implement the trust-first boot state. Preflight the root descriptor before rendering
      an empty tree; if the board is untrusted or the trust gate rejects the preflight, show a
      dedicated explanation that the board must be trusted, point the user to the host's board
      trust control, and provide Retry. Do not present an empty tree with the raw resolver
      error. Apply the same friendly state if trust is revoked during a later call, while
      keeping ordinary path/argument failures in the operation status area.
- [ ] Add `boards/aivision-explorer/style.css` for layout, scrolling, readable JSON/help,
      restricted/caution/error states, and the confirmation overlay. Use `--p-*` tokens and
      the scaffolded `board-base.css`; initialize the live palette from
      `persephone.getTheme()` and update it through `onThemeChange()` rather than adding
      hardcoded colours. Include an explicit `[hidden]` rule if any class-based display rule
      would otherwise override hidden UI.
- [ ] Add `boards/aivision-explorer/WHATS-NEW.md` with the release heading and one terse line
      for the Explorer feature, and add the required public `boards/aivision-explorer/screenshot.png`
      only after the board shows representative, non-personal sample content at 1120x700.
- [ ] Develop and verify through the app MCP on `develop`: open/trust the board, exercise
      descriptor expansion, property reads, writable assignment, method calls, caution
      cancellation/confirmation, search, events, and an untrusted first run; refresh the
      board and inspect its `ui.log` for CSP/runtime errors. Do not add unit tests or a test
      harness.

## Concerns / Open Questions

- The board bridge intentionally unwraps the plain result and does not expose the agent's
  `hint`, `warning`, `truncated`, `shown`, or `total` fields. The result pane must label data
  as "returned value" and must not claim completeness based on its display; changing that
  envelope is outside BT-022.
- The static-member path helper must use the existing AiVision path syntax for a member name;
  live child paths must never be reconstructed because `$describe.children[].path` is the
  authoritative absolute path. Verify names containing non-identifier characters against the
  running board guide before implementation.
- A trusted Explorer can reach privileged members under `proc`, `fs`, `shell`, `script`, and
  `tools`. The caution metadata/confirmation barrier is therefore a release blocker, not a
  cosmetic enhancement; absence of `caution` in a descriptor is not a reason to auto-run a
  method during browsing.

## Acceptance Criteria

- [ ] A trusted board loads the Persephone root through `$describe` and displays a navigable
      tree whose rows follow the documented `children[]` / `node: true` rule.
- [ ] `boards/aivision-explorer/board-manifest.json` declares exactly
      `"minAppVersion": "5.0.3"`, because earlier Persephone releases fail every `$describe`
      call with a path syntax error.
- [ ] Expanding or navigating never invokes a method, performs an implicit assignment, or
      reads a caution getter; restricted nodes describe themselves and do not expose children
      beneath the restriction.
- [ ] The center shows the selected path, descriptor help/member metadata, and an explicit
      JSON-safe value read; writable properties can be assigned and methods can be invoked
      with JSON arguments, with errors shown clearly.
- [ ] Every member with `caution` shows that text beside its applicable control and requires
      a new per-operation confirmation with no remembered bypass.
- [ ] `helpSearch` results and an events feed work through the bridge without network access.
- [ ] An untrusted first run shows trust instructions and Retry, never a blank tree with a
      raw resolver error.
- [ ] The board uses `board-base.css`, live `--p-*` theme tokens, local assets only, and no
      Persephone application or MCP Inspector code.
- [ ] `WHATS-NEW.md` and the public 1120x700 screenshot are present; the manifest's version
      matches the top changelog heading.
- [ ] `ui.log` is clean (no CSP violations)
- [ ] Fully offline (no CDN / network)

## Files Changed

| File | Change |
|------|--------|
| `boards/aivision-explorer/board-manifest.json` | New - board identity, version, minimum app version, and screenshot declaration |
| `boards/aivision-explorer/index.html` | New - offline three-pane Explorer shell |
| `boards/aivision-explorer/app.js` | New - descriptor tree, path reads, member operations, search, trust state, and events feed |
| `boards/aivision-explorer/style.css` | New - themed layout, result/help/member panels, statuses, and dialogs |
| `boards/aivision-explorer/board-base.css` | Scaffolded board theme/chrome base, retained as the first stylesheet |
| `boards/aivision-explorer/WHATS-NEW.md` | New - release changelog |
| `boards/aivision-explorer/screenshot.png` | New - public catalog screenshot with no personal data |

## Notes

- BT-022 is planned for `develop`; it must not be committed directly to `main`.
- BT-023 extends this same board with the root picker and board/web-page `.app` roots; it
  depends on BT-022.
