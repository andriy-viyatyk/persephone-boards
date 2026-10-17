# Active Work Dashboard

Overview of active and planned board work in this repo.

- Task details live in [`doc/tasks/`](tasks/) (one folder per task with a `README.md`)
- Completed tasks are logged in [`doc/tasks/completed.md`](tasks/completed.md)
- Ideas and future concepts in [`doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- [ ] [BT-041: Audio Player — equalizer, crossfade, gapless](tasks/BT-041-audio-effects/README.md)


- [ ] [BT-038: Audio Player — player, queue, volume, visualizer, source mode](tasks/BT-038-audio-player/README.md)
- [ ] [BT-039: Audio Player — music catalog and catalog mode](tasks/BT-039-audio-catalog/README.md)
- [ ] [BT-043: Audio Player — ai-vision model](tasks/BT-043-audio-aivision/README.md)
- [ ] [BT-044: Audio Player — light mode, `singleInstanceMasks`, watch-based catalog refresh](tasks/BT-044-audio-light-mode/README.md)

## Planned

### Persephone EPIC-128 — Audio Player

- [ ] [BT-040: Audio Player — play counts, smart/saved playlists, M3U/PLS](tasks/BT-040-audio-playlists/README.md)
- [ ] [BT-042: Publish Audio Player](tasks/BT-042-publish-audio-player/README.md)

Site page and demo video are complete by Claude; BT-042 keeps them as a pointer only.

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
