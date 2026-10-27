# BT-066: Agent Chat: live insertion of committed phrases

## Status

**Status:** Active  
**Priority:** High  
**Board id:** `claude-agent`  
**Started:** 2026-10-27  
**Completed:** —

## Goal

When the selected `speech.transcribe@1` provider advertises the `live` feature, Agent Chat requests live transcription and inserts committed text segments into the prompt as they arrive. Uncommitted `draft` messages are ignored and never shown. Stopping must not insert text already committed; providers without `live` keep the existing record-then-transcribe behavior.

## Background

- **Epic and order:** Persephone [EPIC-134](C:/projects/persephone/doc/epics/EPIC-134.md), phase 2, task 6 of 6. BT-060 and BT-061 implement provider-side streaming segmentation; US-1727 documents the v1 live messages; BT-062 adds several partial commits per utterance. This task is Agent Chat's consumer work.
- **Existing consumer:** `boards/claude-agent/app.js` (BT-057) discovers providers, describes them for `maxAudioMs`, captures and streams 16 kHz mono PCM, and currently inserts only `result.text`. It already tracks a request's starting prompt/caret, serializes queued audio, and has stop, Escape-cancel, view-switch, visibility, and pagehide handling. Preserve those lifecycle and final-only behaviors where applicable.
- **Prompt structure:** `boards/claude-agent/index.html` uses a `contenteditable="plaintext-only"` `#prompt` inside `.composer`; it is not a textarea. `boards/claude-agent/app.js` already inserts text at the saved or current caret, with whitespace-aware boundaries. Preserve that target policy for committed segments.
- **Live UI precedent:** `boards/speech-to-text/app.js` opens with `live: true` only for its live mode, appends nonempty committed segment text, and handles several segments for one utterance.
- **Normative contract:** `C:/projects/persephone/assets/guides/agents/speech-transcribe.md`. Describe before opting in; send `live: true` only when `description.features` contains the exact string `"live"`. Segment text contains only new committed text, and final `result.text` for the Speech to Text provider is the nonempty committed segment texts joined by one space. Ignore `draft` and unknown message types. Empty segments are allowed. Do not insert `result.text` again after segments were inserted.
- **Provider advertisement:** the Speech to Text board advertises `features: ["live"]`; an unavailable, refused, failed, closed, or malformed describe is treated as non-live. Providers without the feature must continue to work with one final result.
- **Release state checked 2026-10-27:** Agent Chat's manifest is `1.3.1`; `WHATS-NEW.md` has a matching `1.3.1` heading, and local git has no `claude-agent-v1.3.1` tag. This is an unpublished release train: add the live-insertion line under `1.3.1` and keep manifest version `1.3.1` while it remains unpublished. Recheck the release tag at implementation/release time; if `1.3.1` has since shipped, use the next version and matching changelog heading instead.
- **Languages:** `boards/claude-agent/lang/en.json` is the only catalog in `boards/claude-agent/lang/`. Any new user-visible voice status or cancellation copy must use `i18n.js`/`t()`.

## Implementation Plan

1. **Describe and opt in per provider** in `boards/claude-agent/app.js`. Extend the existing provider description cache from `maxAudioMs` to retain validated feature metadata. Ensure starting a request has a settled describe outcome for the selected provider (the microphone may start in parallel); an exact `features.includes("live")` enables `live: true`, while any describe failure, refusal, timeout/close without a valid description, or malformed features selects the current final-only open. Retain the existing provider list/version checks and sample limit behavior.
2. **Handle ordered live events** in the request channel listener. Ignore `draft` messages and unknown message types. Insert only nonempty trimmed `segment` text in event order; ignore empty segments without adding separators or changing the prompt. Serialize insertion if needed so the terminal result cannot overtake earlier commits. Track whether any segments were inserted: suppress `result.text` after one or more segments to avoid duplicates; if a live-capable provider returns a final result without any segments, insert that final text once. For final-only providers, retain the current one-time `result.text` insertion unchanged.
3. **Preserve insertion behavior while dictating** in `boards/claude-agent/app.js`. Apply each segment at the established insertion target: while the prompt is focused use its live caret; if the prompt has not changed since start and focus moved, use the saved start caret; if the prompt changed and focus is elsewhere, append to its end. Insert through the existing whitespace-aware routine, update the originating view's saved draft, and leave the caret after inserted text. Never replace the prompt from a stale snapshot. If a view is switched, keep committed text with its originating view and prevent later events from writing into the newly shown prompt.
4. **Define terminal behavior and cleanup.** The mic button's normal stop flushes queued PCM, sends `end`, releases capture, and waits for the terminal message. Escape sends `cancel` and keeps already inserted committed segments, matching existing cancellation semantics. Preserve the existing view-switch stop/discard behavior, hidden-page stop behavior, and pagehide/beforeunload cancellation; all terminal paths close/release resources once. An empty final result and a final result after multiple segments must not duplicate or erase committed prompt text.
5. **Update release documentation** in `boards/claude-agent/WHATS-NEW.md` under the unpublished `1.3.1` heading with one concise live voice input entry. Keep `boards/claude-agent/board-manifest.json` at `1.3.1` unless the release tag check in Background changes the release state; in that case bump the manifest and create the matching top changelog heading together.
6. **Review manually in the running board** against a provider with `features: ["live"]` and a provider without it: verify ordered segment insertion, ignored `draft` messages, several segments for one utterance, empty segment handling, caret movement and typing during dictation, stop without duplicates, Escape, switching chats, hidden-page stop, and pagehide cleanup. Do not add unit tests.

## Concerns / Open Questions

- Current view switching stops the request while keeping the previous view alive; `insertVoiceText()` routes later text to that view's saved draft. A view that is dropped is marked discarded, while pagehide cancels the request. Preserve these distinctions so no pending event can land in the newly selected chat.
- Recheck whether `claude-agent-v1.3.1` has been released before changing version metadata. The local repository had no such tag when this document was written.

## Acceptance Criteria

- [x] The consumer sends `live: true` only after the selected provider's valid describe response advertises exactly `"live"`; all other describe outcomes preserve the final-only path.
- [x] Provider `draft` messages and unknown message types are ignored and never displayed.
- [x] Nonempty segments insert once, in order, at the defined live caret target; several segments for one utterance work, and empty segments are ignored.
- [x] Stop waits for the live terminal result and never inserts `result.text` over segments already committed. A live request with no segment events can use its final result once; final-only providers still insert their final result once.
- [x] User caret movement or typing during dictation does not overwrite text or move later insertion into another chat; inserted text leaves the caret after the latest segment.
- [ ] Escape retains already committed text and cancels the channel. View switch, hidden-page stop, pagehide, and beforeunload retain their existing stop/cancel semantics and release capture/channel resources. Manual verification remains for the user.
- [x] The board changelog and manifest version are consistent with the checked unpublished release state.
- [x] No unit tests are added.

## Files Changed

| File | Change |
|------|--------|
| `boards/claude-agent/app.js` | Describe feature opt-in, live segment handling, insertion ordering, and lifecycle cleanup |
| `boards/claude-agent/WHATS-NEW.md` | Add live voice input under the unpublished 1.3.1 heading |
| `boards/claude-agent/board-manifest.json` | Keep at 1.3.1 while unpublished; bump with a matching heading only if that release has shipped |
| `doc/tasks/BT-066-agent-chat-live-insertion/README.md` | This task plan |
| `doc/active-work.md` | Not changed per instruction |

## Notes

- This document plans board changes only. The live provider contract already defines the needed feature and message behavior; no implementation or edits to `C:/projects/persephone` are included here.
