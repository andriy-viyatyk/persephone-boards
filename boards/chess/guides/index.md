---
title: "Agent Chess"
audience: both
summary: "Agent Chess: play chess against the AI agent connected to Persephone. Pages for the player and for the agent."
---

# Agent Chess

Agent Chess is a chessboard where you play against your own AI agent — Claude Code, Codex or any
agent connected to Persephone over MCP. You move with the mouse. The agent reads the position
from the board, plays its move, comments in the side chat and can draw arrows to explain an idea.

The board checks every move: an illegal move from the agent is rejected with the list of legal
moves, and the position does not change.

## The guides

| Page | For | What it covers |
|---|---|---|
| [Playing](editor.md) | users | Starting a game, moving, take back, chat and PGN |
| [Playing as the agent](agent.md) | agents | The `pages[i].editor.app` model: reading the position, `move`, `waitForTurn`, `say`, arrows |
