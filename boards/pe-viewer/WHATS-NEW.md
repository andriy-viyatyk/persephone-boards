# What's New — PE Viewer

## 1.1.0

- Interface text moved to a language pack (`lang/en.json`) so the board can be translated; requires Persephone with board bridge 1.36.0.

## 1.0.4

- Declared the board's bridge permissions.

## 1.0.3

- Reads the file as raw bytes instead of base64 — faster on large files, and files
  over ~400 MB can now be opened at all (base64 of one exceeded the browser's maximum
  string length). Requires Persephone 4.0.21.

## 1.0.2

- Added a catalog screenshot, shown on the board's card in Persephone's Search boards tab.

## 1.0.1

- Toolbar, tab strip, and table-header chrome now follows Persephone's own theme chrome color (Persephone 4.0.16+; unchanged look on older versions), with softer hover highlights.

## 1.0.0

- First release: read-only inspector for Windows PE binaries (`.exe`, `.dll`, `.sys`, `.ocx`, `.scr`).
- Overview: app icon, version/company/copyright, file type, security-mitigation chips (ASLR, DEP, CFG…), and key fingerprints.
- Headers: COFF + optional header fields and the data directories.
- Sections: virtual/raw sizes, permissions, and per-section entropy meters.
- Imports (grouped by DLL) and Exports.
- Digital signature: Authenticode presence, certificate type, and best-effort certificate names.
- Hashes: MD5, SHA-1, SHA-256, and imphash.
- Details: full version-info strings, embedded application manifest, debug/PDB path, and the Rich header.
- Packer/high-entropy hints (UPX, ASPack, Themida, VMProtect, …).
