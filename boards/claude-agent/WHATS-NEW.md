## 1.3.1
- Interface languages: Belarusian, Chinese (Simplified), Estonian, French, German, Hungarian, Italian, Japanese, Korean, Latvian, Lithuanian, Polish, Portuguese (Brazil), Romanian, Slovak, Spanish and Ukrainian.
- Live dictation can stop automatically after the configured quiet interval once speech is committed.
- Voice input inserts committed live transcription segments as they arrive when the selected provider supports live transcription.
- Added **Connect**: resume a stored session without sending a message, from its right-click menu or from the **Send** button, which reads **Connect** while the message box is empty. The chips then show the session's model and context fill.
- A connected session shows a green dot just left of its icon in the sidebar.
- The microphone button's icon is centered when no recording time is shown.

## 1.3.0
- Added voice input through a trusted Speech to Text provider; installed users must accept the new microphone grant in the **Board permissions changed** prompt.

## 1.2.1
- Inviting an agent into a chat that is already running works again; before, only the first invite of a new chat went through.
- A Claude reply that mentions "login" is no longer shown as a `not-logged-in` error.
- The error panel takes at most 30% of the chat's height, scrolls, and has a close button.
- A joined agent that answers without calling `post_message` has its reply posted for it, so it no longer looks silent; an exact repeat of its last post is not shared again.
- Codex context usage shows the current fill instead of the thread's running total (which went past 100%), and a joined agent's view shows its context fill as soon as it opens.
- The README explains accounts and provider terms.

## 1.2.0
- Added group chats with invited Claude and Codex agents, shared visible messages, resumable participants, and role-based permissions.
- Added editable agent profiles, four shipped defaults, and one-click invitations from new, resumed, or live chats.
- Nested participant histories in the sidebar with read-only views, a restored group index, and provider-colored group icons.
- Added shared-folder permission warnings and participant approval cards for ask-capable profiles.
- The toolbar's **Instructions** button is now **Configure**: one dialog with Instructions and Agent profiles tabs.
- `/clear` keeps the chat's engine, model, and effort for the new session and deletes the chat it replaces.

## 1.1.0
- Renamed the board to Agent Chat, with a new icon; its board id remains `claude-agent`.
- Added Codex as a second selectable engine using the installed Codex app-server, with provider-specific models, efforts, permissions, instructions and saved sessions.
- Each session in the sidebar shows its engine icon (Claude or Codex) in its own color instead of a dot: muted when not running, bright when running.
- The session sidebar shows a spinner while the sessions load.

## 1.0.0
- Added the Claude Agent provider service, SDK consent flow, and a chat page with a recent-sessions sidebar, Markdown-rendered replies, and resumed-session history.
- Added a selectable Agents tree with read-only subagent transcripts and live status dots.
- Background-task notifications show as a collapsible Task line instead of a raw message.
- The New session form asks only for a working directory, with a folder button to pick it (none when started from a folder); sessions are named after their first words, and model and effort chips under the message box change them for new and running sessions. The context fill moved there too, at the right (click it for /context); the footer keeps the usage limits and token costs.
- Hovering a message shows Copy (plain text and formatted HTML) and Open in a new page buttons.
- A permission-mode chip before the model chip switches between Auto (the default for every new chat), Bypass, and Plan, also on a running session. Auto asks in the chat about calls its classifier cannot decide, and Plan ends with the plan as a card to approve (continuing in Auto or Bypass) or send back.
- While Claude works, a reply bubble shows typing dots instead of a status line above the message box.
