---
title: "Audio Player for agents"
audience: agent
summary: "Read and update the Audio Player catalog, inspect the current track, and control the active queue."
editorId: "board"
---

# Audio Player for agents

The full Audio Player page publishes `pages[pageId].editor.app`. Directly opened plain audio uses
light mode and has no model; catalog and playlist pages and direct opens without a source use full
mode. Track ids are stable catalog ids, and `href` is the original path or URL rather than a
temporary stream URL.

## Results

```text
listTracks({ limit: 1 }) -> { items: [{ id: "track-01", title: "First Light", href: "C:/Music/first-light.mp3", ... }], total: 1, truncated: false }
missingCategory({ limit: 1 }) / missingArtist({ limit: 1 }) / missingYear({ limit: 1 }) -> { items: [{ id: "track-01", href: "...", title: "First Light", missing: ["category" | "artist" | "year"] }], total: 1, truncated: false }
getCategories() -> [{ id: "Ambient", path: "Ambient", depth: 0, trackCount: 1 }]
getTags() -> [{ id: "calm", value: "calm", trackCount: 1 }]; getArtists() -> [{ id: "Aster Vale", name: "Aster Vale", trackCount: 1 }]
getNowPlaying() -> current track, mode, queue label, position, duration and paused state
updateTracks(["track-01"], { artist: "Aster Vale", year: 2024 }) -> { changed: true, ids: ["track-01"], patch: { artist: "Aster Vale", year: 2024 }, undoAvailable: true }
createCategory("Ambient/Drone") -> { created: "Ambient/Drone", categories: [...] }
renameCategory("Ambient", "Electronic") -> { from: "Ambient", to: "Electronic", categories: [...] }
moveCategory("Ambient/Drone", "Electronic") -> { path: "Ambient/Drone", parentPath: "Electronic", categories: [...] }
addTracksFromFolder("C:/Music", { parseMetadata: false }) -> { discovered, added, duplicates, unsupported }
play("track-01") -> { status: "playing", id: "track-01", href: "...", mode: "catalog" }
pause() -> { paused: true, nowPlaying: {...} }
next() at queue end -> { advanced: false, reason: "end-of-queue", nowPlaying: {...} }
next() with another item -> { advanced: true, href: "...", mode: "source" }
previous() at queue start -> { moved: false, reason: "start-of-queue" }
previous() with a previous item -> { moved: true, href: "...", mode: "source" }
setMode("catalog") -> { mode: "catalog", cursor: 0, queueCount: 12 }
setQueue({ mode: "source", hrefs: ["C:/Music/first-light.mp3"] }) -> { mode: "source", cursor: 0, queueCount: 1, selected: { id, href, title } }
undoLastBulkEdit() -> { changed: true, ... } or { changed: false, ... } when no safe undo remains
```

`next()` and `previous()` do not replace the queue. At the boundary they return the literal
no-movement objects shown above.
