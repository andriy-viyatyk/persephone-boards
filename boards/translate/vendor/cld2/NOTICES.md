# CLD2 notices

Vendored from Firefox's translation language detection worker, supplied in the read-only
`C:/projects/translate-poc/vendor/` directory:

- Upstream worker filename: `cld2__cld-worker.js` (copied unchanged)
- Companion data filename: `cld2__cld-worker.js.mem` (copied unchanged)
- License: `LICENSE`, copied from `cld2__LICENSE` (Apache License 2.0)

The detector is adapted at runtime by `scripts/cld2-worker.mjs`; the vendored files themselves
are unmodified. CLD2 is run only in a dedicated Node worker thread, never on the board UI thread.
