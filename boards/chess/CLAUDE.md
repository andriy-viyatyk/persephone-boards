# Agent Chess — author notes

The user plays chess with the mouse; their AI agent plays through the AiVision model at
`pages[id].editor.app` (kind `ChessGame`). Task document: `doc/tasks/BT-033-agent-chess/README.md`.
Agent-facing reference: `guides/agent.md`.

## Files

| File | Role |
|---|---|
| `app.js` | Everything: game state, rendering, pointer input, persistence, the AiVision model. |
| `lib/chess.js` | chess.js 1.4.0 (BSD-2) wrapped as a classic script → `window.Chess`. See `lib/VERSION.txt`. |
| `lib/pieces.svg` | Wikimedia/Cburnett pieces (CC BY-SA 3.0), from cm-chessboard's sprite. Loaded with `fetch` and injected hidden; each piece is a **deep clone** of its `<g id="wk">`… group. |

## Rules that matter

- **Persisted state** is one restorable `persephone.state` key, `game`: `{ moves: SAN[], agentColor,
  resigned, chat, flipped }`. The Chess object is rebuilt by replaying `moves`.
- **Agent wake-up:** every user action the agent must answer calls `remote.notify(...)` (≤512
  chars, 5/min) and wakes pending `waitForTurn()` promises. `waitForTurn` declares
  `timeoutMs: 115000`; it needs Persephone 5.0.8, whose MCP bridge no longer cuts `.app` calls at
  30 s. Its timeout result is `{ timedOut: true }` — **never return `pending: true`** from a board
  method: the host treats that as its own "still in progress" marker and drops the rest.
- **Waiting etiquette** (in `$help` and `guides/agent.md`): short waits (60 s default), answer the
  user's own conversation after each timeout, and pause after ~300 s of `userIdleSeconds`
  (reset by every user move, chat message, take back, resign or new game) so the agent never
  holds the user's terminal hostage.
- **Square colour:** `(fileIndex + rank) % 2 === 0` is light (a1 dark, h1 light).
- **Drag:** the floating `#ghost` piece is created only after the pointer moves 4 px and is removed
  on up/cancel/lost capture/blur. A plain click selects; a second click on a target moves.
- `move()` validates turn and legality and throws a readable error listing legal moves; nothing
  changes on error.
- Square colours are fixed classic colours (like a picture); UI chrome uses `--p-*` variables.

## Testing

`page.editor.click('[data-sq="e2"]')` then `'[data-sq="e4"]'` plays a user move with trusted
clicks. `page.editor.drag` does not work (it replays HTML5 drag, the board uses pointer events).
