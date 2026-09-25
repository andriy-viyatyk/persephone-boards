# Range Provider Test (fixture board)

**This board is a test fixture, not a product.** It lives under `persephone-boards/_test/`, not
`persephone-boards/boards/`, so it is excluded from the published catalog by construction —
`scripts/publish-board.mjs` scans only `boards/` (`:30`, `:151` at the time this was written), so a
board here can never be zipped, released, or listed in `boards-manifest.json`. Nothing needed
changing in the publish script to keep it out.

## What it's for

[EPIC-113](../../../persephone/doc/epics/EPIC-113.md) (decision **D13**) needs a board-implemented
content provider that serves **ranged reads** — `readRange(config, range)` over the module
service — so the epic's acceptance list can be exercised without a torrent and without a real
swarm's variables (cold-start latency, stalls, files bigger than memory). No board in either repo
declared `contentProviders` before this one, so without a fixture, EPIC-113's platform work
(US-1474) would have had no way to prove itself until EPIC-114 (the torrent board) existed —
defeating the point of splitting the two epics.

This board serves a large **synthetic** resource, generated on demand, byte by byte, from a pure
function of the byte's offset — never read from disk, never held whole in memory. That makes any
returned range independently verifiable: the fixture's own UI decodes what it gets back and checks
it against the same formula.

## Installing / trusting it for testing

This board was scaffolded with `boards.createBoard` (the same scaffolder any board uses), which
auto-trusts a board it creates. If you're opening it fresh:

```js
await app.boards.openBoard("C:/projects/persephone-boards/_test/range-provider-test");
```

Boards created this way need no trust prompt. If you copy this folder somewhere else first, it
becomes a "foreign" board and needs the normal Trust dialog — read `scripts/service.mjs` first if
you do that (it's short: two provider registrations plus a two-op request handler).

## The two providers and their schemes

| Provider type  | Scheme         | Implements                          | Purpose                                   |
|----------------|----------------|--------------------------------------|--------------------------------------------|
| `test/range`   | `rangetest:`   | `readBinary`, `readRange`, `stat`    | The ranging path under test.               |
| `test/norange` | `norangetest:` | `readBinary`, `stat` (no `readRange`)| Proves the "no ranging → behaves exactly as before" case (EPIC-113 acceptance item 9). |

The board also declares itself as a `stream-host` custom editor for `*.rangefix`
(`editorPriority: 100`, so it wins as the default editor for that otherwise-unclaimed extension).
That is what makes a `rangetest://…/*.rangefix` or `norangetest://…/*.rangefix` link resolve back
to **this same board** as the opened page (per US-1517's file-name-based editor resolution) — the
new page's pipe is then backed by `ProxyProvider` talking to this board's own service, and the
board's JS reads it via `persephone.host.streamUrl()` with explicit `Range` headers. This is the
same `board://…/__pipe/<pageId>` mechanism the Demo board's stream-host fixture uses, generalized
to a provider-backed (not file-backed) pipe.

**Why not a built-in editor (Monaco, Image, the media player)?** As of this writing, Monaco and the
Image viewer read a pipe's `readBinary()` directly (never ranged), and the built-in media player
isn't pipe-backed at all yet (that's US-1519, still Planned). The only mechanism that currently
carries a `Range` header into a board provider's `readRange` is the `board://…/__pipe/` route used
by `stream-host`/`content-host` board editors — so this fixture is itself that editor. Once
US-1519/US-1521 ship, the same provider could equally back a real media file opened as `.mp3`.

## URL / query-parameter contract

Both schemes take the same query parameters, parsed from the link's full href
(`config.url` inside `scripts/service.mjs`):

| Parameter | Type    | Default | Effect |
|-----------|---------|---------|--------|
| `size`    | integer | `4096`  | Total resource size in bytes, reported by `stat()`. Capped at `4294967295` (2^32 − 1) — see "Known limitation" below. |
| `delay`   | integer | `0`     | Milliseconds to wait before answering **every** read against this URL. Capped at `30000`. Models a slow/cold data source. |
| `stall`   | `"1"`   | (unset) | Makes every read against this URL hang and never resolve on its own — see "Known limitation" below for what actually happens today. |

Example: `rangetest://fixture/large.rangefix?size=314572800` (a 300 MB resource, all default
timing) or `rangetest://fixture/slow.rangefix?size=1048576&delay=3000` (1 MB, every read takes 3s).

## Deterministic content formula

For absolute byte offset `i`:

```js
function genByte(i) {
    const lo = i & 0xff;
    const mid = (i >>> 8) & 0xff;
    return (lo ^ mid ^ 0xa5) & 0xff;
}
```

Implemented identically in `scripts/service.mjs` (the provider) and `app.js` (the board's own
verification code, which never sees more than what it just fetched). Any byte range can be checked
in isolation — no need to read the whole resource to know whether a given slice is correct.

## Call counters (readBinary vs readRange)

`scripts/service.mjs` keeps an in-memory counter per provider type (`readBinary` count, `readRange`
count, and the last 20 requested ranges with timestamps). It resets when the service process
restarts (untrust/re-trust, app restart, or a service crash) — this is deliberately not persisted;
it's a per-run instrumentation, not board state.

Read it from **any** open page of this board (the console, or one of the opened `*.rangefix`
pages — they share one service):

```js
const counters = await persephone.service.request({ op: "counters" });
// { "test/range": { readBinary: 0, readRange: N, lastRanges: [...] },
//   "test/norange": { readBinary: N, readRange: 0, lastRanges: [] } }
await persephone.service.request({ op: "reset-counters" }); // zero them out
```

The board's console page (opened standalone, e.g. from the Boards panel) has **Refresh counters**
/ **Reset counters** buttons that call exactly this.

## Using it

Open the board standalone (Boards panel, or `app.boards.openBoard(...)`) to get the **console** —
one button per scenario below, plus the counters panel. Each button calls
`persephone.openRawLink(url)` with a pre-built scenario URL, which opens a **new** page (this same
board, in its `stream-host` editor role for `*.rangefix`). That page immediately runs a cold-start
probe (fetches bytes 0-63) and offers **Seek: fetch last 64 bytes** once it knows the total size
(from the first response's `Content-Range` header).

## EPIC-113 acceptance items → scenario

| # | Acceptance item (EPIC-113) | Scenario / how to observe it |
|---|------------------------------|-------------------------------|
| 2 | A board provider serves a `Range` request without its whole resource ever being read; observable as the provider's own counter and a `Content-Range` that isn't the full length. | **Cold start, small** (or any `rangetest:` scenario). Fetch bytes 0-63 of a 4096-byte resource; `Content-Range: bytes 0-63/4096`; `readRange` counter increments, `readBinary` stays at 0. Verified while building this fixture. |
| 3 | A resource larger than `MAX_BUFFERED_PIPE_BYTES` (256 MB) opens and seeks. | **Large resource** (300 MB). First-byte fetch and the **Seek: fetch last 64 bytes** button both succeed with correct `Content-Range` and verified bytes. Verified while building this fixture (300 MB opened and seeked to the last 64 bytes in ~2ms). |
| 4 | Seeking near the end of a large file issues a range near the end and returns promptly, with no read of the bytes in between. | Same **Large resource** scenario — the **Seek: fetch last 64 bytes** button requests `bytes=<size-64>-<size-1>` directly; the service's `lastRanges` counter log shows that exact range, not a scan from 0. |
| 6 | A provider read taking minutes completes rather than timing out; closing the page mid-read releases it promptly, and the service's request slot with it. | **Stall indefinitely**. See "Known limitation" below — **not fully exercisable yet**, because US-1518 (removing the per-operation deadline) hasn't shipped. Today the read times out (~10s) rather than hanging until the page closes; the *cancellation-on-close* half can still be exercised by opening this scenario and closing its page before the 10s deadline. |
| 7 | A provider that does **not** implement ranging behaves exactly as before: `hasDirectStream()` is false, every read is buffered, and no new wire concept changes its behavior. | **No-range provider** (2 MB via `norangetest:`). Response looks byte-identical to the ranged path from the outside (`206`, correct `Content-Range`) but the counters panel shows `readBinary` incremented and `readRange` untouched. **No-range provider, over 256 MB** additionally shows the existing ceiling still rejects an oversized buffered read (`503`, no `Content-Range`) — verified while building this fixture. |
| (cold start, D-relevant) | The very first read since the page opened is a `readRange`, not a buffered `readBinary` — no prior request had gone to the board's service. | Every scenario's built-in cold-start probe demonstrates this by construction; watch the counters before/after opening a fresh scenario page. |
| (slow first byte) | A demand-driven read that is slow by construction rather than by luck. | **Slow first byte** (1 MB, 3000ms delay). Verified while building this fixture: first byte took ~3014ms. |

Acceptance items 1, 5, 8 (editor resolution by file name, the built-in media player, VLC) belong to
US-1517 (already implemented and separately verified) and US-1519/US-1521 (not yet built) — this
fixture doesn't exercise those; see the provider-selection note above.

## Known limitation — the stall scenario doesn't yet hang forever

EPIC-113 D6 decided a content read should have **no deadline** — it should wait until the page
closes or the source is deleted. That is **US-1518, not yet shipped**. As of this writing,
`assets/module-service-host.mjs`'s `withDeadline()` still races every provider operation against
`SERVICE_REQUEST_DEADLINE_MS` (~10 seconds). So today, `stall=1` makes the read hang for ~10s and
then fail with a typed timeout error (observed here as an HTTP `503` with an error body), rather
than hanging until the page is closed. This fixture is forward-compatible: once US-1518 removes the
deadline, the exact same `stall=1` flag will hang indefinitely, and the scenario will then also
exercise "closing the page releases a truly-outstanding read" (the other half of D6) rather than
just a timeout. Documented here rather than silently working around it.

## Verified while building this fixture (2026-09-26)

Using the running Persephone app's MCP `call` bridge, every scenario above was opened and its
result inspected directly (page evaluate, not just visual inspection):

- Cold start: `GET bytes=0-63` on a fresh 4096-byte resource → `206`, `Content-Range: bytes 0-63/4096`, all 64 bytes verified against `genByte(offset)`, took ~2ms.
- Seek near end: on the same page, `GET bytes=4032-4095` → correct `Content-Range`, verified bytes.
- Large (300 MB): first-byte and last-64-byte fetches both succeeded in ~2ms with correct `Content-Range` and verified bytes — confirms no whole-resource read occurs.
- No-range (2 MB): succeeded with `206` and a correct `Content-Range`, indistinguishable from the outside from the ranged path — the service's `test/norange.readBinary` counter incremented from 0 to 1, `readRange` stayed 0.
- No-range oversized (300 MB): failed with `503` before any resource bytes were generated — the existing 256 MB buffered ceiling still holds for a non-ranging provider.
- Slow first byte (1 MB, `delay=3000`): first fetch took ~3014ms.
- Stall (`stall=1`): first fetch failed after ~10005ms — matches the documented "not US-1518 yet" limitation exactly.
- Counters (`persephone.service.request({ op: "counters" })`) tracked `test/range.readRange` incrementing across scenarios while `test/range.readBinary` stayed `0` throughout, and `test/norange.readBinary` incremented exactly once for the one buffered-path scenario exercised.

One authoring gotcha worth recording: `persephone.host.streamUrl()` is documented as "safe to call
at any time" (it awaits the board's handshake internally), but during testing a single immediate
call on a freshly-opened `*.rangefix` page sometimes threw `"Persephone did not provide a page id
for streamUrl()"` even though the SAME call succeeded moments later. `app.js`'s mode-detection
(`detectStreamUrl()`) retries for up to ~20 seconds before concluding a page is a plain/standalone
open rather than a stream-host target — worth knowing if you extend this fixture and see the
console render instead of the probe UI on a freshly-opened scenario page.

## Files

- `board-manifest.json` — declares the service, both `contentProviders`, and the `*.rangefix`
  stream-host editor association.
- `scripts/service.mjs` — the two provider implementations, the deterministic byte generator, the
  delay/stall controls, and the counters request handler.
- `index.html` / `app.js` — the console (scenario buttons + counters) and the stream probe UI
  (fetch-with-Range + verification), auto-selected at load based on whether
  `persephone.host.streamUrl()` resolves for the current page.
- `CLAUDE.md` / `board-base.css` — the standard scaffolded authoring reference and theme base;
  unmodified from `boards.createBoard`'s template.
