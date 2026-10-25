# BT-052: Agent profiles, one-click invite, and group management in Agent Chat

## Status

**Status:** In Progress
**Priority:** High
**Board id:** `claude-agent`
**Started:** 2026-10-25
**Completed:**

## Goal

Replace BT-051’s role picker with service-owned agent profiles and a one-click invite menu. Complete group management and inspection in Agent Chat: edit profiles, invite from idle/new chats, browse participant sessions read-only in the sidebar, show group state, and surface approvals allowed by each profile’s permission preset.

## Background

- **Design authority:** [Persephone EPIC-131, Phase 2 — group chat inside Agent Chat](C:/projects/persephone/doc/epics/EPIC-131.md), particularly “Agent profiles” and “Inviting an agent” (revised 2026-10-25), and its last note “BT-051 done; agent profiles for BT-052”. This plan follows its profile fields, four defaults, replacement-without-migration rule, one-click menu, idle-chat invite behavior, sidebar requirements, and approval behavior.
- **Prior slice:** [BT-051 group chat](../BT-051-group-chat/README.md), whose service routing, participant lifecycle, message fan-out, headers, invite UI, and auto-deny behavior are implemented. BT-051’s “Proposed split” assigns profile editing, nested/read-only participant views, permitted approval cards, group icon, and visual refinement to this slice. Its Notes record the user-testing fixes: history bubble kind comes from the author header; Master emits hidden `[[pass]]` rather than replying to messages for others; and join summaries appear only on join notices.
- **Existing profile storage seam:** `boards/claude-agent/scripts/service.mjs`, `readRoles()`, currently persists the BT-051 role array as `%LOCALAPPDATA%/Persephone/board-data/claude-agent/group-chat/roles.json` and materializes its `GROUP_ROLES` defaults when absent. `groupOperation()` handles `save-role`/`delete-role`. `addGroupParticipant()` snapshots role instructions and summary into participant records. BT-052 replaces the roles file and role operations with profiles; do not migrate the unreleased file. Retain invite-time participant snapshots for every profile field needed to render badges, resolve approvals, and inspect prior sessions.
- **Sidebar participant indexing gap:** `boards/claude-agent/app.js`, `participantSessionIds()`, derives hidden participant ids only from `views`; `refreshSessions()` and `renderSessions()` use that set to filter ordinary rows. Thus a restart before opening a group leaves joined sessions visible as root chats and provides no group state for those parents. Add a global service-owned participant index, loaded with the session listing, and use it for all sidebar filtering, nested rows, and group icons.
- **Provider model descriptions:** `boards/claude-agent/scripts/providers/claude.mjs`, `MODEL_ALIASES`, offers `opus`, `sonnet`, and `haiku` as CLI aliases; `sessionOptions()` passes `open.model` directly as the Claude SDK `model` option, and `models()` obtains the installed SDK’s `supportedModels()` list. `getSdkModels()` replaces `cachedModels` with that runtime list, so alias ids are not guaranteed to remain in the returned descriptions. `boards/claude-agent/app.js`, `modelLabel()`, displays a matching model label and strips the “(CLI alias)” suffix. Profile availability must therefore treat the three Claude CLI aliases as offered even when the runtime list omits them; Claude availability depends on provider setup, not matching `opus` against `cachedModels`.
- **Codex model identifiers:** `boards/claude-agent/scripts/providers/codex.mjs`, `getModels()` calls runtime `model/list` and records each `id`, display label, description, and supported reasoning efforts; `startSession()` rejects a selected model absent from that current list. Store/use the identifier reported by `model/list` for Codex profiles; there is no Codex alias-remapping layer in the current adapter. A Codex profile is runnable only while its selected model identifier is offered.
- **Existing popup menu pattern:** `boards/claude-agent/app.js`, `openChoiceMenu()`, builds a floating menu from button items with labels, optional visible descriptions, current/disabled states, and positions it above its anchor. `showModelMenu()` and `showEffortMenu()` use this shared popup for the model and effort chips. Reuse it for the profile menu and editor launch, and set the disabled item’s native `title` as well as its visible description so the unavailable reason is a tooltip.
- **New chat and history-only chat:** `boards/claude-agent/app.js`, the `#composer` submit handler, stores `pendingPrompt` and calls `connect(view)` on first send; `connect()` opens a live main channel with `groupChat: { position: "main" }`. `openStoredSession()` instead calls `loadHistory()` and `startFollow()` without starting a writable session; its comment states that it resumes only when the user sends. The new invite action must explicitly connect/resume Master before sending the invite operation, preserving the pending prompt when applicable. `loadHistory()` requests `session-history` and renders transcript batches without making the session live.
- **Provider and bridge boundaries:** `boards/claude-agent/CLAUDE.md` documents the service as owner of profiles, participant snapshots, lifecycle, and approval policy; provider adapters own engine-specific sessions; the page uses local `boards/claude-agent/lang/en.json` and Persephone theme tokens. `boards/claude-agent/scripts/providers/codex.mjs`, `CAPABILITIES`, currently declares `transcriptFollow: false`; BT-052 adds a service-owned observer so nested views can still live-follow normalized events from active participants. `boards/claude-agent/scripts/providers/claude.mjs` advertises provider transcript follow. Keep profile persistence and validation in `boards/claude-agent/scripts/service.mjs`; derive engine/model/effort choices from provider descriptions already used by the chips.
- **Profile-editor UI precedent:** `boards/claude-agent/index.html`, `#instructions-dialog` and `#panel-dialog`, provide native modal overlays; `boards/claude-agent/app.js`, `editInstructions()` and `openPanel()`, open them with `showModal()`. `askDialog()` / `deleteSession()` provide the existing confirmation pattern. Use a wide overlay dialog with a two-column editor instead of inventing a new page layout.
- **Permission presets:** `boards/claude-agent/scripts/service.mjs`, `readParticipants()`, `prepareOpen()`, and current `groupOperation()` role validation restrict group permissions to `read-only`, `ask`, `auto-edit`, and `full-auto`; `boards/claude-agent/scripts/agent-session-protocol.mjs`, `MODES`, defines the same contract modes. Claude `startSession()` maps these to `plan`, `default`, `acceptEdits`, and `bypassPermissions`, respectively. Codex `startSession()` maps read-only to `read`, ask/auto-edit to `auto`, and full-auto to `full`; `MODE_OPTIONS` and `sandboxPolicy()` apply on-request/read-only, on-request/workspace-write, and never/danger-full-access policies. Read-only alone cannot write; ask, auto-edit, and full-auto are write-capable and get the shared-folder warning.

## Implementation Plan

### Profiles, validation, and editor

- [x] In `boards/claude-agent/scripts/service.mjs`, replace `GROUP_ROLES`, `readRoles()`, and `save-role`/`delete-role` handling in `groupOperation()` with service-owned profile defaults, reads, validation, save, duplicate, delete, and reset operations. A profile record is exactly `{ id, name, roleTitle, instructions, summary, provider, model, effort, permissionMode }`. Profile names may repeat across the board. **Duplicate** copies the selected profile as `<name> 2`, using the next free number when needed (for example, `Nova 3`). In each chat, disable profiles whose `profileId` is already present or whose case-insensitive name matches any participant, so two same-name profiles cannot both join.
- [x] Permit editing and deleting shipped defaults just like user-created profiles; **Reset to defaults** restores the exact four shipped records. Duplicating a profile creates a new id and defaults its name to `Original Name 2`, incrementing to the next free number (for example, `Nova 3`) when needed.
- [x] Expose a local-page-only `manage-profiles` opening request in `boards/claude-agent/scripts/service.mjs` for list/save/delete/reset so the editor works without a live chat. Keep provider descriptions available to validate selections; never expose profile administration to cross-board callers.
- [x] Ship four defaults, each provider `claude`, model alias `opus`, effort `medium`, permission mode `read-only`:
  - **Nova — Reviewer:** Instructions: “Review the requested work, inspect relevant code or evidence, and report concrete defects, risks, and fixes. Do not make changes.” Summary: “Reviews work and identifies defects, risks, and fixes.”
  - **Rex — Critic:** Instructions: “Challenge the proposal’s assumptions, look for counterexamples and failure cases, and explain where reasoning or evidence is weak. Do not make changes.” Summary: “Challenges assumptions and finds counterexamples.”
  - **Atlas — Researcher:** Instructions: “Investigate the question using available sources, distinguish evidence from inference, and report concise findings with source references. Do not make changes.” Summary: “Researches questions and reports evidence and sources.”
  - **Iris — Planner:** Instructions: “Turn the request into a clear, ordered plan. Identify dependencies, risks, and decision points, and keep recommendations practical. Do not make changes.” Summary: “Creates practical plans and highlights dependencies, risks, and decisions.”
- [x] Store profiles under the existing group-chat service data root, using a profiles file in place of `roles.json`. Treat BT-051’s roles file as unreleased and replace it without migration. Validate bounded text, profile ids, supported provider, model/effort shape, permission preset, list size, and serialized size on the service boundary; reject unsupported permission values rather than silently falling back to read-only. Validate selected model/effort against that provider adapter’s current description/catalog before saving and again before invite, except that Claude aliases are always offered as specified below. Write atomically. `reset-profiles` restores the four shipped defaults. Saving or deleting a profile must not change participant snapshots already saved for an existing chat.
- [x] Expand participant snapshots made by `addGroupParticipant()` to preserve `profileId` plus all profile fields used at invite time: `name`, `roleTitle`, `instructions`, `summary`, `provider`, `model`, `effort`, and `permissionMode`, along with participant/session/chat routing ids and `mainProvider` for the global index. Use the snapshot `profileId` to disable a profile already represented in that chat. Replace the old participant `role` / `engine` field uses consistently across `readParticipants()`, header stamping, messages, sidebar, and approval lookup. Never persist bearer tokens.
- [x] In `boards/claude-agent/index.html` and `boards/claude-agent/app.js`, add an in-board profile editor as a wide modal overlay, following `#instructions-dialog` / `editInstructions()` and the `#panel-dialog` / `openPanel()` pattern. Open it from **Edit agents…** at the bottom of the invite menu. Lay it out as a profile list on the left and selected-profile form on the right; put New, Duplicate, Delete, and Reset to defaults controls with the list. Use text inputs for Name and Role title, textareas for Instructions and Summary, and selects for Provider, Model, Effort, and Permission preset. When Provider changes, refresh Model choices; when Model changes, refresh Effort choices. Add Save and Cancel actions. Save validates and persists via the service; Cancel discards. Switching profiles or closing with unsaved edits prompts to Save, Discard, or Stay. Confirm Delete and Reset to defaults through the existing `askDialog()` pattern used by `deleteSession()`.
- [x] Permission choices are the service-validated presets (`read-only`, `ask`, `auto-edit`, `full-auto`): `readParticipants()`, `prepareOpen()`, and current `groupOperation()` validate them, and `MODES` in `boards/claude-agent/scripts/agent-session-protocol.mjs` defines the contract values. Claude `startSession()` maps them in order to native `plan`, `default`, `acceptEdits`, `bypassPermissions`; Codex `startSession()` maps them to `read`, `auto`, `auto`, `full`, with `MODE_OPTIONS` and `sandboxPolicy()` enforcing `on-request/read-only`, `on-request/workspace-write`, and `never/danger-full-access`. Treat `ask`, `auto-edit`, and `full-auto` as write-capable and show the warning that Master and joined agents share the working folder; `read-only` is the only preset without that warning. Keep the shipped profiles read-only. All CRUD/reset operations call the service; no profile data in localStorage.
- [x] In `boards/claude-agent/scripts/providers/claude.mjs`, always include `opus`, `sonnet`, and `haiku` CLI aliases in provider model descriptions, even when `getSdkModels()` has populated `cachedModels`; accept those aliases in `startSession()` even if absent from `supportedModels()`. Keep passing the alias unchanged through `sessionOptions().model`. In `boards/claude-agent/app.js`, treat those Claude aliases as runnable whenever the Claude provider setup is ready and render their labels as Opus, Sonnet, or Haiku. For Codex profiles, require provider availability and an exact model id from `getModels()` / runtime `model/list`.

### One-click invite and idle/new chats

- [x] In `boards/claude-agent/index.html` and `boards/claude-agent/app.js`, remove the BT-051 invite form (`#group-panel`, `renderGroupPanel()`, and the role/name/engine/model/effort/Add form) and replace it with **+ Invite agent** after the effort chip. The chip is visible for every chat, including history-only and blank/new views. BT-051 currently shows the chip only when `view.groupMain`, `view.channel`, and `!view.groupLoading` are true (`renderChips()`), so remove those live-channel conditions.
- [x] Clicking **+ Invite agent** opens the existing `openChoiceMenu()` popup, anchored to the chip, with one item per profile as `Name (Role title)` and **Edit agents…** as the final item. Grey out a profile if an active participant has the same `profileId` or the same case-insensitive participant name, so two different profiles with the same name cannot join one chat. If an engine is unavailable, disable its profiles and show the reason as the item tooltip/description. Claude’s `opus`/`sonnet`/`haiku` aliases are always offered; Claude profile availability depends only on `description.setup.ready`. For Codex, disable a profile when its model id is absent from the current `model/list` description. On selection, invite immediately without a name or settings form; Duplicate assigns the next available numbered name.
- [x] If invite is selected while the chat has no live channel, call the same `connect(view)` path used for first-send/new chat or history-only resume, then issue the group list/invite service request after `groupLoading` completes. New chats need a valid working directory. Preserve an already pending first prompt and do not send a blank Master turn merely to start the channel. In `boards/claude-agent/app.js`, `connect()` sends `groupChat: { position: "main" }`; `handleEvent()` consumes the resulting `group-data` event and clears `groupLoading`.
- [x] The join notice remains board-stamped and contains the full summary for every participant; the main chat continues to collapse the summary under the notice. Removing an agent emits the same leave notice as BT-051.

### Board documentation and release notes

- [x] Update `boards/claude-agent/README.md` and `boards/claude-agent/CLAUDE.md` to describe profiles, the profile editor, one-click invite, the group index/sidebar behavior, and read-only participant views.
- [x] Add BT-052’s concise release-note lines under the existing `## 1.2.0` heading in `boards/claude-agent/WHATS-NEW.md`. BT-051 already set `board-manifest.json` to `1.2.0`; keep that version and do not bump it again in BT-052.

### Nested sidebar sessions and group icon

- [x] In `boards/claude-agent/app.js` and `boards/claude-agent/scripts/service.mjs`, render joined sessions nested beneath their parent using the global group index described below. Selecting one displays stored history and attaches a local-page-only observer only if its parent group and participant session are already live. If either is stopped, show history without starting/resuming any session; opening a read-only participant view has no session side effects. `send()` currently suppresses group-participant events; extend it to copy events only to authorized read-only observers, never into the parent shared timeline. This service observer supports both engines despite Codex `CAPABILITIES.transcriptFollow: false`. The view has no prompt/send, stop, rename, delete, or other destructive controls.
- [x] Add a local-page-only `group-index` opening request in `boards/claude-agent/scripts/service.mjs`. It returns `{ mainSessionId, provider, participants: [{ profileId, name, roleTitle, provider, sessionId, removed }] }` for every participants file; save the parent provider as `mainProvider` in new participant snapshots for this index. For BT-051 snapshots without that field, use the matching `list-sessions` row’s provider in `refreshSessions()`. Paginate so each response is at most 512 KiB and no groups are omitted. In `boards/claude-agent/app.js`, `refreshSessions()` loads all index pages alongside `list-sessions` and applies both results together; refresh the index after invite/remove. Replace `participantSessionIds()`’s open-views-only calculation with ids from this index. Use it to filter participant ids from root rows, render nested children (including removed history entries with a left state), populate history author badges without opening the chat, and draw the group icon for parents with at least one non-removed participant. Use the main session provider for its icon color and idle/live/busy classes. The global index supplies sidebar and badge fields without opening any chat.
- [x] For parent chats with at least one invited participant, update `engineIcon()` and `renderSessions()` so the sidebar glyph is the group icon while its mask/color remains the main provider’s icon color and its idle/live/busy classes remain the main session’s state. Solo chats retain their provider icon. Add `boards/claude-agent/icons/group.svg` if no existing suitable group glyph exists, using the current CSS mask mechanism.

### Participant approvals and localization

- [x] In `boards/claude-agent/scripts/service.mjs`, `policyDecision()` currently turns every joined-agent `ask` into deny and `askApproval()` sends approval events to the participant’s internal channel. Keep that behavior for `read-only` profiles; for ask-capable profiles, relay the `approval-request` event to the parent main channel with the participant snapshot. Add a group approval response operation that resolves only the owning participant’s pending request through existing `approve()` / `settleApproval()` and preserves request ids/ownership. Ensure approval expiry and participant removal still resolve pending prompts safely.
- [x] In `boards/claude-agent/app.js`, render a participant approval card in the main chat under that agent’s author badge. Reuse `addApproval()` and its allow/allow-session/deny controls; route the response to the matching participant via the new group operation. The approval card currently sends `approval-response` on the current view’s channel (`addApproval()`), so the participant identity must be bound by service state, not a user-supplied session id. Do not add approval cards for denied read-only requests.
- [x] Define approval-card cleanup in `boards/claude-agent/scripts/service.mjs`, `removeGroupParticipant()`, `groupOperation()` for `stop-all`, and `closeSession()`: participant removal and Stop all deny each pending participant approval, send a resolved event to the parent, and disable the card with a denied/stopped outcome; the participant receives the deny. Closing the main chat denies pending participant approvals before child sessions close; the page’s `expireApprovals()` disables/resolves remaining cards as the parent channel closes. No pending card remains actionable after its participant or parent session ends.
- [x] Update `boards/claude-agent/app.css` with existing `--p-*` theme tokens, `boards/claude-agent/lang/en.json` for all labels, tooltips, warnings, approval states/errors, and the existing `engineIcon()` mask styles for the group glyph. Keep `boards/claude-agent/i18n.js` and `boards/claude-agent/board-base.css` unchanged.

## Concerns / Open Questions

- Profile deletion/editing must not rewrite saved participant snapshots; existing participants keep the exact instructions and permission preset they received when invited.
- Claude `opus` is an SDK-supported model alias passed directly through `sessionOptions().model`; treat `opus`, `sonnet`, and `haiku` as always offered even if `supportedModels()` omits those ids. Claude alias availability depends only on provider setup. Codex profile availability depends on exact current `model/list` membership.
- For a new blank chat, invite requires a selected working directory because `connect()` refuses an empty cwd. Use the existing cwd control and localized validation message; do not create an implicit folder.
- `group-index` must remain local-page-only like `session-history`; expose only the bounded sidebar fields in its pages, not instructions, summaries, bearer tokens, or private transcript data.
- BT-051 is committed but unreleased; its roles JSON has no user data migration obligation. Reset to defaults intentionally overwrites custom profiles only after the user chooses the explicit reset action.

## Acceptance Criteria

- [ ] Four shipped profiles have the specified names, titles, full instructions, summaries, Claude/`opus`/medium/read-only defaults.
- [ ] Profiles list, add, edit, duplicate, delete, and reset persist through the service; validation rejects unsupported provider/model/effort/permission values and oversized input; edits do not change existing participant snapshots.
- [ ] The old `roles.json` is replaced without migration; a clean profile store materializes defaults.
- [ ] Every chat has **+ Invite agent** after the effort chip. It opens the shared popup pattern with `Name (Role title)` entries and **Edit agents…**; selected runnable profiles join in one click.
- [ ] In-chat duplicates and unavailable provider/model profiles are disabled with a clear hover reason. No invite form or name pool remains.
- [ ] Inviting from a new or history-only chat first starts/resumes Master, then joins the selected profile; no blank prompt is sent and any pending first user prompt is preserved.
- [ ] Write-capable permission presets display the warning that Master and joined agents share a working folder. Read-only auto-deny remains intact; ask-capable requests appear as approval cards under the correct participant badge and resolve through the existing approval path.
- [ ] Removing a participant, Stop all, and closing the main chat deny any pending approvals for that participant; live cards become disabled with a resolved denied/stopped/closed outcome, and no card stays actionable after its session ends.
- [ ] Participant sessions appear nested under their parent chat and open with prior history plus live-follow events from the service observer while their parent group is live. No prompt/send or destructive actions are available in the participant view.
- [ ] After a restart and before opening any group chat, the index hides every participant session from root rows and shows each group’s nested participants and group icon. History badges have the participant engine icon without opening the main chat live. Participant views never start/resume sessions; they attach a live observer only when the parent and participant are already live. Parent group icons retain the main engine color and idle/live/busy indicators; solo rows remain unchanged.
- [ ] All new UI copy is localized and theme-token based. No unit tests or test harnesses are added.

## Notes

- Implementation follows the reviewed plan as a single slice. Participant removal is available from the nested sidebar row context menu when the parent chat is live.
- The live profile-menu check could not complete: the already-running Persephone board service returned Unsupported agent.session opening request for the new local-only request after the board frame reload. The source-level checks pass; a service restart is needed for live verification.
- Smoke check after a service restart (Claude): sessions load, a joined agent's session nests under its parent chat, the parent shows the group icon, and the invite menu lists the four profiles plus **Edit agents…**. Fixed: in a history-only chat the menu did not grey out an agent already in the chat, because `view.groupParticipants` is filled only on a live channel; `openInviteMenu()` now falls back to the chat's `state.groupIndex` entry.
- User testing: inviting into a chat failed with "The group chat operation failed." Claude's `startSession()` (`scripts/providers/claude.mjs`) did not return the session (Codex's does), so `live.group = …` threw for every Claude participant. This was latent since BT-051, whose test agent ran on Codex, and also broke resuming Claude participants. Fixed by returning the session. The `group-error` banner now appends the service's reason after the generic text.
- Live discussion test (Nova, Rex, Master): turn order and the summary worked, but Nova sent `[[pass]]` through `post_message`, and it showed as a message. The MCP handler now drops a bare `[[pass]]` and tells the agent to end its turn without posting.
- Owner decision: no hop limit. `GROUP_CORE` now makes Master the moderator: when agents go back and forth without progress, it tells them by name to stop and summarizes. Joined agents follow Master's instructions, ranked right after the user's, and stay quiet on a topic Master stopped until the user or Master addresses them again.

## Proposed split

One task is large but coherent: profile storage and snapshots underpin the invite menu, sidebar labels, icon state, and approval identity, so keep BT-052 together unless implementation reveals a blocking seam. If it needs a split, use:

1. **BT-052 — Profiles, editor, one-click invite, and idle/new chat start.** Profile CRUD/defaults/snapshots, editor, menu, provider availability, and starting Master before invite.
2. **BT-053 — Participant sidebar and approvals.** Nested read-only transcript view, global participant index, group icon states, and joined-agent approval cards.

## Key seams (before → after)

**Profile record and service persistence — `boards/claude-agent/scripts/service.mjs`, `readRoles()` / `groupOperation()` / `addGroupParticipant()`**

Before:

```js
{ id, name, instructions, summary, permissionMode }
```

After:

```js
{
  id, name, roleTitle, instructions, summary,
  provider, model, effort, permissionMode,
}
```

Replace `roles.json` with the service-owned profiles file, validate every field against provider descriptions and permission presets, and snapshot all profile values onto the participant at invite time.

**Invite popup — `boards/claude-agent/app.js`, `renderChips()` / `openChoiceMenu()` / `showModelMenu()`**

Before:

```js
const groupAvailable = Boolean(view.groupMain && view.channel && !view.groupLoading && !view.selectedAgentId);
$("#group-invite").classList.toggle("hidden", !groupAvailable);
```

After:

```js
const canInvite = Boolean(view && !view.selectedAgentId);
$("#group-invite").classList.toggle("hidden", !canInvite);
```

The click handler opens `openChoiceMenu()` with profile entries and an `Edit agents…` item; it establishes the main channel first when no live channel exists. `openChoiceMenu()` currently has no native tooltip assignment, so disabled profile entries add `button.title = item.reason` while retaining the visible disabled reason.

**Global participant index — `boards/claude-agent/app.js`, `participantSessionIds()` / `refreshSessions()` / `renderSessions()`; `boards/claude-agent/scripts/service.mjs`, opening request dispatch**

Before:

```js
const participantSessionIds = () => new Set([...views].flatMap((view) => view.groupParticipants.map((participant) => participant.sessionId).filter(Boolean)));
```

After restart, that helper has no data until a group view is open, so `refreshSessions()` and `renderSessions()` treat joined-agent sessions as root rows. `group-data` arrives only after a live main channel sends a `list` operation.

After: expose a local-page-only, cursor-paginated `group-index`; load all pages alongside `list-sessions` and apply both before rendering. Refresh it on invite/remove and use it for root filtering, nested rows, group icon states, and history badge engine icons whether or not a parent chat is open.

**Ask-capable approvals — `boards/claude-agent/scripts/service.mjs`, `policyDecision()` / `askApproval()` / `approve()`**

Before:

```js
if (session?.groupParticipant && decision.permissionDecision === "ask") {
  return { ...decision, permissionDecision: "deny", message: "This action is outside the joined agent's permission preset." };
}
await send(session.channel, { type: "approval-request", requestId, ...event }, session);
```

After: keep read-only denials, but relay ask-capable participant approvals to the parent main channel with participant identity; route the main chat’s response back to that exact participant’s existing approval map and resolve it with `approve()` / `settleApproval()`.

**Nested read-only participant view — `boards/claude-agent/app.js`, `renderSessions()` / `openStoredSession()` / `loadHistory()`**

Before:

```js
const rows = state.sessions.filter((item) => !hiddenParticipants.has(item.id));
```

This hides participant ids from normal chat rows without rendering children.

After: for each parent row, render indexed participants as nested child buttons. A child opens `session-history`; it attaches the service observer only when the parent group and participant are already live. Otherwise it shows stored history and starts no session. Suppress the composer, approval actions, and all session-management context-menu actions for that view.

## Files that need NO changes

- `boards/claude-agent/i18n.js` — the `t()` lookup and `applyI18n()` cover new `boards/claude-agent/lang/en.json` keys and data attributes.
- `boards/claude-agent/board-base.css` — its existing theme-token fallbacks remain the base; selectors in `boards/claude-agent/app.css` use the `--p-*` surface/text variables directly.
- `boards/claude-agent/scripts/agent-session-protocol.mjs` — `validateOpen()` keeps the provider-neutral `agent.session` v1 contract; group profile metadata remains board-local.
- `boards/claude-agent/scripts/providers/codex.mjs` — `getModels()` and `startSession()` already expose supported ids/reasoning efforts and reject unavailable ids; `CAPABILITIES` reports no provider transcript follow.
- `boards/claude-agent/scripts/sdk-install.mjs` and `boards/claude-agent/scripts/claude-executable.mjs` — `installSdk()` and `resolveClaudeExecutable()` need no changes for profiles, menus, history views, or approval routing.
- `boards/claude-agent/versions-manifest.json` and `boards-manifest.json` — machine-generated release artifacts are not part of this task document.
- `boards/claude-agent/board-manifest.json` — BT-051 already set `version` to `1.2.0`; BT-052 adds release-note lines under the existing heading and does not bump the version.
- No Persephone app source, cross-board interface, or separate team-chat board changes — the feature remains inside the existing Agent Chat service and page.
- No unit-test files or test harnesses — this plan uses manual acceptance; the task explicitly forbids adding tests.

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/scripts/service.mjs` | Replace role storage/CRUD with validated profile storage and defaults; snapshot full profile records; serve a bounded local-page-only global group index for every participants file; route ask-capable participant approval requests and responses through the parent chat. |
| `boards/claude-agent/scripts/providers/claude.mjs` | Keep CLI aliases in descriptions when runtime supported-model lists omit them; accept aliases at session start and preserve alias model labels. |
| `boards/claude-agent/app.js` | Add profile editor and one-click popup; invite from idle/new/history-only chats; render nested read-only participant sessions, restored history badges, group icon state, and participant approval cards. |
| `boards/claude-agent/index.html` | Replace the BT-051 invite form with the profile editor shell and all-chat invite chip/menu anchor; add nested participant view structure if needed. |
| `boards/claude-agent/app.css` | Style the profile editor, disabled menu reasons, nested sidebar rows, group icon, and approval cards with theme tokens. |
| `boards/claude-agent/lang/en.json` | Add localized profile, invite, shared-folder warning, disabled-reason, nested-view, group icon accessible-label, and approval strings. |
| `boards/claude-agent/icons/group.svg` | Add a monochrome mask glyph for a parent chat with invited participants, if no current icon fits. |
| `boards/claude-agent/README.md` | Document profile CRUD, one-click invite, group indexing, and read-only participant views. |
| `boards/claude-agent/CLAUDE.md` | Update board-specific author notes for profile storage, snapshots, index/sidebar state, and approval lifecycle. |
| `boards/claude-agent/WHATS-NEW.md` | Add BT-052 release-note lines beneath the existing `## 1.2.0` heading. |
| `doc/tasks/BT-052-agent-profiles/README.md` | Add the BT-052 implementation plan and verified code seams. |
| `doc/active-work.md` | Mark BT-051 implemented and add BT-052 under Active. |
