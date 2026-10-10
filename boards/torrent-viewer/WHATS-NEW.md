# What's New — Torrent Viewer

## 1.10.0

- Interface text moved to a language pack (`lang/en.json`) so the board can be translated; requires Persephone with board bridge 1.36.0.

## 1.9.3

- Declared bridge permissions for the service and user-picked file operations.

## 1.9.2

- Fixed the service failing to start in an installed board (`process-exit-before-ready`): the bundle no longer needs the native WebRTC package, which the release does not ship. Peers connect over TCP, UDP and web seeds.

## 1.9.1

- Added a catalog screenshot for the board card in Search boards and Board Info.

## 1.9.0

- Moved status messages, retry actions, and the network indicator into Persephone's shared status bar.

## 1.8.0

- **SOCKS5 proxy.** The network indicator at the right of the status bar opens a Network dialog: choose Direct or a SOCKS5 proxy (host, port, optional login), **Test** it, and Save. Through a proxy, trackers, peers, and web seeds all connect via the proxy, and nothing falls back to a direct connection if it fails. DHT, uTP, local peer discovery, UPnP/NAT-PMP, and incoming peers are off, so magnet links without trackers may not load. UDP trackers work when the proxy relays UDP; **Test** says whether it does.

## 1.7.4

- The add field also accepts a bare info hash (40 hex characters, or the 32-character base32 form). The board builds a magnet link from it; with no trackers in that link, peers are found through DHT.
- **Remove all** in the Torrents header removes every torrent: ready ones leave the service, resolving ones are cancelled, and failed ones are dismissed.

## 1.7.3

- Provider status reports metadata connection, peer count, download speed, and requested-file progress without starting a torrent.

## 1.7.2

- The board itself now warns that the swarm connection is not anonymous when a torrent opens from a private or Tor browser session. Needs Persephone bridge 1.24.0; older hosts keep showing their own notice.

## 1.7.1

- Migrated service lifecycle handling to Persephone's host-managed API (bridge 1.22.0).

## 1.7.0

- File rows show the same icons as Persephone's Explorer panel. Requires Persephone 5.0.4 (bridge 1.18.0).
- Remove on a failed row also forgets its saved source when the failed attempt was started before a Reload board, so the source no longer resolves again on the next reload. Retry is offered on those rows too.
- A `.torrent` path that fails before its metadata arrives shows one failed row across reloads, not one per reload.
- Reload board and app restart no longer flash a "Resolving torrent" row for a saved `.torrent` file. A reload recognises the file as a torrent already listed instead of reading it again, and a local file never gets a placeholder row (it parses in well under a second).

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
