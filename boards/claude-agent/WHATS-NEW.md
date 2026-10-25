## 1.1.0
- Added Codex as a second selectable engine using the installed Codex app-server, with provider-specific models, efforts, permissions, instructions and saved sessions.
- Each session in the sidebar shows its engine icon (Claude or Codex) instead of a dot: gray when not running, green when running.

## 1.0.0
- Added the Claude Agent provider service, SDK consent flow, and a chat page with a recent-sessions sidebar, Markdown-rendered replies, and resumed-session history.
- Added a selectable Agents tree with read-only subagent transcripts and live status dots.
- Background-task notifications show as a collapsible Task line instead of a raw message.
- The New session form asks only for a working directory, with a folder button to pick it (none when started from a folder); sessions are named after their first words, and model and effort chips under the message box change them for new and running sessions. The context fill moved there too, at the right (click it for /context); the footer keeps the usage limits and token costs.
- Hovering a message shows Copy (plain text and formatted HTML) and Open in a new page buttons.
- A permission-mode chip before the model chip switches between Auto (the default for every new chat), Bypass, and Plan, also on a running session. Auto asks in the chat about calls its classifier cannot decide, and Plan ends with the plan as a card to approve (continuing in Auto or Bypass) or send back.
- While Claude works, a reply bubble shows typing dots instead of a status line above the message box.
