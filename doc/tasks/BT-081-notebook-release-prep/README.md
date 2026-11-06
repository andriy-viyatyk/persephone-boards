# BT-081: Notebook release preparation

## Status

**Status:** In Progress  
**Priority:** High  
**Board id:** `notebook`

## Goal

Prepare Notebook 1.0.0 for release without publishing it.

## Background

EPIC-137 is binding. Build on BT-078–080 and the Todo board's agent model, guides and translations.

## Implementation Plan

- [ ] Expose the notebook model through aiVision using the existing host edit path.
- [ ] Add user, agent and format guides, language packs and release metadata.
- [ ] Create a generic demo fixture and capture a separate-window catalog screenshot.

## Acceptance Criteria

- [ ] MCP exposes and exercises the model; destructive actions require confirmation.
- [ ] Guides and language packs cover the board; version and compatibility metadata match its APIs.
- [ ] Screenshot meets repository rules; no publishing or Git operations occur.

## Files Changed

| File | Change |
|------|--------|
| `boards/notebook/` | Model, guides, translations and release assets |
| `_test/` | Generic demo notebook |
| `doc/active-work.md` | Link this task |

## Verification and remaining work

- The model appeared in a separate Persephone window; indexed notes, search, host-backed title editing, the delete guard and navigation highlighting were exercised. No new page errors were observed. Existing `ui.log` contains BT-080 synthetic pointer errors and an intermediate model-shape warning, fixed afterward.
- Captured a generic 1120?700 screenshot (137,852 bytes); the separate window was closed. The demo fixture is ignored under `_test/`.
- **Translations remain incomplete:** 17 packs have the same keys and reuse matching existing translations, but most new strings are English placeholders and require translation before release. Broader API and view validation remains outstanding. Do not publish this version yet.
- Compatibility: app 5.0.10 introduced board language packs; bridge 1.36.0 supplies their i18n API. AiVision itself was introduced in bridge 1.3.0.

### API verification (2026-11-05)

- In a new window on an ignored disposable copy of the demo, read all app properties and indexed notes; inspected elements and highlighted search.
- Passed addNote, updateNoteTitle, updateNoteContent, updateNoteCategory, updateNoteLanguage, addComment, updateNoteComment, removeComment, addNoteTag, updateNoteTag, removeNoteTag, setNoteView (code/grid/preview), setSearchText, clearSearch, setSelectedCategory, setSelectedTag, expandNote, collapseNote, renameCategory, moveCategory, and renameTag, checking resulting fields or selection.
- With 37 notes, paging initially rendered 30 with 7 remaining; loadMore and, after resetting, showAll each reached zero remaining. deleteNote rejected false without deleting, and true removed the note. The content host became modified. Page errors and error-level console messages were empty; the separate window was closed.
- Translation check: key order and placeholders pass in all 17 packs, including locale-specific plural forms. Ukrainian was translated apart from format and language names. The other packs still contain many English strings despite additional matching translations reused from other boards; this remains open.
