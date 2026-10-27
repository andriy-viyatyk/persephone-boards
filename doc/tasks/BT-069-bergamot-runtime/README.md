# BT-069: Bergamot runtime

## Status

**Status:** In Progress
**Priority:** High
**Board id:** `translate` *(the `boards/translate/` folder this task produces or changes)*
**Started:** 2026-10-27
**Completed:** —

## Goal

Build the reusable translation engine module that the Translate board service process loads. It vendors Firefox's Bergamot WASM runtime, discovers and caches desktop translation models on demand, and translates text or HTML through a direct pair or an English pivot with a lifecycle that releases the grown WASM heap after idle.

## Background

- EPIC-135's [Research findings](../../../../persephone/doc/epics/EPIC-135.md#research-findings-2026-10-27), [Language coverage](../../../../persephone/doc/epics/EPIC-135.md#language-coverage), [Proof of concept](../../../../persephone/doc/epics/EPIC-135.md#proof-of-concept-2026-10-27), and [Plan → Translate board](../../../../persephone/doc/epics/EPIC-135.md#translate-board) set the product decisions. The PoC scripts and vendored files are in read-only `C:\projects\translate-poc`.
- **Board/service precedent:** `boards/speech-to-text/board-manifest.json` points `service` to `scripts/service.mjs`; its service owns download/remove/progress commands and settings, while `scripts/downloads.mjs` contains file-system and download helpers. Its data root is `%LOCALAPPDATA%\Persephone\board-data\speech-to-text` (`downloads.mjs:dataRoot`). The Translate service process is BT-070; BT-069 supplies the engine module it imports.
- **What is reusable:** follow Speech to Text's board-data-root convention, `.part` download/resume and atomic replacement, cancellable download tracking, throttled progress snapshots, explicit asset removal, persisted settings via `persephone.settings`, and idle unload behavior. Its Whisper-specific pinned asset registry, native child-process lifecycle, audio queues, and fixed-file SHA/size table do not apply directly. Board packages are independently zipped; there is no shared runtime package in this repo. Keep translation-specific helpers in `boards/translate/scripts/` unless the host later provides a genuinely shared module.
- **PoC engine facts:** `engine.mjs` loads the Firefox glue in a Node VM with `createRequire`, supplies `wasmBinary`, and builds aligned model buffers. Firefox's `content__translations-engine.worker.js` supplies model alignments (model 256 bytes; lex/vocab/srcvocab/trgvocab 64), config, HTML response options, pivoting and whitespace cleanup. `vendor/bergamot-translator-4.0.wasm` is 4,960,506 bytes; its JS glue is 100,187 bytes. The PoC's Bergamot notice is MPL-2.0. Keep the upstream license and provenance/version notice beside the unchanged files; if a vendored file is modified, mark the change and preserve its source-form notice.
- **Model registry facts:** the PoC reads Remote Settings v1 `main/translations-models-v2/records`; production must keep `https://firefox.settings.services.mozilla.com/v1/` as its single server-root constant, read `capabilities.attachments.base_url` from that root, then append each record's `attachment.location` to the advertised base URL. Do not hard-code the attachment CDN. The saved snapshot has 404 records and includes `sourceLanguage`, `targetLanguage`, `fileType`, dotted `version`, `architecture`, `filter_expression`, `attachment.{hash,size,filename,location,mimetype}`, `decompressedHash` and `decompressedSize`. Model artifacts are zstd attachments. `fetch-assets.mjs` chooses the greatest dotted numeric version for each requested pair and calls Node's `zstdDecompressSync`; unlike that PoC script, production must verify hashes before committing files to cache.
- **Memory facts:** the EPIC table records process peaks of 327–495 MiB and WASM heaps growing to 235–434 MiB after translation. The PoC report measured an additional ~43 MB heap when loading a second model in one instance; Emscripten does not shrink its heap, and reducing `workspace` 128→16 did not change the result. Keep one WASM instance and its loaded models in one worker thread, load models lazily, cap work per WASM call, and terminate that worker after idle to release memory. Restarting the worker costs a WASM compile (~5 MB) plus about 100 ms per model; keeping an idle worker retains 235–434 MiB.
- **Host runtime:** Persephone starts board services with `utilityProcess.fork` in `src/main/module-service-supervisor.ts` (around line 956), which runs `assets/module-service-host.mjs`. The PoC only verified `node:worker_threads` in plain Node. Before choosing the worker architecture, verify worker creation from the actual service host and check RSS before and after terminating the worker; the agent sandbox's `EPERM` on nested spawn does not establish Electron utility-process behavior.
- **CLD2 boundary:** the PoC proves Firefox's CLD2 works in a Node worker and distinguishes `zh` from `zh-Hant`, but EPIC-135 assigns language detection and CLD2 vendoring to BT-070. Do not add CLD2 to BT-069 unless the runtime API is deliberately expanded to own detection; the current scope keeps detection outside this engine.
- **Package size:** `scripts/publish-board.mjs` zips board contents, excluding `node_modules`, and records the resulting size and SHA-256; it has no project-specific package-size threshold. The vendored WASM+glue add about 4.9 MiB before compression. Models stay in the per-user cache and are never bundled. GitHub documents a maximum individual release asset size under 2 GiB and no total release-size cap ([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)).

## Implementation Plan

Paths below are for the board that BT-070 creates. The service process is owned by BT-070; this task provides its engine and asset modules.

- [x] **First, verify the host runtime:** *(verified 2026-10-27 by Claude in an Electron 43 `utilityProcess.fork` child: es→en download + 40-item translation ran in the worker; RSS 158 MB before, 409 MB loaded, 214 MB 2 s after `close()` — the worker architecture stands.)* from a board service started by Persephone's `utilityProcess.fork`, create a `Worker` from `node:worker_threads`, load/translate with it, terminate it, and check process RSS before and after termination. The PoC only established this in plain Node. If workers cannot run there or termination does not return the worker's memory, run WASM in the service process and rely on the host's idle-unload to restart that service process.
- Prepared check for BT-070 integration (run temporarily in its service process after the runtime import; the service must have the verified `es→en` model installed):

  ```js
  const runtime = createBergamotRuntime({ idleMinutes: 1 });
  const before = process.memoryUsage().rss;
  await runtime.translate({ from: "es", to: "en", items: ["Hola mundo."] });
  const loaded = process.memoryUsage().rss;
  await runtime.close(); // terminates the worker thread
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const terminated = process.memoryUsage().rss;
  console.log({ before, loaded, terminated, workerRssDelta: loaded - before, released: loaded - terminated });
  ```

  Confirm translation succeeds in the utility process and `terminated` trends back toward `before`. Keep this runtime out of the final service startup path after checking.
- [x] Vendor the known-working Bergamot 4.0 WASM and Firefox glue in `boards/translate/vendor/bergamot/` from the PoC copies. Include the MPL-2.0 license, upstream source/version/collection identifiers and a `NOTICES.md`; do not vendor the PoC's experiment-only `engine.mjs` unchanged. Keep the shipped files unchanged where possible and retain notices for any additional Firefox-derived code.
- [x] Implement `boards/translate/scripts/translation-assets.mjs` for Remote Settings discovery, model downloads, cache inspection and removal. Fetch `translations-models-v2` records, select only the newest eligible dotted numeric version for each directed language pair, collect every file type for that exact version, and reject incomplete/ambiguous sets. Do not pin a specific model version; retain only the selected record metadata needed for that request and integrity checks.
- [x] Accept model records only when `filter_expression` is empty or exactly `env.appinfo.OS != 'Android'`. Skip every other expression, including Android and channel-filtered records, and log each skipped expression once. Keep the chosen records/version stable for the duration of a download/translation request.
- [x] Resolve model attachments through Remote Settings capabilities: use one `RS_SERVER_ROOT` constant set to `https://firefox.settings.services.mozilla.com/v1/`, read `capabilities.attachments.base_url` from the server root response, and append `attachment.location`. Never hard-code the CDN host.
- [x] Store mutable files below `%LOCALAPPDATA%\Persephone\board-data\translate\models\<from>-<to>\<version>\`; keep the registry snapshot/cache separately under the same board-data root. Never write models into the board installation folder. Cache the decompressed files and a small metadata manifest identifying version, file type, sizes and verified hashes.
- [x] Download each compressed attachment to a resumable `.part.zst` file and report downloaded bytes/total plus phases. Verify the compressed `attachment.hash` where present, decompress with Node `node:zlib` zstd support, verify the output size against `decompressedSize` and SHA-256 against `decompressedHash`, then atomically rename verified files into the versioned cache. Delete corrupt partials and never expose an unverified model as installed. Emit progress at a throttled cadence and a terminal ready/failed/cancelled state, following `speech-to-text/scripts/service.mjs:beginDownload`.
- [x] Implement `boards/translate/scripts/bergamot-runtime.mjs` as the service-facing facade and `boards/translate/scripts/bergamot-worker.mjs` as a Node `Worker` entry point. The facade verifies/downloads assets and sends model paths or bytes to the worker; the worker owns exactly one WASM module and one `BlockingService`, lazily loads model pairs into that instance, and returns keyed text/HTML results. Keep all WASM objects and model memory inside the worker.
- [x] Follow Firefox's model construction details from the PoC: aligned file buffers; `qualityScores: false`, `alignment: true`, and `html` set per item; free response/vector allocations in `finally`; use two-hop translation by calling the WASM binding exactly as `engine.mjs` does at line 122: `engine.service.translateViaPivoting(engine.first.model, engine.second.model, messages, options)`. `translateViaPivoting` is an embind method exposed by the WASM module, not a method implemented in the glue JS. For a pair with no direct model, resolve `from→en` then `en→to`; avoid a redundant hop when source or target is English and pass through unchanged when source equals target. Return a clear unavailable-pair error when either leg is absent.
- [x] Match Firefox worker text handling: preserve leading/trailing whitespace around the translated core, remove soft hyphens before inference, never send an empty core, and restore the exact surrounding whitespace. HTML mode translates the fragment while preserving inline markup, as verified by the PoC. Keep the pipeline's distinction between HTML fragments and plain text; do not parse/serialize HTML in the runtime.
- [x] Bound each call into WASM by a small item and combined-text cap so long pages are split at item boundaries and heap growth is limited. Start with at most 8 items / 8,192 UTF-16 code units per WASM call; leave a single oversized HTML item indivisible and return a clear size error rather than corrupting markup. These are conservative starting values, not PoC measurements; tune only from observed memory/latency.
- [x] Expose worker idle timeout control to the service with setting id `idle-unload-minutes`, default 3 minutes, bounded to 1–120. Terminate and recreate the worker when idle, and reset its timer on model load/use. Ensure in-flight work prevents termination. Restarting costs a WASM compile (~5 MB) plus about 100 ms per model, while an idle worker retains 235–434 MiB; terminating the worker—not merely clearing model references—is required to return Emscripten's grown heap.
- [x] Support removal of an installed directed pair/version: stop or restart the worker if it holds the model, delete only that pair's cache entries and partial files, refresh installed-state metadata, and leave unrelated pairs intact. While offline, permit translation from verified cached models and a cached registry snapshot; if a requested model is not cached and neither source is reachable, return an actionable offline error without damaging existing cache.
- [ ] Integrate the facade into BT-070's service process using the same management-channel pattern as Speech to Text for list/download/cancel/remove/progress. Keep this engine independent of the `text.translate@1` transport details; BT-070 maps service requests and progress into that interface.

## Concerns / Open Questions

- **Mirror follow-up:** v1 has no mirror. Revisit a mirror only if Mozilla changes or removes the Remote Settings attachment layout; the advertised `capabilities.attachments.base_url` keeps that layout indirect and configurable.
- The selected model version is the newest eligible Remote Settings version; no version pin or fallback model list is part of v1.
- **Batch cap:** 8 items / 8,192 UTF-16 code units is a conservative implementation starting point, not a measured safe maximum. Confirm against representative browser fragments and memory telemetry during BT-070 integration.
- **Host worker verification:** the PoC's worker-thread result came from plain Node, not Electron's utility process; use the first implementation step to choose between a worker and service-process WASM with host idle-unload.
- Mozilla provides the Remote Settings records and attachments, but EPIC-135 notes there are no stated terms for third-party application downloads; record any licensing/provenance review before release.

## Acceptance Criteria

- [ ] BT-070 can import the runtime module from its service process and translate through Bergamot WASM 4.0 using a verified cached model.
- [x] The engine discovers the attachment base URL from Remote Settings server capabilities, selects and downloads the newest eligible desktop model set from `translations-models-v2`, reports progress, decompresses zstd, and refuses installation if `decompressedHash` or declared size does not match.
- [x] A model pair not cached can be installed online, while a verified cached pair continues to work offline; model removal affects only the selected pair/version.
- [x] Direct, English-pivot, no-op same-language, text, and HTML requests behave as specified; whitespace and soft-hyphen handling matches Firefox's worker behavior.
- [ ] The verified service-host execution path owns one WASM instance, loads models lazily, respects the per-call cap, and releases its memory after the configured 3-minute idle timeout (worker termination, or host idle-unload fallback).
- [x] Vendored Bergamot files retain MPL-2.0 notices and source/version provenance. CLD2 remains BT-070 scope unless this task's boundary is revised.
- [ ] Board package contains only engine assets and code, not downloaded translation models; measured ZIP size is recorded for BT-070 release planning.

## Files Changed

| File | Change |
|------|--------|
| `boards/translate/vendor/bergamot/bergamot-translator-4.0.wasm` | New — Firefox Bergamot WASM runtime |
| `boards/translate/vendor/bergamot/bergamot-translator.js` | New — Firefox's matching JS glue |
| `boards/translate/vendor/bergamot/LICENSE` | New — MPL-2.0 notice |
| `boards/translate/vendor/bergamot/NOTICES.md` | New — upstream provenance, version, source and modification record |
| `boards/translate/scripts/translation-assets.mjs` | New — Remote Settings registry, download, verification, cache and removal |
| `boards/translate/scripts/bergamot-runtime.mjs` | New — service-facing runtime facade and worker lifecycle |
| `boards/translate/scripts/bergamot-worker.mjs` | New — isolated WASM instance, lazy models and translation calls |
| `boards/translate/board-manifest.json` | BT-070 integration — board data root settings are supplied by the provider board |
| `boards/translate/scripts/service.mjs` | BT-070 integration — imports engine and maps management/service messages |
| `doc/active-work.md` | Link the BT-069 dashboard entry to this task document |

## Notes

- Plain Node end-to-end verification succeeded from the board folder. A current Remote Settings `es→en` model (version `3.0`) downloaded and verified in scratch cache `C:\Users\ANDRII~1\AppData\Local\Temp\bt069-final-DFXm7B`; text and HTML translations passed. English-pivot, same-language, whitespace and soft-hyphen behavior also passed against copied PoC model files in a separate scratch cache. These are temporary caches, not board contents.
- The BT-069 scripts plus Bergamot vendor payload compressed to **1,824,133 bytes** in a temporary ZIP. This measurement excludes BT-070's manifest/service and any board UI; remeasure the finished board package during BT-070.

- The PoC's `fetch-assets.mjs` is a useful algorithm reference, not production-ready: it hard-codes the CDN URL, writes files directly, doesn't verify `decompressedHash`, and applies a simple Android substring filter. Production must discover the advertised attachment base URL, verify before atomic cache installation, and apply the exact v1 filter policy above.
- The vendored Bergamot pair is about 4.9 MiB before ZIP compression, and the runtime package has no observed repository-specific size cap. Do not bundle translation models; they are downloaded to the per-user board-data folder.
- CLD2's PoC files are `cld2__cld-worker.js` (~156 KB), `.mem` (~1.1 MB), and an Apache-2.0 license. Detection belongs to BT-070 per EPIC-135, so these are intentionally not listed as BT-069 deliverables.
- `engine.mjs` line 122 calls `engine.service.translateViaPivoting(...)`; this confirms the pivot method is surfaced by the WASM bindings and can be called through the same service object. It is not implemented in `bergamot-translator.js` glue.
- No implementation or tests are part of this task document turn.
