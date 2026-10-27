# BT-063: Speech to Text board redesigned main screen

## Status

**Status:** Active  
**Priority:** Medium  
**Board id:** `speech-to-text`  
**Started:** 2026-10-27  
**Completed:** —

## Goal

Redesign the Speech to Text board's main page around a central microphone test control, with the engine/model setup and third-party license information in collapsible panels. Keep the existing recording, model, language, and download behavior available.

## Background

- **Current page structure:** `boards/speech-to-text/index.html` currently renders the model manager first, a separate microphone recorder with Record, Stop and Cancel buttons second, and the third-party license panel last. `boards/speech-to-text/app.js` fills the model rows in `render()` and builds runtime notice disclosures in `renderLicenses()`.
- **Existing disclosure pattern:** `renderLicenses()` creates native HTML `<details>` and `<summary>` elements and fetches a license notice only when its disclosure opens. A repository-wide source search found no shared disclosure component or board skin to reuse. Use the same native disclosure pattern for the setup and license panels instead of adding a new component. `boards/speech-to-text/app.css` styles the current `.panel` containers and license summaries; `board-base.css` supplies shared theme variables and baseline focus styling.
- **Install state and header data:** `render(snapshot)` considers the board ready when `snapshot.assets.runtime` is installed and the currently selected `snapshot.activeModel` is installed. The management snapshot in `scripts/service.mjs` includes the installed asset map and active model, but not the runtime display version. `scripts/downloads.mjs` defines the runtime identifier as `whisper-runtime-1.9.5-r2`. Add a separate display version (`1.9.5`) beside `RUNTIME.id`, and include it in the management snapshot. The collapsed setup header should show the localized model label from `MODEL_ROWS`/`t(model.label)`, not the model filename; for example, “Engine 1.9.5 · Default quality — installed.”
- **Open state:** On the first management snapshot after page open, set setup disclosure open when the runtime or selected active model is missing, and closed when both are installed. Keep the license disclosure closed initially. Let the user toggle either panel for the rest of that page session; do not persist disclosure state across board opens. Later management snapshots must not override a user's session toggle.
- **Current test and settings behavior:** `startRecording()` in `app.js` selects the current microphone, opens a `speech.transcribe` channel with mono 16 kHz PCM, and passes the board's `language-hints` and `vocabulary-prompt` settings. `stopRecording()` flushes queued audio and sends `end`; `cancelRecording()` sends `cancel`. The recorder also keeps a microphone level meter: `#level` is updated from worklet `level` messages and styled by `.level-track`. Keep the meter in the test block below the microphone selector or near the test button. The settings are declared in `board-manifest.json` and read from Persephone settings during app initialization, so keep them reachable where they are today. Keep the existing model selection, verified downloads, remove/use actions, download progress, microphone enumeration, local capture worklet, and error/status reporting.
- **Live service behavior:** The board's `startRecording()` currently omits `live`, and its channel handler handles `status`, `result`, and `error` only. `scripts/service.mjs` sets live mode from `open.live === true`; `emitSegment()` sends committed `segment` messages, `sendLiveDraft()` sends replaceable `draft` messages, and the live completion path sends one final `result`. In `scripts/live.mjs`, `Segmenter` turns VAD observations into partial/draft/commit ranges, while `LiveStream` streams PCM through the VAD helper and supplies those ranges to the service. After BT-062, `commitStablePartial()` in `scripts/service.mjs` may send a `segment` followed by a new `draft` containing only the remaining tail. Follow this ordering rule: each `draft` replaces the current draft for its utterance; each `segment` appends its non-empty text and clears that utterance's current draft; a later draft for the same utterance repopulates it. Render committed text in the normal text colour and the current draft after it in a muted style. `emitSegment(..., final = true)` also sends an empty-text segment as the utterance's final marker, so do not append an empty piece or separator for it; only clear that utterance's draft. Join non-empty segment text with one space, matching the contract's `result.text` rule. The normative `speech.transcribe` v1 contract in Persephone's `guides.agents["speech-transcribe"]` confirms that `live: true` is opt-in, each segment carries only new text, drafts are replaceable per utterance, and `result.text` repeats the committed text joined with spaces. Do not append `result.text` after live segments; use it for completion/metadata only.
- **Localization:** `i18n.js` delegates lookups to `persephone.i18n.t()` and applies `data-i18n`, placeholder, and title attributes. `board-manifest.json` selects `lang` with English as its default, and `boards/speech-to-text/lang/en.json` is currently the only language file in this board. Add the new English messages there using the existing namespaced key pattern.
- **Release metadata:** The current board manifest and top `WHATS-NEW.md` heading are both at `1.2.0`. Plan the next minor release as `1.3.0`, matching the repository release rules in `CLAUDE.md`.

## Implementation Plan

1. [x] **Make the engine/model manager a collapsible setup panel.** Move its heading into a native `<summary>` while retaining the runtime row, model list, active model, progress, and management actions in the disclosure body. On the initial management snapshot, expand it if either the runtime or selected active model is missing; otherwise collapse it and show the runtime display version plus localized selected model label in the summary. Add `displayVersion: "1.9.5"` beside `RUNTIME.id` in `scripts/downloads.mjs` and include it as `runtimeVersion` in the management snapshot produced by `publishManagement()` in `scripts/service.mjs`. Use the localized model label from `MODEL_ROWS`, not its filename. Preserve the user's disclosure toggle during later snapshots in that board session.
2. [x] **Make third-party licenses a collapsible panel.** Use a native `<details>` disclosure closed on board open. Keep the existing model license link, runtime license text, and lazy per-notice loading implemented by `renderLicenses()`.
3. [x] **Replace the separate recorder panel with the central test block.** Between the two disclosures, place the existing microphone selector above or near the existing level meter and one prominent round button with an inline SVG play/run icon using `currentColor` (no external icon asset). Use localized “Test” text while idle. The single button follows the full state machine in Decisions: idle is enabled only when runtime plus selected active model are installed, otherwise disabled with the existing not-ready hint; preparing disables the button, mode switch, and microphone selector; recording changes the button to “Stop”; finishing/transcribing disables all three through `result`, `error`, or channel close, then returns to idle. Ignore clicks during preparing/finishing. Keep `privacy.local` visible directly under the test block, since it describes audio handling rather than a license. Leave only license information in the collapsed disclosure. Remove the visible Cancel control and the separate recorder panel's duplicate action UI. Preserve the existing readiness guard at the start of `startRecording()`, microphone permission errors, status reporting, and the five-minute service limit.
4. [x] **Add the two test modes.** Add a localized mode switch for “Record, then type” and “Live typing.” Keep record-then-type as the existing non-live request. For live typing, open the same channel with `live: true`. A `draft` replaces that utterance's draft; a non-empty `segment` appends to committed output and clears that utterance's draft; a later draft for the same utterance repopulates it. Empty-text final-marker segments only clear the draft and add no text or separator. Render committed text normally and the draft after it in a muted style. Join non-empty segment text with one space. Keep `#result-meta` for language and duration in both modes, and on final `result` show completion and metadata without duplicating committed text. Clear transcript, draft, and metadata at the beginning of every new test. Respect channel backpressure and stop microphone capture on terminal error or channel closure.
5. [x] **Retain existing configuration and install behavior.** Keep the model list and its download/cancel-download, remove, and use actions in the setup panel. Keep language hints and vocabulary in the existing Persephone board Settings page, as declared in `board-manifest.json`; do not create duplicate in-page settings. Keep device refresh, local audio capture, progress, and error handling.
6. [x] **Localize new UI text.** Add the following keys to `boards/speech-to-text/lang/en.json` and use them through the existing `t()`/`data-i18n` pattern:
   - `models.panelReady` — ready summary with runtime display version and localized model label placeholders (for example, “Engine {version} · {model} — installed”).
   - `models.panelNeedsSetup` — summary shown when the runtime or selected model is not installed.
   - `test.modeLabel` — label for the test mode switch.
   - `test.recordThenType` — “Record, then type” mode label.
   - `test.liveTyping` — “Live typing” mode label.
   - `test.start` — idle button text, “Test.”
   - `test.stop` — active button text, “Stop.”
   Reuse existing localized microphone, listening, preparing, transcribing, done, result, permission, no-device, and generic error messages where their meaning remains accurate. Remove obsolete recorder keys only if their UI is removed and they have no remaining call sites.
7. [x] **Style the new layout.** Update `app.css` for disclosure summaries, the centered test block, mode switch, round primary button, result display, and muted draft text. Keep committed text in the normal text colour. Use an inline SVG (or local asset) for the play icon, with its colour inherited through `currentColor`; add no external icon assets. Retain theme-variable use and the shared `board-base.css` link in `index.html`; do not add a third-party UI dependency.
8. [x] **Plan the release metadata.** Bump `boards/speech-to-text/board-manifest.json` from `1.2.0` to `1.3.0` and add a matching `## 1.3.0` entry to `boards/speech-to-text/WHATS-NEW.md`: “Redesigned the main screen with collapsible setup and license panels and a central live or record-then-type test control.” Apply both changes together during implementation/release work.

## Decisions

- **Disclosure state:** Initial setup open/closed state follows installed runtime plus the selected active model from the first management snapshot. The license panel starts closed. User toggles last for the current page session only and are not stored in `persephone.storage` or another persistent setting.
- **Test button state:** Use one explicit state machine. In idle, show “Test”; enable it only when the runtime and selected active model are installed, otherwise disable it and show the existing not-ready hint. On start, enter preparing immediately: disable the button, mode switch, and microphone selector. In recording, show “Stop” on the enabled button. After Stop, enter finishing/transcribing and disable the button, mode switch, and microphone selector until `result`, `error`, or channel close returns the UI to idle. Use the existing localized transcribing message as the disabled busy label. Ignore button clicks during preparing or finishing. Keep the readiness guard at the top of `startRecording()`.
- **Model readiness:** Use the same readiness condition as `render()` today: installed runtime and installed selected active model. Other downloaded models remain selectable inside the setup panel.
- **Runtime summary:** Source the displayed runtime version from a separate `RUNTIME.displayVersion` value next to `RUNTIME.id` in `scripts/downloads.mjs`, forward it through the management snapshot, and localize the selected model name with its `MODEL_ROWS` label.
- **Live result rendering:** Treat non-empty segment text as committed and drafts as replaceable previews, applying the post-BT-062 ordering rule above. Empty final-marker segments only clear their utterance's draft. Render the draft in muted text after committed text. Do not append `result.text` after receiving live segments because the contract says it includes those same committed words.
- **Settings:** Language hints and vocabulary remain in Persephone's existing board Settings page; model selection and download controls remain in the collapsible setup panel.
- **Privacy note and result area:** Keep `privacy.local` visible directly under the test block; the collapsed disclosure contains license information only. Preserve `#result-meta` for language and duration in both modes, and clear committed transcript, draft, and metadata when a new test starts.
- **No cancel control:** Remove the visible Cancel action from the test area. Keep the service's cancellation protocol available for internal cleanup if needed, and preserve clear handling of the provider's five-minute `too-long` error.
- **No additional persistence:** Do not remember disclosure state across board opens or add settings for the two test modes unless implementation uncovers a concrete need.

## Acceptance Criteria

- [x] The setup panel is expanded on initial open when the runtime or selected active model is missing, and collapsed when both are installed.
- [x] With both assets installed, its collapsed summary identifies the runtime version and selected model. Install, select, remove, cancel-download, and progress controls remain reachable inside the panel.
- [x] The summary shows a display version such as `1.9.5` and a localized model label, never the raw runtime identifier or model filename.
- [x] Later management snapshots do not overwrite disclosure state after the user toggles it. No disclosure state is persisted across board opens.
- [x] Third-party licenses are in a separate native disclosure closed by default; individual runtime notices still load when opened.
- [x] The microphone selector is above or near the retained level meter and one large round Test control between the two panels. Clicking it starts capture; clicking it again stops and transcribes. There is no visible Cancel button. The play icon is inline SVG or a local asset and uses `currentColor`, with no external asset.
- [x] The button follows idle, preparing, recording, and finishing states: readiness gates idle; preparing and finishing disable the button, mode switch, and microphone selector; recording shows Stop; final result, error, or channel close returns to idle. Preparing/finishing clicks do nothing, and `startRecording()` retains its readiness guard.
- [x] Both “Record, then type” and “Live typing” modes work. Live mode sends `live: true`; each draft replaces the utterance's current draft, each non-empty segment appends committed text and clears that utterance's draft, and a later draft repopulates it. Empty final-marker segments clear the draft without adding text or a separator. Committed text is normal colour; its current draft follows in a muted style. Non-empty segments are joined with one space, and final `result.text` is not duplicated.
- [x] `privacy.local` remains visible directly under the test block, and the collapsed disclosure contains only license information. `#result-meta` shows language and duration in both modes; a new test clears transcript, draft, and metadata.
- [x] Microphone selection/refresh, the level meter, permissions and error messages, language hints, vocabulary, model choice, downloads, local capture, and result details remain available.
- [x] New user-facing strings are localized in `lang/en.json` with the keys listed in the plan; existing strings are reused where appropriate.
- [x] `board-manifest.json` and the top `WHATS-NEW.md` version heading both target `1.3.0`, with the planned release note recorded.
- [x] No unit tests or test harness are added for this task.

## Files Changed

| File | Planned change |
|------|---------------|
| `boards/speech-to-text/index.html` | Reorganize main sections into the two disclosures and central test block |
| `boards/speech-to-text/app.js` | Set disclosure initial state, show setup summary, add mode selection and live draft/segment rendering, and replace recorder controls with one toggle button |
| `boards/speech-to-text/app.css` | Style disclosure headers, centered test controls, round button, mode switch, and result text |
| `boards/speech-to-text/scripts/downloads.mjs` | Add a display version beside the runtime identifier |
| `boards/speech-to-text/scripts/service.mjs` | Include the runtime display version in management snapshots for the setup summary |
| `boards/speech-to-text/lang/en.json` | Add localized setup summary, mode, and Test/Stop messages |
| `boards/speech-to-text/board-manifest.json` | Plan version bump to `1.3.0` |
| `boards/speech-to-text/WHATS-NEW.md` | Add the matching `1.3.0` release note |
| `doc/tasks/BT-063-speech-to-text-main-screen/README.md` | This task plan |
| `doc/active-work.md` | Track BT-063 under Active |

## Notes

- Implemented the redesigned board and 1.3.0 release metadata. No unit tests or test harnesses were added, per project instruction.
- Verified changed JavaScript and MJS files with Node's syntax checker, parsed both changed JSON files, and reloaded the board in Persephone. The rendered screen showed no page errors; microphone recording was not exercised.
- Consulted the installed board-authoring guide and normative speech.transcribe v1 guide through Persephone MCP as required by the repository guide.
