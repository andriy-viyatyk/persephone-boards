# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- [ ] [BT-060: Streaming VAD helper in the whisper runtime](tasks/BT-060-whisper-vad-helper/README.md) — Persephone **EPIC-134**, phase 2, task 1 of 6.
- [ ] [BT-061: Live segmentation in the Speech to Text service](tasks/BT-061-live-segmentation/README.md) — Persephone **EPIC-134**, phase 2, task 2 of 6.
- [ ] [BT-062: Streaming partial commits (local agreement) in Speech to Text live mode](tasks/BT-062-streaming-partial-commits/README.md) — Persephone **EPIC-134**, phase 2, task 3 of 6; supersedes the proposed audio left-context task.
- [ ] [BT-063: Speech to Text board redesigned main screen](tasks/BT-063-speech-to-text-main-screen/README.md) — Collapsible setup and license panels with a central live or record-then-type test control.
- [ ] [BT-064: Speech to Text default language hints follow the Persephone UI language](tasks/BT-064-app-language-default/README.md) — Service-resolved `app` locale hint with English fallback for every caller.
- [ ] [BT-065: Speech to Text language picker setting](tasks/BT-065-language-multiselect/README.md) — `language-hints` becomes a checkbox multi-select with endonym labels; needs Persephone US-1730 (bridge 1.43.0).

## Planned

- [ ] [BT-067: Speech to Text - hour-long live sessions](tasks/BT-067-long-live-sessions/README.md) — Persephone **EPIC-134**, phase 4; service-side duration and memory bounds for concurrent live channels.

- [ ] [BT-066: Agent Chat: live insertion of committed phrases](tasks/BT-066-agent-chat-live-insertion/README.md) — Persephone **EPIC-134**, phase 2, task 6 of 6; consume advertised live transcription with incremental insertion of committed phrases.

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
