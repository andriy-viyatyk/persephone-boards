# BT-088: Built-in wake-session instructions

## Status

**Status:** Active

**Priority:** Medium

**Board id:** `claude-agent`

## Goal

Give the marked wake session the shipped voice-assistant instructions for Claude and Codex. The text is board source, with no setting, editor, user-data override, or runtime dependency on the original file.

## Background

The page stores a `{provider, id}` wake marker. Voice and AI Vision requests, as well as typed prompts, use the page's session views. History and live entries supply the context for deciding which instruction block to send.

Live checks found that both Claude's appended system prompt and Codex's developer instructions remain fixed at session creation: passing changed instructions on resume does not make them visible to the model. Echoing the composed open payload does not establish delivery. The earlier per-session record, Codex injection, and marker-driven reconnection designs are replaced by a single page-level mechanism.

## Approach

- [x] Ship the tested general text in `boards/claude-agent/wake-instructions.md`.
- [x] Cache the local asset and its short SHA-256 version in the page. Before each prompt, load the view's history if needed and inspect raw user entries after the last compaction. Add a versioned apply block for a marked session when needed, or a revoke block when the last block applied instructions to an unmarked session. A new version or compaction causes the next marked prompt to apply the text again.
- [x] Record sent prompts and live compaction in the same transcript list used for history. Show leading blocks in collapsed transcript disclosures before user messages; omit block text from titles and AI Vision messages and leave the stored transcript intact. Do not put wake instructions in `open.instructions`, reconnect when the marker changes, or change provider/service protocols.
- [x] Keep blocks out of joined agents and cross-board sessions. When a group-chat prompt needs a transition block, send that prompt to the main session only; subsequent prompts use normal group routing.
- [ ] Verify in Persephone with both providers: marked and unmarked sessions, marker changes, typed, wake and AI Vision sends, repeated sends, compaction, asset changes and failures, stored transcript, collapsed live and history disclosures, titles and AI Vision output, and group sessions. Inspect `ui.log`. Do not equate delivery with model compliance.

## Concerns

Instructions may conflict with provider or working-directory context, and following them is model-dependent. A group prompt that carries a transition block is not broadcast to joined agents. Page-level delivery depends on complete session history and local asset loading. Live checks remain for the user; no board reload was performed.

## Files Changed

- `boards/claude-agent/wake-instructions.md`: tested instruction text.
- `boards/claude-agent/app.js`: compaction-aware page prompt blocks and display filtering.
- `boards/claude-agent/README.md` and `CLAUDE.md`: behavior and maintenance notes.
