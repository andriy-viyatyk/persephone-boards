# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- [ ] [BT-017: Force Graph board — detail panel resizer](tasks/BT-017-detail-panel-resizer/README.md)
- [ ] [BT-019: Force Graph board — ship its own user and agent documentation](tasks/BT-019-force-graph-guides/README.md)
- [ ] [BT-021: Move the greek-gods.fg.json example into the Force Graph board](tasks/BT-021-example-graph/README.md)
- [ ] [BT-020: Todo board — backfill its documentation](tasks/BT-020-todo-board-guides/README.md)
- [ ] BT-018: Force Graph board — colored tab icon (the `currentColor` icon rendered black; a board icon is loaded as an `<img>`, so it inherits no color)

- [ ] [BT-006: PDF Viewer board (.pdf)](tasks/BT-006-pdf-viewer/README.md)
- [ ] BT-013: Excel Viewer — large-workbook load time (10.9 s → 6.0 s on a 20.5 MB / 124k-row file)

### EPIC-100 — Force Graph editor → board

- [ ] [BT-014: Force Graph board — models, renderer, canvas, content host (v1)](tasks/BT-014-force-graph-board/README.md)
- [ ] [BT-015: Force Graph board — panels, grids, menus, dialogs, AiVision surface (v2)](tasks/BT-015-force-graph-board-v2/README.md)
- [ ] [BT-016: Force Graph board — parity verification against the built-in editor](tasks/BT-016-parity-verification/README.md)

## Planned

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
