# BT-067: Speech to Text - hour-long live sessions

**Epic:** Persephone EPIC-134, phase 4  
**Status:** Active  
**Scope:** Speech to Text service only. Persephone US-1731 owns meeting capture and transcript UI.

## Goal

Allow a `speech.transcribe` live channel to run for an hour or longer without a duration rejection
or memory use that grows with the session. Keep both concurrent live channels responsive while
sharing the board's single `whisper-server` process.

## Verified service behavior

- `scripts/service.mjs` advertises `maxAudioMs: 300000` and applies the five-minute byte-duration
  check to every request, including live requests. Non-live requests must keep this cap; live
  requests must not be rejected based on total duration.
- The `speech.transcribe` contract wording this task relies on is: **"`maxAudioMs` limits
  non-live requests; a live request is not capped by total length."** Persephone US-1731 makes the
  corresponding guide change. The provider description may continue advertising the limit for
  non-live requests.
- Live audio is already held in a bounded sliding window by `LiveStream`; total sample and byte
  counters are scalar values. Live prompt construction currently joins the growing
  `trimmedCommitted` array on each inference and only then takes the final 200 characters.
- Live requests append committed transcript pieces to `request.committed` for the terminal result.
  Each live channel has bounded current-window VAD/alignment state, but that committed result list
  grows with the session and needs to be addressed for flat per-request memory.
- Concurrent channels share one `whisper-server` and a single service inference queue. Existing
  logic prevents a request from scheduling redundant partial work and removes queued draft/partial
  jobs in some commit paths; committed inference jobs are not discarded.

## Plan

1. [x] Apply `MAX_AUDIO_MS` only to non-live requests. Preserve the advertised duration metadata
   and `too-long` behavior for non-live requests. Live requests accept audio beyond five minutes,
   consistent with the contract wording above.
2. [x] Keep live request memory flat. Preserve the existing bounded audio window and scalar
   duration counters. Replace `trimmedCommitted` with a rolling prompt-tail string capped at 200
   characters, updated as text is committed; do not join accumulated segment records to build a
   prompt. Do not retain per-segment arrays; the only text that grows is the single committed-text
   string for the terminal result (see Terminal result). Keep only bounded current-utterance alignment/VAD state.
3. [x] Make queue pressure handling explicit across concurrent live channels sharing the same
   server. When work is under load, skip or supersede draft/partial inference first; never drop an
   accepted committed segment. Put the thresholds together in one commented constants block; use
   60 seconds of queued commit audio as the draft/partial skip threshold and five minutes as the
   queued-commit hard cap. At the hard limit, stop accepting more live audio, drain already
   accepted commits, and terminate cleanly using the existing channel error path. Do not add a
   separate backlog notification to callers unless the current contract already defines one.
4. [x] Preserve independent language hints/language latching per channel and existing segment
   event behavior. Do not add meeting-specific identifiers, file handling, UI, permissions, or
   capture behavior to the board.
5. [x] Fold the service change into the unreleased board version `1.3.0`. This is service-only and
   Persephone `5.0.15` is already the board's `minAppVersion`; no new app or bridge capability is
   required.

## Terminal result (decided)

Keep the terminal `result.text` contract unchanged: all committed live text joined with spaces.
An hour of speech is roughly 50-100 KB of text, which is negligible; flat memory is about audio
and per-segment objects. Accumulate the committed text as one string (no per-segment array), and
keep the 200-character prompt tail separate.

## Verification plan

- Run two concurrent live channels against the shared server for at least 10 minutes, then continue
  one channel beyond five minutes to confirm the duration cap is absent only for live requests.
- Sample the service process memory before and during the run and at intervals through the end.
  Confirm memory remains bounded rather than growing with committed segment count.
- Exercise queue pressure and confirm draft/partial work is skipped first, every accepted commit
  is delivered, and the hard-limit shutdown drains queued commits before closing the channel.
- Confirm rolling prompt context stays at or below 200 characters and each channel retains its own
  language behavior.

No unit tests are planned for this task.

## Fixes found in live verification (2026-10-27)

- The prompt tail must hold only words whose audio has left the window (`addPromptTail()` at trim and
  utterance end). Adding every committed word made Whisper skip ahead, and words were lost.
- Language detection asked whisper-server not to report probabilities, so a detection outside the
  allowed list (Ukrainian heard as Russian) always fell back to the first allowed code; with `en,uk`
  that forced English, which Whisper renders as a translation. Detection passes now request
  probabilities (`settleDetectedLanguage()`), the latch needs 3 s of speech at probability >= 0.7, and
  every live commit re-detects so a wrong latch corrects itself at the next utterance.
- The service never received its stored settings at all: Persephone refused board-settings requests
  until the handshake finished. Fixed in Persephone (`module-service-supervisor.ts`, US-1731 commit).
