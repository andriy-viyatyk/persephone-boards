# BT-017: Force Graph board — detail panel resizer

**Epic:** [EPIC-100](../../../../persephone/doc/epics/EPIC-100.md) — Force Graph editor → board
**Reported by:** the owner, during hands-on testing of the board.

## Goal

Give the detail (properties) panel a visible resize grip that works on **both** axes, matching the
built-in `graph-view` editor.

## What the owner reported

> board properties panel (shown on top right corner) do not have resize indicator and I cannot
> resize it if I need it larger to see properties grid without scrolling

## What was actually wrong

Two defects, not one. BT-016 recorded "detail resizes by left-edge drag not a sw-corner" as an
*accepted difference*; investigation showed it was neither accepted-quality nor working.

1. **No affordance.** The resizer was a 4px transparent strip on the panel's left edge with
   `cursor: ew-resize`, styled to show a background only on `:hover`. Nothing indicated it existed.
2. **It could not grow the panel — at all.** The drag clamped against
   `root.parentElement.getBoundingClientRect()`, but the panel's parent is `#detail-slot`, an
   absolutely-positioned wrapper that **shrink-wraps its content**. So the clamp evaluated to
   90% of the panel's *own* current width, and every drag could only ever shrink it. The owner's
   "I cannot resize it" was literally true, not merely a discoverability complaint.
3. A third, latent mismatch: `#detail-slot` capped width at `max-width: 60%` while the JS clamped
   at 90%, so past ~60% of the canvas the drag would keep reporting a larger size than was drawn.

Only (1) was visible to the owner; (2) is the one that mattered.

## The built-in, for reference

`src/renderer/editors/graph/GraphDetailPanelView.ts` — a 12×12 SVG grip of three diagonal strokes
at the panel's **bottom-left** corner (the panel is anchored top-right, so that corner grows it),
`cursor: sw-resize`, `opacity: 0.4`. `DEFAULT 240×300`, `MIN 200×200`, `MAX_PERCENT 0.9` against
the graph container.

## Changes

| File | Change |
|---|---|
| `graph-ui.js` | New `createResizeGripElement()` — the built-in's 12×12 three-stroke grip, same line coordinates so the affordance is visually identical. Exported on `FG`. |
| `style.css` | `.fg-detail-resizer` becomes a 12×12 bottom-left corner grip (`sw-resize`, `opacity 0.4` → `0.9` on hover), strokes from `--p-text-muted`. Dropped `max-height: 60vh` from `.fg-detail-body` (the JS clamp is the authority; a CSS cap would fight it) and aligned its `min-height` to the 200px JS minimum. `#detail-slot` `max-width` 60% → 90% to match the clamp. |
| `graph-panels.js` | Added `state.height` (300, the built-in's default). The drag now tracks both axes with `MIN_WIDTH/MIN_HEIGHT/MAX_PERCENT` constants mirroring the built-in, and clamps against the **canvas** rect rather than the shrink-wrapping wrapper. New `applySize()` helper applies width and height from one place, used by both the drag and `update()`. |

Width default is left at the board's existing 260 (the built-in uses 240) — an unrelated 20px
divergence, not worth churning inside a bug fix.

## Verified live

Driven through `pages[i].editor` automation against `gg-board.fg.json` in the running app:

| Check | Result |
|---|---|
| Grip renders | 12×12, `sw-resize`, opacity 0.4, 3 SVG lines, 1px inset from the bottom-left corner |
| Stroke uses a theme token | resolves to `rgb(150,150,150)` — `--p-text-muted`, not the literal fallback |
| Grow (−140, +160) | 260×300 → 400×460 — exact |
| Maximum | 1422×863 = exactly 90% of the 1580×959 canvas, on both axes |
| Minimum | 200×200 |
| Return drag | back to 260×300 |
| Properties grid follows | 277→527 high, 258→458 wide, `scrollHeight == clientHeight` (no overflow) — the reported need |
| Collapse | clears inline sizing, hides the grip |
| Re-expand | restores the chosen 460×550 |
| `ui.log` | one `board loaded` line, nothing else |

## Noted, not changed

`graph-panels.js` contains a **literal NUL byte** at offset 30845, used deliberately as a delimiter
inside a string literal (`node.id + "\0" + title`). It is legal JS and the board runs fine, but it
makes `file`, `grep` and other text tools treat the whole file as binary. Replacing it with a
`"\u0000"` escape would be behaviourally identical. Left alone as unrelated to this fix.
