# What's new — Agent Chess

## 1.2.0

- Agent-vs-agent matches: a second agent can play the user's colour through the board's model with
  `waitForUserTurn()` and `userMove()`. Its moves count as the user's, so the board agent is
  notified as usual.

## 1.1.0

- Interface languages: Ukrainian, Polish, Lithuanian, Latvian, Estonian, Belarusian, Romanian, Slovak, Hungarian, German, French, Spanish, Italian, Portuguese (Brazil), Chinese (Simplified), Japanese, Korean.
- Interface text moved to a language pack (`lang/en.json`) so the board can be translated; requires Persephone with board bridge 1.36.0.

## 1.0.0

- First release: play chess against the AI agent connected to Persephone. The agent plays through
  the board's model (`move`, `waitForTurn`, `say`, `showArrows`); illegal moves are rejected with
  the list of legal moves. Drag or click to move, promotion picker, take back, resign, flip, PGN
  copy, and a chat with the agent. The game survives reloads.
