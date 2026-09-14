# BT-023: AiVision Explorer — one unified tree over every member

## Status

**Status:** Implemented — awaiting review
**Priority:** High
**Board id:** `aivision-explorer`
**Started:** 2026-09-15
**Completed:** -

> **Supersedes the original BT-023** (a root picker that switched the viewer between Persephone's
> model, a board's `.app`, and a web page's `.app`). That design is dropped: a picker is
> unnecessary once every member is a tree row, because `pages[i].editor.app` is then just another
> node you expand in place. User decision, 2026-09-15.

## Goal

Make the Explorer's tree show **everything** — every member of every node, not only live children
and `node: true` members — and give the detail pane a per-kind editor: a node shows its descriptor,
a property shows its value and (when writable) an assign box, a method shows its signature, an
arguments box and Invoke. A board's or web page's own model then appears in place as
`pages[i].editor.app`, expandable like any other node, with no root switching.

## Background

### What exists today (BT-022, committed as `0e022a6`)

`boards/aivision-explorer/app.js` (618 lines) is structured around one bridge chokepoint and a
descriptor cache. The parts this task changes:

- `describePath(path)` — appends `.$describe` (or returns `"$describe"` at the root).
- `bridgeCall(path, options)` (~line 95) — the single `persephone.call` wrapper. **Keep it as the
  only call site.**
- `descriptorRows(descriptor, parentPath)` (~line 132) — builds tree rows. **This is the function
  the task rewrites.** Today: every `children[]` entry, then every `members[]` entry with
  `member.node === true`, deduplicated by absolute path.
- `memberPath(parentPath, name)` (~line 75) — already handles non-identifier names by emitting
  `parent["name"]`. Reuse it; do not reinvent path joining, and never rebuild a live child's path —
  `children[].path` is authoritative.
- `renderTree()` / `addRow(row, depth)` (~line 165) — row rendering, carets, `data-path`,
  `data-caution`.
- `selectPath(path, options)` (~line 415) — takes an explicit `{ autoRead }` decision.
- `readSelectedValue(token)`, `readMember(path)`, `renderMember(member, parentPath)`,
  `confirmCaution(member, path, action)` — the detail-pane behaviours to reuse.
- `sanitizePath(raw)` — reduces an untrusted path (today only `helpSearch` results) to a plain
  member path. Keep it and keep applying it to search results.

### Verified facts this design rests on

All checked against the running app on 2026-09-14/15; do not re-derive them.

- **`$describe` payload:** `{ path, kind, summary, members[], children[], overview?, help?,
  identity?, restricted? }`. Each `members[]` entry carries `name`, `kind` (`"property"` or
  `"method"`), `summary`, and optionally `signature`, `caution`, `writable`, `node`. Each
  `children[]` entry carries `segment`, `kind`, `summary`, optional `restricted`, and an absolute
  `path`.
- **A leaf needs no call of its own.** The parent's `$describe` already carries everything the
  detail pane must show for a non-expandable member. `$describe` on a descriptor-less value
  (a string, a number, a plain method) returns a resolver error, which the board bridge turns into
  a rejection — so the tree must not describe leaves. This is what keeps the unified tree cheap.
- **`app` is an ordinary member.** `BoardEditorFacade` and `BrowserEditorFacade` both declare it
  `node: true`, and it is spread into the member list **only while that page has a registered
  AiVision model**.
- **A page restored but never activated has no frame, and therefore no `app` member at all.**
  Confirmed: after a Persephone restart, `pages[0].editor` for an unopened Todo board page listed
  no `app`, and `reload()` on it returned `frameReady: false`. After one `pages.showPage(...)`, the
  model registered and `app` appeared.
- **Once registered, it survives being hidden.** With the Explorer active and the Todo page hidden,
  `pages[0].editor.app.fileName` still returned `my.todo.json`. So the Explorer can read another
  board's model while being the visible page — the earlier worry that this was impossible was
  wrong, and it is why the picker is unnecessary.
- **Members with `caution` are common**, including `caution` getters: `pages[i].grouped` carries
  *"reading it CREATES a grouped page if none exists"*. `grouped` is **not** `node: true`, so today
  it is never a tree row — **under this task it becomes one**, which is precisely why the auto-read
  rule below matters more than it did in BT-022.
- **`node: true` means reading is safe** by the descriptor contract, independent of `caution`
  (which describes what a node's *members* do). Root members `fs`, `shell`, `proc` and `tools` are
  all `node: true` *and* cautioned.

### Regressions this task must not reintroduce

BT-022 shipped with two defects, found and fixed during verification. Both are easy to recreate
while rewriting row construction:

1. **Call-syntax paths invoke.** `helpSearch` returns `pages.closePage()`; resolving a path with
   parentheses calls the method. Any path from a non-tree source must go through `sanitizePath`.
2. **`descriptor.kind` is not `IAiMember.kind`.** The first is a node type name (`"Pages"`,
   `"Page"`, `"TodoApp"`); the second is `"property"` / `"method"`. A guard comparing the wrong one
   silently never fires. Row and detail logic must branch on the **member record**, not on the
   node descriptor.

## Design

### The row rule

Build rows from one merged list, deduplicated by absolute path, in this order:

1. every `children[]` entry — path taken verbatim from `child.path`;
2. every `members[]` entry — path from `memberPath(parentPath, member.name)`.

Each row records `{ path, label, memberKind, expandable, writable, caution, restricted, summary,
signature, source }`, where:

- `expandable` is `true` for a live child, or for a member with `node === true`; `false` otherwise.
- `memberKind` is the member's own `kind` for member rows, and `undefined` for child rows.

Only `expandable` rows get a caret and may be expanded. A leaf row is selectable but never
described and never expanded.

### The detail pane

Branch on the selected row's **member record**, not on a descriptor:

| Selection | Pane shows |
|---|---|
| expandable node | its `$describe`: summary, `overview`, `help`, `restricted`, member list, children |
| property | summary, a **Read** control and the returned value; an assign box when `writable` |
| method | summary, `signature`, a JSON arguments box, and **Invoke** |

A leaf's pane is rendered entirely from the parent descriptor's member record — no bridge call
until the user presses Read or Invoke.

### Safety — unchanged rules, wider surface

- Expansion calls **only** `$describe`, and only on `expandable` rows.
- Auto-read on selection is granted **only** to rows that are live children or `node: true`
  members, and **never** to a row carrying `caution`. Every other value arrives by an explicit
  Read. This is what keeps `pages[i].grouped` — now a visible row — from creating a grouped page
  just because the user clicked it.
- A method row never reads and never invokes on selection.
- Assign and Invoke on any member carrying `caution` keep the per-operation in-frame confirmation
  showing that caution text, with no remembered bypass.

### The unrendered-page state

When `pages[i].editor` lists no `app` member, the board or browser page has not been rendered yet.
Say so where the user is looking: a hint under that editor node reading roughly *"this page has no
published model — activate its tab once, then refresh"*, rather than silently omitting anything or
surfacing a resolver error. Do not try to activate the page from the board.

## Implementation Plan

- [x] Rewrite `descriptorRows(descriptor, parentPath)` in `boards/aivision-explorer/app.js` to emit
      the merged row shape above. Keep `children[].path` verbatim, keep `memberPath()` for members,
      keep deduplication by absolute path, and keep child rows first.
- [x] Extend `addRow()` / `renderTree()`: render a caret only when `row.expandable`; distinguish
      property, method and node rows visually (the existing `◆` / `ƒ` glyphs plus a `node` badge);
      keep `data-path`, keep `data-caution`, and add `data-expandable` and `data-member-kind`.
- [x] Guard `togglePath()` so a non-expandable row cannot be expanded and never calls `$describe`.
- [x] Rework the tree click handler: select every row; auto-read only when the row is expandable
      **and** carries no `caution`; pass the row's member record to the detail pane.
- [x] Replace the detail pane's node-only rendering with the three-way branch. Reuse
      `renderMember()`'s existing controls for the property and method cases — it already renders
      Read, a disabled-unless-`writable` assign box, an arguments box, Invoke, and the caution box.
- [x] Keep the Members panel for an expandable node as the whole-node overview; for a leaf
      selection show the single-member editor instead. Do not render both for a leaf.
- [x] Add the unrendered-page hint when an editor node's descriptor has no `app` member and its
      `kind` is `BoardEditor` or the browser editor.
- [x] Keep `sanitizePath()` on every `helpSearch` result and keep search-result selection
      `{ autoRead: false }`.
- [x] Update `boards/aivision-explorer/CLAUDE.md` to describe the unified tree, and add a
      `WHATS-NEW.md` entry under the next version heading with a matching `board-manifest.json`
      version bump.
- [x] Verify in the running app: expand to `pages[i].editor.app` and further into a board's model;
      read a property; assign a writable one; invoke a method with arguments; confirm a cautioned
      operation and cancel one; confirm selecting `pages[i].grouped` does **not** create a grouped
      page; confirm a never-activated board page shows the hint. Check `ui.log` is clean.

## Concerns / Open Questions

1. **Tree size.** The root alone gains ~24 rows, and every node expands into its full member list.
   Collapsed-by-default (already the behaviour) keeps this manageable, but the tree is now the
   primary navigation surface — if it feels heavy in use, the fallback is a per-node "show members"
   toggle rather than reverting the rule.
2. **Duplication with the Members panel.** For an expandable node the same members appear in both
   the tree and the panel. That is deliberate (the panel is the readable overview with summaries),
   but if it reads as noise, the panel is the half to drop, not the tree.
3. **Indexed children.** `children[]` includes `[0]`, `[1]`, … for collections. With every member
   also listed, a large collection could dominate the tree. Watch `pages` and any board model with
   a long `items` list, and cap or paginate if needed — the descriptor does not do it for us.
4. **`elements` / `highlight`.** Most facades carry these. `highlight` is cautioned and changes the
   visible UI; it is a fine thing to expose, but it will now be one click away in the tree, so the
   confirmation text matters.
5. **BT-022's screenshot is still outstanding** and blocks publishing the board at any version. It
   needs a curated window: a live capture includes the tab strip and status bar of a real session.

## Acceptance Criteria

- [x] Every member of a described node appears as a tree row; only live children and `node: true`
      members are expandable, and only those show a caret.
- [x] `pages[i].editor.app` appears as an ordinary expandable node for a rendered board or browser
      page, and its model can be walked in place without any root switching.
- [x] Selecting a property shows Read and, when writable, an assign box; selecting a method shows
      its signature, an arguments box and Invoke; selecting a node shows its descriptor.
- [x] Expanding or selecting never invokes a method and never reads a `caution` getter — verified
      specifically against `pages[i].grouped`, which must not create a grouped page when clicked.
- [x] Assign and Invoke on a cautioned member still require a fresh per-operation confirmation.
- [x] A `helpSearch` result for a method still selects a plain member path and does not invoke.
- [x] A board page that has never been activated shows the "no published model" hint rather than an
      error or a silent omission.
- [x] `ui.log` is clean (no CSP violations)
- [x] Fully offline (no CDN / network)

## Files Changed

| File | Change |
|------|--------|
| `boards/aivision-explorer/app.js` | Rewritten row construction, expandability, click handling, and the three-way detail pane |
| `boards/aivision-explorer/index.html` | Detail-pane regions for the per-kind editors, if the existing markup cannot carry them |
| `boards/aivision-explorer/style.css` | Row kind/leaf styling, the unrendered-page hint |
| `boards/aivision-explorer/board-manifest.json` | Version bump |
| `boards/aivision-explorer/WHATS-NEW.md` | Entry for the unified tree |
| `boards/aivision-explorer/CLAUDE.md` | Board-specific notes updated to the new tree rule |

## Notes

- Work belongs on `develop`; never commit board changes to `main`, and never hand-edit
  `boards-manifest.json` or any `versions-manifest.json`.
- Belongs to Persephone's **EPIC-101**, which holds the `$describe` design and the verified
  background.
