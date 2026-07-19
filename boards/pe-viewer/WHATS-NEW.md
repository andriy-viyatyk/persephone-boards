# What's New — PE Viewer

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
