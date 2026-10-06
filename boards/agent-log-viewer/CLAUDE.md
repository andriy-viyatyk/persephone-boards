# Agent Log Viewer — author notes

Viewer for Claude Code (`~/.claude/projects/**`) and Codex CLI (`~/.codex/sessions/**`) session
logs. Task document: `doc/tasks/BT-032-agent-log-viewer/README.md`.

## Architecture

| File | Role |
|---|---|
| `scripts/log-server.mjs` | Resident Node process (`persephone.executeNode`, JSON lines over stdin/stdout). Streams files with its own line splitter that keeps byte offsets; serves `open`, `turns`, `raw`, `scan`, `search`, `find`, `watch`. Holds the summary cache and recent sources in `cache/summaries.json`, which is git-ignored and never published. |
| `scripts/session-model.mjs` | `SessionIndex` (header stats plus a per-turn byte range), token helpers, tool call/result pairing, patch-to-diff lines. |
| `scripts/parsers/claude-code.mjs`, `codex.mjs` | Format detection, the streaming `index()` step, and `normalize()` of one turn window into display items. |
| `app.js` | The frame. It holds the turn index and the rendered window only. It has a list view (scan, filter, group, sort, chart, content search) and a session view (outline, windowed transcript, filters, find, raw, subagent drill-down, live tail). |
| `lib/` | marked 15.0.12 (MIT) and DOMPurify 3.4.16; see `lib/VERSION.txt`. |

## Rules that matter

- **Never read a log whole.** A 400 MB file must stay in Node; the frame asks for `WINDOW` turns
  at a time.
- **Claude usage:** streamed blocks repeat `message.usage` under one `message.id`, so count each id
  once.
- **Codex usage:** deltas of the cumulative `token_count.total_token_usage`. A negative delta (the
  counter reset) falls back to `last_token_usage`. `input_tokens` includes the cached input, which
  is subtracted.
- **Unknown record types** become meta items or are skipped. They must never throw.
- **Cost** is off by default (the `showCost` setting). Prices in `PRICES` are estimates.

## Testing

`node _test/agent-log-viewer/generate-fixtures.mjs` writes synthetic logs under folders that match
the board's `folderMasks`. Adding `--append` adds a turn to the Claude fixture, to test the live
tail. Do not commit real session logs.
