# BT-093: Wake Word — one detection per phrase, best-matching person wins

## Status

**Status:** In Progress *(verified in the Wake Word board; the Agent Chat path is still unverified)*
**Priority:** High
**Board id:** `wake-word`
**Started:** 2026-11-08
**Completed:** —

## Goal

Report a spoken phrase **once**, carrying the best-scoring person, instead of once per enrolled person — so
a wake word shared by several people cannot fire N times for one utterance.

## Background

Detections were keyed by `[phrase, kind, person]` in two independent places, so one utterance that matched
several people's templates produced one detection each:

- the per-window `matches` map in `processChunk()` — collapsed persons matched in the **same** window
- the `operation.refractory` key in `handleHit()` — rate-limited **per person**, so a person matched in an
  adjacent window was never suppressed

Observed live with two people enrolled for `agent-wake`: a single utterance produced detections at
13.35 s and 13.43 s, and the ordering between the two people varied from utterance to utterance.

Consequences in Agent Chat (`wake-assistant.js`):

- **`agent-wake` was already safe but attributed at random.** The `state === "listening" || "sending"`
  guard at line 507 (added for US-1786) drops the second detection, so only one request starts — but
  `item.person` is taken from whichever detection arrived first (line 538), and BT-086 prefixes the prompt
  with `[Speaker: <person>]`. The speaker label was effectively a coin flip.
- **`agent-stop` genuinely double-fired.** That branch has no equivalent guard: the first detection cuts
  the request, and the second re-enters with the state already changed and falls through to a different
  branch — plausibly `interruptSession(view)`, interrupting an agent turn the user never asked to stop.
  Each extra enrolled person made this worse.

Fixing it in the board rather than in Agent Chat keeps every consumer simple and means the next consumer
does not rediscover the same problem. `person` stays on the hit, so callers that care still get it.

Precedent inside the same function: the computer-audio suppression already compares `computer.phrase ===
hit.phrase` only, ignoring person — this change makes identity consistent throughout the file.

## Implementation Plan

- [x] **1. `scripts/service.mjs`, `processChunk()`** — key the per-window `matches` map by
      `[sample.phrase, sample.kind]`. The existing `match.distance < matches.get(key).distance` comparison
      then keeps the best-scoring sample across persons, and `match.sample.person` carries that winner.
- [x] **2. `scripts/service.mjs`, `handleHit()`** — key `operation.refractory` by `[hit.phrase, hit.kind]`,
      dropping person, so a runner-up landing in an adjacent window is suppressed for `REFRACTORY_MS`.
- [x] **3. Comment both sites** with the reasoning, since person-free keying looks like a bug otherwise.
- [x] **4. Live verification** — see Acceptance Criteria.
- [x] **5. `WHATS-NEW.md` + version bump.**
- [x] **6. `boards/wake-word/CLAUDE.md`** — record the one-detection-per-phrase rule.

## Concerns / Open Questions

- **Per-person detection is gone as an observable.** Anything that wanted "which enrolled people matched"
  now sees only the winner. Nothing in this repo consumed that — Agent Chat uses a single `person` for the
  speaker label — but it is a contract narrowing for any external `speech.wake` consumer.
- **Person attribution is still a guess, just a better one.** Highest template score is a weak speaker
  identifier; `speech_embedding` is a keyword model, not a speaker-ID model. Two people saying the same
  phrase will sometimes swap. Treat `[Speaker: X]` as a hint, not identity — worth stating in the board's
  user docs rather than implying it identifies the speaker.
- **Refractory is now shared across people.** Two different people saying the wake word genuinely within
  `REFRACTORY_MS` (1500 ms) of each other produce one detection, not two. That is the correct trade for a
  shared assistant and matches the old per-person behaviour for the common single-speaker case, but it is a
  deliberate loss.
- **Not related to BT-091.** The adaptive gate reduces *false* triggers; this fixes *duplicate* triggers on
  genuine speech. Both were visible in the same logs, which made them easy to conflate.
- **Agent Chat's `agent-stop` branch still has no guard.** This task removes the duplicate at the source,
  so the guard is no longer load-bearing — but a defensive guard there would make Agent Chat robust against
  any future provider that emits duplicates. Left out deliberately; raise separately if wanted.

## Acceptance Criteria

- [x] One utterance matching several enrolled people produces exactly one detection
- [x] The emitted detection carries the **best-scoring** person
- [x] A genuine second utterance after `REFRACTORY_MS` still fires
- [x] Two people matched inside a single window collapse to one detection
- [x] The same holds for `agent-stop`
- [x] Live: saying the wake word with two people enrolled shows **one** row in the Wake Word board
- [ ] Live: Agent Chat starts one request and `agent-stop` stops once, without interrupting the session
- [x] `ui.log` is clean (no CSP violations)
- [x] Fully offline (no CDN / network)

Offline verification used `temp/bestmatch-sim.mjs`, which replays both keying rules over a synthetic
stream: 7 detections before, 4 after, duplicates removed and genuine repeats preserved.

## Files Changed

| File | Change |
|------|--------|
| `boards/wake-word/scripts/service.mjs` | Both detection keys dropped `person`; comments |
| `boards/wake-word/board-manifest.json` | Version bump |
| `boards/wake-word/WHATS-NEW.md` | Changelog entry |
| `boards/wake-word/CLAUDE.md` | One-detection-per-phrase rule recorded |

## Notes

Ships together with BT-091 (adaptive gate) in the same `wake-word` version; they were found in the same
session but are independent fixes.
