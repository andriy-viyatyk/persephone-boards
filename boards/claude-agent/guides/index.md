---
title: "Agent Chat"
audience: both
summary: "The Agent Chat board: chat with the installed Claude and Codex CLIs, and how an AI assistant drives its sessions and profiles."
editorId: "board"
---

# Agent Chat

Agent Chat is a Persephone **board** for chatting with the agent CLIs installed on your computer:
Anthropic's **Claude** CLI and OpenAI's **Codex** CLI. You need at least one of them installed and
signed in; without one, starting a chat shows a message saying so.

Sessions are resumable: the board lists your earlier Claude and Codex sessions and continues them.
Saved profiles (a role, instructions, model and permission mode) let you start a chat with the same
setup each time.

The board keeps its own data (group chats, instruction files and the Claude SDK it downloads with
your consent) in the Persephone profile's board data folder, for the default profile
`%LOCALAPPDATA%\Persephone\board-data\claude-agent`.

## For agents

The model and every method are documented in
[Agent Chat for agents](./agent.md).
