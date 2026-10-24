# BT-047: Claude Agent board — subagents panel

## Status

**Status:** Active  
**Priority:** Medium  
**Board id:** `claude-agent`  
**Started:** 2026-10-24  
**Completed:** —

## Goal

Show the selected session and its subagents as a tree at the bottom of the Claude Agent sidebar. Selecting a node displays that chat's transcript, with the main session as the root and the active chat highlighted.

## Background

- The Chat page currently has a single `#session-list` navigation area in `index.html`; `app.js` renders its folder/session tree in `renderSessions()`. The sidebar is a vertical flex container, so the Agents section can sit below it with a capped height and its own scrolling.
- `app.js` keeps per-session view state for transcript DOM, follow channel, draft, status, footer, and scroll position. `openStoredSession()` loads history through `session-history`, then starts `follow-session`; `showView()` manages the main session views. Subagent selection needs separate read-only transcript and scroll state while the main session remains current for controls.
- `scripts/service.mjs` implements `session-history` and `follow-session` as local-board-only requests. Main history filters SDK messages with `parent_tool_use_id`; `transcriptLineEntries()` skips `isSidechain` JSONL lines. The follow loop polls a transcript file by byte offset, decodes complete JSONL lines, converts them to entries, and batches channel messages through `sendEntries()`.
- `scripts/agent-session-protocol.mjs` `normalizeNativeMessage()` handles `stream_event`, `assistant`, `user`, `tool_progress`, and `result` messages. `emitNative()` currently passes native messages through it. `trackStatus()` ignores parented assistant usage. Drop all native messages with non-null `parent_tool_use_id` before conversion, including stream deltas and tool progress. Subagent content comes from the transcript file. Top-level `result` messages that end the main turn do not carry a parent id, so they continue to end the main turn normally.
- The pinned SDK at `%LOCALAPPDATA%\Persephone\board-data\claude-agent\sdk\0.3.302\sdk.mjs` exports `listSubagents(sessionId, options)` and `getSubagentMessages(sessionId, agentId, options)`. Calling these with `{ dir }` returned agent-id strings and message arrays. Use `listSubagents()` for the list, but read the subagent JSONL directly for both replay and following: the follow loop needs that file, and a single conversion path avoids differences between SDK replay and file-follow entries.
- `findTranscript(sessionId)` resolves the main transcript as `<projects>/<project-key>/<sessionId>.jsonl`. Resolve subagent files relative to that exact result: `<dir of the main transcript>/<sessionId>/subagents/agent-<agentId>.jsonl`, with adjacent `agent-<agentId>.meta.json`. Validate `sessionId` with the existing `SESSION_ID` pattern and validate page-supplied `agentId` with `/^[A-Za-z0-9_-]{1,64}$/` before building any subagent path.
- Every line in a subagent transcript has `isSidechain: true`, and the first line is the parent's prompt represented as a `user` message. Therefore the subagent entry-conversion path must explicitly allow sidechain lines; the default main transcript conversion continues to reject them. Render the first user entry as a user bubble and render collapsed tool calls/thinking as in the main chat.
- Metadata contains `agentType`, `description`, `toolUseId`, `spawnDepth`, `requestShape`, and completion state. The `finished` lifecycle is verified: while an agent runs, metadata has no `finished` key; on completion, the CLI rewrites metadata with `finished: true`. A killed or crashed process can leave the key absent indefinitely. Show a pulsing running dot only when `finished` is absent and either the board runs that session live or the agent JSONL mtime is within about two minutes; otherwise show a neutral stopped/unknown dot. Metadata has no parent-id field, and sampled `parent_agent_id` values did not establish a nested parent mapping, so list agents as flat children of the root unless a reliable parent relationship is verified.
- `watchFor(channel, stop)` in `scripts/service.mjs` registers channel teardown. The existing `FOLLOW_INTERVAL_MS` is 1000 ms. Poll the selected session's subagents folder on that cadence; it may not exist until the first agent starts, so do not use another recursive `fs.watch` per session.
- `normalizeNativeMessage()` emits `tool-call` events with `callId: block.id`; the Agent/Task tool call id matches metadata `toolUseId`. This is sufficient to make a listed child selectable from its Agent/Task tool-call row.
- Existing session rows use `.session-item`, `.active`, `.session-dot`, `.live`, and `.busy` styles from `app.css`, with `--p-*` theme tokens. New page strings belong in `lang/en.json` and use the existing `i18n.js` helpers. Extend the existing `## 1.0.0` entry in `WHATS-NEW.md`; version 1.0.0 has not been released, so do not add a 1.0.1 entry or change `board-manifest.json`.

## Implementation Plan

- [x] Add local-board-only `watch-subagents` and `subagent-history` opening requests in `scripts/service.mjs`, refusing cross-board callers as `session-history` does. Validate `sessionId` with `SESSION_ID` and `agentId` with `/^[A-Za-z0-9_-]{1,64}$/` before constructing paths. Resolve the main file with `findTranscript(sessionId)`, then use `<dir of main transcript>/<sessionId>/subagents/agent-<agentId>.jsonl` and its `.meta.json` sibling. Use SDK `listSubagents()` for IDs and direct JSONL reading for replay and following.
- [x] Factor the byte-offset polling, complete-line parsing, batching, deletion handling, and teardown from `followSession()` into a reusable transcript follower. Use that follower for the validated subagent JSONL path as well as the main transcript. Add an explicit `allowSidechain` option (or equivalent dedicated converter) to `transcriptLineEntries()`; keep it false for the main transcript and true for subagent transcript lines, since all subagent lines are sidechains. Preserve the first parent-prompt user entry and the main chat's tool/thinking presentation.
- [x] Implement `watch-subagents` as a poll at `FOLLOW_INTERVAL_MS` cadence. Each poll discovers SDK agent ids and stats their metadata and JSONL; tolerate the folder not existing yet. Compare agent ids, `finished` state, and mtime-derived running state, and send a list update only when one of those changes. Register the polling timer and channel cleanup with `watchFor(channel, stop)`; do not add another recursive `fs.watch` per session.
- [x] In `emitNative()` (or at the top of `normalizeNativeMessage()`), drop any native message with a non-null `parent_tool_use_id` before conversion, including `stream_event` deltas, `assistant`, `user`, and `tool_progress`. Subagent views receive content from their transcript files, so no content is lost. Main `result`/turn-ended messages do not carry a parent id and must still update status and end the turn.
- [x] Add an Agents section after `#session-list` in `index.html`. In `app.js`, render it only when the selected main session has agents; use the main session title as root and each child's description plus agent type. Keep nesting flat unless a parent relationship is verified. Show a pulsing running dot only when `finished` is absent and (the board runs the main session live or the agent JSONL mtime is within about two minutes); otherwise use a neutral stopped/unknown dot. Highlight the chat currently shown.
- [x] Add tool-call navigation: when an Agent/Task tool-call row's `callId` matches a listed child's `toolUseId`, clicking the row opens that child transcript.
- [x] Extend app view handling so clicking a child loads/follows its read-only transcript, clicking the root or the hint's **Back to main chat** action returns to the main transcript, and selecting another main session resets to that session's root. Preserve the selected agent's independent scroll position. While a child is shown, replace the composer with a one-line localized hint and Back to main chat action; keep the footer, status line, and Interrupt button bound to the main session so Interrupt still works. Disable the slash-command menu in the subagent view. Do not persist subagent selection; after reload the restored main session opens at its root.
- [x] Add all new text to `lang/en.json` and render it through `i18n.js`. Add the capped, independently scrolling Agents tree and row states to `app.css` with `--p-*` tokens; retain the existing sidebar resize behavior.
- [x] Update the Chat page section in `boards/claude-agent/README.md` to describe the Agents tree, chat switching, status dots, and read-only subagent view. Extend the existing `## 1.0.0` entry in `boards/claude-agent/WHATS-NEW.md` with the subagents-panel change. Do not change `boards/claude-agent/board-manifest.json` or use version 1.0.1 because 1.0.0 has not shipped.
- [ ] Verify with a stored session, a terminal-followed session, and a board-run session that agent lists/history load and update; running, completed, and stale unfinished states show the correct dots; main chat excludes parented messages; and root/child/tool-call switching works. Check first user prompt rendering, tool/thinking presentation, scroll restoration, read-only controls, localization, and `ui.log`.

## Concerns / Open Questions

- No verified metadata or sampled message value linked a nested subagent to its parent. Keep the initial tree flat under the root unless implementation verifies a stable parent key.
- The `finished` lifecycle is verified, including the stale missing-key case. The two-minute JSONL freshness threshold is an operational cutoff from the design and should be checked against the live-session verification cases.

## Acceptance Criteria

- [x] The selected session's Agents tree appears only when it has subagents, with a selectable root and children; the node whose transcript is displayed is highlighted.
- [x] Subagent paths are derived from the main transcript returned by `findTranscript()`. Both session and agent ids are strictly validated before any subagent path is constructed.
- [x] Subagent JSONL replay and following share one conversion path that explicitly permits `isSidechain` lines; main transcript conversion continues to exclude sidechains. The parent's initial prompt appears as a user bubble, and tool calls/thinking use the main chat's collapsed presentation.
- [x] A running dot pulses only when metadata lacks `finished` and the board runs the session live or the agent JSONL was modified within about two minutes. Completed or stale unfinished agents show a neutral stopped/unknown dot.
- [ ] Main live output drops all non-null `parent_tool_use_id` messages before conversion, including stream events and tool progress; top-level result messages still end the main turn. Subagent content is read from its transcript file.
- [x] The subagents watcher polls at `FOLLOW_INTERVAL_MS`, tolerates a missing folder, sends list updates only when ids, finished state, or mtime-derived running state changes, and uses `watchFor()` for teardown.
- [x] Clicking a listed Agent/Task tool-call row opens its child when `callId` matches `toolUseId`.
- [x] Child selection shows a read-only transcript. The composer is replaced by a localized one-line hint with a Back to main chat action; the footer, status, and Interrupt control remain bound to the main session; slash commands are unavailable. Main-session switches reset to root and reloads reopen at root.
- [x] New UI text is localized and styles use `--p-*` theme tokens. Nested agents are placed under a parent only when that relationship is verified; otherwise they remain flat root children.
- [x] Extend the existing `WHATS-NEW.md` `## 1.0.0` entry; do not bump the manifest version.
- [x] `ui.log` is clean (no CSP violations).
- [x] Fully offline (no CDN / network).

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/scripts/service.mjs` | Add validated local page requests, subagent metadata/history, polling watcher, and shared transcript following. |
| `boards/claude-agent/scripts/agent-session-protocol.mjs` | Keep parented native messages out of the main live stream. |
| `boards/claude-agent/index.html` | Add the Agents section below the session list. |
| `boards/claude-agent/app.js` | Render agents and manage read-only subagent transcript selection/state and tool-call navigation. |
| `boards/claude-agent/app.css` | Style the capped tree section and agent row states with theme tokens. |
| `boards/claude-agent/lang/en.json` | Add localized Agents and read-only UI strings. |
| `boards/claude-agent/README.md` | Document the Agents tree in the Chat page section. |
| `boards/claude-agent/WHATS-NEW.md` | Extend the existing 1.0.0 changelog entry. |
| `doc/tasks/BT-047-claude-agent-subagents/README.md` | Record task scope, verified findings, plan, and open questions. |
| `doc/active-work.md` | Keep BT-047 listed under Active. |

## Notes

- SDK inspection used structural output only: `listSubagents()` returned agent-id strings and `getSubagentMessages()` returned message arrays. No local prompt or transcript content is recorded here.
- The verified `finished` lifecycle comes from a real background subagent observed while running and after completion. A process killed before completion leaves no `finished` key, so mtime and whether the board is running the session are also required to determine the displayed state.
- No implementation has been made as part of this task-document task.
