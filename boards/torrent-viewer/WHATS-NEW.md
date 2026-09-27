# What's New — Torrent Viewer

## 1.5.0

- Resolved HTTP(S) `.torrent` sources are persisted as canonical magnets; unresolved and failed URLs are not persisted.

## 1.4.1

- A failed or cancelled resolve no longer destroys a torrent that another page is still resolving or already lists.

## 1.4.0

- Route claimed sources to one page per window and persist accepted source links for restart restore.

## 1.3.0

- Render the shared service inventory, including retained resolution outcomes, across board pages without moving torrent payload bytes.

## 1.2.0

- Claim browser `.torrent` downloads, read their source bytes through the board content pipe, and resolve them in memory without saving a file.

## 1.1.0

- Replaced the proof harness with the EPIC-114 two-pane metadata-only torrent viewer, including D5 links and explicit file actions.
- Added bounded metadata retry, reader-safe removal, and state-based service stopping after the last explicit remove.
