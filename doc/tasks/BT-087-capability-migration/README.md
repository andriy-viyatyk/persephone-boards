# BT-087: Migrate capability declarations and add agent-shaped methods

## Status

**Status:** Active  
**Priority:** High  
**Board ids:** `cert-viewer`, `theme-editor`, `translate`, `speech-to-text`  
**Epic:** [Persephone EPIC-140](../../../../persephone/doc/epics/EPIC-140.md)

## Goal

Describe four boards' existing capabilities explicitly and add cancellable, agent-friendly translation and WAV transcription calls in their providing services. Preserve existing open intents and v1 streaming consumers.

## Background

The normative contract is `C:/projects/persephone/assets/guides/agents/capabilities.md`; see also `C:/projects/persephone/doc/architecture/capabilities.md` and tasks US-1795, US-1796 and US-1797 in `C:/projects/persephone/doc/tasks/`. Live MCP `capabilities.$help` and per-capability help show `certificate.view` and `theme.edit` as `open`; `text.translate` and `speech.transcribe` currently expose channels only. `capabilities.list()` is the legacy open-intent view.

- **Compatibility:** Keep both service boards' `serviceInterfaces` arrays verbatim. `mergeCapabilityDeclarations` in `C:/projects/persephone/src/shared/capability-contract.ts` first copies explicit methods and synthesizes legacy channel names only when absent; it synthesizes `open` only for a declaration **without** `methods`. `board-trust-service.ts` includes declarations in `legacyCapabilities` only when they have no methods or include an `open` method. `capability-registry.ts` builds `legacyRegistrations` from that list, which `capability-router.ts` uses for legacy resolution. Thus the two new channel/call-only entries neither add an open intent nor make `app.capabilities.invoke` open a service board.
- **Channel route:** Unified `capability-router.ts` `invokeChannel` sets `openMessage.type` to the explicit method name, and `module-service-supervisor.ts` `openCapabilityChannel` delivers it with the same interface id/version and caller information to the existing `onChannel`. The provider's existing policy check and v1 message handling remain the same. The host's separate legacy `connectHostServiceChannel` checks `HOST_SERVICE_CHANNEL_POLICIES` and `serviceInterfaces`; `connectServiceChannel` checks the latter and consumer `uses`. The unified path does **not** itself run that host-only open-type allowlist: it authorizes the declared method through the capability router. Do not state that the two paths literally run the same host policy check.
- **Old app:** At tag `v5.0.17`, `src/renderer/editors/board/board-manifest.ts` `normalizeCapabilities` ignores `methods`, and `custom-editor-registry.ts` registers every normalized capability as an open intent. A service-only declaration would therefore become a bogus page intent. A viewer's `methods.open` would still be treated as the old open intent, but 5.0.17 would ignore its new metadata and not expose the new surface; use the requested `minAppVersion: "5.0.18"` consistently for all four. `C:/projects/persephone/package.json` currently says `5.0.18`; this plan requires the build containing EPIC-140, not merely an older build with the same version string.
- **Trust and callers:** `board-trust-service.ts` compares normalized `permissions` and `uses` with the grant, not `capabilities`, `serviceInterfaces`, or version. With both grant fields unchanged this update does not itself re-prompt trust. Main assigns caller kind from the authenticated route in `capability-router.ts` and `module-service-supervisor.ts`; a manifest author/name cannot choose that kind. Do not use `ctx.caller.id`: the author/name-based id is spoofable between trusted boards (US-1795). `permission-denied` and `rejected` are valid capability error codes in `src/shared/capability-contract.ts`.
- **Versions:** `git ls-remote --tags origin` verified current tags `cert-viewer-v1.1.0`, `theme-editor-v1.2.0`, `translate-v1.0.0`, and `speech-to-text-v1.4.1`. Each is released; next versions are respectively **1.1.1**, **1.2.1**, **1.0.1**, **1.4.2**. Create those headings and add one line under each. Recheck remote tags before eventual release; publishing is outside this task.
- **Service calls:** Register `persephone.capabilities.handle` synchronously during startup, before awaiting settings or other initialization. The handler receives positional JSON `args` and `ctx.signal`; bridge `1.50.0` is required. Keep existing consumers on `persephone.services.connect/list` rather than adopting `getCapability` (which requires bridge 1.51.0 and adds churn). No `uses` or permission changes.

## Implementation Plan

Snippets below show exact relevant before → after replacements or additions; omitted surrounding manifest fields remain unchanged. Handler snippets are insertion points and interface-level pseudocode for the helpers specified immediately beneath them, not a claim that those helpers already exist.

### Phase 1 — Certificate Viewer and Theme Editor

- [x] In `boards/cert-viewer/board-manifest.json`, change `version` `"1.1.0" → "1.1.1"`, `minAppVersion` `"5.0.10" → "5.0.18"`; leave bridge `1.36.0`. Replace the capability object:

```json
// Before
{ "id": "certificate.view", "version": 1, "title": "View certificate", "priority": 50, "alwaysOpensNewPage": true }
// After
{
  "id": "certificate.view", "version": 1, "title": "View certificate", "priority": 50,
  "alwaysOpensNewPage": true,
  "methods": {
    "open": {
      "kind": "open", "summary": "View a certificate chain.",
      "args": [{ "name": "payload", "type": "{ title: string, certificates: string[], source?: { url: string } }", "description": "Title and base64 DER certificates in leaf-first order." }],
      "returns": "null"
    }
  }
}
```

The JSON comments mark alternatives and are not literal manifest content. `boards/cert-viewer/app.js` validates `title`, `certificates` and optional `source.url`, opens a fresh page and calls `request.resolve()`. Verify the actual agent result on the running build when implementing; the method metadata describes its result only.

- [x] In `boards/theme-editor/board-manifest.json`, change `version` `"1.2.0" → "1.2.1"`, `minAppVersion` `"5.0.10" → "5.0.18"`; leave bridge `1.36.0`. Replace:

```json
// Before
{ "id": "theme.edit", "version": 1, "priority": 50, "title": "Theme Editor" }
// After
{
  "id": "theme.edit", "version": 1, "priority": 50, "title": "Theme Editor",
  "methods": {
    "open": {
      "kind": "open", "summary": "Create or edit a theme.",
      "args": [{ "name": "payload", "type": "{ mode: 'new' } | { mode: 'edit', themeId: string }", "description": "Create a theme or edit an existing theme by id." }],
      "returns": "{ accepted: boolean }"
    }
  }
}
```

`boards/theme-editor/app.js` `validateThemeEditIntent` enforces precisely these two shapes and `request.resolve({ accepted: true })` reports acceptance; preserve its existing draft decision and page reuse behavior.

- [x] Add `## 1.1.1\n- Improved certificate capability discovery.` to `boards/cert-viewer/WHATS-NEW.md` and `## 1.2.1\n- Improved theme editing capability discovery.` to `boards/theme-editor/WHATS-NEW.md`.
- [ ] **MCP manual checks (5):** (1) `capabilities["certificate.view"].$help`; verify payload, selected provider and timeout. (2) Call its `open` with a non-personal valid DER certificate in canonical base64; verify a fresh page and result. (3) `capabilities["theme.edit"].$help`; call `open({mode:"new"})` and verify the editor opens. (4) Through `script.execute`, use `app.capabilities.invoke` for each same payload; verify the old open paths still work. (5) Read both boards' `ui.log` via the available MCP filesystem surface; no new errors or CSP violations.

### Phase 2 — Translate

- [x] `boards/translate/board-manifest.json`: change `version` `"1.0.0" → "1.0.1"`, `minAppVersion` `"5.0.15" → "5.0.18"`, `minBridgeVersion` `"1.42.0" → "1.50.0"`. Keep the existing `serviceInterfaces` unchanged; insert the following sibling after it (before: no `capabilities` field):

```json
"capabilities": [{
  "id": "text.translate", "version": 1, "title": "Text Translation",
  "methods": {
    "describe": { "kind": "channel", "summary": "Describe available language pairs.", "args": [{ "name": "options", "type": "{}", "optional": true, "description": "Empty channel options." }] },
    "detect": { "kind": "channel", "summary": "Detect the language of a text sample.", "args": [{ "name": "options", "type": "{ text: string, htmlLang?: string }", "description": "Text and optional HTML language hint." }] },
    "translate": { "kind": "channel", "summary": "Translate a batch of text or HTML items.", "args": [{ "name": "options", "type": "{ id: string, to: string, from?: string, priority?: string, items: Array<{ key: string | number, text: string, format: 'text' | 'html' }> }", "description": "V1 translation batch; omit type." }] },
    "download": { "kind": "channel", "summary": "Download a language pair with progress.", "args": [{ "name": "options", "type": "{ from: string, to: string }", "description": "Directed language pair; omit type." }] },
    "translateText": {
      "kind": "call", "summary": "Translate plain text using installed models.",
      "args": [
        { "name": "text", "type": "string", "description": "Plain text, up to 64,000 Unicode code points." },
        { "name": "to", "type": "string", "description": "Target language code." },
        { "name": "from", "type": "string", "optional": true, "description": "Source language code; detect when omitted." }
      ],
      "returns": "string", "timeoutMs": 180000
    }
  }
}]
```

- [x] `boards/translate/scripts/service.mjs`: add this registration **before** the existing `persephone.service.onChannel(...)`; the existing channel registration remains:

```js
// Before: detection = new LanguageDetection(); then onChannel(...)
// After:
detection = new LanguageDetection();
persephone.capabilities.handle("text.translate", "translateText", async ([text, to, from], ctx) => {
  await settingsReady;
  authorizeTranslationCall(ctx.caller.kind);
  return await translateOneText(text, to, from, ctx.signal);
});
persephone.service.onChannel(async (channel, open, info) => {
  // existing handler remains
```

Implement `authorizeTranslationCall` and `translateOneText` in this file. Allow `agent` and `platform`; for `board-page` / `board-service`, require `settings.approval === "accept-granted"`, otherwise throw `Object.assign(new Error("This provider does not accept board callers."), {code:"permission-denied"})`. Since the call route does not identify same-board ownership securely, treat all board-routed calls as cross-board; existing same-board page channels remain unchanged.

Build a single-item `open` object (`id` nonempty, `to`, optional `from`, `priority:"background"`, `items:[{key:"text",text,format:"text"}]`) and reuse `validateTranslate` and the existing 64,000-code-point / 1 MiB validation. Extract shared preparation from `acceptTranslate`: `selectedModels`, CLD2 `detection.detect` on the first 4,096 code units when `from` is absent, then `routeFor` / `routeLegs`. If no supported route exists, reject with `rejected` and name `from → to`; if a required model is missing, reject with `rejected`, name the pair and say to install it in the Translate board's language manager. Never download.

Reuse the **same** priority queue and `runTranslation`, rather than invoking Bergamot concurrently with channel work. Refactor its job completion boundary to support either the existing channel or a promise sink: preserve channel progress/result/error messages byte-for-byte; resolve the call to the sole successful item's `text`, reject on an item error. Connect `ctx.signal` to `cancelJob`, including removal of queued work, active `job.controller.abort`, immediate already-aborted handling, single settlement and listener cleanup. `runtime.translate` already accepts that controller's signal. Keep `onShutdown` cancellation for both sinks. `180000` ms allows cold WASM/model loading plus work; it is a deadline including queue time, not a guarantee on very slow hardware.

- [x] Add `## 1.0.1\n- Added agent-friendly text translation and capability discovery.` to `boards/translate/WHATS-NEW.md`.
- [ ] **MCP manual checks (6):** (1) `capabilities["text.translate"].$help` shows the four channels and `translateText(text,to,from?)`, with no open. (2) With an English→Ukrainian model already installed, call `capabilities["text.translate"].translateText` with args `["Hello","uk","en"]`; confirm translated string; repeat without `from` using enough text to detect. (3) Request a known uninstalled supported pair and confirm pair-specific language-manager guidance and no download. (4) In a trusted test board with a `text.translate@1` `uses` grant and bridge 1.51.0, set provider policy to `same-board-only`; invoke `getCapability("text.translate").translateText(...)` from that board page and confirm `permission-denied`; restore the original setting. (5) Open Translate board, translate the same sample through its existing page channel; verify result. (6) Read its `ui.log`; no new errors. Use only preauthorized test boards/grants; do not change trust as part of this task.

### Phase 3 — Speech to Text

- [x] `boards/speech-to-text/board-manifest.json`: change `version` `"1.4.1" → "1.4.2"`, `minAppVersion` `"5.0.15" → "5.0.18"`, `minBridgeVersion` `"1.43.0" → "1.50.0"`. Keep `serviceInterfaces` unchanged; add sibling (before: no `capabilities` field):

```json
"capabilities": [{
  "id": "speech.transcribe", "version": 1, "title": "Speech to Text",
  "methods": {
    "describe": { "kind": "channel", "summary": "Describe the transcription engine and limits.", "args": [{ "name": "options", "type": "{}", "optional": true, "description": "Empty channel options." }] },
    "transcribe": { "kind": "channel", "summary": "Stream PCM audio for transcription.", "args": [{ "name": "options", "type": "{ format: { encoding: 'pcm-s16le', sampleRate: 16000, channels: 1 }, languages?: string[], prompt?: string, live?: boolean, translate?: boolean }", "description": "V1 stream options; omit type." }] },
    "transcribeFile": {
      "kind": "call", "summary": "Transcribe a local PCM16 or float32 WAV file.",
      "args": [
        { "name": "path", "type": "string", "description": "Absolute path to a WAV file, at most 32 MiB and five minutes." },
        { "name": "options", "type": "{ language?: string }", "optional": true, "description": "Optional supported language code; otherwise use the board language settings." }
      ],
      "returns": "{ text: string, language: string | null, audioMs: number, elapsedMs: number }",
      "timeoutMs": 600000
    }
  }
}]
```

- [x] `boards/speech-to-text/scripts/service.mjs`: insert the synchronous registration before `persephone.service.onChannel`:

```js
// Before: settingsReady initialization, then onChannel(...)
// After: same initialization, then
persephone.capabilities.handle("speech.transcribe", "transcribeFile", async ([filePath, options], ctx) => {
  if (ctx.caller.kind === "board-page" || ctx.caller.kind === "board-service")
    throw Object.assign(new Error("Board callers must stream audio through speech.transcribe."), { code: "permission-denied" });
  await settingsReady;
  return await transcribeWavFile(filePath, options, ctx.signal);
});
persephone.service.onChannel(async (channel, open, info) => {
  // existing handler remains
```

Allow agent and platform; reject both board kinds before reading or probing the path, independent of `caller-approval-policy`. Existing channels keep `checkCaller(info)`. Validate absolute nonempty path, options object and supported `language` using `languageNameForCode`; no `ctx.caller.id` decision. Enforce one regular file, maximum **32 MiB** (33,554,432 bytes), check size before allocation and again during bounded read to handle file changes. A capability call may read an arbitrary local file only for agent/platform callers; this is a service-owned filesystem operation and does not change the board's page `fileSystem` grant.

Before decoding check `getActiveModel()`, `installedModel(model)`, and `installedRuntime()`; if either missing, reject with code `rejected` and the exact channel message: `Install the whisper.cpp runtime and choose an installed model in the Speech to Text board.` (`not-ready` is a channel protocol code, not a capability error code). Never download. Reject invalid paths, unsupported formats, bad headers and over-limit input with `rejected` and actionable messages.

Add `boards/speech-to-text/scripts/wav-file.mjs`: parse little-endian RIFF/WAVE with bounded chunk traversal and even-byte padding, validate RIFF length, `fmt ` and `data`, integer PCM format 1 / 16-bit or IEEE float format 3 / 32-bit (also WAVE_FORMAT_EXTENSIBLE only when its PCM/float subtype and valid bits match), channel count, sample rate, block alignment and data length. Reject other encodings with “Supported: WAV PCM 16-bit or IEEE float 32-bit.” Downmix all channels by arithmetic mean, clamp finite float samples to [-1,1], linearly resample to 16 kHz, quantize to signed 16-bit little-endian; reject NaN/infinite samples and malformed or partial frames. Preserve any positive sample rate/channel count that fits valid WAV fields and the byte/duration limits. Reject duration > `MAX_AUDIO_MS` (five minutes) before allocating resampled output. The 32 MiB cap bounds high-rate/multichannel input, while five minutes matches the existing non-live channel.

Use the existing shared `queue`, `infer`, `makeWav`, language selection and `pumpQueue` instead of starting a competing whisper-server request. Refactor `terminal` and the pump to support a promise result sink alongside the existing channel sink; retain current channel status/result/error messages exactly. Construct a non-live request with decoded mono PCM chunks, `bytes`, `totalSamples`, `languages: options.language ? [options.language] : []`, empty prompt and existing timestamps/fields; enqueue `final`. Resolve only `{text, language: result.language || null, audioMs, elapsedMs}`, all JSON-safe. Tie the signal to `removeJobs`, mark the request terminal, abort the currently assigned `request.controller`, and reject once; remove listeners and buffers on all exits. The pump currently **replaces** `request.controller` before and after `ensureEngine`: wire the signal to each replacement and check abort after `ensureEngine` so cancellation cannot be lost; do not kill a shared engine during another request. `inferOnce` passes `request.controller.signal` to `fetch`.

The maximum `600000` ms includes cold model startup, queueing and inference. At an estimated 0.5× real-time CPU throughput, five minutes audio takes ten minutes even before startup; this is a ceiling, not a guarantee. Slower CPUs or long queues can time out. Prefer short files or GPU; do not silently truncate.

- [x] Add `## 1.4.2\n- Added agent-friendly WAV transcription and capability discovery.` to `boards/speech-to-text/WHATS-NEW.md`.
- [ ] **MCP manual checks (6):** (1) `capabilities["speech.transcribe"].$help` shows `describe`, `transcribe`, `transcribeFile` and no open. (2) Create a scratch `BT-087-tone.wav` with a generated one-second 440 Hz mono PCM16 16 kHz tone using a local script through MCP `script.execute` and the documented filesystem API; it contains no voice or personal data. With runtime/model already installed call `transcribeFile` with its absolute path; confirm JSON fields and no crash (silence/tone may yield empty or arbitrary text). Remove the scratch file after checks. (3) Call on a non-WAV file and verify supported-format error; exercise missing runtime/model only in an existing suitable test installation, without removing user assets. (4) From a pretrusted board with `speech.transcribe@1` `uses` and bridge 1.51.0, invoke `transcribeFile` via `getCapability` and verify `permission-denied` before any path read. (5) Exercise Agent Chat's existing dictation using a pre-existing non-personal audio input or loopback test source; verify its legacy `services.connect` transcribe channel and result. Do not record the user. (6) Read Speech to Text and Agent Chat `ui.log`; no new errors.

## Deferred / not in this task

- **Text to Speech:** `speech.synthesize.speak` already names a channel. The future contract revision and `speak`/`stop` playback via US-1790 audio belong to BT-084 (EPIC-139); no Text to Speech files change here.
- **Wake Word:** revised `speech.wake` contract belongs to BT-085 (EPIC-139); no Wake Word files change here.
- **Agent Chat:** leave `serviceInterfaces` and legacy `list-sessions` projection intact: the hyphen is invalid in new method names. Its existing `speech.transcribe` `uses`, `services.list` and `services.connect` calls remain. EPIC-139's BT-086 owns its voice-assistant changes.
- **`record`:** defer until US-1790 provides platform audio; Speech to Text's microphone capture lives in its page and its service has no documented route to command that page. A follow-on Speech to Text task after US-1790 owns this method.

## Concerns

- MCP interruption does not currently abort an in-flight capability call; the normative guide documents that the deadline still applies. Handle `ctx.signal` for supported cancellation, caller closure and deadline; do not promise agent-turn interruption until Persephone adds propagation.
- A five-minute file can exceed the 10-minute ceiling on slow machines. The deadline is deliberate and must surface a timeout, never a partial successful transcript.
- Service APIs are privileged; routing only agent/platform file reads avoids letting a granted board ask this provider to read arbitrary files. Validate the caller before filesystem access.

## Acceptance Criteria

- [ ] Four manifests expose the specified methods with 5.0.18 minimum; service interfaces, grants, page intent behavior and v1 channels remain compatible. Service-only entries do not appear as legacy open intents.
- [ ] `translateText` uses installed models, detects omitted source, reports missing pair, shares queue, enforces caller policy and responds to supported cancellation.
- [ ] `transcribeFile` accepts bounded PCM16/float32 WAV, rejects board callers before file access, shares Whisper queue, reports missing assets, observes cancellation and returns the documented JSON.
- [ ] Each phase's MCP checks pass; `ui.log` is clean; no test harness or unit tests are added.
- [ ] Versions and one-line changelogs match the remote-tag inventory; no publishing, Persephone app code, or deferred board changes.

## Files needing no changes

`boards/cert-viewer/app.js`, `boards/theme-editor/app.js`, `boards/translate/app.js`, `boards/speech-to-text/app.js`, all `boards/claude-agent/`, `boards/wake-word/` and `boards/text-to-speech/` files retain their existing behavior. `boards/translate/scripts/bergamot-runtime.mjs` and `boards/speech-to-text/scripts/live.mjs` already provide engine and live streaming behavior. Do not hand-edit `boards-manifest.json` or any `versions-manifest.json`; do not edit the Persephone repo.

## Files Changed

| File | Planned change |
|---|---|
| `boards/cert-viewer/board-manifest.json`, `boards/theme-editor/board-manifest.json` | Explicit open metadata, version and app minimum. |
| `boards/translate/board-manifest.json`, `boards/speech-to-text/board-manifest.json` | Explicit channels and calls alongside unchanged service interfaces; versions and minimums. |
| `boards/translate/scripts/service.mjs` | Cancellable, authorized `translateText` sharing the existing queue. |
| `boards/speech-to-text/scripts/service.mjs` | Authorized, cancellable `transcribeFile` sharing the existing queue. |
| `boards/speech-to-text/scripts/wav-file.mjs` | New bounded WAV decoder, downmix and resampling. |
| `boards/cert-viewer/WHATS-NEW.md`, `boards/theme-editor/WHATS-NEW.md`, `boards/translate/WHATS-NEW.md`, `boards/speech-to-text/WHATS-NEW.md` | One line under each new patch version. |
| `doc/tasks/BT-087-capability-migration/README.md`, `doc/active-work.md` | This plan and its existing Planned dashboard link. |

## Verification (2026-11-07, Claude via Persephone MCP)

- **Phase 1:**
  - `certificate.view` `$help` shows the payload.
  - `open` with a public root CA certificate returns `{ pageId, result: null }`.
  - `theme.edit` `open({ mode: "new" })` returns `{ accepted: true }`.
  - The legacy `app.capabilities.invoke("certificate.view", …)` still opens.
- **Phase 2:**
  - `translateText("Hello, how are you today?", "uk", "en")` is correct, and an omitted `from` is detected.
  - A missing en → de model names the pair and points to the language manager.
  - An unknown target says no route exists, and a non-string text is rejected.
  - A board caller is allowed by default and gets `permission-denied` under `same-board-only` (the setting was restored), while agent and platform callers are still allowed.
  - The Translate page still loads its language list over the legacy channel.
- **Phase 3:**
  - Test audio came from a synthetic Windows speech WAV, with no recording.
  - `transcribeFile` on PCM16 22.05 kHz mono and on float32 stereo returns the exact text.
  - Non-WAV input, a missing file, a relative path and an unsupported language each give a clear `rejected` message.
  - A board caller gets `permission-denied`.
  - The existing streaming `transcribe` channel returns the exact text.
- **Not exercised:**
  - Cancellation mid-transcription. Callers have no cancel API, and the test file finishes in about 3 s; the signal wiring was checked by reading the code.
  - Agent Chat dictation, which needs a microphone.
- **Persephone fix found here:** the service host masked messages of errors thrown with an explicit `rejected` code. Fixed in `assets/module-service-host.mjs` (see EPIC-140 notes).
