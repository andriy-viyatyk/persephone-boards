# Bergamot runtime notices

- `bergamot-translator-4.0.wasm` is Mozilla Firefox's Bergamot Translator WebAssembly
  runtime, version 4.0, from the Firefox Translations component.
- `bergamot-translator.js` is the matching Emscripten JavaScript glue from
  `toolkit/components/translations/bergamot-translator/bergamot-translator.js`.
- Upstream source: <https://github.com/mozilla-firefox/firefox/tree/main/toolkit/components/translations>
- WASM registry record: Remote Settings `main/translations-wasm-v2`, record
  `bergamot-translator`, version `4.0`.
- JavaScript source identifier: Firefox Translations component source file
  `bergamot-translator/bergamot-translator.js` on the upstream `main` branch.
- The PoC acquisition date was 2026-10-27. The PoC supplied the WASM versioned 4.0
  and the matching JS glue. The exact upstream commit was not recorded by the PoC.
- Both vendored files are byte-for-byte unchanged from
  `C:/projects/translate-poc/vendor/`.
- The upstream MPL-2.0 license is included as `LICENSE`.

No Firefox worker or other Firefox-derived implementation file is copied into this
board. The runtime implementation in `scripts/` is an independent Node adapter based
on the PoC algorithms and Firefox's published model construction behavior.
