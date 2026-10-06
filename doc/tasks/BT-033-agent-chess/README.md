# BT-033: Agent Chess — play chess against the agent connected to Persephone

## Status

**Status:** Done — published as `chess` v1.0.0
**Priority:** Medium
**Board id:** `chess`
**Started:** 2026-10-07
**Completed:** 2026-10-07

## Goal

A board where the user plays chess against their own AI agent (Claude Code, Codex, … over
Persephone's MCP). The user moves with the mouse; the agent reads the position and moves through
the board's AiVision model at `pages[id].editor.app`. A showcase board for a Reddit post.

## Background

- AiVision authoring: `persephone/assets/guides/agents/ai-vision.md`; worked example
  `boards/todo/app.js` (descriptor, `expose`, `createElements`, `refresh`, `notify`).
- `remote.notify(text)` reaches the agent's event log (trusted boards, ≤512 chars, 5/min).
  The agent waits with `events.wait()` (≤110 s) — or with the board's own `waitForTurn()`.
- A member may declare `timeoutMs` (host honours it over the 30 s fallback).
- `persephone.state.init(defaults, { restorableKeys })` keeps the game across reload/restart.
- Libraries: chess.js 1.4.0 (BSD-2-Clause) for rules/SAN/PGN, wrapped as a classic script;
  Wikimedia "standard" pieces by Cburnett (CC BY-SA 3.0) from the cm-chessboard sprite.
  The Staunty set is CC BY-NC-SA — not used.

## Design (decided)

- Plain board, no file association, no permissions.
- UI: toolbar (New game as White / as Black, Flip, Take back, Copy PGN); board with
  click-to-move and drag, legal-move dots, last-move and check highlight, promotion picker,
  agent arrows; side panel with status, move list and a chat (agent `say()` + user messages
  forwarded to the agent with `notify`).
- Agent model `ChessGame`: `fen`, `ascii`, `turn`, `agentColor`, `isAgentTurn`, `status`,
  `legalMoves`, `history`, `pgn`, `lastMove`, `chat`; methods `move(san|uci)` (throws a readable
  error listing legal moves on an illegal or out-of-turn move), `say(text)`,
  `waitForTurn(seconds)`, `newGame(agentColor)`, `resign()`, `showArrows(moves)`, `clearArrows()`.
- Every user action the agent must react to (user move, user chat, new game, take back, game
  over) is sent with `remote.notify`.

## Implementation Plan

- [x] Manifest, base css, icon, vendored libs + licenses
- [x] index.html / styles.css / app.js (game, rendering, input, persistence)
- [x] AiVision model + notify
- [x] guides (index, agent), CLAUDE.md, WHATS-NEW.md, screenshot
- [x] Live test in Persephone: user move → notify; agent move/illegal move/say/arrows/wait;
      promotion, checkmate, take back, reload keeps the game

## Notes from live testing

- Persephone's MCP bridge cut every `.app` call at 30 s, ignoring both the per-call and the
  declared `timeoutMs`. Fixed in Persephone 5.0.8 as **US-1631**
  (`src/main/mcp/tools/call-tools.ts`, `remoteAppBridgeTimeout`). The board needs 5.0.8.
- A board method must not return `{ pending: true }`: the host reads it as its own "still in
  progress" marker. `waitForTurn` returns `{ timedOut: true }`.
- Fixed during testing: leaked drag ghosts (user saw extra knights), inverted square colours,
  the global `svg { fill: none }` rule hollowing black pieces, `<use>` replaced by cloned groups.
- Verified: user move → notify; illegal and out-of-turn `move()` errors; `say`, arrows; a
  60 s `waitForTurn` timeout; wake-up on a user move and on a chat message; checkmate and
  post-game errors; reload keeps the game; a 13-move game played live with the user.
- Not verified: the promotion picker (the scripted attempt collided with the user's live game).

## Acceptance Criteria

- [x] An agent with only the `.app` help can play a full game
- [x] Illegal or out-of-turn `move()` throws a clear error and changes nothing
- [x] Game survives a board reload
- [x] `ui.log` is clean; fully offline
