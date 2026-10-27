# BT-068: Agent Chat microphone - live dictation with auto-stop after silence

## Status

**Status:** Planned  
**Priority:** High  
**Board id:** claude-agent  
**Started:** —  
**Completed:** —

## Goal

Make Agent Chat live dictation stop after Persephone's configured quiet interval once committed speech has arrived and no utterance is still a draft. Use the existing microphone stop path so the user can click again to continue dictating.

## Background

- **Epic and dependency:** Persephone EPIC-134. US-1733 (bridge 1.44.0) exposes the read-only number persephone.voiceTyping.autoStopSilenceMs in milliseconds and persephone.voiceTyping.onAutoStopSilenceChange(callback). The callback runs immediately with the current value and on every change; the method returns an unsubscribe function.
- **Bridge compatibility:** Feature-detect with typeof persephone.voiceTyping?.onAutoStopSilenceChange === 'function'. Keep boards/claude-agent/board-manifest.json minBridgeVersion at 1.42.0; when the API is absent, auto-stop is off, so bridge 1.44.0 is not a minimum requirement.
- **Setting values:** Accept any finite integer greater than or equal to 0; 0 disables auto-stop. Any other value means off. Do not enforce Persephone app UI options in the board.
- **BT-066 source review:** The requested live insertion is present in boards/claude-agent/app.js: provider descriptions cache features, live: true is sent only when the selected provider advertises "live", nonempty segment messages use insertVoiceText(), result.text is suppressed after a segment, and there is no draft handler, so draft text is ignored. Provider final-only behavior remains. This is source inspection, not live runtime verification; retain these behaviors and close any BT-066 gaps found during implementation.
- **Current recording path:** startVoiceRecording(), stopVoiceRecording(), consumeVoiceSamples(), and watchVoiceChannel() are in boards/claude-agent/app.js. audio-capture-worklet.js emits mono float samples. stopVoiceRecording() flushes queued PCM, releases capture, then sends end. The mic click stops a recording; when the terminal result clears the request, another click starts a new request.
- **Normative live contract:** C:/projects/persephone/assets/guides/agents/speech-transcribe.md states live requests have no total-duration cap; maxAudioMs and too-long apply only to non-live requests. Drafts are replaceable uncommitted text, committed segments are ordered and have startMs/endMs offsets from the first sample, and final result text repeats committed text. Draft text must never enter the prompt.
- **Persephone algorithm inspected:** C:/projects/persephone/src/renderer/ui/voice-typing/VoiceTypingController.ts tracks acoustic level intervals against capture-relative milliseconds. For each committed segment, it pools levels whose intervals overlap startMs/endMs and sets quiet threshold to max(0.005, 0.2 × median of committed-speech RMS levels). Every 150 ms, it auto-stops only with active capture, at least one segment, no outstanding draft utterance id, and current level below threshold for the configured duration. A draft adds its utterance id; a segment removes the matching id. No segment, outstanding draft, missing threshold, or louder level resets the quiet timer.
- **RMS implementation choice:** Compute RMS in consumeVoiceSamples() from resampled 16 kHz float samples. That timeline matches the PCM sent to the provider, so level intervals compare directly with segment offsets. Use short fixed windows (for example, 100 ms) with startMs/endMs/value and no visible meter.
- **Live duration cap:** request.sampleLimit is initialized and reset from maxAudioMs - 1000; consumeVoiceSamples() displays voice.limit and stops at that limit. Remove the limit for requests opened with live: true, retaining it for non-live requests. The guide explicitly says live duration is uncapped.
- **Release state checked 2026-10-27:** Agent Chat board-manifest.json and the top WHATS-NEW.md heading are both 1.3.1. Local git has claude-agent-v1.3.0 but no claude-agent-v1.3.1 tag; generated boards-manifest.json remains at the published 1.3.0. The repo publishes on pushes to main through .github/workflows/publish-boards.yml and scripts/publish-board.mjs, which creates a <board-id>-v<version> release/tag and updates generated manifests; doc/tasks/completed.md has prior Agent Chat publish evidence. Add a line under 1.3.1 and keep the manifest there. Recheck before implementation/release; if 1.3.1 shipped, use 1.3.2 in both files.
- **Visible state:** Keep the existing recording label and elapsed timer. A level indicator is not needed.

## Implementation Plan

1. [x] **Subscribe to the setting once** during board load in boards/claude-agent/app.js. Feature-detect with typeof persephone.voiceTyping?.onAutoStopSilenceChange === 'function'; the immediate callback initializes module state and subsequent callbacks keep the latest value current. Accept any finite integer >= 0, otherwise store 0 (off). Retain the returned unsubscribe function for board teardown. The auto-stop check reads the latest module value, so changes during recording apply immediately. Keep minBridgeVersion at 1.42.0.
2. [x] **Track RMS and speech baseline** in consumeVoiceSamples(). Calculate RMS over fixed windows of resampled 16 kHz samples and store capture-relative intervals derived from sample offsets. For each committed segment with finite valid startMs/endMs, select overlapping RMS windows and recompute max(0.005, 0.2 × median(all overlapping committed-speech RMS values)), matching Persephone's pooled baseline semantics. Keep level history bounded using the controller's general retention approach, while retaining the speech baseline required for threshold updates.
3. [x] **Track drafts and auto-stop** in watchVoiceChannel() and the existing request timer. On live requests only, add a valid utterance id to draftUtterances on draft and remove the matching id on segment; ignore draft text. At the periodic check, reset quiet timing unless capture is recording, at least one segment arrived, no drafts remain, a threshold exists, and current RMS is below threshold. After the configured duration, call stopVoiceRecording() so PCM flush, capture release, and terminal end match a button click. Value 0, absent API, or non-live request disables auto-stop.
4. [x] **Disable only the live sample cap** in startVoiceRecording() and consumeVoiceSamples(). Once provider description determines live opt-in, do not limit live samples by maxAudioMs - 1 second and do not show voice.limit for that provider duration. Preserve the existing cap, error, and stop behavior for non-live. Keep committed segments inserted once, drafts ignored, and duplicate final text suppressed.
5. [x] **Keep the UI minimal** in renderVoice(): retain recording label and timer; add no level meter. Auto-stop shows the existing stopping/transcribing state while waiting for the terminal response. Once finishVoice() clears the request, the next mic click starts another request.
6. [x] **Plan release metadata:** Add one terse auto-stop/live-dictation line to boards/claude-agent/WHATS-NEW.md under unpublished 1.3.1 and keep board-manifest.json at 1.3.1. If claude-agent-v1.3.1 exists by implementation/release time, move the heading and manifest together to 1.3.2.
7. [ ] **Manually verify** with a live-capable and a non-live provider: supported and disabled durations, setting changes during recording, no stop before a segment, no stop with any outstanding draft, below-threshold quiet duration, normal stop flush/end behavior, another recording after finish, no live maxAudioMs cutoff, and retained non-live cap. Confirm drafts never appear in the prompt and final text does not duplicate committed segments. Do not add tests or a harness.

## Concerns / Open Questions

- The provider contract allows multiple committed segments for one utterance. Follow the inspected controller: every segment removes that utterance id; a later draft may add it again. Confirm this is appropriate with the live provider's partial-commit behavior.
- Missing or invalid segment timing cannot contribute to the speech baseline. Keep auto-stop disabled until valid committed-speech level data establishes a threshold; do not infer a baseline from draft or unaligned audio.
- Measure silence with wall-clock elapsed time, as Persephone does now; reset when level rises above threshold or a draft appears.

## Acceptance Criteria

- [x] Feature-detect the setting API; accept any finite integer >= 0 (0 = off), treat every other value or absent API as off, and keep minBridgeVersion at 1.42.0.
- [x] Live RMS is measured on the resampled audio timeline and uses the segment-aligned pooled threshold max(0.005, 0.2 × median committed-speech RMS).
- [x] Auto-stop applies only to live capture after at least one segment, with no outstanding draft, below threshold for the configured duration; it uses the button's stop path.
- [x] Draft text never enters the prompt; committed phrases are inserted incrementally once, without duplicate final text.
- [x] Live requests are not capped by maxAudioMs; non-live requests retain the current maxAudioMs - 1 second cap and voice.limit behavior.
- [x] Recording label and timer remain; no meter is added. A new recording can start after the stopped request finishes.
- [x] WHATS-NEW and manifest target 1.3.1 while unpublished, or move together to 1.3.2 if 1.3.1 shipped.
- [ ] Manual verification is completed; no unit tests or harnesses are added.

## Files Changed

| File | Change |
|------|--------|
| boards/claude-agent/app.js | Feature-detected silence setting, aligned RMS, draft-aware auto-stop, and live-specific uncapped capture |
| boards/claude-agent/WHATS-NEW.md | Add the auto-stop change under the unpublished release heading |
| boards/claude-agent/board-manifest.json | Keep at 1.3.1, or 1.3.2 if 1.3.1 ships first; retain minBridgeVersion 1.42.0 |
| doc/tasks/BT-068-agent-chat-auto-stop/README.md | This task plan |
| doc/active-work.md | Link BT-066, BT-067, and BT-068 under Active |

## Notes

- Source and release-state findings are recorded as of 2026-10-27. Implementation and release metadata are updated; manual verification remains for the board owner.
