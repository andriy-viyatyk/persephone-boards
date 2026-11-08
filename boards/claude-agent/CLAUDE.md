# Agent Chat board notes

The board id and folder remain `claude-agent`.

Standalone provider board; it is not a custom editor and has no file association. The resident service implements the vendor-neutral `agent.session` v1 protocol and the local chat page uses the same service channel and protocol.

## Runtime design

- Wake mode requires an enrolled **wake** word only; the stop word is optional. A stop word merely cuts a
  request early, and a request already ends on the silence timeout without one, so the old both-enrolled
  gate refused a working setup — and declining a stop word is reasonable, since a stop phrase that
  false-matches mid-sentence truncates the request while silence cannot. `agent-stop` stays in the
  `wake.listen` request: the provider needs only ONE requested phrase to have enrollments, so a stop word
  enrolled later starts working without a code change.
- `wake-assistant.js` owns the page's wake controller, in-memory audio ring and request buffer, channels,
  transcription, stop cut, silence handling and turn lifecycle. `app.js` connects it to the marked session
  and owns the Wake words configuration UI. `scripts/service.mjs` owns the private local-only `wake-owner`
  lease channel; one page owns it until close, loss of trust or service exit.
- Tune the commented constants at the top of `wake-assistant.js` together: pre-roll, request hold-back,
  maximum request, default silence, no-speech timeout and interrupt wait. The hold-back is not a guarantee;
  a late stop before the sent position requires re-transcription of the cut buffer. Never persist request PCM.
- Page preferences in `claude-agent:*` localStorage use `wake-mode`, `wake-session` (`{provider,id}`),
  `wake-threshold`, `wake-silence` and `wake-device`. Storage events propagate preferences between pages;
  only the service lease arbitrates ownership. `app.js` caches the shipped `wake-instructions.md` and its
  SHA-256 version, and checks raw transcript user entries after the last compaction before each page prompt.
  It prepends a versioned apply or revoke block when needed. Show it in a separate collapsed disclosure before
  the user message, but omit the text from titles and AI Vision output; stored transcripts retain it. Marker changes do not reconnect sessions. Joined agents and cross-board callers
  do not receive the block. Group-chat transition prompts go directly to the main session to avoid broadcasting
  the block to joined agents.

- `scripts/agent-session-protocol.mjs` owns v1 validation, bounds, policy classification, and instruction composition.
- `scripts/service.mjs` owns provider-neutral contract validation, provider catalog/session aggregation, channel lifecycle, policy and approvals, provider-scoped instruction files, MCP endpoint revocation, watcher lifecycle, and child process cleanup. `scripts/providers/claude.mjs` owns Claude SDK/CLI integration, Claude session storage, native event normalization, model/mode metadata, and setup. `scripts/providers/codex.mjs` owns the installed Codex app-server JSON-RPC protocol, Codex thread store, event normalization, and Codex model/mode metadata.
- Providers are selected by the bounded `open.provider` id (default `claude`) from a closed registry. Keep provider-specific behavior behind the adapter boundary; descriptions publish capability flags and localized mode keys for the page.
- `scripts/sdk-install.mjs` downloads SDK 0.3.302 only after a local consent message and verifies both the archive SRI and the SDK entrypoint SHA-256. Do not vendor SDK files or add a package manager/build step.
- `scripts/claude-executable.mjs` resolves only the installed CLI. The SDK process spawn hook always launches that resolved executable.

Persephone's own MCP endpoint is **pre-approved for every session that gets one** (BT-095): Codex passes
`mcp_servers.persephone.default_tools_approval_mode="approve"`, Claude passes
`allowedTools: ["mcp__persephone__*"]`. The endpoint is private, per-session and token-scoped — this board
issues and revokes it — so prompting for it re-asks consent for the surface the session was opened on, and
an unattended wake session could not speak without a dialog. Before this, only a cross-board full-auto
session skipped the prompt while local page sessions did not, which is backwards. **Consequence to keep in
mind:** `cross-board-permission-ceiling` therefore gates native tools only, not Persephone MCP calls — and
that surface includes `execute_script`. Re-add `&& !session.crossBoard` in both providers to narrow it.

The page deliberately does NOT persist the chosen permission mode (`app.js:516`): every new chat starts in
Auto and `rememberSession()` keeps only `{ id, provider, cwd }`. Restoring an elevated mode would bring a
voice-triggered session back with approvals disabled. If that ever changes, scope it to the marked wake
session rather than every chat.

Claude local chat sessions retain their existing Claude Code mode behavior. Codex local sessions use the capability-described Auto, Full access, and Read only modes; Auto is `on-request` plus `workspace-write`. Cross-board contract modes and `cross-board-permission-ceiling` apply to both providers and must never be broadened by native policy.

Claude and Codex both ignore changed system/developer instructions on resume in model-visible history; the
page-level prompt block handles wake transitions without changing their open or resume protocols.

Codex is version-gated to CLI 0.163.0 **or newer** because its app-server protocol is experimental; the gate is a minimum, not an exact match, so a CLI update does not disable the engine. Verified against 0.167.0 from its own `codex app-server generate-json-schema` output: every request, parameter, response field, notification payload and approval decision this provider uses is present and unchanged. Raise `MIN_VERSION` only when the provider starts depending on something a newer CLI introduced. Start one `codex app-server --stdio` child per live session with the private MCP endpoint passed through `-c`; keep its bearer token only in the child's environment. The shared discovery process has no MCP configuration or token and is stopped after idle time. Codex supports its stored-thread list, paged history, rename, delete, and resume. It does not support transcript following, cost, rate limits, subagent panels, slash commands, or the MCP panel.

The service owns `instructions.md` for Claude and `instructions-codex.md` for Codex under the existing board-data directory. Preserve Claude's existing default text and file contents; compose environment, provider instructions, and caller instructions in the same order and with the same joiner. Do not add instruction settings to the manifest.

`session-history` is a board-page-only opening request (refused for cross-board callers, like `provider-setup`): it replays a stored transcript via the SDK's `getSessionMessages` as batched `history` messages (each batch under 600 KB) so the chat page can show a resumed session's earlier turns. It is not part of the `agent.session` v1 contract.

Follow-up messages ("steer", capability flag `steer`) are also board-page-only: a `send` with `steer: true` while a turn runs joins that turn; cross-board callers, slash commands, and a send without the flag still get `busy`, so the v1 contract is unchanged. The provider answers with page events `user-input { id, state: queued | delivered | next-turn | cancelled }` and, for Codex, `stream-reset` (a steer abandons reply text still streaming). A steer emits no `turn-started` and does not count toward `maxUserTurns`; when steers are still pending at a turn result, the provider holds that `turn-ended` (carrying its usage) so the page sees one turn. Claude pushes a uuid-stamped user message onto the live input stream; the CLI folds it in after the next tool result, or runs it as a follow-up turn when no tool boundary is left. The signals used — the untyped `command_lifecycle` frame, `result.user_message_uuids`, and `interrupt({ cancelQueued: true })` — are undocumented in the SDK 0.3.302 typings, so holding a turn has a timer fallback (`STEER_FOLLOW_UP_WAIT_MS`). Codex uses `turn/steer` with `expectedTurnId`; when Codex refuses (no active turn, review or compact turns) the text is held and starts the next turn. Cancel drops follow-ups the agent has not picked up and the page puts their text back in the composer. Group chat keeps its own queue-until-idle routing.

The chat page renders agent text with vendored marked 15.0.12 and DOMPurify 3.4.16 (`lib/`, see `lib/VERSION.txt`) and the catalog `markdown.css` skin; always sanitize marked output.

The SDK's `SpawnOptions` and `SpawnedProcess` declarations are from pinned version 0.3.302. Custom spawn replaces SDK default spawning; `ChildProcess` satisfies the declared process interface. `settingSources` is explicitly `user`, `project`, and `local`. The `PreToolUse` hook must remain enabled for every contract mode because native permission settings may auto-allow tools.

## Authoring and release

Keep browser CSP limited to local assets, use Persephone `--p-*` theme tokens, and localize page text with `i18n.js` and `lang/en.json`. Do not add `node_modules`, SDK code, a bundled package, or a build script. Increase `version` and add a matching `WHATS-NEW.md` heading for release changes. Capture the catalog screenshot in the running development app with synthetic content and no personal paths or data.

## Group-chat lifecycle

The local page opens the main session with service-owned `groupChat` identity metadata. `scripts/service.mjs` owns the four shipped agent profile defaults, profile validation and CRUD, invite-time participant snapshots, lifecycle, routing queues, local-only group index and participant observers, approval routing, and the shared token-gated loopback MCP endpoint. Profile and group data belong under `%LOCALAPPDATA%/Persephone/board-data/claude-agent/group-chat/`; replace the unreleased `roles.json` with `profiles.json` without migration. Never persist a participant bearer token. Keep every profile field on the participant snapshot so edits or deletion do not change existing participants.

The main session owns the live participant lifetimes, and closing or shutting down it must deny pending participant approvals, revoke endpoints, close observers, and stop child sessions while retaining resumable participant ids. Only user messages, main final replies, explicit `post_message` calls, and a joined agent's final reply from a turn that posted nothing (unless it is `[[pass]]`) enter the shared timeline; an exact repeat of a participant's last post is dropped. Preserve separate provider transcripts and only decorate history at the provider boundary. Participant transcript views read stored history without starting a session; attach the local observer only when both parent and participant are already live. The group index exposes only sidebar fields and must remain local-page-only. Ask-capable approvals resolve through the owning participant's pending approval map; read-only requests remain denied. Keep profile editing, one-click invite, nested read-only participant rows, approval cards, and group icon behavior within this board.

## AI Vision sessions

The exposed `AgentChat` model combines profiles with `sessions`, `send(sessionId, text, options?)`, `messages(sessionId, options?)`, and `waitIdle(sessionId, timeoutMs?)`. Session sends reuse the wake resume path without changing selection or wake marker; they need no opt-in, because an agent can already drive the board through browser automation; this is the direct route. The send options are `provider`, `speaker`, `wait` (default true), and `timeoutMs` (default 300000); messages accepts `provider` and `limit`. Preserve per-session turn/error tracking and unread behavior.
