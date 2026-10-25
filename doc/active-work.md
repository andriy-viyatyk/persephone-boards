# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- [ ] [BT-046: `claude-agent` provider board — Persephone EPIC-131 / US-1706](tasks/BT-046-claude-agent-board/README.md)
- [ ] [BT-047: `claude-agent` board — subagents panel](tasks/BT-047-claude-agent-subagents/README.md)
- [ ] [BT-048: `claude-agent` — provider adapter interface and capability flags (no behavior change)](tasks/BT-048-agent-provider-adapters/README.md)
- [ ] [BT-049: Codex engine over `codex app-server`](tasks/BT-049-codex-engine/README.md)
- [ ] BT-050: Rename the board to **Agent Chat** — display name and texts only; the `claude-agent` id stays (user decision 2026-10-25), so no storage or settings migration
- [ ] [BT-051: Group chat in Agent Chat — Persephone EPIC-131 / US-1708](tasks/BT-051-group-chat/README.md)

## Planned

Persephone EPIC-131 / US-1707: Codex becomes a second engine in this board instead of a separate `codex-agent` board (decided 2026-10-25).


Board work for Persephone's **EPIC-128** (*Audio Player board*) is finished: BT-038 – BT-045 shipped as
`audio-player` v1.0.0, published 2026-10-18. See [`tasks/completed.md`](tasks/completed.md).

Board work for Persephone's **EPIC-101** (*Structured descriptor access and the AiVision Explorer
board*) is finished: BT-022 and BT-023 shipped as `aivision-explorer` v1.0.2, published
2026-09-15. See [`tasks/completed.md`](tasks/completed.md).

---

## How This Dashboard Works

### Structure

Each section (Active / Planned) lists tasks. A task links to its document:

```
- [ ] [BT-XXX: Title](tasks/BT-XXX-short-name/README.md)
```

`[ ]` = planned or in progress. `[x]` = done.

### Lifecycle

1. **Create** a task: add a `doc/tasks/BT-XXX-short-name/README.md` (copy `doc/tasks/_template/`)
   and link it under **Planned**.
2. **Start** work: move the entry from **Planned** to **Active**.
3. **Complete** a task: mark it `[x]`, move a one-line evidence entry to
   [`tasks/completed.md`](tasks/completed.md), and remove it from this dashboard. Delete the task
   folder once its content is captured in `completed.md` (ask first).

### Task ID Format

`BT-XXX` — sequential Board Task number (repo-local; independent of Persephone's `US-XXX`).
