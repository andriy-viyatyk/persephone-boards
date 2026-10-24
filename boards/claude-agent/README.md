# Claude Agent

Claude Agent provides the `agent.session` v1 service and a local chat page backed by your installed `claude` CLI.

## Requirements and first run

- Install the `claude` command line application and sign in through its normal login flow.
- Open the board, review the SDK download notice, and choose **Accept and download**. It downloads `@anthropic-ai/claude-agent-sdk` 0.3.302 from `registry.npmjs.org`, verifies the pinned SHA-512 digest before extraction, and stores the SDK under `%LOCALAPPDATA%\Persephone\board-data\claude-agent\sdk\0.3.302`. The SDK is not included in this board's files.
- Use of the SDK and CLI is subject to Anthropic's legal agreements.
- Choose a working directory, then type your first message to start a session. The empty model and effort choices preserve the CLI defaults.

## Chat page

The left sidebar lists your recent Claude sessions as a two-level tree: each working folder is a collapsible node, folders are ordered by their most recent session, and sessions inside a folder are newest first. The filter box matches session titles and folder paths. Hover a folder and click **+** to start a new session there. The start form has a **Session name** field (prefilled with "Default"); the name is saved as the session's title after its first reply, and clearing the field falls back to the usual title from the first message. Right-click a session for **Rename** (saved as the session's custom title in its transcript) or **Delete** (after a confirmation, removes its transcript from disk; an open session is closed first). Drag the sidebar's right edge to resize it (double-click resets); the width is remembered. On load only the most recent folder is expanded. Selecting one replays its stored conversation and keeps following it, so turns written by another process (Claude Code in a terminal, for example) appear as they happen; the board resumes the session with a Claude process of its own only when you send a message from it. The list itself refreshes when stored transcripts change. The page reopens the selected session after a reload, an app restart, or a move to another window; **New session** in the page toolbar returns to the start form. The toolbar also shows the open session's folder, an **Instructions** button, and, during a reply, **Interrupt**. **Instructions** opens an editor for the provider instructions added to Claude's system prompt: the board ships a default, your saved text replaces it (stored in `%LOCALAPPDATA%\Persephone\board-data\claude-agent\instructions.md`), and **Reset to default** restores the board's text. Saved changes apply to sessions started or reopened afterwards; a connected session keeps the instructions it started with. Your messages appear on the right and the agent's replies on the left, rendered as Markdown (sanitized; raw HTML is not trusted). Tool calls, thinking, and notices appear as collapsible lines between messages. The message box grows with its text; Enter adds a new line and Ctrl+Enter sends.

### Slash commands

Type `/` at the start of the message box to list the session's commands: skills, plugin and custom commands, and Claude Code's built-in ones. Arrow keys move through the list, Tab completes the name, and Enter runs a command that takes no arguments (or completes one that does). The list comes from the live session and is cached for the next time the board is not connected. Most commands are sent as a message, exactly as typed, and run the way they do in the terminal: `/compact` shows a "Conversation compacted" line with the token counts and a collapsed summary, and commands that print output (`/usage`, `/context <args>`, `/effort <level>`, and others) show it in a box under the command. `/model <name>` and `/effort <level>` typed with an argument also update the footer.

The terminal draws its own screens for a few commands; the SDK has none, so the board handles these itself (marked **board** in the list):

- `/mcp` lists the session's MCP servers with their state, scope, transport, and tools, with **Reconnect**, **Disable**/**Enable**, and **Authenticate** for servers that need sign-in (it opens the sign-in page; press **Reconnect** afterwards). The panel refreshes itself while open, since claude.ai connectors appear a few seconds after the session starts.
- `/model` (and `/effort` with no argument) switches the session's model directly and offers the effort levels the current model supports; picking one runs `/effort <level>` in the chat. On the New session form it focuses the model picker instead.
- `/context` shows what fills the context window as a stacked bar and a table by category, with the auto-compaction threshold and the memory files and MCP tools that use tokens.
- `/clear` returns to the start form with the same folder, ready for a new session.
- `/rename` with no argument opens the rename dialog.

These panels need a session the board runs: on a selected session that the board is only following, they resume it first, as sending a message does. A stored session's history shows its commands, compaction, and the summary it continues from; the output of local commands such as `/usage` is not part of the stored history the SDK returns, so it appears only live.

Persephone's footer bar shows the session's model and effort, how full the context window is, your plan's 5-hour and 7-day usage-limit percentages (hover for reset times), and the last turn's tokens and cost with the session's running total. Context and limit values turn highlighted at 70% and red at 90%. Values appear once Claude reports them, usually after the first reply.

The installed SDK file is hash-checked each time it loads. A missing or modified file returns the board to the consent and download flow. Discovery (`describe`) remains available without the SDK; listing or opening sessions requires it.

## Permissions and network behavior

The board asks for `service` and `appScripting`. `service` runs its resident Node process and launches the installed CLI with your account privileges. `appScripting` is required to issue an optional private Persephone MCP endpoint; that endpoint gives the associated Claude session full control of Persephone. Each session gets its own endpoint, and it is revoked when the session ends. Sessions started from this board's own chat page have no permission modes: they run unrestricted, without approval prompts, so Claude can edit files, run commands, and use Persephone freely. Only sessions opened by other boards through the `agent.session` contract use permission modes. Cross-board calls are clamped by the configured permission ceiling, which defaults to `read-only`.

Manifest `network` stays disabled. The board's Node module service downloads the pinned SDK directly from npm only after consent; that Node process can access the network independently of bridge networking. The board never reads CLI credential files or handles login tokens. It relies on the unmodified installed CLI and its existing login.

Configure the executable override, model, effort, and the cross-board ceiling in **Settings → Editors → Claude Agent**; edit provider instructions with the toolbar's **Instructions** button. The service reads these itself; consumer boards' messages cannot replace the provider instructions or the ceiling.

## Privacy

Prompts, working-directory content, and tool activity are handled by the installed CLI as part of its normal operation. The board sends bounded event summaries to a connected consumer and never sends file contents in `file-change` events. SDK files are kept in user data and are not written into or shipped with the board.
