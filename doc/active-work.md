# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- [ ] [BT-101: Speech to Text and Agent Chat — always use cleaned Persephone audio; audio debug panel](tasks/BT-101-stt-audio-debug/README.md)

- [ ] [BT-100: Wake Word — centralize enrollment and review the crop before adding it](tasks/BT-100-wake-enroll-review/README.md)

- [ ] BT-091: Wake Word — adaptive noise-floor detection gate (`wake-word` 1.1.1; implemented, awaiting live verification on the loud-fan laptop)
- [ ] [BT-093: Wake Word — one detection per phrase, best-matching person wins](tasks/BT-093-wake-best-match-wins/README.md) (`wake-word` 1.1.1; implemented, awaiting live verification)
- [ ] [BT-094: Wake Word — gate detection on speech, not loudness (Silero VAD)](tasks/BT-094-wake-vad-gate/README.md) (`wake-word` 1.1.1; verified live)
- [ ] [BT-095: Pre-approve Persephone's own MCP endpoint for every agent session](tasks/BT-095-persephone-mcp-preapproval/README.md) (`claude-agent` 1.4.1; implemented, awaiting live verification)
- [ ] BT-099: Agent Chat — end a wake request on transcription inactivity, not microphone level (`claude-agent` 1.4.3; a loud fan pinned the level test at "speech", so a request without a stop word never ended on silence and ran to the 60 s limit. Implemented, awaiting live verification)
- [ ] BT-098: Agent Chat — make the stop word optional for Wake mode (`claude-agent` 1.4.2; the gate required both `agent-wake` and `agent-stop` enrollments, so removing a stop word that false-matched mid-sentence disabled Wake mode entirely. Requests already end on the silence timeout. Implemented, awaiting live verification)
- [ ] BT-097: Speech to Text — choose the graphics device (`speech-to-text` 1.4.3; whisper-server defaulted to device 0, the integrated GPU; measured 6.21 s vs 2.17 s for 35 s of audio on Intel Iris Xe vs GTX 1650. Picker lives on the board page backed by `persephone.storage`, not a manifest setting, so the cards show by name. Implemented, awaiting live verification)

## Planned

- [ ] [BT-092: Make the Wake Word detection gate tunable from board settings](tasks/BT-092-wake-gate-settings/README.md)

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
