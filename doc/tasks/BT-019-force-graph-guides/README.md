# BT-019: Force Graph board — ship its own user and agent documentation

**Epic:** [EPIC-100](../../../../persephone/doc/epics/EPIC-100.md)
**Depends on:** US-1406 in the app (the `guides` manifest field and the multi-source guide index).

## Goal

Move the Force Graph documentation out of the Persephone app and into the board, so it ships and
versions with the board and is discoverable by users (About page, `F1`) and agents
(`guides.search()`, `guides["boards/force-graph/..."]`).

## Background

The app currently owns all of it:

| Source (in `C:\projects\persephone`) | Size | Audience |
|---|---|---|
| `assets/guides/editors/graph.md` | 8.1 KB | user — the editor guide |
| `assets/guides/formats/graph.md` | 9.4 KB | user/agent — the `.fg.json` format reference |
| `qa/surfaces/editors/graph.md` | 6.7 KB | agent — the QA surface |

US-1405 deletes the built-in editor. Without this task that documentation is deleted with it —
which is exactly what happened to the Todo editor (commit `a2692189`), leaving the Todo board
shipping undocumented to this day.

**The content cannot be copied verbatim.** Every one of these documents addresses the built-in
editor's scripting facade at `page.editor.*` / `page.asGraph()`. The board's agent surface is
`pages[i].editor.app.*`, with a different and slightly larger member set (BT-016 found the board
model is a **superset** of the built-in facade's ~30 members). Element names are the same 33.

## Implementation plan

1. Create `boards/force-graph/guides/` and declare it in `board-manifest.json` (`"guides": "guides"`).
2. Author the pages, each with the front-matter contract the app already enforces —
   `title`, `audience` (`user` | `agent` | `both`), `summary`, and `editorId` where the page
   documents the board's editor:

   | Page | Audience | Content |
   |---|---|---|
   | `index.md` | both | What the board is, when to use it, links to the others |
   | `editor.md` | user | Port of `assets/guides/editors/graph.md`: toolbar, panels, gestures, menus, keyboard, search, grouping, expansion |
   | `format.md` | both | Port of `assets/guides/formats/graph.md`: the `.fg.json` schema |
   | `agent.md` | agent | The `pages[i].editor.app.*` model and the 33 named elements |

3. **Rewrite every API reference** from the built-in facade to the board model: `page.asGraph()`
   and `page.editor.*` become `pages[i].editor.app.*`. Verify each member you name actually exists
   — read `graph-aivision.js`, do not translate from the old document's member list.
4. **Correct the differences BT-016 and the owner's testing recorded**, rather than describing the
   built-in's behaviour: the two image buttons are in the board's own toolbar (not the page
   toolbar); grouping strikethrough follows the documented sense; the detail panel resizes from a
   bottom-left grip on both axes; `groupingEnabled` is page-scoped.
5. Decide what becomes of the QA surface (`qa/surfaces/editors/graph.md`). It exercises the app's
   MCP documentation, not the board's — propose retiring it or relocating it, and record the call.
   Do not delete anything in the app repo under this task.
6. Do **not** delete the app-side guides — US-1405 owns that, and it is gated on owner testing.

## Concerns / open questions

- Screenshots and any images referenced by the guides must live in the board folder; check whether
  the guide renderer resolves relative image paths for a mounted board source, and say so if not.
- `format.md` documents a file format that is meaningful without the board installed (an agent may
  generate `.fg.json` before the board exists). Note the dependency in the page itself.
- The existing documents are good and were written for this feature — port their substance, do not
  regenerate thinner versions from the source code.

## Acceptance criteria

- The board declares `guides` and the pages appear in the About tree under the installed-boards
  branch.
- `guides.search("force graph")` returns board pages.
- Every API member, element name and file-format field named in the guides is verified against
  `graph-aivision.js` / `graph-core.js`, not carried over from the app's documents.
- No page tells the user to use `page.asGraph()` or `page.editor.<graph member>`.
- The four differences in step 4 are documented as the board behaves, not as the built-in did.
- Nothing in `C:\projects\persephone` is modified by this task.

## Outcome (implemented)

Four pages in `boards/force-graph/guides/`, declared with `"guides": "guides"` in
`board-manifest.json`:

| Page | audience | Ported from |
|---|---|---|
| `index.md` | both | new — what the board is, when to use it, the four behavioural differences, links to the rest |
| `editor.md` | user | `assets/guides/editors/graph.md`, rewritten as a real user guide for the board's UI |
| `format.md` | both | `assets/guides/formats/graph.md`, minus its `page.editor` API half |
| `agent.md` | agent | the API half of `formats/graph.md`, rewritten against the board model |

**`editorId: "board"` on `editor.md`, and nowhere else.** A board's real editor id is
`board-editor:<absolute board root>` - machine-specific and impossible to ship in a guide - so
US-1406 gave a board's own page the literal token `board` to claim its board with
(`BOARD_SELF_EDITOR_ID` in `src/shared/guides/mounted-source.ts`). It is honored only for pages
under that board's own mount, so a board can claim neither another board's pages nor a built-in
editor. `KeyboardService.findGuidePath` ranks a self-claim at -2 and adds +1 for a non-`user`
audience, and only the top match opens; the user-facing UI guide is what someone pressing F1
wants, and putting the token on a second page would only make that ranking harder to reason
about. The other three pages carry no `editorId`.

### API verification

Every member, element name and format field was read out of `graph-aivision.js` (the 83 model
members and the 33 elements) and `graph-core.js` (the reserved keys, the `#N` indexed-property
rule, the level/shape defaults, the `maxVisible` 500 default, the force defaults) rather than
translated from the app's documents. A scripted cross-check confirmed that every one of the 33
element names and all 83 members appear in `agent.md`, and that no identifier in `agent.md`
names something the model does not have. Spot-checks (`fileName`, `recordsCount`,
`forceParams`, `expansionOptions`, `getComponents`) were also run live over MCP.

### The four corrected differences

Documented as the board behaves: the image buttons in the board's own toolbar; the Grouping
button struck through while grouping is **off**; the detail panel resized from a bottom-left
grip on **both** axes (200x200 min, 90% of the canvas max); `groupingEnabled` page-scoped.

### QA surface — retired, not ported (step 5)

`qa/surfaces/editors/graph.md` should be **deleted with the built-in editor in US-1405**. It is
a test of Persephone's own MCP descriptors for `graph-view` — `pages[i].editor.elements`,
`highlight`, `dialogs[0]`, `menus[0]` — and almost none of it transfers: the board's surface is
`pages[i].editor.app`, its confirmations are in-frame overlays that never reach the app's
`dialogs`, and its menus are av-grid's, not Persephone's. There is no surface-QA corpus in the
boards repo to relocate it into, and inventing one for a single board is not justified. The
coverage it represented now lives in two places that are maintained: BT-016's parity checklist,
and the *Gotchas* section of `guides/agent.md`.

### Live verification

US-1406 had landed in the running build, so this was verified end to end, not assumed:

- The board loads with the new manifest field; `ui.log` clean after a reload.
- `guides["installed-boards/force-graph"]` lists all four pages with the right titles,
  audiences and summaries (the mount path is `installed-boards/<id>/`, not `boards/<id>/`).
- `guides.search("force graph")` returns all four as its top hits.
- All four render in the About guide browser under **Installed boards › Force Graph**.
- **F1 on a Force Graph board page opens `installed-boards/force-graph/editor`**, not the
  generic built-in board guide - driven live (About parked on `editors/index`, the graph page
  activated, F1 pressed, About then reading the board guide).

Relative cross-links (`editor.md`, `format.md`, `agent.md`) resolve by `resolveGuideHref`
against the page's corpus path; the four pages were each opened directly to confirm they render.

No screenshots or images are referenced by any page, so the open question about relative image
paths in a mounted board source did not have to be answered.

Nothing in `C:\projects\persephone` was modified. The board version stays **1.0.0** (never
released); the change is recorded under that heading in `WHATS-NEW.md`.
