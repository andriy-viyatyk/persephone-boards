# BT-095: Pre-approve Persephone's own MCP endpoint for every agent session

## Status

**Status:** In Progress *(implemented; awaiting live verification)*
**Priority:** High
**Board id:** `claude-agent`
**Started:** 2026-11-08
**Completed:** —

## Goal

Let an agent call Persephone's own MCP tools without an approval prompt, so an unattended wake session can
speak, open pages and drive the app without the user having to grant blanket Full access.

## Background

User report: a Codex wake session set to **Full access** came back in **Auto** after a Persephone restart,
and then raised a confirmation dialog on every speech-tool call. Two separate findings came out of it.

**1. The mode reset is deliberate** (`app.js:516`):

> `// Every new chat starts in Auto; the last pick is not kept.`

`rememberSession()` persists only `{ id, provider, cwd }`. For Codex, "Full access" means
`sandbox: "danger-full-access"` **and** `approvalPolicy: "never"`, so silently restoring it would bring an
unattended voice session back able to run anything with no approvals. **Not changed by this task.**

**2. The prompts had a much narrower cause.** The speech tool is a *Persephone MCP* tool, and the
Persephone endpoint was registered without pre-approval while the group-chat endpoint beside it already
had it:

| | before |
|---|---|
| Codex, `mcp_servers.agent_chat` | `default_tools_approval_mode: "approve"` |
| Codex, `mcp_servers.persephone` | *(nothing)* — prompts on every call |
| Claude, `mcp__persephone__*` | allowed **only** when `crossBoard && mode === "full-auto"` |

The Claude rule is backwards: a **local page session** — the common case, including the wake session — got
no pre-approval, while a cross-board caller at full-auto did. So the only lever the page offered for
"stop asking me about speech" was Full access, which also drops shell and file approvals. That is a bad
trade forced by a gap, not a considered design.

The endpoint is private, per-session and token-scoped: this board issues it via
`persephone.mcp.issueSessionEndpoint()` and revokes it on close. Prompting for it asks the user to
re-consent to the surface they already opened the session on.

## Implementation Plan

- [x] **1. `scripts/providers/codex.mjs`** — add
      `-c mcp_servers.persephone.default_tools_approval_mode="approve"` beside the existing url and
      token args, matching what the group endpoint sets for `agent_chat`.
- [x] **2. `scripts/providers/claude.mjs`** — pre-approve `mcp__persephone__*` for **every** session that
      has an endpoint, replacing the `crossBoard && full-auto` condition.
- [x] **3. Comment both sites** with the reasoning and the ceiling consequence below.
- [x] **4. Document the carve-out** in the `cross-board-permission-ceiling` setting description, so the
      limitation is visible where the ceiling is configured rather than only in code.
- [ ] **5. Live verification** — see Acceptance Criteria.
- [x] **6. `WHATS-NEW.md`, `CLAUDE.md`.**

## Concerns / Open Questions

- **This lifts the cross-board ceiling for Persephone MCP tools.** Explicitly requested — *"all agents in
  Persephone should use its tools without additional approvals"* — after the narrower, local-sessions-only
  scoping was offered. A consumer board that opens an agent session below `full-auto` can now have that
  agent use Persephone MCP tools without prompting; native tools (shell, file writes) are still gated by
  the ceiling and by `policyDecision`. It matters because Persephone's MCP surface includes
  `execute_script`, which carries full app trust — so for a cross-board caller this is a real widening,
  not a cosmetic one. Narrowing it later is a one-line change in each provider: re-add
  `&& !session.crossBoard`.
- **Approval prompts were the only visible signal of MCP activity.** With them gone, a user no longer sees
  individual Persephone tool calls go by. The transcript still shows tool entries, but the consent moment
  moves entirely to opening the session.
- **The mode-restore request is deliberately not implemented.** If pre-approval removes the reason to pick
  Full access for the wake session, nothing further is needed. If the user still wants the mode
  remembered, scope it to the **marked wake session only** (the `wake-session` marker already stores
  `{provider, id}`, so the mode fits beside it) rather than reversing the author's rule for every chat.
- **Claude's `allowedTools` and the `PreToolUse` hook interact.** `CLAUDE.md` requires the hook to stay
  enabled for every contract mode because native permission settings may auto-allow tools; this change
  widens `allowedTools`, not the hook, so the hook still sees and can classify the calls.

## Acceptance Criteria

- [x] Codex accepts the new `-c` override and still initializes (verified against CLI 0.167.0)
- [ ] Live: a Codex wake session in **Auto** calls the speech tool with no confirmation dialog
- [ ] Live: a Claude local page session calls a Persephone MCP tool with no confirmation dialog
- [ ] Live: shell and file-write approvals still prompt in Auto — the change is scoped to MCP tools
- [ ] `ui.log` is clean (no CSP violations)

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/scripts/providers/codex.mjs` | `default_tools_approval_mode="approve"` on the endpoint |
| `boards/claude-agent/scripts/providers/claude.mjs` | `allowedTools` for every session with an endpoint |
| `boards/claude-agent/board-manifest.json` | Ceiling setting description notes the carve-out |
| `boards/claude-agent/CLAUDE.md` | Pre-approval rule recorded |
| `boards/claude-agent/WHATS-NEW.md` | Changelog entry |

## Notes

Ships in `claude-agent` 1.4.1 alongside BT-089. Verified offline with `temp/codex-config-smoke.mjs`, which
launches `codex app-server --stdio` with the exact argument list the board now passes.
