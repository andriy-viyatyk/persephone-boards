# BT-071: Answer the agent's questions in Agent Chat

## Status

**Status:** Done
**Priority:** High
**Board id:** `claude-agent`
**Started:** 2026-10-28
**Completed:** 2026-10-28

## Goal

When Claude calls `AskUserQuestion`, the chat page shows the questions with their options, and the
user's choices go back to Claude as the tool's answers.

## Background

A real session showed the problem: the agent asked two questions. The chat page showed an empty
"AskUserQuestion needs your approval" card with Allow / Allow for this session / Deny. Allow ran the
tool with no answers, and Claude got "The user did not answer the questions."

- `scripts/providers/claude.mjs` `requestApproval` → `pageApproval` treats `AskUserQuestion` like any
  tool that needs permission. In Bypass mode it is allowed outright, again with no answers.
- `scripts/agent-session-protocol.mjs` `summarizeToolInput` keeps only `command`, `file_path`, `url`
  and similar keys. `questions` is dropped, so the approval card and the "Tool · AskUserQuestion" row
  are both empty, and so are replayed history rows, which use the same summary.
- The SDK contract: `canUseTool` returns
  `{ behavior: "allow", updatedInput: { ...input, answers: { "<question text>": "<label>" } } }`.
  Multi-select answers are the chosen labels joined with `", "`. A deny returns its message to Claude.
- `ExitPlanMode` is the precedent for a tool with its own card: `pageApproval` sends `kind: "plan"`
  and `app.js` `addApproval` renders a dedicated body and buttons.
- `scripts/service.mjs` `askApproval` / `approve` / `settleApproval` carry the page's answer back to
  the provider. `approve` today passes only `decision`, `message` and `mode`.

## Implementation Plan

- [x] `agent-session-protocol.mjs`: `summarizeToolInput("AskUserQuestion", …)` summarizes the
      questions as `questions: <header> — <question>` lines, so tool rows and history show them.
- [x] `claude.mjs` `requestApproval`: handle `AskUserQuestion` before every other branch.
  - Page session: send an approval request `{ kind: "question", tool, questions }` with the questions
    sanitized and bounded (question, header, multiSelect, option label and description). Wait with no
    timeout, like the plan card, ahead of the Bypass shortcut.
  - On allow with answers, return `updatedInput: { ...input, answers }`. On deny, return
    "The user declined to answer. Continue with your best judgment or ask in your reply."
  - Group participants and cross-board callers have nobody to answer, so deny with a message telling
    the agent to put the question in its reply.
- [x] `service.mjs` `approve`: accept an optional `answers` object for this request. It must have
      string keys and values and be bounded. Pass it through `settleApproval`.
- [x] `app.js` `addApproval`: a question card for `kind: "question"`.
  - Each question shows its header chip, the question text, and options as toggle buttons, with each
    option's description as a tooltip and a line under it. A single-select question selects one
    option; a multi-select question toggles any number.
  - An "Other" text field answers with free text.
  - **Submit** is enabled once every question has an answer. **Skip** declines.
  - After answering, the card keeps a read-only summary of the answers.
- [x] `app.css`: question card styles with `--p-*` tokens only.
- [x] `lang/*.json`: new `question.*` strings in all 18 languages.
- [x] `WHATS-NEW.md` `## 1.3.2` plus `board-manifest.json` version `1.3.2`.

## Concerns / Open Questions

- Codex has no `AskUserQuestion` equivalent wired through this board, so this is Claude-only.
- The question card does not offer "Allow for this session". Every question needs a fresh answer.
- Whether a PreToolUse allow in cross-board full-auto skips `canUseTool` for this tool is not
  verified. Cross-board sessions are agents driving agents, so a deny there is the safe default.

## Acceptance Criteria

- [x] A page session in Auto and Bypass mode shows the question card. The chosen options
      reach Claude, and Claude's reply reflects them.
- [x] A multi-select question and an "Other" free-text answer both arrive correctly.
- [x] Skip makes Claude continue without answers, and the card shows "Skipped".
- [x] The "Tool · AskUserQuestion" row lists the questions.
- [x] `ui.log` has no new errors. The existing "ResizeObserver loop" entries come from the composer layout observer and predate this task.

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/scripts/providers/claude.mjs` | AskUserQuestion routing |
| `boards/claude-agent/scripts/service.mjs` | `answers` in approval responses |
| `boards/claude-agent/scripts/agent-session-protocol.mjs` | question summary |
| `boards/claude-agent/app.js` | question card |
| `boards/claude-agent/app.css` | question card styles |
| `boards/claude-agent/lang/*.json` | strings |
| `boards/claude-agent/WHATS-NEW.md`, `board-manifest.json` | 1.3.2 |

## Notes

- Verified live 2026-10-28 in a scratch-folder session:
  - Auto mode: Blue; Apple + Cherry + typed "Mango" reached Claude as `Color: Blue · Fruits: Apple, Cherry, Mango`.
  - Bypass mode: the card still appears. Skip gave the card "Skipped", and Claude reported it got no answer.
  - Stored history rows for older AskUserQuestion calls now list the questions.
- Ask mode was not tried separately. It takes the same `askUserQuestion` path, which runs before any mode check.
