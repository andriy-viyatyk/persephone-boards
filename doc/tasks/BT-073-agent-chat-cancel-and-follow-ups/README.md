# BT-073: Agent Chat — in-chat Cancel and mid-turn follow-up messages

## Status

**Status:** Done
**Priority:** Medium
**Board id:** `claude-agent`
**Started:** 2026-11-02
**Completed:** 2026-11-02

## Goal

Work like the Claude Code terminal: stop the agent from inside the chat, and send a follow-up message while the
agent works, so the agent picks it up between tool calls in the same turn.

## Background

- **Cancel (done first, same task).** The toolbar's Interrupt button was not discoverable. It is replaced by a
  **Cancel** button in the typing bubble (`●●● Cancel`), shown while the shown session is busy. While reply text
  streams or an approval waits, only Cancel shows. No Escape shortcut: the user does not want an accidental stop.
- **Today a send during a turn is refused.** `providers/claude.mjs` `handleSessionMessage` replies `busy`; the page
  disables Send while busy (`app.js` `updateControls`, composer submit). Group chat already queues user text until
  the main session is idle (`service.mjs` `queueGroupText` / `flushGroupQueue`) and keeps that path.
- **Spike (2026-11-02) — both engines can steer a running turn:**
  - **Claude** (SDK 0.3.302, CLI 2.1.316): a user message pushed onto the live `inputQueue` with a `uuid` and no
    `priority` is folded in after the next tool result of the running turn; one `result` lists it in
    `user_message_uuids`. With no tool boundary left, it runs as a second turn with its own `result`. The CLI emits
    an untyped `command_lifecycle {command_uuid, state: queued|started|completed|cancelled}` frame.
    `Query.interrupt({ cancelQueued: true })` (runtime-supported in 0.3.302, missing from `sdk.d.ts`; CLI capability
    `interrupt_cancel_queued_v1`) cancels queued messages and lists them under `cancelled`; a plain interrupt
    lets them run afterwards.
  - **Codex** (0.163.0): `turn/steer {threadId, input, expectedTurnId, clientUserMessageId?}` adds input to the
    active turn; it fails with a turn-id mismatch, with no active turn, or with `activeTurnNotSteerable` during
    review/compact turns. A steer during streamed reply text abandons that `agentMessage` item (never completed),
    and the model writes the reply again.
  - Also found: `codex.mjs` never stores the turn id, and sends `turn/interrupt` without the required `turnId`.

## Design

- **Board-page only.** A `send` with `steer: true` while busy is accepted only from the board's own chat page
  (`!session.crossBoard`); cross-board `agent.session` v1 callers keep the `busy` refusal, so the published
  contract and the Persephone `agent-session` guide are unchanged. Slash commands are never steered (`busy`).
- **Capability flag** `steer: true` on both providers; the page enables Send while busy only when it is set.
- **New page event** `user-input { id, state }` (echoes the steer request id):
  `queued` (accepted, not yet seen) · `delivered` (the agent has it) · `next-turn` (runs after the current reply) ·
  `cancelled` (dropped; the page puts the text back in the composer).
- **One logical turn.** A steer emits no `turn-started`; if steers are still pending when a `result` arrives, the
  provider holds back that `turn-ended` (summing usage) and the session stays busy until the follow-up turn ends.
  Steers do not count toward `maxUserTurns`.
- **Cancel drops queued follow-ups.** Claude interrupts with `cancelQueued: true`; Codex drops its local queue.
  The page restores cancelled text into the composer.

## Implementation Plan

### Cancel (done)
- [x] `app.js`: Cancel button inside the typing bubble; `quiet` state while streaming/approval; toolbar catalog fixed.
- [x] `app.css`: typing bubble layout and quiet state. Lang files: drop the unused `interrupt` key.

### Claude provider (`scripts/providers/claude.mjs`)
- [x] `CAPABILITIES.steer = true`.
- [x] `userMessage(text, uuid)` stamps `uuid`; session gets `steers: Map<uuid, { requestId, delivered, nextTurn }>`,
      `carryUsage`, `steerTimer`.
- [x] `send` while busy: refuse with `busy` unless `request.steer === true`, not cross-board, and not a slash command;
      otherwise push the stamped message, record it, emit `user-input queued`. No `maxUserTurns` check for steers.
- [x] `emitNative`: handle `command_lifecycle` for our uuids (`started` → `delivered`, `cancelled` → `cancelled`);
      any native message clears the steer fallback timer.
- [x] On `turn-ended`: clear steers listed in `result.user_message_uuids`, already delivered, or flagged
      `nextTurn` (their turn just ended). Interrupted turn → remaining steers `cancelled`. If steers remain: flag
      them `nextTurn`, emit `user-input next-turn`, add the usage to `carryUsage`, skip the `turn-ended`, and arm a
      fallback timer that ends the turn if no follow-up turn starts (older CLI without fold reporting).
- [x] Interrupt: `query.interrupt({ cancelQueued: true })`; emit `cancelled` for every pending steer.

### Codex provider (`scripts/providers/codex.mjs`)
- [x] `CAPABILITIES.steer = true`; store `session.turnId` on `turn/started`, clear on `turn/completed`.
- [x] `turn/interrupt` passes `turnId`.
- [x] `send` while busy: refuse with `busy` unless steer (same rules as Claude). Steer → `turn/steer` with
      `expectedTurnId` and `clientUserMessageId`; success → `delivered` (plus `stream-reset` if an `agentMessage`
      item is mid-stream). Failure or no turn id → hold the text locally and emit `next-turn`.
- [x] `turn/completed`: interrupted → held texts `cancelled`; otherwise, with held texts, skip `turn-ended`, start the
      next turn with the joined texts, and emit `delivered`. A send that is refused by a non-busy session state
      flushes at once.

### Page (`app.js`, `app.css`, `lang/*.json`)
- [x] Send stays enabled while busy for plain text when `capabilities(view).steer` (not slash commands, not group).
- [x] `sendPrompt`: while busy, add the user bubble with class `queued` and send `{ type: "send", steer: true }`;
      keep `view.steers: Map<id, node>`; leave `commandTurn` alone.
- [x] `user-input`: `delivered` → un-dim; `next-turn` → keep dimmed, tooltip; `cancelled` → remove bubble and put
      the text back in the composer. `error` echoing a steer id → same as cancelled, plus the error.
- [x] `stream-reset`: drop the partial streaming node. `turn-ended`: settle any leftover steers (interrupted →
      cancelled, else un-dim).
- [x] CSS `.msg.user.queued`; one new localized string (queued tooltip) in all 18 languages.

### Docs
- [x] `boards/claude-agent/CLAUDE.md`: steer note (page-only, `user-input`, `stream-reset`, undocumented SDK bits).
- [x] `WHATS-NEW.md` 1.3.3 line.

## Concerns / Open Questions

- `command_lifecycle`, `priority`, and `interrupt({ cancelQueued })` are undocumented in the SDK types and could
  change with a Claude CLI update (the CLI is not pinned). The design uses them only as signals and falls back to
  `user_message_uuids` and a timer.
- A follow-up typed during one long tool call waits until that tool finishes — same as the terminal.
- Steering during a pending approval was not tested in the spike.

## Acceptance Criteria

- [x] Cancel in the typing bubble stops a running turn (Claude and Codex); no Interrupt button in the toolbar.
- [x] Claude: a follow-up sent during a multi-tool turn is followed in the same turn; one turn end, bubble un-dims.
- [x] Claude: a follow-up sent during a tool-less reply runs right after it; the session stays busy until done.
- [x] Codex: a follow-up sent during a command is followed in the same turn.
- [x] Cancel with a queued follow-up drops it and puts its text back in the composer.
- [x] Slash commands and cross-board callers still get `busy`; group chat behaves as before.
- [x] `ui.log` is clean.

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/app.js` | Cancel in typing bubble; steer sending and `user-input` handling |
| `boards/claude-agent/app.css` | Typing bubble Cancel; queued bubble |
| `boards/claude-agent/lang/*.json` | Drop `interrupt`; add queued tooltip |
| `boards/claude-agent/scripts/providers/claude.mjs` | Steer via the live input stream; held turn end; cancel-queued interrupt |
| `boards/claude-agent/scripts/providers/codex.mjs` | `turn/steer`; turn id; interrupt `turnId` |
| `boards/claude-agent/CLAUDE.md`, `WHATS-NEW.md` | Notes |

## Notes

- Verified live 2026-11-02 in the dev board (service restarted with `app.boards.stopService/startService`):
  Claude multi-tool turn with a mid-turn follow-up (folded, one turn); Claude tool-less reply with a follow-up
  (ran as the next turn, held as one turn); Cancel with a queued follow-up (dropped, text back in the composer,
  no extra turn); Codex command turn with a follow-up sent while an approval card was pending (steered, same turn).
- Fix found in testing: a follow-up answered as a next turn streamed into the previous reply's bubble. The page now
  ends the current reply bubble when a follow-up is `delivered`, so the answer starts below the follow-up.
- Not covered live: Codex `stream-reset` (steer during streamed reply text) and the fallback timer (needs an older CLI).
