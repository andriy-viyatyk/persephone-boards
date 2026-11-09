## 1.2.0
- Review and play wake phrase recordings before adding them; automatic crops use speech detection and existing samples show an approximate length.

## 1.1.1
- Fixed: enrolling a wake word failed with `Cannot find package 'onnxruntime-common'`. The speech runtime was missing a required file, so no enrollment or listening could work on an installed board.
- Fixed: on a machine with a loud fan the detector triggered every few seconds with nobody speaking. The sound gate now follows the room's noise level instead of a fixed one.
- Fixed: a phrase enrolled by several people was reported once per person, so one spoken wake word fired several times. It is now reported once, by the closest-matching person.
- Fixed: typing on the keyboard or tapping the desk triggered wake words. Detection now runs only on actual speech, not on any loud sound.
- The listening test shows the current sound level and speech probability next to the best score, so a noisy room can be checked at a glance.

## 1.1.0
- Capture shared audio in the service for named phrases and computer-sound suppression.
- Samples are shown as a tree by phrase and person, with a remove button at every level.

## 1.0.0
- Added local wake and stop phrase enrollment and the `speech.wake@1` provider.
