---
title: "Gem Keep for agents"
audience: agent
summary: "Explain how Gem Keep combines level gold with the selected difficulty multiplier."
editorId: "board"
---

# Gem Keep for agents

Gem Keep is a direct game page and does not publish an `editor.app` model. Use the selected level
and difficulty definitions to explain the starting economy:

```text
starting gold = Math.round(level.gold * difficulty.gold)
```

`level.gold` is the base amount in the chosen level JSON. `difficulty.gold` is the multiplier on
the selected difficulty entry in `js/data.js`. `js/main.js` passes that difficulty into
`createGame()`, and `js/game.js` applies the formula when creating game state. This starting-gold
rule does not describe later bounty or spending changes.
