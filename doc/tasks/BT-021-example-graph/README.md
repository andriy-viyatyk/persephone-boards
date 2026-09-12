# BT-021: Move the `greek-gods.fg.json` example into the Force Graph board

**Epic:** [EPIC-100](../../../../persephone/doc/epics/EPIC-100.md)
**Owner decision:** the example belongs to the board, and the app's copy is deleted during the
Graph cleanup (US-1405).

## Goal

Ship the sample graph with the Force Graph board, and reference it from the board's guides so a
user who installs the board has something to open.

## Background

`C:\projects\persephone\assets\guides\examples\greek-gods.fg.json` — 26,265 bytes, 63 nodes,
87 links, six shapes, five levels. It has been the primary fixture for every stage of this epic
(BT-014/015/016 all verified against it).

**It is currently orphaned in the app.** A grep of `assets/`, `qa/` and `src/` finds **no reference
to it at all** — the guide that used to link it no longer does. So there are no live links to
repair on the app side; the only references are historical, inside completed task documents under
`doc/`, which must not be rewritten.

The board's own guides (BT-019) do not reference any example file yet.

## Implementation plan

1. Copy the file into the board — suggested `boards/force-graph/examples/greek-gods.fg.json`,
   **byte-for-byte unchanged**. Confirm the copy matches the source exactly (compare hashes).
2. **Investigate how a board guide can link to a non-Markdown file inside the board**, and whether
   clicking that link opens the file in Persephone. This is the open question of the task and is
   not yet known to work:
   - BT-019 flagged that relative asset resolution from a mounted board guide source is unverified.
   - Board guides are mounted read-only through `GuideSource` (`readDirectory` / `readFile`) at
     `installed-boards/<board>/`, and containment is enforced per board root (US-1406), so a link
     escaping the guides folder may well be rejected.
   - Determine what actually happens, and pick the best available option: a link the guide renderer
     resolves; a documented path the user opens themselves; or, if the board should open it
     directly, a small board affordance. **Do not invent an app-side feature under this task** — if
     the only good answer needs app support, write it up as a finding and stop there.
3. Reference the example from the board's guides where it helps — most naturally `index.md`
   ("open this to see what the board does") and `format.md` (a real file illustrating the schema).
   Match the voice of the existing pages.
4. Record in the task document what you found in step 2, including anything that does not work.

## Concerns / open questions

- **Do not modify the app copy.** Deleting `assets/guides/examples/greek-gods.fg.json` belongs to
  US-1405 and is gated on owner testing. This task only adds the board's copy.
- If the example ships inside the board, note that the board's package grows by ~26 KB; confirm
  nothing in the publish pipeline excludes non-code files from a board folder.
- The file must stay a valid `.fg.json` the board opens with no migration — verify by opening the
  board's copy, not the app's.

## Acceptance criteria

- `boards/force-graph/examples/greek-gods.fg.json` exists and is byte-identical to the app's copy.
- Opening the board's copy in the Force Graph board renders correctly, with `ui.log` clean.
- The board's guides point a reader at the example, by whatever mechanism step 2 established works.
- The findings of step 2 are recorded, including any mechanism that does **not** work.
- Nothing under `C:\projects\persephone` is modified.

## Outcome (implemented)

`boards/force-graph/examples/greek-gods.fg.json` — copied byte-for-byte; SHA-256
`1ec5c00470d7b75b5aa00cc6a523187141e73684f2781f3ff14322a40a5ee21a` matches the app's copy.
Nothing under `C:\projects\persephone` was touched. The publish script's exclude list is
`ui.log`, `versions-manifest.json`, `.git`, `node_modules`, `screenshot.png`, so `examples/`
ships inside the release ZIP (+26 KB).

Verified live: opening the **board's** copy gives a `board-editor:…\boards\force-graph` page with
`nodeCount: 63`, `linkCount: 87`, `error: ""`, `loading: false`; the screenshot renders the graph
correctly and `ui.log` holds only `board loaded`.

The file is smaller than the task brief claimed: **four** shapes (circle, diamond, square, star),
**four** levels (1-4), **no** groups. The guides describe it as it actually is.

### Step 2 — what does NOT work: a guide link to a non-Markdown file

**A board guide cannot link to a file inside the board. The mechanism does not exist, and it
cannot exist without an app change.** Two independent blocks, both confirmed in the source and
empirically:

1. **Only the guides folder is mounted.** `createMountedGuideSource`
   (`src/shared/guides/mounted-source.ts`) mounts the board's `guides` folder — not the board
   root — at `installed-boards/<board>/`, with containment per mount. A sibling
   `examples/` folder is therefore outside the corpus entirely, and
   `resolveGuideHref("installed-boards/force-graph/index", "../examples/greek-gods.fg.json")`
   resolves to `installed-boards/examples/…`, which belongs to no board.
2. **A guide link resolves only to a Markdown page, whatever it points at.** Every *relative*
   href on a guide page is rewritten by `rehypeMarkdownOverrides` →
   `resolveGuideHref` into a `persephone-guide://<corpus path>` URL. The guide resolver
   (`src/renderer/content/resolvers.ts`) looks the path up with `getGuidePage`, and
   `createGuideIndex` indexes **only `*.md`** (`getPage` appends `.md`). So a non-`.md` target is
   always "Guide not found". Even moving the example *inside* `guides/` does not help: the file
   would not be indexed, and if it were, the resolver hard-sets `data.target = "md-view"`, so a
   guide link can never hand content to the Force Graph board.

   Empirically: `pages.openUrl("persephone-guide://installed-boards/force-graph/examples/greek-gods.fg.json")`
   opened no page (error toast, page count unchanged).

A local absolute path would survive the rewrite (`resolveGuideHref` returns `undefined` for an
absolute href and the original is kept), but a board's install root is machine-specific
(`<userData>/data/boards/force-graph`), so it cannot be written into a shipped guide.

**If this is ever wanted app-side** (not done here, per the brief): the smallest change would be a
guide-relative link form that resolves against the *board root* rather than the guide corpus, and
that bypasses `target = "md-view"` in favour of the normal open pipeline. That is an app feature —
recorded here, not built.

### What was chosen instead: an absolute catalog URL

An **absolute `https://` href is passed through untouched** by the guide renderer and goes to the
normal open pipeline. Verified end to end, in the running app:

- `pages.openUrl("https://raw.githubusercontent.com/…/greek-gods.fg.json")` opened a page whose
  editor is `board-editor:…\boards\force-graph` — an HTTP-sourced `.fg.json` is claimed by the
  board, because a content-host board accepts every source.
- With the link temporarily pointed at a URL that exists on `main` today, **clicking the link in
  the About guide browser** opened a new Force Graph page (verified twice: reuse of the existing
  page, and a fresh open after closing it). The rendered `href` is the verbatim absolute URL.

So the guides now carry, in `index.md` (a new *An example graph* section) and `format.md`:

- a one-click link to
  `https://raw.githubusercontent.com/andriy-viyatyk/persephone-boards/main/boards/force-graph/examples/greek-gods.fg.json`,
  and
- the offline alternative in prose: the file is at `examples/greek-gods.fg.json` inside the
  board's own folder, whose path the Board Info page shows.

**Caveat:** the catalog URL 404s until `develop` is merged to `main` — `boards/force-graph/` is
not on `main` yet. It becomes live with the same merge that first publishes the board, i.e. before
any user can install it. The URL *shape* was confirmed with a 200 on an existing file under the
same path prefix.
