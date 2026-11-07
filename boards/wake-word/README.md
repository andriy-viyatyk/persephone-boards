# Wake Word

Wake Word provides local, enrollment-based wake and stop phrase detection through
`speech.wake@1`. Its bundled model and ONNX Runtime Web work offline.

Open and trust the board in Persephone 5.0.18 or later. It needs background service,
microphone and computer-audio permissions and the `audio@1` capability grant. Microphone
listening also captures computer audio to suppress matching computer-sourced speech. A changed
permission or capability grant requires renewed trust approval.

Choose a kind, phrase ID, person, microphone and echo cancellation setting. The default phrase
IDs, `agent-wake` and `agent-stop`, are used by Agent Chat; other consumers can choose their own
case-sensitive IDs. The ID identifies a group of samples, not the words the model transcribes.
Record several 2.5-second examples per person. The board rejects silent, clipped, short or very
quiet clips. Use the same echo cancellation setting for enrollment and listening. Refresh the
microphone list when devices change; labels or IDs can be unavailable before an authorized capture,
in which case the default microphone remains available.

The samples panel shows the selected phrase, capture provenance and individual delete controls.
Person deletion is limited to that phrase. Samples captured before this version are marked as
pre-change with echo cancellation off. Existing `wake` / `stop` names are migrated to
`agent-wake` / `agent-stop`; other names remain unchanged. Older incompatible template versions
remain visible and deletable but do not match. Existing current templates still match, though
different audio processing can reduce their scores; re-enroll if necessary.

The live panel listens for the selected phrase and reports similarity and the shared audio-clock
epoch and time. The threshold starts at 0.85 and needs calibration in your environment; similarity
is not a probability. A reset clears displayed events because epochs cannot be compared.

Audio is processed locally and enrollment clips are transient. Only embeddings and phrase/person
metadata are retained in `%LOCALAPPDATA%/Persephone/board-data/wake-word/`. Embeddings retain voice
information: treat them as sensitive and delete them when no longer needed. The default caller
policy accepts authorized `speech.wake@1` callers; `same-board-only` permits only this board page.
Agent-visible metadata calls can reveal enrolled person names to the user's agent.

Computer suppression compares the same phrase across people and kinds, so it can also suppress a
person speaking at the same time. It adds roughly 0.8–1 second to microphone detection delivery;
computer detection misses, delayed audio and imperfect echo cancellation can still cause false
triggers. The clock is an estimate, not an exact acoustic-arrival measurement. Tune thresholds,
onset and suppression with your own setup. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
for model and runtime licensing.
