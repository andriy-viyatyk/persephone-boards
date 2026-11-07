# BT-086: Agent Chat voice assistant

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `claude-agent`  
**Started:** 2026-11-07  
**Completed:** —

## Goal

Make Agent Chat the voice assistant in [EPIC-139](../../../../persephone/doc/epics/EPIC-139.md). Use an ordinary marked session, existing speech providers, and user-owned instructions. Preserve normal chat and dictation.

## Background

- Epic decisions 3, 4, 7–11 and Concerns define this task. Wake mode is remembered, off by default, and only active while the board is open. One copy listens. The marked session owns its model, effort and working folder. Its user writes the speaking instructions; the board adds no voice-specific instruction layer. The stop word cuts the request; silence is the fallback. Wake Word suppresses computer-sourced detections. Echo cancellation defaults on.
- A false wake can start a turn with the session's normal access. The visible request and stop word are mitigations. TV channels and other devices are outside computer-loopback suppression. A matching film and user voice can suppress each other. CLIs compact long sessions; the user can mark a new session.
- `boards/claude-agent/board-manifest.json` is 1.3.3, app 5.0.15 and bridge 1.42.0. It declares `service`, `appScripting`, `microphone`, `speech.transcribe@1`, and provides `agent.session@1`. `app.js:1415` sets New session, Refresh and Configure on the host toolbar. `index.html` and `app.js:1452` implement Configure's Instructions and Agent profiles tabs. Provider-wide instructions already exist; retain their composition. The README still mentions an Instructions toolbar button and Interrupt button; correct it.
- Sessions are Claude transcripts or Codex threads listed by `scripts/providers/claude.mjs` and `scripts/providers/codex.mjs`. `app.js:41` keys views by provider plus NUL plus session ID. `state.sessions`, `sessionsByKey` and `viewsByKey` track rows and live views; group participant rows are hidden or read-only. `persephone.state.merge` restores the selected page session. `prefs` at `app.js:754` stores JSON under `claude-agent:*` in localStorage. `connectView` at `app.js:1828` opens the board's own service with the view's provider, folder, model, effort, mode and resume ID. `sendPrompt` at `app.js:2120` sends a normal message or group user message; if busy it can steer. The typing-bubble Cancel at `app.js:253` sends `interrupt`. `handleEvent` tracks `turn-started` and `turn-ended` at `app.js:1904` and `1936`.
- Current dictation is separate. `startVoiceRecording` at `app.js:2396` opens page `getUserMedia({audio:{channelCount:1}})` and a selected `speech.transcribe` provider through `persephone.services.list/connect`. It asks for mono 16 kHz s16le and advertised live mode. `audio-capture-worklet.js` downmixes to floats; `consumeVoiceSamples` resamples, converts to s16le and sends 1,600-sample / 100 ms `audio` frames with backpressure. `end` flushes; `cancel` aborts. Segments are inserted at the caret; drafts track incomplete utterances; final result is inserted only if no segments were inserted. Auto-stop uses 100 ms RMS windows and `max(0.005, 0.2 × median speech RMS)`, after a segment and with no draft. It uses the app's voice-typing silence setting. Hide keeps recording; pagehide/unload cancels. Non-live requests obey `maxAudioMs`. Keep this path and worklet unchanged.
- [Audio](../../../../persephone/assets/guides/agents/audio.md) supplies `devices()`, microphone `capture`, and `play`. Capture yields 200 ms mono 16 kHz s16le `{epoch,timeMs,data}` chunks. `timeMs` is the first sample's shared-clock time; compare only equal epochs. Same device and `echoCancel` share capture. `devices()` returns audio-window IDs; labels can be empty and IDs can expire. Playback takes float32 mono chunks, then `end`. Install channel listeners immediately and respect backpressure.
- [Wake Word](../../../../persephone/assets/guides/agents/speech-wake.md), `boards/wake-word/board-manifest.json`, `scripts/service.mjs`, `scripts/enrollments.mjs` and `app.js` provide `describe`, `list`, `delete`, `enroll` and `listen`. Use exact phrase IDs `agent-wake` and `agent-stop`, microphone source, selected device and `echoCancel:true`. Require `describe().local`. Enrollment captures 2.5 seconds and returns quality, sample ID and best match against earlier samples, or null for the first. List returns sample metadata and capture provenance, not historical match scores. The provider stores embeddings, not audio. Default threshold is 0.85; higher is stricter. Detections carry person, onset `start` and detection `time` on the audio clock. Reset invalidates timing. The provider suppresses same-phrase computer detections in the −1500/+300 ms window.
- [BT-085 live verification](../BT-085-wake-word-audio-service/README.md) used synthetic speech. Computer detection was 5/5 at threshold 0.8 with scores 0.80–0.86; onset preceded detection by 1.0–1.1 s. Strong mic hits 0.73–0.91 were suppressed; three marginal ~0.70 hits leaked because they led the computer hit by ~0.75 s. Synthetic enrollment was often rejected near the ~0.009 RMS floor. Tone alignment was −5 ms. Detection delivery is typically delayed by about 0.8–1.1 s; processing can take longer. These results do not establish real-TV accuracy.
- [Speech to Text](../../../../persephone/assets/guides/agents/speech-transcribe.md), `boards/speech-to-text/board-manifest.json`, `scripts/service.mjs` and `scripts/live.mjs` use a `services.connect` channel, not a capability channel method. Audio payloads already match; wrap each in `{type:"audio",data}` and omit timestamps. Live `draft` replaces the preview for an utterance; `segment` adds committed text; final `result.text` includes the segments. Check local metadata, advertised `live`, provider policy and runtime/model readiness. Respect backpressure and non-live `maxAudioMs`.
- [Text to Speech](../../../../persephone/assets/guides/agents/speech-synthesize.md), `boards/text-to-speech/board-manifest.json` and `scripts/service.mjs` expose `speak` and `stop`. `speak` replaces current speech and resolves on finish or interruption. There is no playback status or event. Provider policy must allow Agent Chat and the agent; `same-board-only` refuses them.
- [Capabilities](../../../../persephone/assets/guides/agents/capabilities.md) and [boards guide](../../../../persephone/assets/guides/agents/boards.md) describe page `getCapability`, calls and channel handles. Exact `uses` grants messaging, not provider trust or provider permissions. Boards and providers must be trusted and enabled; each provider applies its own caller policy. Wake Word needs its own microphone and computerAudio grants. Agent Chat needs microphone but not computerAudio. Revocation can close channels. Its existing `appScripting` gives sessions their MCP path.

## Implementation Plan

### Phase 1 — configuration and ownership

- [x] Add `boards/claude-agent/wake-assistant.js`. `index.html` currently loads `i18n.js` and `app.js` as classic scripts, not modules. Load the new classic script immediately before `app.js`; expose a small `window.createWakeAssistant(options)` factory. Pass callbacks for session lookup, connection, interruption, ordinary send, rendering and preferences from `app.js`. Keep the controller, buffer, timers, channels and state machine inside the new file. Use readable, formatted code and avoid a new build step.
- [x] In `scripts/service.mjs:728`, route a private `wake-owner` channel before provider adapter selection. The shared service owns only this lease. Reject `info.interface` or `info.caller`, as for local-only group channels. The first open owns it until close, page loss, trust loss or service exit. Send `{type:"wake-owner",status:"acquired"}` to the owner and `{type:"wake-owner",status:"occupied"}` to a second opener, then close the latter. No expiring lease and no localStorage lock. The occupied page shows “Wake mode active in another window” and offers retry; it never captures. Release on off or teardown. Check races, startup cancellation and service restart.

  ```js
  // Before: onChannel enters provider routing immediately.
  persephone.service.onChannel(async (channel, request, info) => {
    if (request?.type === "open") { /* existing validation */ }
  });
  // After: a local-only branch returns before provider routing.
  persephone.service.onChannel(async (channel, request, info) => {
    if (request?.type === "wake-owner") {
      if (info?.interface || info?.caller) return closeChannel(channel, { code: "connection-refused" });
      return acquireWakeOwner(channel); // sends acquired or occupied; onClose releases
    }
    if (request?.type === "open") { /* existing validation */ }
  });
  ```

- [x] In `app.js:754`, use `prefs` for desired mode (default false), marker `{provider,id}` (default null), threshold, silence timeout and device ID. Update the current page immediately after writes. Handle the window `storage` event for `claude-agent:*` so other copies refresh the toolbar, marker badge and settings and safely restart or stop their controller. `storage` is shared preference propagation, not lease arbitration. Distinguish desired mode from listening, occupied and error. Keep desired mode across page closure, but release channels on unload. Use generation tokens to reject stale asynchronous opens and detections after off.
- [x] In `updateToolbar` and `persephone.toolbar.onAction` at `app.js:1415`, add the host `toggle`. The [boards guide](../../../../persephone/assets/guides/agents/boards.md) documents boolean toggle actions. EPIC-112 introduced toolbar controls in bridge 1.11.0 (Persephone commit `7fb9ed18`); the existing bridge 1.42.0 already supports them. The task's audio requirement raises the minimum to 1.51.0. Use `toolbar.update` when another page changes the preference.

  ```js
  // Before: the catalog ends with Configure; onAction receives { id }.
  { id: "configure", type: "button", label: t("configure"), icon: { name: "settings" } },
  // After: keep the existing entries and add the remembered toggle.
  { id: "configure", type: "button", label: t("configure"), icon: { name: "settings" } },
  { id: "wake-mode", type: "toggle", label: t("wake.mode"), value: prefs.read("wake-mode", false) },
  // Change onAction to receive value as well:
  persephone.toolbar.onAction(({ id, value }) => {
    if (id === "wake-mode") { prefs.write("wake-mode", value); void wakeAssistant.setEnabled(value); }
    // retain the existing button branches
  });
  ```

- [x] Add mark/unmark to `#session-menu` in `index.html` and its handler at `app.js:938`. In `renderSessions` at `app.js:793`, show an accessible badge for the exact provider/ID. Exclude unsaved sessions and read-only participants. Preserve it on rename. On successful deletion, including `/clear`, remove it, cancel an active request and show setup required. An unavailable CLI or incomplete listing must not erase the marker or select another session.

  ```js
  // Before, renderSessions appends marker, title and time:
  button.append(marker, element("span", "title", item.title), element("span", "when", formatWhen(item.updatedAt)));
  // After, retain the row and add a localized accessible wake badge:
  button.append(marker, element("span", "title", item.title));
  if (isWakeSession(item)) button.append(element("span", "wake-badge", t("wake.sessionBadge")));
  button.append(element("span", "when", formatWhen(item.updatedAt)));
  ```

- [x] Add a third tab and panel to `index.html`, with styles in `app.css` and English text in `lang/en.json`. Extend `openConfig`, `setConfigTab`, `updateConfigSave`, `closeConfig` and the Save handler at `app.js:1452–1496`. The page must open even when provider instructions cannot load. Preserve existing draft/unsaved behavior. Wake settings are saved by `prefs`; enrollment and deletion are immediate. Close cancels an active enrollment.

  ```js
  // Before: setConfigTab switches only instructions and profiles; Save has two branches.
  $("#config-profiles").classList.toggle("hidden", tab !== "profiles");
  $("#config-save").addEventListener("click", () => void (configTab === "instructions" ? saveInstructions() : saveAllProfiles()));
  // After: add the wake panel and route its Save explicitly.
  $("#config-wake").classList.toggle("hidden", tab !== "wake");
  $("#config-save").addEventListener("click", () => void (configTab === "instructions" ? saveInstructions() : configTab === "profiles" ? saveAllProfiles() : saveWakeSettings()));
  // openConfig loads the wake page independently; do not return early on an instructions error.
  ```

- [x] Wake words panel: add person, wake/stop choice, and `wake.enroll({phrase,kind,person,deviceId,echoCancel:true})`. Attach listeners immediately. Show recording, rejection reason, accepted match percentage or “first sample”. Refresh `wake.list("agent-wake")` and `wake.list("agent-stop")`; display groups, sample dates/IDs and capture provenance. List has no historical match values. Delete individual samples with `{phrase,sampleId}` and refresh. Preserve other enrollments. Persist threshold (0–1, default 0.85), silence timeout (0.5–30 s, default 2 s), and device (default system input). Explain higher threshold is stricter. Populate from `audio.devices()`; offer refresh, numbered unlabeled inputs and visible fallback for a missing ID.

### Phase 2 — listening and turns

- [x] Put one commented tuning block in `wake-assistant.js`:

  ```js
  // BT-085 measured about 0.8–1.1 s from onset to delivery; allowance includes
  // LOOK_AHEAD_MS 300, PROCESSING_MARGIN_MS 200 and inference. Tune on real hardware.
  const PRE_ROLL_MS = 3000;
  const REQUEST_HOLD_BACK_MS = 1500;
  const MAX_REQUEST_MS = 60000;
  const DEFAULT_SILENCE_MS = 2000;
  const NO_SPEECH_TIMEOUT_MS = 10000;
  const INTERRUPT_WAIT_MS = 10000;
  ```

  The hold-back is a practical latency margin, not a guarantee that no stop audio reaches the first transcription. The late-stop retry below produces the final request from cut audio. Never persist request PCM; release it after completion or cancellation.
- [x] Resolve audio, local wake, local transcription and TTS providers. Require a valid marked session and enrollments. Acquire the lease, open `audio.capture` with selected device and `echoCancel:true`, then `wake.listen` with both phrases and the same options. Attach listeners immediately. Keep a rolling `PRE_ROLL_MS` timestamped ring while waiting. Reject gaps, epoch mismatches, overflow and backpressure visibly. On accepted wake, call TTS `stop()`, play a short low-volume tapered generated sine tone via `audio.play` float32 chunks and `end`, and start the request from buffered `detection.time.timeMs`. Keep audio received during beep and channel startup. If the ring cannot reach that point, cancel and report. Show live text separately from the composer's draft.
- [x] Keep the request's own contiguous audio in memory from wake `time.timeMs` through its end, up to `MAX_REQUEST_MS`; force an end at that limit. Open transcription through `persephone.services.connect`, select advertised `live`, and send `{type:"audio",data}` only through the newest chunk end minus `REQUEST_HOLD_BACK_MS`. Track the exact exclusive sample position sent. Use a serialized queue with `whenWritable`. Render additive segments and replaceable drafts; use the final result as authoritative without duplicating segments. For a non-live provider use result-only display and respect its advertised maximum. A request is never sent before the final result.
- [x] For a same-epoch stop, set `cut = detection.start.timeMs`. For each chunk, compute `n = clamp(floor((cut - chunk.timeMs) * 16), 0, chunk.data.byteLength / 2)` and retain only the first `2*n` bytes. Drop all audio at or after cut. If cut is at or after the exclusive sent position, send the unsent retained samples and `end` the live channel. If cut precedes the sent position, cancel that transcription, discard its preview, open a fresh transcription channel, send the saved request audio only up to cut, then `end`; use its `result` for the request. Never compare epochs or use message arrival time for cutting. Onset is conservative and clock alignment approximate, so preceding speech may be cut.
- [x] Calculate request RMS in 100 ms s16le windows, using the existing floor 0.005 and speech-level median approach where available. After speech, configured quiet time ends capture; cancel after `NO_SPEECH_TIMEOUT_MS` without speech. On silence or forced end, wait out the hold-back before sending the final tail and `end`; accept a stop during that wait and cut/retry as above. Display transcribing while awaiting the result. A gap, epoch change, Wake Word `status:reset`, or capture close during a request cancels it, shows the reason, discards PCM and preview, and returns to waiting after channels are re-established; if re-establishment fails, show an actionable error. Do not send blank text.
- [x] Serialize state transitions per owner: **off → waiting** after readiness; **waiting → listening** on wake; **listening → sending** after stop, silence or limit and final transcription; **sending → running** after an ordinary nonempty send; **running → waiting** on turn end. Wake during listening cancels the old request and starts a new one. Wake during a running turn stops TTS and collects a new request without interrupting. If that request is empty or cancelled, leave the turn alone. Once nonempty final text is ready, interrupt only if the marked view remains busy; await its terminal event for at most `INTERRUPT_WAIT_MS`, then send a new ordinary turn. On timeout/error retain text visibly and do not send to a busy session. Stop during listening cuts and finishes the request. Stop during sending cancels unsent work. Stop during running interrupts the marked turn. Stop while waiting only stops TTS. Ignore stale events using request IDs and avoid duplicate sends.

  Do not claim a speaking state: the TTS contract has no playback observer.  
  Call `stop()` for every accepted wake or stop; it globally stops current TTS speech, including another caller's.

- [x] In `app.js`, add a callback that resolves or creates the marked background view without `openStoredSession` changing `current`. Load its description/history as needed and use `ensureLive(view)` / `connectView` with its own session settings. Mark a background view unread. Normalize the detected person to one line and prefix exactly `[Speaker: <person>]\n`. Wait until idle before `sendPrompt` so it cannot steer. Preserve group routing and existing error handling.

  ```js
  // Before: ordinary chat sends the user's text to its view.
  await sendPrompt(view, text);
  // After: the wake callback sends to the marked, idle view as an ordinary turn.
  const speaker = person.replace(/[\r\n]+/g, " ").trim();
  await sendPrompt(wakeView, `[Speaker: ${speaker}]\n${requestText}`);
  ```

- [x] Toggle off closes listener, capture, beep and pending transcription; it ignores late events and leaves a sent turn alone. Missing/untrusted/refused Wake Word, TTS, STT, microphone, lease or capture errors release resources, show recovery and leave chat usable. Keep timers and channels alive when the page is inactive or pinned; close on actual unload.

### Phase 3 — release, docs and verification

- [x] In `boards/claude-agent/board-manifest.json`, retain existing permissions and `speech.transcribe@1`. Add `audio@1`, `speech.wake@1` and `speech.synthesize@1` to `uses`. Keep microphone, service and appScripting; no computerAudio grant. Set app minimum 5.0.18, bridge minimum 1.51.0, version 1.4.0. Add a matching one-line `## 1.4.0` entry in `WHATS-NEW.md`. New English strings only in `lang/en.json`; use existing `i18n.js` fallback and defer translations to epic close. New uses may trigger a trust-change dialog.
- [x] Update `boards/claude-agent/README.md` and `CLAUDE.md` for UI, lifecycle, local processing, provider setup/policies, device and sensitivity calibration, session access and TV limits. Ship `boards/claude-agent/wake-instructions.md` as a copyable example, never automatically loaded:

  ```md
  # Voice assistant
  Answer aloud by calling `capabilities["speech.synthesize"].speak(...)` through Persephone.
  Keep spoken replies to one or two sentences unless I ask for more.
  Prefer site-extension actions when finding or controlling media.
  ```

  Tell users to copy or adapt it into `CLAUDE.md` or `AGENTS.md` in the wake session folder. Preserve existing provider-wide instruction composition; add no voice instruction layer.
- [ ] Verify with the running Persephone MCP and UI. Use generated tones and Text to Speech through speakers. Never record, store, play back or transcribe the user's voice. Use disposable synthetic enrollments and delete only those samples. Synthetic enrollment can fail below the quality floor; report it rather than altering production thresholds.

  1. Enroll, list and delete synthetic samples; observe quality, match, provenance, settings persistence and device fallback.
  2. Exercise wake, beep, live text, silence, forced end and empty requests; observe the marked session and speaker prefix. Inject deterministic synthetic chunks/detections to inspect sample-boundary cuts and hold-back.
  3. Deliver a stop before and after the sent position; observe normal cut and fresh-channel re-transcription respectively, with only the cut result sent. Exercise stop during silence hold-back, epoch/reset/gap/close and errors.
  4. Exercise wake while running with empty and nonempty requests; observe no interruption until nonempty text, then bounded interrupt and ordinary send. Check stop, toggle-off races, provider refusal, missing model, microphone denial and unchanged dictation.
  5. Open two copies; observe a single lease, occupied notice, release and retry. Pin the board on the right, activate another page, and observe timers, capture, listener and detection continuing. Close it and confirm release.
  6. Play TTS and generated tones; observe beep, suppression and interrupt behavior. Check `ui.log`, repo checks and version/changelog consistency. Do not edit generated manifests.

  User-only checks: real-voice enrollment, wake and stop; room/TV acoustics, sensitivity and latency. External-app/TV suppression is not established by synthetic checks.

### Live verification (2026-11-07, dev Persephone 5.0.18)

Method: 3.2 s of Text to Speech speech ("Please play some relaxing music in the browser.") was captured from
the `computer` stream (no microphone). A page harness replaced the `audio` capture and `speech.wake`
with scripted stand-ins replaying that audio on its timeline (1 s silence, speech 1.0–4.2 s, 5 s
silence), emitted detections about 1 s late as the real provider does, and intercepted `sendPrompt`.
Transcription used the real Speech to Text board. Nothing reached a real session; no voice was used.

| Check | Result |
|---|---|
| Wake → live transcription → silence end → send | Sent `[Speaker: Tester]\nPlease play some relaxing music in the browser.`; TTS `stop()` on the wake |
| Stop detected early (onset 3.0 s, emitted at 3.6 s) | Cut at the sample: sent "Please play some relaxing music in the" |
| Late stop (onset 2.0 s, emitted at 4.4 s, after that audio was sent) | Fresh-channel re-transcription of audio up to the cut: sent "Please place some room" (1 s of speech) |
| Wake while the marked session is busy | `interrupt` sent only when the new text was ready (13.0 s, not at the 2.0 s wake); sent after the turn settled |
| Lease, two openers | A acquired, B occupied and closed; after A closed, C acquired |
| Right-pinned, popover closed, another tab active | Frame kept running (timers, chunks, silence end on time); request sent normally (3 runs) |
| Cleanup | Prefs restored (Wake mode unset, no marker); no page errors |

Observations:
- Latency is dominated by Speech to Text: about 5.8 s from `end` to `result` for a 3 s utterance
  (whisper with a language-detection pass; one utterance without pauses is decoded only at the end).
  Dictation has the same cost. Silence end + hold-back add 3.5 s more.
- Once (not reproduced in four retries), a hidden run went from "Transcribing" back to "Waiting" in
  30 ms with nothing sent, consistent with an empty `result`. Empty results are dropped silently by
  design; a short "didn't catch that" note would make this visible.
- User report (real voice): false wakes while speaking the request and even in silence with
  laptop-fan noise. Two regressions from the BT-083/US-1786 behaviour that worked: BT-085 dropped
  BT-083's level gate (match only above RMS 0.006, history cleared after 400 ms of quiet), so noise
  was compared with the samples; and Agent Chat restarted the request on a wake during listening,
  while US-1786 ignored wakes outside "waiting". Fixed: the gate is back in Wake Word
  (`GATE_RMS`, `GATE_HOLD_MS`), and Agent Chat ignores wake during listening/sending.
- User report: after a voice interrupt the next turn ended "error" and the one after hung. Cause in
  `scripts/providers/claude.mjs`: the 5 s interrupt escalation checked only `session.busy`, so it killed
  the NEW turn the assistant sent right after the interrupt; the query (started once per session) was
  then dead and later prompts waited on an unread input queue. Fixed: escalate only while the same
  interrupted turn runs; when the query ends, close the session so the page resumes it on the next send.
- Not exercised live: the toolbar toggle with the real microphone (would capture the room), real
  enrollment, the beep through a real wake, provider-missing/denied paths.

## Concerns / Open Questions

- The 1.5 s hold-back is based on measured timing, not a delivery guarantee. A late stop may have been processed by the first live transcription; the fresh-channel retry ensures the final request excludes stop audio. A detection arriving after finalization cannot revise a sent turn. Tune on real hardware and document this limitation.
- Onset is estimated. Chromium echo cancellation does not eliminate sound from other apps; US-1798 is the separate loopback-canceller follow-up. BT-085's marginal leaks and speech-dependent enrollment require user calibration. Verify inactive pinned operation and the shared service across windows live.
- Existing provider-wide instructions remain in effect. “No instruction layer” means no additional voice-specific injection. A marked session may be temporarily unavailable; show recovery rather than erasing its marker.

## Acceptance Criteria

- [ ] Wake mode is off by default, remembered, visible, page-lifetime only and has one owner across copies. Inactive pinned operation and release are verified.
- [ ] The marked session receives ordinary speaker-prefixed turns with its own settings. Deletion clears the marker. No voice-specific instruction layer is sent.
- [ ] Wake words page enrolls by person, shows actual quality and match, lists and deletes samples, and persists threshold, timeout and audio-service microphone.
- [ ] Beep, live text, silence and stop flow work. The 1.5 s hold-back, sample cut and fresh-channel re-transcription for late stops produce a final request without stop audio. Resets and errors cancel safely; empty requests are not sent.
- [ ] Wake and stop interrupts follow the specified timing. Empty or cancelled wake requests do not interrupt a running turn. There are no duplicate turns, unintended steers or false speaking indicators.
- [ ] Missing/untrusted/refused providers and denied microphone are actionable. Chat and dictation remain functional. No request audio is persisted.
- [ ] Manifest, version, English UI, docs and sample match the plan. `ui.log` is clean and board assets are offline. Synthetic checks are recorded; real voice and TV checks are left to the user.

## Notes

Investigated 2026-11-07; planning only. BT-086 changes only persephone-boards; providers and contracts are used as they are. Epic already lists BT-086. No implementation or voice capture was performed.

## Files Changed

| File | Planned change |
|------|----------------|
| `boards/claude-agent/wake-assistant.js` | New classic-script controller, audio buffers, channels and state machine. |
| `boards/claude-agent/app.js`, `index.html`, `app.css` | Integrate controller, toolbar, session marker and Configure page. |
| `boards/claude-agent/scripts/service.mjs` | Local-page single-listener lease only. |
| `boards/claude-agent/board-manifest.json`, `WHATS-NEW.md` | Dependencies, minimums and release version. |
| `boards/claude-agent/lang/en.json`, `i18n.js` | English strings and fallback only if needed. |
| `boards/claude-agent/README.md`, `CLAUDE.md`, `wake-instructions.md` | User/author docs and sample. |
| `doc/active-work.md`, `doc/tasks/BT-086-agent-chat-voice-assistant/README.md` | Track and document the task. |

No changes planned: `boards/claude-agent/audio-capture-worklet.js`, `scripts/agent-session-protocol.mjs`, `scripts/providers/claude.mjs`, `scripts/providers/codex.mjs`, `scripts/sdk-install.mjs`, `scripts/claude-executable.mjs`, `board-base.css`, `markdown.css`, `lib/`, `icons/`, `icon.svg`, `screenshot.png`, non-English `lang/{be,de,es,et,fr,hu,it,ja,ko,lt,lv,pl,pt-BR,ro,sk,uk,zh-CN}.json`, `versions-manifest.json`, root `boards-manifest.json`; Wake Word, TTS and Speech to Text boards are dependencies, not BT-086 edits.
