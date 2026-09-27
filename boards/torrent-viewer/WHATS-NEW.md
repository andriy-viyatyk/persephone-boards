# What's New — Torrent Viewer

## 1.6.0

- New board icon (the µTorrent logo) on the tab, the main-editor tile, and the sidebar.
- Remove takes effect at once, even while another page is playing one of the torrent's files. That page's next read fails instead of adding the torrent back.
- A removed torrent leaves the list at once; it no longer comes back for up to a minute.
- A cancelled resolve leaves the list at once and is not saved for restart.
- A failed resolve's row has Retry and Remove on its right-click menu.
- A failed resolve (a 30-second metadata timeout, say) no longer raises an error toast; its message goes to the status bar and the row shows a failed badge.
- Opening a .torrent file for a torrent that is already listed selects it instead of failing with "Cannot add duplicate torrent", and does not save the file as a second source for it.
- A resolved torrent's right-click menu adds Copy magnet link, Copy info hash, and Save .torrent. They work whatever the torrent was opened from: WebTorrent rebuilds the magnet and the .torrent from the metadata.
- Reloading the board no longer adds another "Resolution failed" row for the same torrent, and no longer fails with "Cannot add duplicate torrent" when the reload lands mid-resolve.
- Redesigned page: Explorer-style torrent and file lists with a resizable splitter, one status bar at the bottom, the magnet input under the torrent list, and Open .torrent on the page toolbar.
- Badges on each row: download speed and peers for a torrent, size and download percentage for a file; hover a badge for the full figures.

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
