# Agent Chat board notes

The board id and folder remain `claude-agent`.

Standalone provider board; it is not a custom editor and has no file association. The resident service implements the vendor-neutral `agent.session` v1 protocol and the local chat page uses the same service channel and protocol.

## Runtime design

- `scripts/agent-session-protocol.mjs` owns v1 validation, bounds, policy classification, and instruction composition.
- `scripts/service.mjs` owns provider-neutral contract validation, provider catalog/session aggregation, channel lifecycle, policy and approvals, provider-scoped instruction files, MCP endpoint revocation, watcher lifecycle, and child process cleanup. `scripts/providers/claude.mjs` owns Claude SDK/CLI integration, Claude session storage, native event normalization, model/mode metadata, and setup. `scripts/providers/codex.mjs` owns the installed Codex app-server JSON-RPC protocol, Codex thread store, event normalization, and Codex model/mode metadata.
- Providers are selected by the bounded `open.provider` id (default `claude`) from a closed registry. Keep provider-specific behavior behind the adapter boundary; descriptions publish capability flags and localized mode keys for the page.
- `scripts/sdk-install.mjs` downloads SDK 0.3.302 only after a local consent message and verifies both the archive SRI and the SDK entrypoint SHA-256. Do not vendor SDK files or add a package manager/build step.
- `scripts/claude-executable.mjs` resolves only the installed CLI. The SDK process spawn hook always launches that resolved executable.

Claude local chat sessions retain their existing Claude Code mode behavior. Codex local sessions use the capability-described Auto, Full access, and Read only modes; Auto is `on-request` plus `workspace-write`. Cross-board contract modes and `cross-board-permission-ceiling` apply to both providers and must never be broadened by native policy.

Codex is version-gated to CLI 0.163.0 because its app-server protocol is experimental. Start one `codex app-server --stdio` child per live session with the private MCP endpoint passed through `-c`; keep its bearer token only in the child's environment. The shared discovery process has no MCP configuration or token and is stopped after idle time. Codex supports its stored-thread list, paged history, rename, delete, and resume. It does not support transcript following, cost, rate limits, subagent panels, slash commands, or the MCP panel.

The service owns `instructions.md` for Claude and `instructions-codex.md` for Codex under the existing board-data directory. Preserve Claude's existing default text and file contents; compose environment, provider instructions, and caller instructions in the same order and with the same joiner. Do not add instruction settings to the manifest.

`session-history` is a board-page-only opening request (refused for cross-board callers, like `provider-setup`): it replays a stored transcript via the SDK's `getSessionMessages` as batched `history` messages (each batch under 600 KB) so the chat page can show a resumed session's earlier turns. It is not part of the `agent.session` v1 contract.

The chat page renders agent text with vendored marked 15.0.12 and DOMPurify 3.4.16 (`lib/`, see `lib/VERSION.txt`) and the catalog `markdown.css` skin; always sanitize marked output.

The SDK's `SpawnOptions` and `SpawnedProcess` declarations are from pinned version 0.3.302. Custom spawn replaces SDK default spawning; `ChildProcess` satisfies the declared process interface. `settingSources` is explicitly `user`, `project`, and `local`. The `PreToolUse` hook must remain enabled for every contract mode because native permission settings may auto-allow tools.

## Authoring and release

Keep browser CSP limited to local assets, use Persephone `--p-*` theme tokens, and localize page text with `i18n.js` and `lang/en.json`. Do not add `node_modules`, SDK code, a bundled package, or a build script. Increase `version` and add a matching `WHATS-NEW.md` heading for release changes. Capture the catalog screenshot in the running development app with synthetic content and no personal paths or data.

## Group-chat lifecycle

The local page opens the main session with service-owned `groupChat` identity metadata. `scripts/service.mjs` owns the four shipped agent profile defaults, profile validation and CRUD, invite-time participant snapshots, lifecycle, routing queues, local-only group index and participant observers, approval routing, and the shared token-gated loopback MCP endpoint. Profile and group data belong under `%LOCALAPPDATA%/Persephone/board-data/claude-agent/group-chat/`; replace the unreleased `roles.json` with `profiles.json` without migration. Never persist a participant bearer token. Keep every profile field on the participant snapshot so edits or deletion do not change existing participants.

The main session owns the live participant lifetimes, and closing or shutting down it must deny pending participant approvals, revoke endpoints, close observers, and stop child sessions while retaining resumable participant ids. Only user messages, main final replies, explicit `post_message` calls, and a joined agent's final reply from a turn that posted nothing (unless it is `[[pass]]`) enter the shared timeline; an exact repeat of a participant's last post is dropped. Preserve separate provider transcripts and only decorate history at the provider boundary. Participant transcript views read stored history without starting a session; attach the local observer only when both parent and participant are already live. The group index exposes only sidebar fields and must remain local-page-only. Ask-capable approvals resolve through the owning participant's pending approval map; read-only requests remain denied. Keep profile editing, one-click invite, nested read-only participant rows, approval cards, and group icon behavior within this board.
