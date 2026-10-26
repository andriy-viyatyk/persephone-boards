# BT-057: Agent Chat voice input

## Status

**Status:** In Progress
**Priority:** Medium
**Board id:** `claude-agent`
**Started:** 2026-10-26
**Completed:**

## Goal

Add record-then-transcribe voice input to Agent Chat v1.3.0. When a compatible `speech.transcribe` provider is available, the composer can record mono 16 kHz PCM, stream it to that provider, and insert the returned text at the prompt caret without sending it.

## Background

- The Agent Chat board currently ships as v1.2.1 and requires Persephone 5.0.13. Its manifest has object-form permissions, `minBridgeVersion: "1.42.0"`, one existing `agent.session` service interface, and host-declared settings (`boards/claude-agent/board-manifest.json:7-38`). BT-057 must bump the board to v1.3.0, set `minAppVersion` to 5.0.15, add `uses: [{ id: "speech.transcribe", version: 1 }]`, and change `permissions.microphone` to `true`.
- The normative consumer declaration is `uses` plus `permissions.microphone` and `minAppVersion: "5.0.15"` (`C:/projects/persephone/assets/guides/agents/speech-transcribe.md:13-24`). `uses` grants messaging only; the selected provider must also be trusted and provide its own service permission. Calls use `persephone.services.list("speech.transcribe")` and `persephone.services.connect("speech.transcribe", { provider, version }, openMessage)`; versions match exactly.
- Provider discovery is runtime-dynamic. The boards guide says non-empty `uses` grants messaging access to currently or later trusted providers, calls `services.list(id)` to choose one, and uses `services.connect(id, { provider, version }, openMessage?)`; microphone permission is declared as `permissions.microphone: true` and the approved user-facing wording is “Use your microphone.” (`C:/projects/persephone/assets/guides/agents/boards.md:30-44, 120-124`).
- The speech v1 open message requests `{ type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 }, prompt: "Claude, Codex, Persephone" }`; omit `languages` so the provider auto-detects. Language and prompt hints are optional (`speech-transcribe.md:26-41`). BT-056 maps zero or multiple language hints to auto-detect (`boards/speech-to-text/scripts/service.mjs:137-140`). Audio messages carry an `ArrayBuffer`; send ordered chunks, respect `channel.writable` / `channel.whenWritable()`, then send `end` or `cancel` (`speech-transcribe.md:43-53`).
- `describe` returns provider metadata including `maxAudioMs`; it is the provider's maximum duration. BT-056's Speech to Text provider advertises five minutes. A `too-long` error may arrive during streaming. A `not-ready` error arrives before accepting the request and explains setup; channel close before a result means stop capture and release request resources (`speech-transcribe.md:61-82`).
- Capture precedent is `boards/speech-to-text/audio-capture-worklet.js:1-20` and `boards/speech-to-text/app.js:120-282`: the worklet averages channels to mono Float32; app code resamples to 16 kHz, converts to little-endian PCM s16le, queues chunks serially with channel backpressure, sends `end` only after queued audio, and stops tracks/closes the context on stop, cancel, provider error, and close. It loads `./audio-capture-worklet.js` through `audioWorklet.addModule()` (`app.js:209-225`). Agent Chat's CSP permits scripts only from `'self'` (`boards/claude-agent/index.html:5`), so keep the worklet as a local board asset and load it from `'self'`.
- The current composer is a form with `#prompt` (plaintext-only contenteditable), then `#send`, and a status line above them (`boards/claude-agent/index.html:40-47`). Its flex layout wraps and aligns controls at the bottom (`boards/claude-agent/app.css:187-196`). `setPrompt()` currently replaces the prompt and moves the caret to the end (`app.js:1856-1863`); command-menu items use `mousedown.preventDefault()` to preserve prompt focus/caret (`app.js:1847-1848`). Voice capture should save caret offsets in prompt text, not a live DOM Range, because switching views replaces the shared prompt from each view's `draft` (`app.js:1236, 1247`).
- The existing dismissible error panel is `#error`, `#error-text`, and `#error-close` (`index.html:23`); `showError()` controls visibility and the close handler clears it (`app.js:13-15`). Use it for capture, channel, and provider errors. For `not-ready`, show a localized instruction to open Speech to Text and finish setup, retaining the provider's useful message where appropriate.
- Only `boards/claude-agent/lang/en.json` is shipped under `lang/` (`board-manifest.json:28`; verified with `rg --files boards/claude-agent/lang`). Add localized strings there. The board applies its pack through `i18n.js`, where `data-i18n`, `data-i18n-title`, and runtime `t()` are supported (`i18n.js:1-11`).
- The board already has a local preference helper backed by `localStorage` keys prefixed `claude-agent:` (`app.js:704-708`). Manifest enum options are static (`C:/projects/persephone/assets/guides/agents/boards.md:156-162`), while speech providers are discovered at runtime. Use a voice-provider board-local preference for the selected provider id, defaulting to the first listed provider; render a selector only when `services.list()` returns more than one provider, and show the selected provider's `title` from that list in the voice button tooltip. Reconcile a saved id when the provider list changes.
- EPIC-133 specifies that Agent Chat records from the default input device (device picker is future work), shows the voice control only when a provider exists, starts/stops on click, cancels on Escape, displays elapsed time then transcribing, inserts at the caret, and never auto-sends (`C:/projects/persephone/doc/epics/EPIC-133.md:159-169`; concern 5 at lines 203-204). Its 2026-10-26 notes record BT-055's published runtime verification and the provider's `no_language_probabilities=true` optimization; the consumer uses the normative BT-056 contract and does not need provider-specific handling (`EPIC-133.md:251-257`).

## Implementation Plan

- [x] Update `boards/claude-agent/board-manifest.json`: bump `version` to `1.3.0`, set `minAppVersion` to `5.0.15`, add `uses: [{ "id": "speech.transcribe", "version": 1 }]`, and set `permissions.microphone` to `true`; keep `minBridgeVersion` at `1.42.0` because the required services/channel APIs already exist.
- [x] Add the matching `## 1.3.0` heading and one terse voice-input line to `boards/claude-agent/WHATS-NEW.md`.
- [x] Add a local capture worklet at `boards/claude-agent/audio-capture-worklet.js`, adapting the verified `speech-to-text` worklet. Load it only through `audioWorklet.addModule("./audio-capture-worklet.js")` so the current `script-src 'self'` CSP permits it; use the existing AudioContext fallback (requested 16 kHz first, native rate otherwise) and linear resampling path when the actual context rate differs.
- [x] Add an isolated voice-capture controller to `boards/claude-agent/app.js`. Discover providers using `persephone.services.list("speech.transcribe")` during page initialization and re-check on window focus / visibility changes (and when the user opens provider choice) so the control tracks provider installation or removal. Display the voice button only when the list is non-empty; choose the saved provider id if still present, otherwise the first provider. Render the provider selector only when the list length is greater than one; use the existing `openChoiceMenu()` menu (`app.js:532-550`) and persist selection with `prefs`. Put the selected provider title from `services.list()` in the voice button's tooltip.
- [x] Start `getUserMedia` and `services.connect("speech.transcribe", { provider, version: 1 }, openMessage)` immediately on click; do not wait for `describe`. The transcribe open message contains the mono PCM s16le 16 kHz format and vocabulary prompt `Claude, Codex, Persephone`; omit `languages` for auto-detection. In parallel, issue one `describe` request per provider snapshot, consume and close its channel, and update the duration cap when `maxAudioMs` arrives. Until then use five minutes; the provider enforces its own `too-long` limit. Stop a little before the applicable limit and show a localized recording-limit notice rather than relying on provider rejection.
- [x] Adapt the Speech to Text resampler and PCM conversion (`boards/speech-to-text/app.js:131-145, 227-250`). Stream small ordered `ArrayBuffer` chunks and serialize sends through `writable` / `whenWritable()`. Update the voice button with localized elapsed `m:ss` while recording, then show its transcribing state after stop. On stop, flush final samples, stop tracks and close the AudioContext, await all queued chunks, then send exactly one `end`.
- [x] Handle provider `status`, `result`, and `error`; map `not-ready` to a localized “Open Speech to Text to finish setup” message and route other non-cancel errors through `setViewError()` / the existing error panel. Each recording belongs to the view where it started. On result, if that view is still current, insert into its prompt at the saved caret offsets; if another view is current, append the transcript to the originating view's `draft`, separated from adjacent text by a space/newline. If that view was dropped with `dropView()`, discard the result. Never send the composer.
- [x] Preserve prompt focus when clicking the voice button by using `mousedown.preventDefault()` as the command-menu items do (`app.js:1847-1848`). At start, save character offsets into `promptText()` plus the prompt text snapshot; never retain a live `Range`. If the text is unchanged, clamp offsets to its current length. If it changed, insert at the current caret when `#prompt` has focus, otherwise append. Add one separating space where inserted text would touch adjacent non-whitespace; preserve existing whitespace. After insertion, dispatch a bubbling `input` event so the existing prompt input handler runs `updateControls()`; do not call `requestSubmit()`.
- [x] Make the capture lifecycle idempotent and release microphone tracks on every terminal path: setup failure, channel open/send failure, provider error, channel close before result, cancel, document hide/unload, Persephone page becoming not visible, and session view switch. Use `persephone.page.onVisibilityChange()` to catch switching away from the board while the app window stays open (`boards.md:1327-1336`); also cover `document.visibilitychange`. Switching Agent Chat views (`showView()`) or hiding the document/page stops recording and sends `end` to transcribe; the result follows the originating-view rule above. Among lifecycle transitions, only `pagehide` / unload cancels. Escape cancels only an active recording; let existing choice-menu, session-menu, and command-menu Escape handlers run first, and call `preventDefault()` / `stopPropagation()` only when voice capture actually cancelled.
- [x] Keep the voice button hidden whenever `#prompt` is hidden, including read-only participant/subagent transcript paths (`app.js:1142, 1344, 1367`), and disabled whenever `#send` is disabled under `updateControls()` (`app.js:1137-1145`). Keep those states synchronized when a view or transcript mode changes.
- [x] Add `boards/claude-agent/icons/mic.svg`, matching the board's icon style and using `currentColor` without hardcoded colors. Add the icon button adjacent to `#prompt` / `#send` in `#composer`; during recording show elapsed `m:ss` beside/in place of the icon. Preserve the existing flex wrapping, focus style, and button sizing in `app.css:187-196`. Add localized tooltip, timer, transcribing, provider-choice, permission/capture, limit, and not-ready setup strings in `lang/en.json`.
- [x] Because the manifest adds `permissions.microphone`, note in `WHATS-NEW.md` and `README.md` that an installed trusted board will show the **Board permissions changed** dialog listing the new microphone grant on its next open/reload; the user must Accept for voice input to work (`C:/projects/persephone/assets/guides/agents/boards.md:139-141`).
- [x] Update `boards/claude-agent/README.md` with voice input and the microphone permission-update prompt. Update `boards/claude-agent/CLAUDE.md` only if its board-specific behavior notes become inaccurate.
- [x] Update `boards/claude-agent/README.md` and `boards/claude-agent/CLAUDE.md` only if their existing behavior/permission descriptions become inaccurate; keep any required voice UX or lifecycle instructions concise.

## Concerns / Open Questions

- Dynamic providers cannot be represented as a fixed manifest enum. The plan treats the selected provider as an Agent Chat local preference, with an in-page choice when multiple providers exist; keep that control discoverable and its saved provider id stable across page reloads.
- `services.list()` is a snapshot rather than a push subscription in this use case. Recheck on focus/visibility and before recording; provider changes while the page remains focused may not appear until the next check. Do not keep a stale provider channel after a lifecycle change.
- `describe` is a separate channel that must be opened and closed, and provider availability can change between description and transcription. Handle a failed/missing description with the five-minute cap, and handle `not-ready` from `transcribe` as an ordinary terminal provider error.
- Voice results target the view that started recording: a current view receives caret insertion, a still-live but inactive view receives a separated append to `draft`, and a dropped view discards the result. Preserve this ownership rule across session switches and page/document visibility changes that stop-and-transcribe.
- A channel may close before an error/result, or during an awaited `whenWritable()`. Guard queued sends and cleanup against close races; no audio may be sent after close, and no late result may mutate a different view's prompt.
- Document/page visibility loss and `showView()` stop-and-transcribe; among lifecycle transitions, only `pagehide` / unload cancels. Ensure every stop path releases tracks even if channel cancellation throws.
- Resampling duration uses output sample count at 16,000 Hz. Avoid exceeding the provider limit due to a final partial chunk or interpolation flush; the provider contract rejects over-limit audio rather than truncating silently.

## Acceptance Criteria

- [ ] The manifest declares the v1 consumer interface, microphone permission, `minAppVersion` 5.0.15, and board version 1.3.0; `WHATS-NEW.md` has a matching 1.3.0 entry.
- [ ] The voice control is absent with no compatible provider, appears when one is available, and selects the first provider by default; with several providers a persisted choice is honored and reset to the first if unavailable.
- [ ] Recording uses the default microphone, streams ordered mono PCM s16le 16 kHz chunks with channel backpressure, shows elapsed time, stops cleanly, then shows transcribing; Escape cancels.
- [ ] The result is inserted at the prompt caret without sending, preserving existing prompt text and supporting Unicode/newlines.
- [ ] Voice clicks preserve prompt focus; caret offsets clamp safely, edited prompts use the current caret or append fallback, boundary whitespace is normalized, and insertion fires the prompt input update path without submitting.
- [ ] View switches and visibility loss stop-and-transcribe; results insert into the originating current view, append to its inactive draft, or are discarded if that view was dropped. Only pagehide/unload cancels.
- [ ] The control follows prompt/send visibility and disabled state, and Escape cancels only active recording after existing menu handlers have had priority.
- [ ] `not-ready` gives Speech to Text setup guidance; other failures appear in the existing dismissible error panel.
- [ ] Microphone tracks are stopped on every terminal/lifecycle path; provider close, channel failure, page hide/unload, and view switch do not leave capture active. A second click during transcription cannot create a second request.
- [ ] No request exceeds the provider's `maxAudioMs`; missing/invalid description falls back to a five-minute limit.
- [ ] All added user-facing strings are localized in the shipped English board pack.
- [ ] The icon uses `currentColor`; timer text shows elapsed `m:ss`; provider choice appears only for multiple providers and the button tooltip identifies the selected provider by its title.
- [ ] The v1.3.0 release notes and README tell users that microphone permission adds a **Board permissions changed** prompt on update.
- [ ] The local worklet loads under the board's `'self'` CSP. Live verification follows BT-056's precedent in dev Persephone 5.0.15 with the trusted board and a real microphone, including provider-ready and not-ready cases, cancel/error/close cleanup, and result insertion.

## Files Changed

| File | Change |
|------|--------|
| `doc/tasks/BT-057-agent-chat-voice-input/README.md` | Updated: implementation checklist and acceptance criteria. |
| `doc/active-work.md` | Updated — move BT-057 from Planned to Active and link this task. |
| `boards/claude-agent/board-manifest.json` | Updated — v1.3.0 / app 5.0.15, speech provider use, microphone permission. |
| `boards/claude-agent/WHATS-NEW.md` | Updated — v1.3.0 voice input and permission prompt notice. |
| `boards/claude-agent/README.md` | Updated — voice input and microphone permission-update notice. |
| `boards/claude-agent/audio-capture-worklet.js`, `boards/claude-agent/icons/mic.svg` | Added — local microphone worklet and currentColor icon assets. |
| `boards/claude-agent/index.html`, `app.js`, `app.css` | Updated — composer controls, provider discovery, streaming, insertion and cleanup. |
| `boards/claude-agent/lang/en.json` | Updated — localized voice-input strings. |
| `doc/tasks/BT-057-agent-chat-voice-input/README.md` | Updated: implementation checklist and acceptance criteria. |

## Notes

- Implementation is in place. The live board reload and provider discovery were verified; real microphone recording and end-to-end insertion were not exercised. No unit tests or test harnesses were added.
- Publish the 1.3.0 manifest change only after Persephone 5.0.15 ships, because this board requires `minAppVersion: "5.0.15"`. Keep the bump on `develop` until then: pushing to `main` runs the publisher across all bumped boards without matching release tags, including Speech to Text (`CLAUDE.md:58-67`).
- Adding `permissions.microphone` to an installed trusted board causes Persephone's **Board permissions changed** dialog on the next open/reload, listing the new grant. Accept is required; users can close the dialog to unregister the board (`boards.md:139-141`). The v1.3.0 changelog and README must explain this before users update.
- The BT-056 live verification precedent was run in dev Persephone 5.0.15. For BT-057, the current live check confirmed the board reloads, discovers Speech to Text, and renders its voice button. Real microphone recording and result insertion remain unverified.
- No additional voice-capture library is required; adapt the existing board worklet/resampler and keep the worklet a local asset.

## Live verification (Claude, 2026-10-26)

Dev Agent Chat 1.3.0 against the Speech to Text provider, with a synthetic speech clip fed through a stubbed `getUserMedia`. The user then tested with the real microphone in Ukrainian and English: both worked.

- Voice button appears with one provider; the mic icon renders through a CSS mask in the text colour.
- Record → stop: the text is inserted after existing prompt text with one separating space, the caret stays in the prompt, Send enables, and nothing is sent. Text arrives about 2.2 s after stop; the track ends.
- Esc while recording, and Esc while the microphone is still opening, both cancel with no error, and the track ends.
- Closing the popover mid-recording stops and transcribes the audio captured so far.

Fixes made during verification:
- The icon was an `<img>`, so it could not take the text colour; it is now a CSS mask.
- The mic was disabled whenever Send was, which included while the agent was working. It is now only hidden with the prompt.
- Providers were described again on every window focus; each provider is now described once.
- Esc was ignored during startup, and a cancel during startup left the provider channel open.
- The leading space in Whisper's output was inserted; the text is now trimmed.

Not verified:
- The permission prompt on update.
- `not-ready` and provider errors.
- Switching sessions while recording into a live session's draft.
- The multi-provider selector.
