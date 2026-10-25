# BT-048: Refactor Claude Agent behind Provider Adapters

## Status

**Status:** In Progress  
**Priority:** High  
**Board id:** `claude-agent`  
**Started:** 2026-10-25  
**Completed:**

## Goal

Move Claude-specific runtime behavior behind a provider adapter interface and describe provider capabilities in the existing `agent.session` contract v1. Preserve the current Claude board page and cross-board contract behavior, with no user-visible change.

## Background

- Persephone's [EPIC-131](C:/projects/persephone/doc/epics/EPIC-131.md), Phase 1 (“One board, two engines”), selects a second engine in this board because boards cannot share implementation code and a second board would duplicate chat and service plumbing. BT-049 will add the Codex adapter and capability-gated UI; BT-048 does not implement Codex.
- The board currently has one large service entry point: `boards/claude-agent/scripts/service.mjs`. It contains channel setup and shared policy/session work alongside direct Claude SDK, CLI, transcript-store, and settings assumptions. The initial inspection verified those concerns in `describe`, `listSessions`, `sessionOptions`, `emitNative`, `startSession`, `handleSessionMessage`, `CONTROL_ACTIONS`, `killChildren`, `teardownSession`, and `onChannel`.
- `scripts/agent-session-protocol.mjs` is the shared v1 wire contract. `MODE_NATIVE` and native message normalization are Claude-specific mappings and should move behind the Claude adapter; shared validation, bounds, tool classification, limits, instructions, and serialization remain provider-neutral.
- `scripts/sdk-install.mjs` and `scripts/claude-executable.mjs` are Claude-only dependencies. Preserve the current explicit local SDK consent and installed CLI resolution behavior.
- The board page in `boards/claude-agent/app.js` must consume typed events and `description.capabilities`; it must never branch on a provider/vendor name. The current page has Claude-native assumptions in model label parsing, SDK consent, slash command and `/mcp` controls, subagent/history views, usage/cost/context UI, permission-mode and effort controls, and two native message string regexes.
- BT-046 established local-page full-auto behavior and cross-board contract policy; BT-047 added the local subagent tree/history UI. BT-047's final live verification remains open, so retain that behavior and include it in Persephone runtime verification.
- Persephone's `US-1705-agent-session-contract` and normative guide define contract v1. BT-048 updates that normative guide: `open.provider` is additive-compatible when omitted, description/session events identify the provider, `capabilities` supplements the permanent v1 `features`, and `resume` remains provider-defined opaque text. Keep `contractVersion: 1`; do not introduce a v2 envelope.
- The Codex app-server research in EPIC-131 establishes the adapter's required range: thread/start, turn/start, interrupt, server-originated approval requests, model/list, token-only usage, no cost or budget, and a provider-owned session store. It is interface-fit input only; BT-048 does not plan Codex implementation.
- Repo authoring guide says running Persephone's MCP is required for board work. It is available in this session; the live boards guide was read before designing the task. Persephone reports version 5.0.14, with board bridge 1.42.0.

## Implementation Plan

### Target adapter and service boundary

The service remains the single bridge between Persephone channels and provider-neutral contract events. Add `scripts/providers/claude.mjs`; select it from a closed provider registry in the service, defaulting the new `open.provider` field to `"claude"`. Reject non-empty unrecognized ids before creating a session. Preserve v1 framing, request ids, and existing open fields.

Target layout:

```text
scripts/
  service.mjs                    shared channel, policy, registry and lifecycle
  agent-session-protocol.mjs      shared v1 validation, bounds, policy and serialization
  providers/
    claude.mjs                    Claude SDK/CLI adapter and Claude session store
  sdk-install.mjs                 Claude-only consent-gated SDK installer
  claude-executable.mjs           Claude-only installed CLI resolver
```

Keep shared functions in `service.mjs` and `agent-session-protocol.mjs`; do not add a second implementation of the board channel or duplicate the protocol. `sdk-install.mjs` and `claude-executable.mjs` stay in place but are imported only by the Claude adapter.

Define a provider adapter factory with these methods (all asynchronous methods return promises; method arguments are structured objects):

```js
describe({ cwd, settings }) -> { models, defaults, capabilities, chatOptions, setup }
setup({ action }) -> SetupStatus
listSessions({ cwd }) -> SessionSummary[]
open({ open, sessionId, composedInstructions, endpoint, onEvent, requestApproval, registerProcess }) -> ProviderSession
send(session, { text, attachments?, requestId? }) -> void
interrupt(session) -> void
approve(session, { requestId, decision, message?, mode? }) -> void
control(session, { action, ...args }) -> ControlResult
history({ sessionId, cwd }, { emitEntries(entries, metadata?) }) -> void
follow({ sessionId, cwd }, { emitEntries(entries, metadata?), signal }) -> void
watchSessions({ cwd }, { emit(event), signal }) -> void
manageSession({ action, sessionId, title?, cwd }) -> void
watchSubagents({ sessionId, cwd }, { emit(event), signal }) -> void
subagentHistory({ sessionId, agentId, cwd }, { emitEntries(entries, metadata?), signal }) -> void
close(session, { reason, force }) -> void
```

Keep methods optional only when their capability is false; the service validates capability before dispatch and returns the existing typed unsupported-operation error. `open` returns an opaque provider session handle and emits the shared v1 event vocabulary through `onEvent(event)`: `session-started`, `turn-started`, `turn-ended`, `text-delta`, `text`, `thinking-delta`, `tool-call`, `tool-result`, `file-change`, `task`, `compacted`, `approval-request`, `session-status`, `notice`, and `error`. The `session-status` snapshot has this shape (fields other than `type` are present when known/supported):

```js
{
  type: "session-status",
  model: string,                  // opaque provider model id
  modelLabel?: string,             // user-facing label for the live model id
  effort?: string,
  mode?: string,                  // opaque board-chat mode id, when applicable
  compacting: boolean,            // true from compaction start through compact boundary
  contextTokens?: number,
  contextWindow?: number,
  contextPercent?: number,
  limits?: { fiveHour?: { percent: number, resetsAt?: string }, sevenDay?: { percent: number, resetsAt?: string } }
}
```

The Claude adapter emits updated `session-status` with `compacting: true` when the SDK enters compacting status, then `compacting: false` at the compact boundary — and also on `turn-ended`, interrupt, error, and close, so a failed or interrupted compaction never leaves the flag stuck; it updates `model` and `modelLabel` together on init/model reroute. The page reads the compacting flag for its existing status line and renders `modelLabel` in the footer, falling back to the raw model id. Do not emit synthetic `notice` strings for either cue. Preserve request ids on service-emitted events as today. Adapter-originated approval requests call shared `requestApproval({ scope, kind, summary, detail, signal })`; the adapter maps native tool/approval details to shared policy categories, while policy classification, ceilings, pending-approval lifecycle, and decision validation stay in the service. Incoming v1 `approval-response` is routed to `approve()` so the adapter can resolve the underlying SDK callback or app-server request.

`service.mjs` keeps the channel lifecycle, input validation, approval and policy engine, limits, instruction composition, Persephone MCP endpoint issuance/revocation, session registry and close coordination, session-scoped process-tree termination, request-id routing, history batching/serialization, and local-page authorization checks. Move provider-specific SDK query setup, executable resolution/spawn hooks, model discovery, native mode mapping/message normalization, Claude settings defaults, SDK install/consent, `~/.claude/projects` transcript search/follow, session storage operations, and Claude subagent-file discovery into `providers/claude.mjs`. `getSdkModels()` moves with model discovery and is called by the Claude adapter from `emitNative()` on SDK init to refresh/cache `supportedModels()`; there is no separate `listModels()` adapter method. Shared history batching remains in service; adapters supply normalized history entries or stream typed events into the shared batcher. Preserve the exact current composed instruction text for Claude by letting the adapter supply its existing Claude-specific environment preamble and default instructions as input to the shared layer joiner; changing the text is a prompt-behavior change even if the page looks identical. `registerProcess(child)` registers session-owned children for shared cleanup. BT-049 will decide whether Codex uses one app-server per session or a shared process; BT-048 leaves that extension point open and does not introduce provider-scoped process registration.

### Capability contract

Add a required `capabilities` object beside the existing, permanent v1 `features` field in `description`. These are the small set of booleans the current page actually branches on; they are not a replacement for contract `features`:

```js
capabilities: {
  providerSetup: true,
  sessionStore: true,
  transcriptFollow: true,
  permissionModes: true,
  modelSelection: true,
  effortSelection: true,
  slashCommands: true,
  mcpPanel: true,
  subagents: true,
  tokenUsage: true,
  costUsage: true,
  contextUsage: true,
  rateLimits: true
}
```

Each flag gates the UI/service path shown below; providers may differ where the feature depends on provider-owned storage or controls. Keep v1 `features` exactly as normative contract fields (`resume`, `thinkingStream`, `usage`, `cost`, `maxAgentSteps`, `maxBudgetUsd`) and keep them permanently alongside `capabilities`. Do not migrate or retire them. `sessionStore` groups list, history, resume, and rename/delete because both planned providers have provider-owned list/read/resume operations; `transcriptFollow` stays separate because Claude can follow JSONL written by another Claude process, while BT-049 must determine whether Codex can provide equivalent external-session following. Setup readiness is a generic `description.setup` object (`{ required, ready }`); `providerSetup` means the page has an adapter setup action, not that setup is incomplete.

Return the contract's generic permission modes in `description.permissionModes` unchanged. The local page's provider-specific mode selector uses `description.chatOptions.permissionModes` descriptors with ids and i18n keys only: `{ id, labelKey, descriptionKey, planApproval? }[]`. The page resolves `labelKey` and `descriptionKey` through `t()`; adapter-supplied display strings are not allowed. `planApproval` marks a mode whose completion offers approve/continue controls, replacing a separate plan-review capability. Setup panels and capability-state copy use keys in `lang/en.json`, never adapter-provided UI prose. The page may carry provider ids for routing but must not branch on provider names or ids.

| Capability | Exact gated path |
|---|---|
| `providerSetup` | `#consent`/generic setup panel, `consentSdk()` replacement and `provider-setup` request; `description.setup.ready` controls whether it is shown. |
| `sessionStore` | `renderSessions()`, `refreshSessions()`, `openStoredSession()`, `loadHistory()`, resume in `connect()`, and session rename/delete menu actions. |
| `transcriptFollow` | `watchSessionList()`, `startFollow()`, and the service's `watch-sessions`/`follow-session` paths; separates Claude's external JSONL following from store-backed resume/history. |
| `permissionModes` | `#mode-chip`, `showModeMenu()`, and board-local `open.mode`/`set-mode`; each mode id is paired with localized label keys and optional `planApproval`. |
| `modelSelection` | `#model-chip`, `showModelMenu()`, and `models`/`set-model` control actions. |
| `effortSelection` | `#effort-chip`, `showEffortMenu()`, and effort selection via the provider control. |
| `slashCommands` | `updateCommandMenu()`, `refreshCommands()`, and the provider command listing; board commands with their own capability remain individually gated. |
| `mcpPanel` | `/mcp`, `showMcpPanel()`, status/reconnect/toggle/authenticate controls. |
| `subagents` | Agents tree rendering, `startAgentWatch()`, `showAgentTranscript()`, and `watch-subagents`/`subagent-history` service paths. |
| `tokenUsage` / `costUsage` | `updateFooterUsage()` token fields and last-turn/session cost chips respectively; Codex can report token usage while `costUsage` is false. |
| `contextUsage` | Context chip and `/context` `showContextPanel()`/`renderContext()` path. |
| `rateLimits` | Five-hour/seven-day limit chips in `updateFooter()`. |

### Provider routing and v1 compatibility

- Extend `validateOpen()` and Persephone's normative `assets/guides/agents/agent-session.md` to accept optional `open.provider` with a bounded identifier shape and default it to `"claude"`. Missing `provider` is additive-compatible with contract v1 and preserves current callers. Explicit `provider: "claude"` is equivalent. Unknown/unavailable ids fail with documented `provider-unavailable`. The contract defines `resume` as a provider's resumable id; replace the implementation's UUID-only shared validation with bounded opaque-id validation and keep Claude UUID/transcript-path validation inside `providers/claude.mjs` so Codex thread ids fit. Add optional `provider` to `description`, `session-started`, and each `sessions[]` row, and document the new `description.capabilities` beside permanent v1 `features`. Add the typed `session-status` event fields described above. These are additive v1 fields/events; keep `contractVersion: 1`.
- Existing Claude behavior remains the default. Page discovery requests may omit `provider` and route to Claude because it is the sole registered provider until BT-049. The UI carries the opaque provider id returned in description/session-started and passes it through list/history/watch requests without comparing it to a known vendor string. For a live `sessionId`, resolve the owner from the service registry and reject a conflicting explicit provider. For stored sessions absent from the live registry, pass the provider id recorded on the session row; if there is no recorded id, use the sole registered provider. Keep local-board-only protections for page-specific operations.
- The session registry records `{ providerId, adapter, providerSession }`; `session-started.provider` and each `sessions[].provider` preserve routing for later history/resume. Teardown calls the owning adapter's `close()` exactly once.
- Keep list/history provider-scoped. Claude lists and follows Claude's own store; a future provider lists and replays only its own store. Each `sessions` row carries its provider id so the page can retain it on the session view and supply it to history/follow/manage requests. The shared service owns request authorization, event serialization, bounded history batches, and watcher cleanup. Cache `description` per opaque provider id so each view's capability/model/mode controls stay tied to that session's adapter.

### UI leak inventory and required `app.js` changes

The UI must never check `provider`, provider id, or vendor text. It branches only on `description.capabilities` and typed events:

| Current leak | Required change |
|---|---|
| `modelLabel()` recognizes Claude model-id syntax (`claude-opus-5-5`) | Remove vendor regex formatting, but do not lose the friendly live model display: Claude adapter adds `modelLabel` to `session-status` (e.g. `Opus 5.5` for `claude-opus-5-5`), alongside the raw `model` id. Page renders `modelLabel`, then the model-list label, then the raw id. |
| `consentSdk()`, `#consent`, `sdkInstalled`, and `sdk-not-installed` handling | Replace `sdkInstalled` with generic `description.setup: { required, ready }`; gate the setup panel/action on `capabilities.providerSetup` and `setup.ready`. Send `provider-setup` to adapter `setup({ action })`. Remove the `consent-sdk` and `sdk-not-installed` Claude aliases; service and page ship together, and the setup request is page-only. Claude adapter keeps the same opt-in SDK install copy and flow through localized board strings. |
| Model/effort chips and menus assume `/model` and `/effort` support and fixed effort values | Gate `modelSelection` and `effortSelection`; use adapter-provided model efforts and defaults only. Remove hard-coded vendor effort fallback where capability data is absent. Preserve current Claude choices and labels. |
| Permission-mode chip values (`bypassPermissions`, `auto`, `plan`) | Gate on `capabilities.permissionModes` and render `description.chatOptions.permissionModes` descriptors (`id`, `labelKey`, `descriptionKey`, optional `planApproval`). Resolve text through `t()`; send selected opaque mode id in board-local `open.mode`/`set-mode`. Keep Claude-native values in adapter and preserve current visible choices. Leave v1 contract `permissionModes` unchanged. |
| Selected-model and compacting notices currently matched by message regexes | These strings are produced by our own service/protocol code, not native SDK messages. Remove both notices and regexes. On SDK init/model reroute, Claude emits `session-status` with `model` and `modelLabel`; on compacting status and compact boundary it emits the same event with `compacting: true` and `compacting: false`. `handleEvent()` reads status fields directly: the model chip uses `modelLabel` (falling back as above), and the status line shows/clears the existing localized compacting text from `t("compacting")`. No duplicate notice or compatibility marker is needed. |
| Slash-command menu and command listing | Gate dynamic command listing on `slashCommands`; gate board-provided `/model`, `/effort`, `/context`, `/mcp`, `/clear`, and `/rename` actions on their matching capabilities. Fetch provider commands through `control` only when supported. Claude keeps its current command list and typed command/history entries. |
| `/mcp` panel and reconnect/toggle/authenticate actions | Gate on `mcpPanel`; preserve existing control-result shapes and behavior when enabled. |
| Subagents tree and subagent transcript selection/history (`BT-047`) | Gate on `subagents`; preserve `watch-subagents`, `subagent-history`, status detection, ordering, selection, live-follow and history rendering for Claude. Hide the entire affordance when false. |
| Usage/cost footer and session cost accumulation | Gate token display on `tokenUsage` and cost display/accumulation on `costUsage`. Support token-only usage without fabricating cost. |
| Context fill and rate-limit chips in `updateFooter()` | Gate context fields on `contextUsage` and provider-specific rate-limit windows on `rateLimits`; retain Claude's current footer content when those flags are true. |
| Context command/panel (`renderContext`) and provider-specific context categories | Gate on `contextUsage`; render only normalized context fields supplied by the adapter. Unsupported context command is absent. |
| Max turn/budget features | Do not add capability flags: the page sends no `maxAgentSteps`, `maxBudgetUsd`, or `maxTurns` fields. Keep these only in contract v1 `features`; this task does not add a limit UI. |
| History/resume/session browser controls | Gate resume, list, history, follow and manage affordances separately on their matching capability flags. |
| Approval card's `kind === "plan"` branch and hard-coded continuation modes | Derive plan continuation controls from the selected mode descriptor's `planApproval` property; do not add a `planReview` capability. Render other approvals through the shared contract approval event. |
| Local board commands, `#mode-chip`, `#model-chip`, `#effort-chip`, `#context-chip`, setup-required session-list empty state | Update `renderChips()`, `updateCommandMenu()`, `refreshCommands()`, `renderSessions()`, `refreshSessions()`, `connect()`, `watchSessionList()`, and startup restore to hide/enable by the capability table. Preserve chip visibility/order and empty-state text for Claude. |
| Static Claude setup/prompt copy in `index.html` and `lang/en.json` | Keep the published Claude Agent name and copy unchanged in BT-048; show setup only when `providerSetup` is supported and `setup.ready` is false. Page-visible adapter choices use localized keys. Board rebrand and the `claude-agent:` localStorage namespace migration remain BT-050 scope. |

### Step-by-step checklist

- [x] **1. Update the normative v1 contract.** Skipped in this run at the user's direction; the two Persephone-repo files are outside the writable scope and are assigned to a separate run.
- [x] **2. Freeze and implement v1 protocol validation.** Added optional bounded `open.provider`, provider defaulting and bounded opaque resume-id validation. Moved `MODE_NATIVE`, model/native event normalization and its native state into the Claude adapter; contract version remains 1.
- [x] **3. Define provider-neutral service helpers.** `service.mjs` owns the channel registry and dispatch, async queue, event serialization/request ids, errors, limits, approval/policy decisions and records, endpoint lifecycle, history batching, process registration/tree cleanup, session registry and close coordination. It imports no SDK modules and contains no Claude filesystem paths.
- [x] **4. Extract the Claude adapter.** Claude settings/defaults, SDK/CLI setup and query, native events/status, model discovery, transcript/subagent storage and following, session list/history/management, controls, modes/efforts, native permission mapping and spawn behavior now live in `scripts/providers/claude.mjs`. SDK installer and executable resolver are imported only there.
- [x] **5. Route channel operations without compatibility aliases.** The shared service selects the registry adapter, validates capabilities/local-page routing and dispatches each opening operation. Live session messages dispatch through the owning adapter; shared service owns approvals, request ids and close coordination. Replaced the consent request and SDK error aliases with `provider-setup` and generic setup readiness/errors.
- [x] **6. Advertise capabilities and status events.** Adapter/service descriptions now include capabilities, setup readiness, and localized mode descriptors; v1 features remain present. Model and compacting state use `session-status`; generated model/compaction notices were removed.
- [x] **7. Update page discovery, localization, and gating.** Cached descriptions by opaque provider id, retained ids on session rows/views and routed session requests. Mode/setup copy uses localized keys; UI paths are gated by the capability table for store/follow, modes, model/effort, commands, MCP, subagents, usage, context and rate limits. Removed vendor-dependent UI parsing and SDK-installed state; added no limit UI.
- [x] **8. Update board authoring and user-facing provider descriptions.** Updated both board docs to describe the adapter boundary and additive v1 provider/capability model; preserved the existing setup instructions.
- [x] **9. Keep Claude dependencies and behavior stable.** SDK and executable modules are now imported only by the Claude adapter; their verification, consent, executable, and spawn implementations remain unchanged. Existing mode chips and related Claude functionality remain in place, and model/compacting cues now use typed status fields.
- [x] **10. Verify in Persephone.** Skipped at the user's direction; Claude will verify live. No throwaway consumer board was created.
- [x] **11. Release accounting.** Kept the board manifest at `1.0.0` and did not add a `WHATS-NEW.md` heading. The Persephone release announcement is part of the separately assigned step 1.

## Concerns / Open Questions

- The v1 `description.features` object is normative and permanent. `description.capabilities` is an additional documented object beside it, not a migration or replacement. Both are added to the normative Persephone guide in this task.
- Cross-board v1 callers cannot choose an engine in the current contract. BT-048 adds optional `open.provider`; discovery requests without it select the only registered provider (Claude) until BT-049 adds another.
- Claude's session list/history/watch functions currently mix transcript storage with generic batch serialization. Extract storage/query operations but keep batch limits and event shapes shared; do not let a provider bypass channel backpressure or the 600 KiB history batch limit.
- Claude permission modes, command catalog, context breakdown, `/mcp`, and subagent semantics have no guaranteed equivalent in every provider. Their controls must be capability-gated; suppressing them for a provider without support is expected provider-specific UI, while Claude remains visually unchanged.
- The existing model and compaction notice text is generated by this board, not native provider output. Remove those notices and publish their state as `session-status.modelLabel` and `session-status.compacting`; no external consumer board exists yet, so no notice compatibility alias is needed.
- Contract fields and `session-status` change additively in v1, while the generic `provider-setup` request is a board-local page/service rename with no external caller. Update the contract guide and Persephone 5.0.14 release notes in this task. The Claude page must preserve its visible model label, compacting status, setup copy, and controls; if any visible Claude change proves necessary, separate that from the no-behavior-change scope and plan a board release.
- Capability descriptor UI text must remain localizable: adapters return ids and i18n keys, never labels or explanatory prose. Existing v1 model descriptors keep their normative user-facing `label` field; the newly added live `session-status.modelLabel` is a provider-computed model name for display, not new instructional copy.
- BT-047's final live-verification step remains open in its task doc. This task must preserve its implementation and verify it at runtime; it cannot claim that pre-existing live verification is already complete.

## Acceptance Criteria

- [ ] Default or omitted provider preserves all existing Claude page and `agent.session` v1 behavior.
- [ ] Persephone's normative guide documents all added v1 fields/errors and the `session-status` shape; its 5.0.14 upcoming section contains the one-line announcement.
- [x] Service owns shared protocol validation, policy, approvals, instruction composition joiner, endpoint lifecycle, history batching, and session teardown; Claude-specific code resides under `scripts/providers/claude.mjs`.
- [x] `describe` returns stable `capabilities` beside permanent v1 `features` while `contractVersion` remains 1.
- [x] UI feature decisions use capabilities and typed events only; no provider/vendor inspection remains in `app.js` decision logic.
- [x] Mode labels/descriptions and generic setup/capability copy resolve through `i18n.js` keys in `lang/en.json`; the adapter supplies no UI prose.
- [x] Claude `session-status` carries friendly live `modelLabel` and the compacting true/false state; UI no longer parses notices or model ids.
- [x] BT-047 subagent tree, history, and live-follow behavior remains available for Claude (runtime verification skipped per scope).
- [ ] Persephone runtime verification confirms no user-visible behavior change and `ui.log` has no new errors.
- [x] No unit tests or test harness are added.
- [x] Persephone 5.0.14 guide release note remains assigned to the separate step 1 run; no `claude-agent` version bump or `WHATS-NEW.md` 1.0.1 heading was added.

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/scripts/agent-session-protocol.mjs` | Provider/default/opaque-resume validation and shared protocol, policy, limits, instruction joiner and serialization; Claude native mappings removed. |
| `boards/claude-agent/scripts/service.mjs` | Shared registry and operation dispatch, validation, approvals/policy, request ids, endpoint and session lifecycle, event/history batching and process cleanup; no SDK or Claude paths. |
| `boards/claude-agent/scripts/providers/claude.mjs` | Claude settings/defaults, SDK/CLI/session/query, native status/events, models/modes/controls, transcript/subagent storage/follow, management and setup. |
| `boards/claude-agent/app.js` | Provider-description cache/routing, typed status events, localized descriptor-driven modes, full capability gating and generic setup flow. |
| `boards/claude-agent/lang/en.json` | Added localized generic continuation label for descriptor-driven plan approval modes. |
| `boards/claude-agent/CLAUDE.md` | Corrected runtime ownership and documented provider adapter boundary. |
| `boards/claude-agent/README.md` | Added provider selection and additive v1 capability/status description. |
| `doc/tasks/BT-048-agent-provider-adapters/README.md` | Marked implementation steps, recorded scoped skips, and updated the change inventory. |
| `boards/claude-agent/scripts/sdk-install.mjs` | No planned behavior change; retained as Claude adapter dependency. |
| `boards/claude-agent/scripts/claude-executable.mjs` | No planned behavior change; retained as Claude adapter dependency. |
| `boards/claude-agent/WHATS-NEW.md`, `board-manifest.json` | No edit if there is no user-visible change; do not bump published 1.0.0. |
| `C:/projects/persephone/assets/guides/agents/agent-session.md` | Skipped in this run per user scope; separate run will update. |
| `C:/projects/persephone/assets/guides/whats-new.md` | Skipped in this run per user scope; separate run will update. |

## Notes

- Verified live Persephone MCP availability and read `guides.agents.boards` before authoring. Runtime board verification is a later implementation step, not performed while writing this plan.
- Initial source findings recorded during inspection: service currently advertises `features` and Claude `sdkInstalled` in `describe`; `listSessions` directly calls `sdk.listSessions`; transcript follow/watch resolves `~/.claude/projects`; subagent files are stored beside Claude JSONL transcripts; `sessionOptions` configures Claude's SDK preset, hooks, MCP, limits, executable and spawn hook; `emitNative` maps Claude SDK messages and emits English model-selection notice; teardown revokes MCP endpoint and kills child processes.
