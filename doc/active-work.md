# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- [ ] [BT-022: AiVision Explorer board — tree, path resolution, help and events](tasks/BT-022-aivision-explorer/README.md)
  — implemented and verified in the running app (commit `0e022a6`), but **not publishable**:
  `screenshot.png` is still missing, because a live capture would include the tab strip and status
  bar of a real session.

- [ ] [BT-023: AiVision Explorer — one unified tree over every member](tasks/BT-023-aivision-explorer-unified-tree/README.md)
  — supersedes the original BT-023 root picker, which is dropped. Implemented and verified live
  (board v1.0.1); unreviewed, and publishing is still blocked by BT-022's missing screenshot.

Both belong to Persephone's **EPIC-101** (*Structured descriptor access and the AiVision Explorer
board*); that epic document holds the design and the verified background. The `$describe` resolver
segment they depend on shipped in `ai-vision` 1.2.0, so it is no longer a blocker.

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
