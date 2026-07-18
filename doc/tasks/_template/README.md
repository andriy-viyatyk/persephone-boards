# BT-XXX: [Task Title]

## Status

**Status:** Planned | In Progress | Done
**Priority:** High | Medium | Low
**Board id:** `<board-folder-name>` *(the `boards/<id>/` folder this task produces or changes)*
**Started:** YYYY-MM-DD
**Completed:** YYYY-MM-DD

## Goal

What this task achieves (1-2 sentences).

## Background

- Relevant existing code / precedent to follow (e.g. `boards/drawio-viewer/`)
- The Persephone bridge surface the board relies on (`persephone.*`)
- The open-source library to vendor, its license, and where to get it

## Implementation Plan

Step-by-step checklist with exact file paths under `boards/<id>/`. Each step should have
enough detail to implement without re-deriving the design.

- [ ] Step 1
- [ ] Step 2

## Concerns / Open Questions

Anything ambiguous, risky, or needing user input. Flag decisions that could go either way.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] `ui.log` is clean (no CSP violations)
- [ ] Fully offline (no CDN / network)

## Files Changed

| File | Change |
|------|--------|
| `boards/<id>/board-manifest.json` | New — board identity + file association |
| `boards/<id>/index.html` | New — page shell |
| `boards/<id>/app.js` | New — load + render logic |

## Notes

Decisions made during implementation, gotchas discovered, etc.
