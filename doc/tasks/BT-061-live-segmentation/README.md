# BT-061: Live segmentation in the Speech to Text service

## Status

**Status:** In Progress  
**Priority:** High  
**Board id:** speech-to-text  
**Started:** 2026-10-26  
**Completed:** —

## Goal

Add opt-in live segmentation to the Speech to Text service. Each live channel produces replaceable draft previews and ordered final utterance segments, then the usual final result. Channels that omit the live flag keep today's behavior.

## Background

- **Epic/task order:** Persephone EPIC-134 phase 2 has six tasks; BT-061 is task 2, after BT-060's streaming VAD helper and before the contract/consumer tasks.
- **Accepted design and measurements:** C:/projects/persephone/doc/tasks/US-1726-pause-detection-research/README.md (Recommendation and Measurements) and C:/projects/persephone/doc/epics/EPIC-134.md (phase 2 task table). English TTS hybrid result: 0/89 word errors. User voice hybrid result: English 0/40, Ukrainian 3/28, with errors in one short isolated phrase. These are small-sample targets, not guarantees.
- **VAD helper (BT-060):** one whisper-vad-helper.exe process per live stream, launched from the runtime directory with --model models/ggml-silero-v6.2.0.bin --threads 1. Raw 16 kHz s16le is written to stdin; stdout is JSONL with {frame, speechProbability} per 512-sample frame. Final partial frame is zero-padded; EOF exits 0. Lockstep cost is about 0.25 ms/frame.
- **Provider today:** boards/speech-to-text/scripts/service.mjs receives ordered 16 kHz mono PCM s16le chunks, enforces a 300,000 ms limit, buffers all chunks, wraps them as WAV on end, and sends one /inference request through a FIFO queue. describe currently advertises features: []. The service registers an early-message collector before awaiting settings/readiness.
- **BT-058 language behavior:** caller language hints override the saved setting. A single allowed language is forced. With multiple or zero allowed languages, infer first uses auto, maps whisper's returned language name, and if it is outside a nonempty allowed set retries up to three allowed languages, selecting the best token-weighted avg_logprob. Current code makes that decision for every inference request; it does not latch language per stream.
- **Current prompt behavior:** inferOnce uses request.prompt || settings.vocabulary. Live requests will cap that base prompt at 400 characters and append the last 200 characters of committed text from that stream; drafts and commits use the same prompt rule.
- **Current consumer:** boards/speech-to-text/app.js sends 3,200-sample PCM chunks and handles status, result, and error only. The recorder shows result.text. BT-061 does not change the UI.
- **Consumer contract source:** C:/projects/persephone/assets/guides/agents/speech-transcribe.md defines v1 open/audio/end/cancel, status/result/error/description messages, and says live partials are not part of v1. BT-061 defines the live wire format below; US-1727 will document exactly what BT-061 implements.
- **Runtime paths:** downloads.mjs pins whisper-runtime-1.9.5-r2. The data root is %LOCALAPPDATA%/Persephone/board-data/speech-to-text and the runtime directory is <dataRoot>/runtime/<RUNTIME.id>. BT-060 makes the helper and its bundled model required members of the verified r2 runtime, so successful open-time readiness continues to imply both are present.
- **Board release state:** board-manifest.json is already unpublished version 1.1.0 on develop. WHATS-NEW.md has the r2/helper line under 1.1.0; plan a second 1.1.0 line for live segmentation without changing the version.
- **Accepted simulator:** C:/Users/ANDRII~1/AppData/Local/Temp/claude/C--projects-persephone/4fc7f5dc-827f-4ce9-8a15-5cfe2ab1e4e3/scratchpad/vad/sim.py. Port the frame segmentation in segment() and raw speech-boundary grouping in main()'s --commit-silence path, not its code style. The simulator is offline and does not implement live queueing or wire messages.

## Implementation Plan

### 1. Add scripts/live.mjs

- [x] Export a pure Segmenter. Its input is one ordered {frame, speechProbability} observation for each 512-sample frame; its output is zero or more {type:"draft"|"commit", utterance, start, end} events, where start/end are absolute sample offsets and ranges are half-open [start,end).
- [x] Implement explicit states: idle (no current utterance), speech (speech currently active), and pause-after-speech (a raw VAD speech run ended and its pause is being measured). Enter speech at probability >= 0.5; leave speech at probability < 0.35. Values between thresholds preserve the current classification.
- [x] Track raw VAD speech-run boundaries separately from padded audio bounds. Join speech runs into the same utterance when the gap between raw speech end and next raw speech start is < 1200 ms. At a 500 ms pause emit/update a draft for the utterance-so-far. At 1200 ms pause commit the full utterance from its start through 300 ms after the last raw speech end, clipped to received audio. Include gaps between joined speech runs in that one contiguous range.
- [x] Set each new utterance start to max(previous commit end, first raw speech sample - 16,000 samples). Apply 300 ms (4,800 sample) end padding to pause-ended ranges. Ranges must never overlap.
- [x] Drop an utterance with total raw speech duration < 250 ms without sending it for inference or emitting a commit. Do not let the pre-roll or silence padding count toward this minimum.
- [x] Cap an utterance at 25 seconds. Track the lowest-probability frame in the final three seconds and force the commit boundary at that frame. The next utterance starts exactly at that absolute sample boundary, with no pre-roll, so the adjacent ranges do not overlap. Continue tracking subsequent speech as a new utterance.
- [x] flush() finalizes the open utterance on end using available audio and end padding, subject to the 250 ms minimum. Make flush idempotent so terminal races cannot emit duplicate commits. Reset/dispose clears state without emitting on cancel/close/shutdown.

### 2. Add LiveStream in scripts/live.mjs

- [x] LiveStream owns the helper child process, Segmenter, and a PCM store addressable by absolute sample index. Append each incoming PCM chunk once to the store and write the same raw bytes to helper stdin.
- [x] Spawn whisper-vad-helper.exe from the verified runtime directory with --model models/ggml-silero-v6.2.0.bin --threads 1 and cwd set to that runtime directory. Handle spawn errors and child exit.
- [x] Handle stdin write failures, including EPIPE, without an unhandled error. Parse stdout incrementally as UTF-8 newline-delimited JSON; validate JSON shape, monotonic frame index, and finite speechProbability before feeding the Segmenter. Treat malformed, missing, or out-of-order frames as helper protocol failure.
- [x] On end, stop accepting writes, close helper stdin, drain the final JSONL record from its zero-padded partial frame, flush the Segmenter, and await normal helper exit before final result. On cancel, channel close, terminal error, or service shutdown, stop accepting writes, kill a helper that is still running, and await/observe exit. Do not leave child processes or pipe listeners alive.
- [x] On helper spawn failure, crash, EPIPE, or protocol failure, stop segmentation immediately, emit no more drafts, and retain all PCM. Log one diagnostic through console (service.mjs currently has no logging abstraction).

### 3. Change scripts/service.mjs

- [x] Accept open.live === true as opt-in. A request without it follows the existing accumulation path and enqueues exactly one final job at end.
- [x] For live channels, create LiveStream at accept, send listening first, then start ensureEngine(model) in the background to warm whisper-server while audio arrives. A job sends preparing only if the engine is still loading when that job starts. Send transcribing after end while flushes and queued commits drain; send result only after they finish. Normal live order: listening; draft/segment messages while listening; optional preparing if still loading; after end, transcribing; result; close. Do not send status or any other message after a terminal result/error.
- [x] Replace request-level queue items with jobs shaped {request, kind:"final"|"draft"|"commit", range}; allow only one active whisper-server job. Make activeRequest refer to the active job and update all its guards/cleanup sites: terminal(), scheduleIdleStop(), applySetting() GPU toggle, managementCommand() model use, and onShutdown. Keep non-live jobs as kind:"final".
- [x] Track open live requests separately from queued/active jobs. scheduleIdleStop() must clear or defer its timer while any live request is open, even when that stream is silent and has no queued job. When the last live request ends, is cancelled, closes, or becomes terminal, restart the normal idle timer if there are no jobs.
- [x] Draft queue policy: when a draft job for utterance n reaches the queue head, discard it if a newer draft or the commit for n is queued, or if n's commit has already been sent. Commits are never discarded except when their request is terminal. Maintain per-request segment order despite global serialization.
- [x] Change infer() to receive an absolute PCM range, read that slice from the request's PCM store, and pass makeWav() the slice; it must not read request.chunks/request.bytes for live jobs. For a non-live final job, use range [0,totalSamples), preserving current one-request behavior.
- [x] For live draft/commit jobs, use basePrompt = (request.prompt || settings.vocabulary).slice(0, 400), then append the last 200 characters of that stream's committed text. Drafts use the same prompt as commits. Keep full/default whisper audio context.
- [x] Apply the language policy below to draft and commit job construction. Segment messages use the language returned by that job's inference.
- [x] On live end, stop audio intake, close helper stdin so the helper zero-pads/processes its final partial frame, feed final probabilities, call flush(), enqueue its commit, drain all commit jobs, then send the unchanged v1 result fields. result.text is committed segment texts joined with one space; result.audioMs is total received audio duration and elapsedMs covers the request through final completion.
- [x] On helper failure, allow already queued/in-flight commits to finish, but invalidate queued and in-flight draft results so none are emitted after the failure. At end, enqueue one final commit for all audio after the last committed sample, then send result. Do not re-transcribe already committed audio and do not lose the uncommitted PCM. Enforce the existing five-minute limit while retaining fallback audio.
- [x] Keep readiness checks as they are: the verified r2 runtime requires whisper-server.exe and whisper-vad-helper.exe. Fallback applies only to helper spawn failure or helper failure after the stream has been accepted, not a failed runtime verification or missing model.
- [x] Ensure terminal(), cancel, close, and onShutdown stop the helper and discard request jobs/resources; no messages may follow result/error. End flushes and drains commits before the result.
- [x] Add the planned WHATS-NEW.md line under 1.1.0: “Added opt-in live segmentation with draft previews and committed utterances.” Keep board-manifest.json at 1.1.0.

### 4. Verify through Persephone MCP

- [x] Claude verifies from the Speech to Text board page using Persephone MCP; a plain Node script cannot open the service channel because the service runs inside Persephone. Do not add a UI change, unit test, committed test harness, or board-folder _test directory.
- [x] Connect to the service with live:true and stream C:/Users/ANDRII~1/AppData/Local/Temp/claude/C--projects-persephone/4fc7f5dc-827f-4ce9-8a15-5cfe2ab1e4e3/scratchpad/vad/en-pauses.wav (38.2 s) at real-time pace in 100 ms chunks; use sibling en-ref.txt. Log each draft, segment, and result with wall-clock timestamps and compare committed text against the 89-word reference.
- [x] Run the same clip through a non-live request and confirm one final result with today's behavior.
- [x] Cancel mid-stream; confirm helper termination and no later messages. Force helper failure (for example, kill its child process), continue streaming to end, and confirm there are no further drafts, the uncommitted tail is committed once, and result contains prior commits plus the tail.
- [x] After cancel, close, and end, inspect tasklist to confirm helper processes do not outlive their requests.

## Contract defined for US-1727

BT-061 defines these wire shapes. US-1727 documents this behavior and these fields; it does not gate implementation.

- Open: existing v1 transcribe fields plus live:true, for example { "type":"transcribe", "format":{"encoding":"pcm-s16le","sampleRate":16000,"channels":1}, "languages":["uk","en"], "prompt":"...", "live":true }. Omitting live or setting it false preserves current v1 behavior.
- Describe: retain existing fields and advertise features:["live"].
- Draft: { "type":"draft", "utterance":1, "text":"...", "startMs":120, "endMs":840 }. Text is trimmed. A newer draft replaces an earlier draft for the same utterance. Never send a draft after that utterance's segment.
- Segment: { "type":"segment", "utterance":1, "text":"...", "language":"uk", "startMs":120, "endMs":840 }. Text is trimmed; segments are final and sent in ascending utterance order. Times are offsets from the first audio sample (absolute sample offset / 16 for milliseconds), for future meeting timestamps.
- If trimmed inference text is empty, emit no segment. Utterance IDs may then skip; consumers must not assume contiguity. Result remains the v1 shape { "type":"result", "text":"...", "language":"uk", "audioMs":38200, "elapsedMs":40000 }; result.text is nonempty segment texts joined with one space. Consumers insert a separator between committed segments.
- Existing caller messages remain ordered {type:"audio", data:ArrayBuffer}, then {type:"end"} or {type:"cancel"}. Existing v1 errors and channel-close behavior remain unchanged.

## Concerns / Open Questions

- **Language policy — decided by the user 2026-10-26: latch once.** Until latched, commits use full BT-058 infer (auto plus forced retries when detected language is outside the allowed set). Drafts use one inference pass only: auto when there are multiple/zero allowed languages, or the single allowed code when there is exactly one. If an auto draft detects a language outside a nonempty allowed set, skip that draft instead of retrying. Latch the selected language from the first commit containing at least 2 seconds of raw speech; force that code for later drafts and commits in the stream. A single allowed language is forced from the start. Short first commits do not latch; code-switching remains forced to the latched language.
- **Audio retention:** keep the existing five-minute maxAudioMs in both modes for BT-061 because fallback needs the uncommitted PCM. Live mode could later trim PCM before (last commit end - pre-roll) and lift the limit for long meetings in EPIC-134 phase 4.
- **Settings changes:** GPU toggle and active-model use currently call stopEngine when there is no active request. During an open live stream between jobs this can stop the warm engine; the next job will reload it. This is acceptable for BT-061.
- **Inference load:** drafts add work to the single whisper-server queue. Stale drafts are dropped at the queue head per the rule above; commits remain lossless and ordered. Keep full audio context; -ac 768 caused a repeated Ukrainian sentence in research.

## Acceptance Criteria

- [x] Requests without live:true preserve today's one-final-result behavior; describe advertises features:["live"].
- [x] Segmenter implements idle / speech / pause-after-speech states, 0.5/0.35 hysteresis, 1 s bounded pre-roll, raw-boundary <1200 ms merging, 500 ms drafts, 1200 ms commits, 300 ms end padding, 250 ms minimum speech, and the 25 s quietest-frame cut in the last 3 s. Absolute ranges never overlap; cap continuation starts exactly at the cut without pre-roll.
- [x] Draft/segment payloads and trimmed-text rules match the contract section; timestamps map absolute samples to milliseconds from the first input sample.
- [ ] *(Accuracy met: 0/89. Latency partly: typically 2.5 s, up to 4.6 s when a draft holds the engine; see Verification.)* English TTS target is 0/89 word errors or near that result. Commit latency is approximately pause wait plus inference; record per-event wall-clock timings and observed word errors.
- [x] Commit requests transcribe the whole utterance from its start, including gaps, and use the specified base plus committed-text prompt. Drafts use the same prompt.
- [x] Drafts are discarded at queue head only under the stated supersession rules; commits are never discarded except when terminal. Final result text equals segment texts joined by one space.
- [x] Helper failure stops drafts and commits only audio after the last committed sample at end; it does not re-transcribe committed audio. The five-minute limit is enforced and retained PCM supports fallback.
- [x] Live status order is listening, optional preparing only while a job starts with engine loading, transcribing after end while flush/commit jobs drain, result. No messages follow result/error.
- [x] Helper process does not outlive request on end, cancel, close, or shutdown; check with tasklist. No messages follow terminal result/error.
- [x] Live requests keep the engine warm while open, including long silent pauses; the idle timer restarts when the last live request ends. Settings changes between jobs may stop it as documented.
- [x] Persephone MCP verification covers live clip at real-time 100 ms chunks, non-live unchanged behavior, cancel cleanup, and forced helper failure fallback. No test harness or UI changes are committed.
- [x] WHATS-NEW.md has the planned live line under unpublished 1.1.0; board-manifest.json remains 1.1.0.

## Files Changed

| File | Change |
|------|--------|
| boards/speech-to-text/scripts/live.mjs | New — pure segmenter and live helper/PCM stream owner |
| boards/speech-to-text/scripts/service.mjs | Add live jobs, channel lifecycle, inference ranges, and live message emission |
| boards/speech-to-text/WHATS-NEW.md | Add the planned live segmentation line under 1.1.0 |
| doc/tasks/BT-061-live-segmentation/README.md | This task plan |
| doc/active-work.md | Track BT-061 under Active as EPIC-134 phase 2, task 2 of 6 |

## Notes

- Offline Segmenter exercise passed from a temporary script outside the repo: drafts appeared after the 500 ms pause; the 2 s + 600 ms gap + 1 s speech merged into one commit padded through 300 ms; pre-roll stayed within 16,000 samples; a 30 s run cut at the lowest-probability frame in its final 3 s and continued at that exact boundary; a 200 ms blip emitted nothing; commit ranges did not overlap. The temporary script was deleted.
- Section 4 Persephone MCP verification was intentionally not attempted per the implementation request.

- The simulator's segment() defaults differ from production: its pad defaults to 200 ms, pre-pad defaults to pad, and max duration defaults to 15 s; it has no 250 ms utterance minimum. The accepted production values are 1 s pre-roll, 300 ms post-padding, 25 s maximum, and 250 ms minimum speech.
- The simulator's --commit-silence grouping compares raw VAD speech boundaries, not padded segment edges. Production must preserve that distinction. Its offline grouping does not provide live queue supersession, helper lifecycle, or channel ordering.
- Live mode retains all PCM up to the existing five-minute limit for helper-failure tail commit; no long-recording buffer trimming is included in BT-061.

### Verification (Claude, 2026-10-26)

Streamed the US-1726 English TTS clip (38.2 s) from the Speech to Text board page through `persephone.service.openChannel` at real time in 100 ms chunks (a temporary `_probe.pcm` in the board folder, deleted afterwards). r2 was installed through the board's own runtime download, which removed r1.

- **Accuracy:** 0 word errors against the 89-word reference (differences are punctuation and capitalisation only). Five utterances, the same boundaries as the US-1726 simulator; language latched to `en`.
- **Timing (warm engine, speech end to message):** drafts 1.4 - 2.5 s; segments 2.5 / 2.5 / 3.7 / 2.5 / 2.6 s, except the first sentence at 4.6 s. A draft started at the 500 ms pause occupies whisper-server when the 1200 ms commit arrives, so the commit waits behind it; the US-1726 simulator did not model this queue contention. Tuning (e.g. skipping drafts for short utterances) is left for when consumers show drafts.
- **Non-live request:** unchanged (`listening`, `preparing`, `transcribing`, one `result`; text keeps its leading space as before).
- **Cancel mid-stream:** `error cancelled`, nothing after it, no helper process left.
- **Helper killed mid-stream (taskkill):** no further drafts; at `end` the uncommitted audio was committed once and `result` was correct.
- **No helper processes** outlive a request (tasklist after cancel, end and kill).

### Fixes made during verification (Claude)

- No drafts reached the caller. The Segmenter emitted a draft on every frame of a 500 - 1200 ms pause (`draftSent` was set but never checked), and a finished draft was suppressed once its utterance's commit was *queued* (`committedIds` is set at enqueue). Now one draft per pause (speech resuming re-arms it), and a draft is dropped only after its utterance's commit has finished (`finishedIds`).
- `draftsInvalid` (set after a helper failure) also discarded commit events; it now drops drafts only.
- **Intermittent, not root-caused:** in 4 of about 14 live runs the stream ended with no drafts or segments although the helper returned every frame, and `result` came back empty about 10 ms after `end`. The evidence fits the Segmenter not emitting (or being disposed early) while frames kept arriving, but it never reproduced with diagnostic logging in place. Safety net: if a live stream ends without a helper failure and without any utterance while the helper reported a speech probability >= 0.5, the service logs a diagnostic and commits the whole recording as one segment, so the caller gets the full transcript instead of nothing. Watch for it when the voice typing and Agent Chat tasks use live mode; their drafts and segments will show the symptom immediately.
