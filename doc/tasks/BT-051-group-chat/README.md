# BT-051: Group chat in Agent Chat

## Status

**Status:** In Progress
**Priority:** High
**Board id:** `claude-agent`
**Started:** 2026-10-25
**Completed:**

## Goal

Implement the EPIC-131 / US-1708 group-chat feature in the existing Agent Chat board. A chat has one Master session and optional invited peer sessions; every participant receives the same visible timeline, while tool traffic and invited agents’ unposted replies remain private to their own transcripts.

## Background

- Design authority: [Persephone EPIC-131, Phase 2 — group chat inside Agent Chat](C:/projects/persephone/doc/epics/EPIC-131.md), including the 2026-10-25 redesign notes. This plan follows its decisions: no separate board, user-only invites, editable board-level roles, names/positions in core instructions, visible-message fan-out only, read-only default role permission, group icon, and instruction-first loop control. No hop limit is planned unless manual verification demonstrates one is needed.
- Contract authority: [agent-session.md](C:/projects/persephone/assets/guides/agents/agent-session.md), `agent.session` v1. `open.instructions` is caller layer 3; `send` injects a user turn; provider events include `text`, `text-delta`, `turn-started`, `turn-ended`, `approval-request`, and `history`. This task keeps the contract version at 1 and implements group behavior inside the board service and local UI.
- Bridge references: [boards.md](C:/projects/persephone/assets/guides/agents/boards.md), sections “Declared services and shared storage” and “Channels.” The utility process can use Node built-ins, local networking, and `persephone.storage`; the service must not open the bridge’s `store.json` directly. `persephone.service.openChannel()` creates an ordered two-way streaming channel; both ends expose `onMessage`, `onClose`, `close`, `writable`, and `whenWritable()`, with 256 messages in flight per direction. Either end closing releases it. The current board manifest already grants `service` and `appScripting`; do not add a cross-board `uses` connection.
- Current service storage: `scripts/service.mjs` already stores provider instruction files under `%LOCALAPPDATA%/Persephone/board-data/claude-agent/` using Node `fs/promises` (`instructionsFile`, `readInstructions`, `manageInstructions`). Store role configuration and per-chat participants JSON alongside these files in a `group-chat/` subdirectory, not in the board installation and not in the bridge-owned `store.json`. Use atomic temp-write + rename. Keep role data service-owned and expose bounded request operations to the frame.
- Shared MCP verification: Claude `sessionOptions()` in `providers/claude.mjs` already attaches Persephone as HTTP MCP with `{ type: "http", url, headers }`. The installed Codex app-server schema accepts arbitrary `thread/start.config` keys, and `JsonRpcProcess.start()` already configures an HTTP MCP server with a bearer token from the child environment. Use one loopback, token-gated Streamable HTTP MCP endpoint for both engines, with a distinct bearer token bound to each participant. The endpoint derives identity from the token; the tool accepts no identity argument. There is no concrete Claude transport limitation requiring an in-process SDK server, so do not add one.
- Codex app-server verification: `codex app-server generate-json-schema --experimental --out $env:TEMP/bt051-codex-schema` completed using the installed Codex CLI (the adapter gates 0.163.0). The generated `thread/start` params schema permits an arbitrary `config` map (`additionalProperties: true`); it does not validate nested MCP fields. Existing `JsonRpcProcess.start()` demonstrates the installed CLI's HTTP MCP URL and `bearer_token_env_var` config, with the token passed only through the child environment. Chosen delivery: create a separate board-hosted, loopback-only, token-gated MCP HTTP endpoint per invited Codex session and put `mcp_servers.agent_chat` in that participant's `thread/start.config`; use a participant-specific environment variable for the bearer token. The endpoint maps the secret token to the participant record; `post_message` has no participant/name parameters. Do not overload the existing Persephone MCP endpoint, which exposes app tools rather than board group-chat posting.
- Existing service behavior in `boards/claude-agent/scripts/service.mjs`: channel ownership and dispatch are in `persephone.service.onChannel`, `bindSession()`, `closeSession()`, and `dispatchSession()`; `boards/claude-agent/scripts/providers/claude.mjs` owns an `AsyncQueue` user-input stream and emits normalized `turn-ended` events from `emitNative()`; `boards/claude-agent/scripts/providers/codex.mjs` receives `turn/started` and `turn/completed` in `onNotification()` and sends user turns with `callTurn()`. Provider `busy` state is already maintained. Group routing belongs in the shared service so both providers get identical queueing and fan-out behavior.
- Existing UI behavior in `boards/claude-agent/app.js`: `createView()` keeps a view per open session, `addUserMessage()` / `addAgentMessage()` render messages, `loadHistory()` → `appendEntries()` reload history, `engineIcon()` builds engine markers, `refreshSessions()` → `renderSessions()` lists provider sessions, and `renderChips()` renders option chips. These are the extension points for group badges, participant filtering, and invite UI. Styling stays on existing `--p-*` theme tokens in `boards/claude-agent/app.css`; new visible text belongs in `boards/claude-agent/lang/en.json` and uses `boards/claude-agent/i18n.js`.

## Implementation Plan

### Group model, persistence, and service routing

- [x] In `boards/claude-agent/scripts/service.mjs`, add group-chat request validation and service-owned persistence helpers. Store `roles.json` and one `participants-<main-session-id>.json` per group under `%LOCALAPPDATA%/Persephone/board-data/claude-agent/group-chat/`. A role record is exactly `{ id, name, instructions, summary, permissionMode }`: `instructions` is the full layer-3 text for the joined agent; `summary` is the short description of its work and what it can be asked for. Participant records snapshot both `instructions` and `summary`, plus `name`, `role`, `engine` (provider id), `model`, `effort`, `sessionId`, stable role id, participant id, and main-chat id as routing metadata. Never persist MCP bearer tokens. Provide service operations to list/save/delete roles, list participants, add/remove a participant, and send/stop group turns. Bound names, roles, instructions, summaries, list sizes, and serialized file size; write files atomically.
- [x] Keep shipped role defaults (Reviewer, Critic, Researcher) in a service constant and materialize them when no user role file exists. Every default has both full `instructions` and a concise `summary`. Default text: Reviewer instructions: “Review the requested work, inspect relevant code or evidence, and report concrete defects, risks, and fixes. Do not make changes.” Summary: “Reviews work and identifies defects, risks, and fixes.” Critic instructions: “Challenge the proposal’s assumptions, look for counterexamples and failure cases, and explain where reasoning or evidence is weak. Do not make changes.” Summary: “Challenges assumptions and finds counterexamples.” Researcher instructions: “Investigate the question using available sources, distinguish evidence from inference, and report concise findings with source references. Do not make changes.” Summary: “Researches questions and reports evidence and sources.” User edits/deletes are persisted; deleting a role does not alter already invited participant snapshots. Validate permission mode against the board’s existing modes; the default is read-only.
- [x] Make a participant’s native channel and process live for as long as its parent group is live. `closeSession()` in `service.mjs` must close/revoke participant endpoints and children, remove the participant from live maps, and persist the remaining participant list. Filter participant session ids from the root sidebar list on initial load and every refresh so they do not appear as ordinary chats. Participant transcript ids are exposed only through parent group metadata; nesting/read-only participant views are BT-052.
- [x] On group reopen, read `participants-<main-session-id>.json`, resume each invited session through its adapter’s existing `open()` path with the saved session id, model, effort, cwd, and role text. If an engine transcript is missing or resume fails, surface a participant error and leave the main chat usable; do not silently create a new native session under the old identity.
- [x] Add a participant-aware queue per session in `service.mjs`. A user message, a Master final reply, or an invited agent post is stamped once, then appended to each recipient’s pending visible-message batch. If `session.busy` is true, retain the messages; on `turn-ended`, join the pending messages (in arrival order, each complete and header-prefixed) into one `send` user turn. Queues are in memory for v1 and may be lost if the chat/service closes before delivery. A post queued for busy Master appears live at post time but reaches Master’s transcript after its current turn, so history order can differ from live order; accept this for v1. Do not copy `tool-call`, `tool-result`, reasoning, approvals, or unposted invited-agent assistant text.
- [x] Route every ordinary user turn to Master and every invited participant. Slash commands (`view.commandTurn`) remain Master-only on the existing main channel and require Master idle. On invite, send the new participant a first turn containing the current visible timeline with stamped headers, then broadcast the join notice with the summary text; the main page receives it from `group-visible-message` and renders it once. On remove, stop and close that participant session and broadcast the leave notice. Add service-side Stop all to interrupt Master and every joined session. Use existing interrupt/close operations instead of introducing engine-specific UI calls.

### `post_message` tools and provider delivery

- [x] In `boards/claude-agent/scripts/service.mjs`, add one loopback-only Streamable HTTP MCP endpoint for joined participants from both engines. Require an unpredictable per-participant bearer token, map it to the server-owned participant record, expose only `post_message`, and revoke it when that participant/session closes. Bind only `127.0.0.1`; reject invalid Origin/Host combinations; never put tokens in a transcript, URL, CLI arguments, participant JSON, UI request, or logs. Implement the minimal stateless protocol surface: `POST` JSON-RPC `initialize` returns `{"jsonrpc":"2.0","id":id,"result":{"protocolVersion":supportedVersion,"capabilities":{"tools":{}},"serverInfo":{"name":"agent-chat","version":"1"}}}`; `notifications/initialized` gets HTTP 202 with no body; `tools/list` returns `{"jsonrpc":"2.0","id":id,"result":{"tools":[{"name":"post_message","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}}]}}`; `tools/call` accepts bounded `text` and returns `{"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":"Posted to group chat."}],"isError":false}}` (tool-level failure returns text content and `isError:true`; unknown method/tool uses a JSON-RPC error). JSON-RPC request responses use JSON; notification-only POSTs return 202. `GET` returns 405 with `Allow: POST` (no SSE stream), and `DELETE` returns 405 because the endpoint is stateless and issues no MCP session ids. Follow the [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) request/response rules.
- [x] In `providers/claude.mjs`, extend `sessionOptions()` to attach the shared endpoint using the already-supported HTTP form `{ type: "http", url, headers: { Authorization: "Bearer …" } }` alongside the existing Persephone server. In `providers/codex.mjs`, extend `startSession()` to include `config: { mcp_servers: { agent_chat: { url, bearer_token_env_var, default_tools_approval_mode } } }` in that participant's `thread/start` params. Set the bearer variable only in that participant's app-server child environment; the generated schema permits the top-level config map but leaves its nested MCP shape unchecked. Preserve the existing Persephone MCP configuration; ensure the discovery app-server child from `sharedServer()` receives neither group MCP config nor token.
- [x] Make `post_message` always allowed without approval for every permission preset on both engines. Enforce this at the board boundary: the endpoint accepts only the authenticated participant’s `post_message` call, independently of the role’s sandbox/tool permissions; the joined-session approval policy auto-approves exactly `mcp__agent_chat__post_message` (or the corresponding provider MCP tool identity) and rejects any other tool request outside the role preset. Configure Codex `mcp_servers.agent_chat.default_tools_approval_mode="approve"` per participant in addition to the per-session approval policy. Claude’s `canUseTool` approval callback must fast-path the board-owned `post_message` tool before creating an approval request, and its `PreToolUse` policy must allow this tool even in read-only mode. The installed Codex generated app-server schema models explicit command/file approval and MCP elicitation, not a distinct regular MCP-tool approval request; still set the MCP server’s per-tool approval mode and manually verify the call under `on-request` plus read-only. Requests outside the joined role preset are auto-denied with a clear message to the agent in BT-051; visible approval cards for roles that can request approval are BT-052.
- [x] Keep tool outputs local to the calling session. A valid post returns a small acknowledgement to the caller and broadcasts the board-stamped message through the visible group timeline. Invalid/expired tokens fail closed and cannot select another participant by arguments.

### Instructions, headers, turn capture, and history

- [x] In `boards/claude-agent/scripts/providers/claude.mjs`, `makePreamble()` builds Claude layer 1; in `boards/claude-agent/scripts/providers/codex.mjs`, layer 1 is the environment string passed to `host.composeInstructions()` in `startSession()`. Both currently call the board “Claude Agent”; rename that wording to “Agent Chat board” in the same edit. Keep `composeInstructions()` in `boards/claude-agent/scripts/agent-session-protocol.mjs` ordering environment → provider instructions → caller instructions, joined by two newlines. Add an immutable core to both environment preambles for every session, including solo: board identity, agent name (Master is fixed for v1), position (`main` or `joined`), that others may join, the exact header examples `[[from: Nova | role: Reviewer]]`, `[[from: user]]`, and `[[from: Master | role: main]]`, and the instruction to treat headers as author metadata; Master answers unless another agent is named and answers when addressed as Master, and may delegate work to a joined agent by asking it by name based on role summaries; joined agents follow layer-3 role instructions, post via `post_message`, answer only when named, and may stay silent. Do not list participants in the core because the roster changes after session creation.
- [x] For sessions opened after this feature, compose the core into layer 1 for solo and group sessions. Pass position/name as validated service-only open metadata, not user-authored text. On invite, pass the role’s full `instructions` as `open.instructions` (layer 3). For an older session upgraded into a group, do not try to read layer 1 back or detect session age: if the participants file did not exist before this first join, include a compact full-core-rules reminder for Master in that first delivered join notice. The first notice itself carries the reminder; no `groupRulesDelivered` detection flag is needed. A new invite’s first turn contains its name, joined position, role instructions, role summary, all current names/roles, and visible history so far.
- [x] Fix the one-line author header grammar at the service boundary: `[[from: Nova | role: Reviewer]]`, `[[from: user]]`, `[[from: Master | role: main]]`. Stamp user messages before delivery, invited posts inside the server-bound `post_message` handler, join/leave notices in the service, and Master’s final visible text in the turn-end fan-out path. Escape or reject `]`, newlines, and control characters in identity fields so a header always occupies exactly one line. Header text is prepended to the delivered message body, not accepted from agents as identity metadata. A join notice is `Agent Nova (Reviewer) joined` and its delivered body includes the role summary in full; UI renders the notice with the summary collapsed behind an expandable disclosure.
- [x] Capture only the main agent’s final reply text for a turn. Add provider-neutral per-turn text accumulation: `boards/claude-agent/scripts/providers/claude.mjs`, `emitNative()`, accumulates normalized assistant text/final streaming text until `turn-ended`; `boards/claude-agent/scripts/providers/codex.mjs`, `onNotification()`, captures completed `item/agentMessage` text, with deltas used only when no final item exists. At turn-end, stamp the final reply as Master, emit the canonical `group-visible-message` for the main page, and fan it out to joined participants. Provider inspection found Claude’s normalized user-message path emits tool results but not the input text (`boards/claude-agent/scripts/providers/claude.mjs`, `normalizeNativeMessage()`); Codex `onNotification()` emits `agentMessage` text but no `userMessage` item as a page message (`boards/claude-agent/scripts/providers/codex.mjs`). Ignore any echoed user-turn event if a future provider emits one. The page renders each visible user/post once from `group-visible-message`; the later Master transcript copy exists only for history reload. Never fan out partial deltas or any tool item/result.
- [x] Add history decoration at provider boundaries: Claude `sessionHistory()` and Codex `history()`/`normalizedItems()` should preserve visible user/post messages stored in the main transcript and add the Master header only for chats with a participants file, and only to the final agent text of each turn (never intermediate assistant text between tool calls). This synthesizes the header when native formats cannot store it on the assistant entry. Do not rewrite provider transcript files. Solo chats render exactly as today. The main transcript remains the source for reload; the participants file supplies roster/session metadata.
- [x] In `boards/claude-agent/app.js`, add one `parseAuthorHeader()` helper and use it from live rendering (`handleEvent()`, user and agent text paths) and history (`appendEntries()`). A header is recognized only at the start of a line. Split each user transcript entry on every recognized header line into consecutive visible messages; each segment gets its own author badge in history and live rendering, so an N-message queued batch reloads as N messages, not one bubble under the first author. Render parsed author as a badge with name, role/position, and engine icon/color from `state.descriptions`; strip raw header lines from rendered Markdown. Treat unrecognized or malformed lines as ordinary message text. Header parsing must not use HTML; continue routing message Markdown through `renderMarkdown()` and DOMPurify.

### UI, sidebar, permissions, localization

- [x] In `index.html` and `app.js`, add the **+ Invite agent** chip immediately after the effort chip. The panel opens above the input and contains role, prefilled name, engine/model, effort, and Add. Choose names in a built-in pool while skipping names in use and the fixed, non-editable v1 name “Master”; allow editing the prefill. A join notice is `Agent Nova (Reviewer) joined`, carries the full role summary in its delivered message, and displays that summary collapsed/expandable in the main UI. Add/remove operations show join/leave notices to all group participants.
- [ ] Add a board-level roles editor in `index.html` and `app.js` with add/edit/delete fields for name, full instructions, summary, and permission preset. Ship Reviewer, Critic, Researcher defaults with both instructions and summaries. All role operations go through the service; do not store role data only in browser localStorage.
- [x] In `app.js`, keep Send enabled for ordinary messages in a group while Master is busy; the service queues messages for busy recipients. Slash commands (`view.commandTurn`, including `/compact`) remain routed only to Master’s channel as today, require Master idle, are not stamped or fanned out, and never reach participants. Render the user’s own ordinary message exactly once from `group-visible-message`; do not also optimistically render it in `sendPrompt()`. There must be no live double-render path for user or participant posts. Add Stop all when a group is active; it interrupts every live participant and Master while keeping group metadata and transcripts resumable.
- [x] In `app.js`, update the existing Send disabled condition in the submit path around `view.busy` / `#send`: ordinary group messages stay enabled while Master is busy, but slash commands remain disabled until Master is idle. The service queue holds messages for any busy recipient.
- [x] In BT-051, if a joined agent requests a tool outside its permission preset, auto-deny it with a clear localized message to that agent so it cannot hang on an invisible approval. Visible approval cards under the participant badge are BT-052. Read-only is the role default.
- [x] Extend `refreshSessions()`/`renderSessions()` to filter participant native session ids from ordinary root rows on initial load and every refresh. Nesting them under the parent and read-only transcript views (history only; no prompt, send, or destructive actions) are BT-052.
- [ ] Make the main session row use a group glyph whenever its participant list is non-empty while preserving the main provider icon color and idle/live/busy state. Extend `engineIcon()` with a group variant that uses the same mask/color/state classes; solo rows remain unchanged. Keep normal participant session rows nested, with each participant engine’s own color for its author badge.
- [x] Update `boards/claude-agent/app.css` using only the existing Persephone theme variables and local styles; do not add fixed light/dark colors for UI surfaces. Add all new labels, notices, role defaults where user-visible, approval copy, and errors to `boards/claude-agent/lang/en.json`; do not hard-code user-facing English in `app.js`.
- [x] Update `boards/claude-agent/README.md` and `boards/claude-agent/CLAUDE.md` with the group-chat workflow and lifecycle. For the implementation release, add a concise matching heading to `boards/claude-agent/WHATS-NEW.md` and bump only `version` in `board-manifest.json`; existing permissions/settings need no change.

### Manual acceptance (no unit-test harness)

- [ ] From a fresh solo Claude session and a fresh solo Codex session, confirm the core layer-1 rules are present, then invite an agent of each engine and confirm the role text is visible as layer 3.
- [ ] Verify `post_message` works through the shared token-gated loopback HTTP MCP endpoint from Claude and Codex, without approval under each role preset; verify the service stamps the token-bound identity and ignores forged identity fields.
- [ ] Send a user message while participants are idle and while one is mid-turn; verify ordered batching into one later turn and that every participant receives the full visible message.
- [ ] Verify only final Master text and explicit invited-agent posts fan out. Tool call/result payloads, reasoning, approvals, and joined-agent unposted replies do not appear in other transcripts.
- [ ] Close and reopen a group chat; verify participant metadata resumes each existing engine session, history reconstructs headers/badges, and failed participant resume leaves Master usable.
- [ ] Verify participant sessions do not appear as root chats after load/refresh. BT-052 verifies nested read-only participant views and the group icon retaining the main engine’s color plus idle/live/busy states.
- [ ] Verify BT-051 join/leave, removing an agent, out-of-preset auto-denial, read-only default, Stop all, English localization, and theme-token UI. BT-052 verifies role CRUD and permitted approval cards under participant badges.

## Concerns / Open Questions

- **History format constraint (known, smallest-change plan specified):** provider transcripts are owned by Claude/Codex. Live delivery can stamp the header, but an assistant reply already stored in a native transcript may not contain that board prefix. The plan decorates final assistant history entries with the fixed Master header during `sessionHistory()` / `history()` normalization, without rewriting the provider transcript. Verify both providers return a stable final assistant text entry; if Codex only exposes incomplete item history, retain the participant-post timeline in the existing participants metadata and synthesize the main transcript view from both sources.
- **MCP HTTP details:** Claude already accepts the same HTTP MCP shape used by its existing Persephone server (`providers/claude.mjs`, `sessionOptions()`), and Codex `thread/start.config` is an arbitrary map in the generated schema. The shared endpoint is stateless and intentionally has no GET event stream or DELETE session lifecycle. If the installed Codex CLI rejects the documented `default_tools_approval_mode="approve"` MCP setting in implementation, validate the supported spelling with its installed config schema/help and use the smallest per-tool auto-approval hook; do not switch to a second transport.
- **Codex MCP approval behavior:** the generated app-server request schema exposes command/file approval and elicitation, but not a named regular MCP-tool approval request. `approvalPolicy: "on-request"` and read-only sandbox still need an installed-runtime manual check. Regardless, `post_message` must always be allowed without approval for all presets; service-side token-bound endpoint and exact-tool allow rule enforce this. All other requests beyond a participant preset are denied with a localized explanation in BT-051.
- **Joined-session permission enforcement:** `service.mjs` currently selects full-auto for same-board sessions in `selectPermissionMode()`, and Claude's `sessionOptions()` uses `canUseTool` to request approval while its `PreToolUse` hook currently bypasses local-page tools. Codex permission mapping uses `open.mode`. Smallest change: pass joined role mode into existing provider policy, auto-allow only `post_message`, auto-deny out-of-preset requests with a clear agent-facing message, and retain current Master local-page behavior. BT-052 adds visible approval cards for roles allowed to request approval.
- **Role edits after invite:** instructions are fixed in each native session by the v1 contract. Save both role `instructions` and `summary` snapshots with each participant; editing a board-level role affects future invites, while changing an existing participant requires remove/reinvite so the new layer 3 takes effect. Master is the fixed name for v1 and cannot be edited; the invite name pool skips it.
- **Session lifetime:** current session channels own live sessions: `bindSession()` closes the provider session when the page channel closes, while switching views keeps other view channels open; service shutdown closes all provider sessions. Durable participant ids allow resume after page or board close. Stop all should interrupt turns without deleting persisted participant sessions. The implementation must not promise background activity after the owning page/service exits.
- **Queue lifetime/order:** pending recipient batches are in-memory only and may be lost if the chat/service closes before delivery; accepted for v1. A busy Master’s transcript copy lands after its current turn even though the message was visible live at post time, so reload order can differ from live order; accepted for v1.
- **Scope:** BT-051 includes persistence, delivery, role snapshots, invite flow, participant-id filtering from the root sidebar, permission-safe `post_message`, and clear denials for joined requests outside the role preset. BT-052 retains sidebar nesting/read-only transcript views, roles editor, participant approval cards for ask-capable roles, group icon, and visual refinement. Each BT-051 acceptance item works without BT-052.


### Key seams (before → after)

**Live send and fan-out — `boards/claude-agent/app.js`, `sendPrompt()`; `boards/claude-agent/scripts/service.mjs`, `dispatchSession()`**

Before:

```js
async function sendPrompt(view, text) {
  view.commandTurn = text.startsWith("/");
  if (view.commandTurn) addCommandMessage(view, text); else addUserMessage(view, text);
  try { await channelSend(view.channel, { type: "send", id: crypto.randomUUID(), text }); }
  catch (error) { setViewError(view, error.message); }
}
```

After:

```js
async function sendPrompt(view, text) {
  view.commandTurn = text.startsWith("/");
  if (view.commandTurn) {
    addCommandMessage(view, text);
    await channelSend(view.channel, { type: "send", id: crypto.randomUUID(), text });
    return;
  }
  if (view.group) await groupRequest({ type: "group-user-message", mainSessionId: view.id, text });
  else {
    addUserMessage(view, text);
    await channelSend(view.channel, { type: "send", id: crypto.randomUUID(), text });
  }
}
```

For group chats, render the user's ordinary message once when the canonical `group-visible-message` arrives; do not optimistically render it in `sendPrompt()`. The service owns stamping and recipient routing; the UI does not choose author identity. Slash commands never enter the group route and keep today's Master-only behavior. `dispatchSession()` currently sends each session request directly to its adapter; after the change, the shared group router queues/batches visible messages and calls adapter sends only when the recipient is idle.

**Busy send control — `boards/claude-agent/app.js`, `updateControls()` and composer submit handler**

Before, `updateControls()` disables Send whenever `current.busy` is true; the composer submit callback also returns when `view.busy` (`app.js:883`, callback at `app.js:1382`). After, allow ordinary group messages through while busy, keep slash commands gated on Master idle, and queue ordinary messages in the service.

**Claude MCP — `boards/claude-agent/scripts/providers/claude.mjs`, `sessionOptions()`**

Before:

```js
...(session.endpoint ? { mcpServers: { persephone: { type: "http", url: session.endpoint.url, headers: session.endpoint.headers } } } : {}),
```

After (shape; preserve the existing Persephone entry):

```js
mcpServers: {
  ...(session.endpoint ? { persephone: { type: "http", url: session.endpoint.url, headers: session.endpoint.headers } } : {}),
  ...(session.participant ? { agent_chat: {
    type: "http", url: session.groupEndpoint.url,
    headers: { Authorization: `Bearer ${session.groupEndpoint.token}` },
  } } : {}),
},
```

The shared HTTP endpoint maps the per-participant bearer token to the participant; no identity is accepted from the agent. Claude's `canUseTool`/PreToolUse path fast-approves this exact MCP tool without approval for every permission preset.

**Codex MCP — `boards/claude-agent/scripts/providers/codex.mjs`, `startSession()` / `callTurn()`**

Before:

```js
if (this.endpoint) args.push("-c", `mcp_servers.persephone.url=${JSON.stringify(this.endpoint.url)}`, "-c", "mcp_servers.persephone.bearer_token_env_var=PERSEPHONE_MCP_TOKEN");
```

After (per-thread config map; token only in the participant app-server child's environment):

```js
const params = {
  cwd: open.cwd, model, approvalPolicy, sandbox, developerInstructions,
  config: participant ? { mcp_servers: { agent_chat: {
    url: groupEndpoint.url,
    bearer_token_env_var: "AGENT_CHAT_MCP_TOKEN",
    default_tools_approval_mode: "approve",
  } } } : undefined,
};
// Before starting this participant's app-server child:
env.AGENT_CHAT_MCP_TOKEN = groupEndpoint.token;
// shared discovery process receives neither group config nor token
```

```js
await session.rpc.request("thread/start", params);
```

The installed schema allows arbitrary keys in `thread/start.config` but does not validate the nested MCP shape. The service maps the endpoint token to one participant and accepts only `post_message(text)`. The MCP server approval mode plus the adapter's exact-tool policy makes this call approval-free for every preset.

**Layer 1 — Claude `makePreamble()` and Codex `startSession()`**

Before (current short environment lines):

```js
const environment = `You are running inside Persephone's Claude Agent board. Working directory: ${open.cwd}. Persephone MCP is ${mcpAttached ? "attached for this session" : "not attached"}. Your output is shown in a chat UI.`;
```

After: rename the product to “Agent Chat board” and append the immutable group core built from service-validated `name` and `position` for all new sessions, including solo. Continue passing it through `host.composeInstructions(provider, environment, open.instructions)`, which keeps the order layer 1 → provider layer 2 → caller/role layer 3. If no participants file existed before the first invite, that first join notice carries a compact full-core reminder for Master.

**History and author badges — `boards/claude-agent/app.js`, `appendEntries()` and `handleEvent()`**

Before:

```js
if (entry.role === "user") addUserMessage(view, entry.text + suffix, false);
else if (entry.role === "agent") addAgentMessage(view, entry.text + suffix);
```

After:

```js
const messages = splitOnStartOfLineAuthorHeaders(entry.text || "");
for (const message of messages) {
  if (entry.role === "user") addUserMessage(view, message.text + suffix, false, message.author);
  else if (entry.role === "agent") addAgentMessage(view, message.text + suffix, message.author);
}
```

`parseAuthorHeader()` recognizes a header only at line start; split every batched user entry into consecutive messages before creating bubbles in history and live handling. Provider history normalization supplies the Master header only for group chats (participants file exists) and only on each turn's final agent text. Solo transcript rendering is unchanged.

## Proposed split

1. **BT-051 — group chat service and delivery foundation (this task):** service persistence/role snapshots, participant lifecycle and resume, message queues/fan-out, shared HTTP `post_message` endpoint for Claude and Codex, provider turn capture, headers and transcript reconstruction, invite panel, root-sidebar participant-id filtering, and auto-denial of out-of-preset requests. Acceptance: both engines can join, post, receive user and Master final turns, resume, and stay hidden from root chats; shared messages show author badges after reopen.
2. **BT-052 — group management and sidebar polish:** nested/read-only participant transcript views, role editor, visible approval cards for requests allowed by the role preset, group icon state, and visual refinement. Acceptance: users can edit roles, inspect participant transcripts read-only, and see permitted approval requests under the participant badge.

Both slices use the same fixed Phase 2 behavior and remain within Agent Chat. BT-051 remains usable as a standalone invite-and-chat feature; BT-052 adds management and inspection surfaces without changing delivery semantics.

## Acceptance Criteria

BT-051 slice:

- [ ] Inviting Claude and Codex participants succeeds; both receive the visible timeline and can post via the shared token-gated loopback HTTP MCP endpoint with board-stamped identity, no approval, and no agent-supplied identity.
- [ ] Busy recipients receive ordered, batched user turns after turn-end; only visible user messages, Master final replies, and explicit participant posts are delivered.
- [ ] Group core instructions and layer-3 instruction/summary snapshots are applied to new sessions; the first join notice in a chat without an existing participants file carries a core-rules reminder for Master.
- [ ] Participant records and roles persist in service-owned board data, and a reopened group resumes existing participant session ids.
- [ ] Live and reloaded main transcripts render parsed author badges and hide the raw header line.
- [ ] Batched transcript entries split on each start-of-line header into consecutive bubbles with their own author badges, both live and after reload.
- [ ] The invite panel, expandable-summary join/leave notices, root sidebar filtering, and minimal participant roster support a usable end-to-end group.
- [ ] Slash commands stay in Master’s channel, require Master idle, and are never stamped/fanned out; group Send remains enabled while Master is busy for ordinary messages.
- [ ] `post_message` bypasses approval for every preset; any other joined-agent request outside its preset is auto-denied with a clear localized explanation.
- [ ] Each user or participant post renders once live; transcript copies are used only on reload. In-memory queues may be lost on close, and busy-Master transcript ordering may differ from live order (both accepted v1 behavior).
- [ ] Participant session ids are filtered from the root sidebar on load and refresh; nesting/read-only views, role editor, participant approval cards, and group icon remain BT-052.
- [ ] No unit tests or test harnesses are added; verify with the manual acceptance checklist.

BT-052 completes role editor, read-only participant views/nested sidebar rows, group icon states, participant approval cards, and visual refinement. Stop all, localization, and core theme-token styling are part of BT-051 as required for a usable standalone slice.

## Notes

- Confirmed the installed Codex CLI reports version 0.163.0. The generated app-server schema permits an arbitrary `thread/start.config` map but does not validate nested MCP configuration. A direct `codex app-server --stdio` config probe exited with `Access is denied` before returning a `thread/start` result; the in-app attempt ran against a resident service loaded before the latest group-routing edits and returned `Unsupported Codex session action: group`. The runtime acceptance of `default_tools_approval_mode="approve"` and approval-free `post_message` therefore remains unverified; the setting was not observed to be rejected, so the documented fallback was not applied.

- BT-052-only role editor, nested participant transcript views, participant approval cards, and group icon remain out of this slice.
- No unit tests or test harnesses were added.
- **User testing fixes (Claude, 2026-10-25):**
  - Reloaded history styled agent posts as the user's own messages, because posts reach Master as user turns. `appendEntries()` now takes the bubble kind from the author header, not the transcript role.
  - Master answered every message, including ones addressed to another agent ("Nova has this one…", "Thanks, Nova"). `GROUP_CORE` now tells Master to reply with exactly `[[pass]]` when a message is for another agent or it has nothing substantive to add, and forbids acknowledgements; joined agents are told never to post acknowledgements. The service drops a `[[pass]]` final reply instead of sharing it, and `appendEntries()` skips it in history. Master still runs a hidden turn per message.
  - The role summary disclosure was attached to every post of a joined agent; now only to its join notice. Join/leave notices are recognised in history by their first line and render as notices with the summary collapsed. User messages no longer carry a `user` badge.
  - Verified by the user in a new chat with two agents. Rules are fixed per session, so chats started before the change keep the old behaviour.

## Files that need NO changes

- `boards/claude-agent/scripts/sdk-install.mjs` — the existing Claude runtime dependency remains required, but group `post_message` uses the shared HTTP MCP endpoint and needs no SDK installer/export change.
- `boards/claude-agent/scripts/claude-executable.mjs` — the Claude executable resolver remains unchanged.
- `boards/claude-agent/i18n.js` — existing localization lookup handles new `lang/en.json` keys.
- `boards/claude-agent/board-base.css` — existing Persephone bridge theme variables remain the styling base.
- `boards/claude-agent/icons/` — use the existing engine SVGs and CSS mask mechanism; no new raster or engine assets are needed.
- `boards/claude-agent/versions-manifest.json`, `boards-manifest.json` — machine-generated publishing artifacts must not be edited for a task document.
- No Persephone app source, MCP endpoint bridge, cross-board interface, or separate team-chat board changes — all needed platform support already exists and delivery stays inside Agent Chat.
- No test files or harnesses — this project does not use unit tests, and this task explicitly uses manual acceptance only.

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/scripts/service.mjs` | Add group-chat persistence, role/roster snapshots, delivery queues/fan-out, header stamping, shared token-gated MCP HTTP endpoint and per-tool permission exception, lifecycle cleanup, resume, participant-id filtering support, and Stop all routing. |
| `boards/claude-agent/scripts/providers/claude.mjs` | Attach the shared HTTP MCP endpoint with participant bearer, auto-allow only `post_message`, set joined-role policy, rename the layer-1 preamble to Agent Chat, and add final-turn/history hooks. |
| `boards/claude-agent/scripts/providers/codex.mjs` | Configure the shared MCP endpoint and per-participant child token/approval mode, set joined-role policy, rename the layer-1 preamble to Agent Chat, and add final-turn/history hooks. |
| `boards/claude-agent/scripts/agent-session-protocol.mjs` | Validate bounded group metadata and shared header/participant fields while preserving contract version 1. |
| `boards/claude-agent/app.js` | Add invite flow and summary disclosure, group metadata state, split author-header rendering, participant-id root filtering, busy group Send/slash-command handling, exactly-once live message rendering, out-of-preset denial display, and Stop all. BT-052 adds role editor, nested/read-only views, permitted approval cards, and group icon. |
| `boards/claude-agent/index.html` | Add invite panel, role editor, group controls, and participant-view structure. |
| `boards/claude-agent/app.css` | Style the invite/roles/group UI with Persephone theme tokens. |
| `boards/claude-agent/lang/en.json` | Add all group-chat interface text and messages. |
| `boards/claude-agent/board-manifest.json` | Bump board `version` for the implementation release; existing permissions and settings remain unchanged. |
| `boards/claude-agent/README.md`, `boards/claude-agent/CLAUDE.md` | Document group-chat operation, roles, participant persistence, and session behavior. |
| `boards/claude-agent/WHATS-NEW.md` | Add the implementation release note under the matching next-version heading. |
| `doc/active-work.md` | Add the active BT-051 entry. |
