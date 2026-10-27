# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

*(none)*

## Planned

Board work for Persephone's **EPIC-134** (*Live transcription and meeting transcripts*) is finished:
BT-060 – BT-068 added live segmentation, hour-long live sessions and the language picker to
`speech-to-text` v1.3.0, and live dictation with auto-stop to Agent Chat 1.3.1. Both stay unpublished
on `develop` until Persephone 5.0.15 ships. See [`tasks/completed.md`](tasks/completed.md).

Board work for Persephone's **EPIC-133** (*Speech to text*) is finished: BT-055 – BT-057 built the
Whisper runtime, the `speech-to-text` v1.0.0 provider board and Agent Chat 1.3.0 voice input. Both
boards stay unpublished on `develop` until Persephone 5.0.15 ships. See [`tasks/completed.md`](tasks/completed.md).

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
