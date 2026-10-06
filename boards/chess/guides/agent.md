---
title: "Agent Chess for agents"
audience: agent
summary: "Play chess against the user through pages[i].editor.app: read the position, wait for the user's move, move with SAN, chat and draw arrows."
---

# Agent Chess for agents

The board publishes its game at **`pages["<id>"].editor.app`** (kind `ChessGame`). Find the
Agent Chess page in `pages`, read its `.app`, and play from there — never by clicking the board.

## The loop

```text
call pages["<id>"].editor.app                       → summary: agentColor, isAgentTurn, ascii, legalMoves, fen…
call pages["<id>"].editor.app.waitForTurn  args []  → returns when it is your move (or the game ended, or the user chatted)
call pages["<id>"].editor.app.move  args ["Nf6"]    → plays it; returns the new summary
call pages["<id>"].editor.app.say   args ["…"]      → a short comment in the board's chat
```

1. Read `agentColor`. If the user has not started a game the way they asked, call
   `newGame("black")` (or `"white"`) — the argument is **your** colour.
2. Call `waitForTurn()` (60 s by default, 105 s at most). It returns at once when it is your turn
   or the game is over, early with `userSaid` when the user wrote in the board chat, and otherwise
   `{timedOut: true, userIdleSeconds}`.
3. On your turn read `ascii` (White at the bottom, uppercase = White) and `legalMoves`, then call
   `move()` with SAN (`"e5"`, `"Nxd4"`, `"O-O"`, `"e8=Q"`) or from-to (`"g8f6"`, `"e7e8q"`).
4. Repeat until `status` is not `"playing"`.

## Waiting without blocking the user

The user can talk to you in two places: the board chat (reaches you as `userSaid`) and your own
conversation (terminal or chat window). While a `waitForTurn()` call runs, your own conversation
may not reach you, so:

- **Keep each wait short** — the 60 s default. Do not pass a long value to keep the turn alive.
- **After every timeout, answer the user's own messages first**, then wait again.
- **Do not wait forever.** When `userIdleSeconds` reaches about 300 (five minutes with no move or
  message), stop: `say()` that you have paused, end your turn, and tell the user to ask you to
  continue when they are back. Resume with `waitForTurn()` — a move made meanwhile is returned at
  once.

The board also sends a notification to your event log for every user move, chat message, take
back and new game, so `events.wait()` works too.

## Mistakes are safe

`move()` throws, and changes nothing, when the move is illegal or it is not your turn. The error
lists the legal moves and the FEN — pick one and call `move()` again.

## Members

| Member | Meaning |
|---|---|
| `status` | `"playing"`, `"checkmate"`, `"stalemate"`, `"resigned"` or a draw reason |
| `result` | `"*"`, `"1-0"`, `"0-1"` or `"1/2-1/2"` |
| `turn`, `agentColor`, `userColor` | `"white"` / `"black"` |
| `isAgentTurn`, `inCheck` | booleans |
| `fen`, `ascii`, `pgn` | the position and the game |
| `legalMoves`, `history` | SAN lists |
| `lastMove` | `{from, to, san, color, by}` |
| `chat` | the last 20 messages |
| `move(move)` | play your move |
| `say(text)` | chat message to the user |
| `waitForTurn(seconds?)` | wait for your turn: 60 s default, 105 s max; declared 115 s call timeout |
| `showArrows(moves)` / `clearArrows()` | draw `"e2e4"`-style or SAN arrows; they clear on the next move |
| `newGame(color)` | restart with you playing `color` — only when the user asks |
| `resign()` | resign |

Named elements: `board`, `status`, `moves`, `chat`, `chat-input`, `new-white`, `new-black`,
`takeback`, `resign` — use `highlight(name, message)` to point at one.
