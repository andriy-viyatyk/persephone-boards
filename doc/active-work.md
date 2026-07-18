# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

_No active tasks._

## Planned

- [ ] [BT-003: PowerPoint Viewer board (.pptx)](tasks/BT-003-powerpoint-viewer/README.md)

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
