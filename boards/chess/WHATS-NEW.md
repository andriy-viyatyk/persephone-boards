# What's new — Agent Chess

## 1.1.0
- Interface text moved to a language pack (`lang/en.json`) so the board can be translated; requires Persephone with board bridge 1.36.0.
- First release: play chess against the AI agent connected to Persephone. The agent plays through
  the board's model (`move`, `waitForTurn`, `say`, `showArrows`); illegal moves are rejected with
  the list of legal moves. Drag or click to move, promotion picker, take back, resign, flip, PGN
  copy, and a chat with the agent. The game survives reloads.
