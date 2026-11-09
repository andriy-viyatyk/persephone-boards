## 1.5.0
- Configure and review wake phrase enrollment in the Wake Word board.

## 1.4.3
- A wake request now ends when the speech provider stops producing text, instead of when the microphone goes quiet. On a machine with a loud fan the old test treated the fan as speech, so a request without a stop word never ended on silence and ran until the one-minute limit. The **Silence timeout** setting still sets how long a pause ends the request.

## 1.4.2
- A stop word is no longer required for Wake mode. Enrol just a wake word and each request ends after the quiet interval, as it already did. Enrol a stop word only if you also want to end a request by speaking — which is worth skipping if the stop phrase cuts you off mid-sentence.
- When Wake mode needs attention, the status line is now marked in amber with a border instead of reading like the ordinary status text, so it is not missed.

## 1.4.1
- The Codex engine now accepts Codex CLI 0.163.0 **or newer** instead of exactly 0.163.0, so updating the Codex CLI no longer greys out the engine.
- Agents no longer ask for confirmation before using Persephone's own tools, so a voice session can speak and open pages without a dialog each time. Shell commands and file changes still ask as before.
- Fixed: interrupting a Codex session when no turn was running sent an invalid request that failed silently.

## 1.4.0
- Added Wake mode for voice requests to a marked session.
- The wake session gets built-in voice assistant instructions, shown as a collapsed item in the chat, and they are added again after `/compact`.
- While a wake request listens, Persephone's own sound is muted so a playing film is not transcribed.
- Settings and Wake mode preferences are kept across Persephone restarts.
- Agents can list sessions, send messages to them and read the replies through AI Vision.
- Wake words tab: sample chips with delete buttons and a more compact settings panel.

## 1.3.3
- A **Cancel** button next to the agent's typing dots stops the running turn; it replaces the toolbar's hard-to-find Interrupt button.
- Session and agent list rows now hover and highlight like Persephone's file tree: the selected row is green with an outline while its list has focus, and gray otherwise.
- Send a follow-up message while the agent works, as in the terminal: Claude and Codex pick it up between steps of the running turn. It stays dimmed until the agent has it; Cancel puts a follow-up that has not been picked up yet back into the message box.
- Reworked Agent profiles into independently editable, collapsible panels with per-profile drafts and save handling.
- Added AI Vision access to read, create, update, duplicate, and delete saved Agent Chat profiles, with provider choices and permission effects described.
- Added per-agent message colors, including existing group chat history, with color choices in the profile editor.
- The Configure profile editor and AI Vision now share required-field and case-insensitive unique-name validation; profile deletion persists correctly.
- A joined agent that answers without calling `post_message` now has its reply shared in the group chat, as intended; before, the reply stayed in its own session.
- A joined agent's notice shows its model and effort.
- A joined agent no longer receives its own posts and join notice back, which cost it an extra turn each time.
- Click a joined agent's name in the main chat and choose **Remove from chat**. Removing an agent from the sidebar's right-click menu works again.
- Session status now reports the working state to Persephone.
- Voice recording continues while the board is hidden.

## 1.3.2
- When Claude asks you questions, the chat shows them with their options. Pick answers or type your own, then **Submit answers** or **Skip**.

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
