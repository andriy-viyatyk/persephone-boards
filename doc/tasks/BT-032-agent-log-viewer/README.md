# BT-032: Agent Log Viewer (Claude Code + Codex session logs)

## Status

**Status:** Done — published as `agent-log-viewer` v1.0.0
**Completed:** 2026-10-06
**Priority:** Medium
**Board id:** `agent-log-viewer`
**Started:** 2026-10-06

## Goal

A board that opens Claude Code and Codex CLI session logs (`.jsonl`) and makes them readable and
measurable. A single session shows as a conversation with tool calls paired to their results. A
set of files or a whole folder shows as a sortable session list with usage totals.

## Background

### Where the logs live (verified on this machine, 2026-10-06)

| Agent | Path | Override | Volume here |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<project-slug>/<sessionId>.jsonl`; subagents in `<sessionId>/subagents/agent-<agentId>.jsonl` | `CLAUDE_CONFIG_DIR` | 245 files; one is 407 MB |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (newer builds may write `.jsonl.zst`) | `CODEX_HOME` | ~1,570 files, 3.1 GB total, median 1.2 MB, max 269 MB |

**File association:**
- `fileMasks: ["*.jsonl"]`
- `folderMasks: [".claude/projects/**", ".codex/sessions/**"]` (Persephone US-1630)

Other `.jsonl` files keep the JSONL grid. **Open with → Board: Agent Log Viewer** opens any file,
whatever its folder.

### Format summary (record types counted across recent local logs; no content read)

**Claude Code.** One record per line, linked by `uuid` / `parentUuid`.

- **Conversation records:**
  - `user`: either prompt text, or `tool_result` blocks plus a structured `toolUseResult`.
  - `assistant`: `thinking`, `text` and `tool_use` blocks, with `message.model` and
    `message.usage` (input, output, cache-read and cache-creation tokens).
  - `system/*`: `compact_boundary`, `turn_duration`, `stop_hook_summary`, `away_summary`,
    `local_command`, and others.
- **Metadata records:** `ai-title`, `last-prompt`, `mode`, `permission-mode`, `attachment`,
  `file-history-snapshot` / `-delta`, `queue-operation`, `cost-state`.
- **Common fields:** every record carries `sessionId`, `timestamp`, `cwd`, `gitBranch` and
  `version`. Subagent records also carry `agentId` and `isSidechain: true`.
- **Gotcha:** the streamed blocks of one API response repeat the same `usage` under the same
  `message.id`. Summing naively overcounts about 5x, so deduplicate by `message.id`.

**Codex.** Each line is an envelope `{timestamp, ordinal, type, payload}`.

- **Session and turn records:**
  - `session_meta`: id, cwd, cli_version, model_provider, git commit and branch, subagent source,
    and `forked_from_id` / `parent_thread_id`.
  - `turn_context`: model, effort, and approval and sandbox policy for each turn.
  - `world_state` and `compacted`.
- **`response_item`:**
  - `message` with role user, assistant or developer.
  - `reasoning`, which is encrypted; only its summary is readable.
  - `function_call` / `custom_tool_call` and their `*_output`, paired by `call_id`.
  - `agent_message` (inter-agent).
- **`event_msg`:**
  - `task_started` / `task_complete`, with duration and time to first token.
  - `token_count`: **cumulative** totals plus rate limits, so per-turn usage is the delta.
  - `item_completed`, and others.
- **`token_usage_record`:** usage per response, per turn and per thread.
- **No official schema.** Both formats drift between versions, so the parser must ignore unknown
  types.

### Existing tools surveyed (web research, 2026-10-06)

- **Usage:** ccusage (~19k★). Daily, monthly and per-session cost, 5-hour windows; reads both
  Claude and Codex logs.
- **Desktop browsers:**
  - opcode/Claudia (~22k★): session browser, checkpoint timeline, usage charts.
  - claude-code-history-viewer (~2k★): 31 agents, global search, analytics, live watch.
- **Transcript renderers:**
  - claude-code-log: type filters, zoomable timeline, per-message tokens, cross-project index,
    watch mode.
  - simonw/claude-code-transcripts: paginated HTML export.
  - codex-transcripts: minimap, fold/unfold, keyboard navigation.
  - codex-transcript-viewer and ai-transcript.
- **Analytics:**
  - sniffly: error breakdown, showing where the agent fails.
  - llmly: cumulative token chart.
- **Trace UIs worth borrowing from:**
  - Langfuse: tree/timeline toggle, per-span cost and latency.
  - Inspect AI log viewer: sample list → transcript → event timeline.

**Table stakes:**
- readable conversation with collapsible tool calls;
- tokens per message and per session;
- search and type filters;
- live update;
- local only.

**Common complaints:**
- `/resume` finds sessions by title only.
- Token totals are overcounted.
- Huge files are slow.
- Subagents and compaction are poorly surfaced.
- Users need one tool for reading and another for cost.

## Requirements (draft)

### R1. Source selection (header)
- The header shows the current source: a file path, "N files", or a folder path.
- A **Change source** menu offers:
  - Open file(s)… (multi-select);
  - Open folder…;
  - presets *Claude Code projects* and *Codex sessions*, resolved from `CLAUDE_CONFIG_DIR` /
    `CODEX_HOME` or the home-folder defaults;
  - a Recent sources list.
- Opened as a file editor, the board starts in single-session mode on that file.
- The agent type is detected per file from its content (the first records), not from its path, so
  a copied log still works.

### R2. Single-session view
- **Session header:**
  - agent, title (Claude `ai-title` or the first user prompt), project `cwd`, git branch;
  - model(s) and CLI version;
  - start time, duration, turn count, tool-call count;
  - token totals and estimated cost.
- **Transcript.** Grouped into turns: user prompt → agent work → final answer.
  - User and assistant text is rendered as Markdown.
  - Tool calls are paired with their results and collapsed by default. The header line shows the
    tool name, a short argument summary (command, file path or query), the status (ok, error or
    exit code) and the duration.
  - Edit and patch tools are rendered as a diff.
  - Thinking and reasoning are collapsed and dimmed. Codex reasoning is encrypted, so only its
    summary is shown.
  - Compaction shows as a visible divider. Model, effort and sandbox changes show inline.
  - Subagent calls (Claude `Task`/`Agent`, Codex spawned agents) expand into the subagent's own
    transcript, loaded from its file on demand.
- **Navigation:**
  - an outline of turns (first line of each prompt) in a side panel;
  - jump to the next or previous error;
  - keyboard navigation;
  - expand all / collapse all.
- **Filters:**
  - show or hide each kind: user, assistant text, thinking, tool calls, tool results,
    system/meta;
  - errors only;
  - text search within the session, with highlighting.
- **Raw view:** any rendered item can show its raw JSON record(s).

### R3. Multi-session view (several files or a folder)
- **Session list (grid):**
  - Columns: agent, date, project, title, duration, turns, tool calls, errors, tokens, cost, file
    size.
  - Sort and filter by any column; group by project or by day.
- **Opening a session:** selecting a row opens it in the single-session view inside the board, with
  Back. It can also be opened in its own page.
- **Totals strip:** number of sessions, tokens (input, output, cache) and estimated cost for the
  current filter.
- **Usage charts:** tokens and cost per day, split by agent and model.
- **Cross-session search:** a simple scan, with no index. Search titles and prompts; the Node process streams the files and returns matches. No SQLite or FTS (user decision).

### R4. Usage and cost
- **Token totals:**
  - Claude: sum `message.usage`, deduplicated by `message.id`.
  - Codex: take deltas of the cumulative `token_count`, or read `token_usage_record` directly.
- **Cost:**
  - **Off by default** (user decision: most users are on a subscription; per-token cost only
    matters for API billing). A board setting turns it on.
  - When on: computed from a bundled per-model price table and labelled **estimated**. Unknown
    models show tokens without a cost.
- Per-turn token bars in the session view. Show the context window filling over time if that is
  cheap to compute.

### R5. Performance (hard requirement)
- Never load a whole large file into the board frame; a 400 MB log crashed the text editor.
- **Streaming parse:** files are parsed by streaming in a resident Node process
  (`persephone.executeNode`).
  - It builds a light per-session index: header stats plus the byte offsets of turns.
  - The frame requests one window of turns at a time.
- **Folder mode** scans metadata only.
  - Results are cached per file, keyed by path + size + mtime, so reopening a 3 GB folder is fast.
  - Progress is shown while scanning.
- **Live update:** a session still being written appends its new turns (tail), and the folder
  list refreshes when new files appear.

### R6. Out of scope (v1)
- editing logs;
- resuming a session or sending to the agent;
- sharing and publishing;
- run-vs-run diff;
- evals and scores;
- other agents (Cursor, Gemini, opencode).

Revisit these after v1.

## Implementation Plan

1. [x] **Scaffold the board contract** in `boards/agent-log-viewer/board-manifest.json`. Use
   `fileMasks: ["*.jsonl"]`, `folderMasks: [".claude/projects/**", ".codex/sessions/**"]`,
   `editorPriority: 100`, `editorName: "Agent Logs"`, and `editorKind: "simple"`. The masks
   match the documented rule: file masks match basenames, folder masks narrow the default claim
   by a case-insensitive parent-folder path suffix, and `**` spans separators. The priority clears
   the JSONL/grid editor priority so these in-scope logs open here by default; an explicit Open
   with can still select the board for copied logs elsewhere. Set `minAppVersion: "5.0.7"` (the released
   app; `folderMasks` shipped in 4.0.18) and `minBridgeVersion: "1.30.0"` (object permissions;
   no pageState is used — see step 5). Declare `permissions.execute: true`,
   `permissions.fileSystem: "board"`, `permissions.network: false`, and all unused permissions
   false. `service` stays false: this is a page-owned `executeNode` job, not a module service.
   Declare a boolean `showEstimatedCost` setting with default `false`; use stable `author` and
   `name` values so Persephone retains that setting.

2. [x] **Add the resident backend** at `boards/agent-log-viewer/scripts/log-server.mjs`.
   The main frame starts one `persephone.executeNode("scripts/log-server.mjs", [], { name:
   "agent-log" })` job and sends request/reply JSON lines on stdin/stdout, matched by request id.
   Keep stdout exclusively for protocol messages; send diagnostics to stderr. Stream structured
   progress messages while indexing and scanning. Let the host reap the process with the board
   frame; do not set the board busy or enable reload-surviving jobs. Support open-file, folder
   scan, turn-window, raw-record, text-search, refresh, tail and stop operations.

3. [x] **Normalize the two formats independently.** Implement
   `scripts/parsers/claude-code.mjs` and `scripts/parsers/codex.mjs`, plus
   `scripts/session-model.mjs` for the shared session/turn/item shape and call-result pairing.
   Detect the format from the first parsed records, not the filename or directory. Claude parsing
   handles `uuid`/`parentUuid`, user and assistant content blocks, system/meta events, sidechain
   metadata, and usage deduplicated by `message.id`. Codex parsing handles envelope `type` plus
   `payload`, `call_id` pairs, turn/model/effort changes, compacted records, and usage from
   `token_count` deltas or `token_usage_record` (prefer direct usage records when present; never
   add both sources). Keep unrecognized records attached as raw items so they remain inspectable
   and cannot abort a session. Estimate cost only when `showEstimatedCost` is on, from a bundled,
   labelled-estimate model price table; unknown models retain token counts and no cost.

4. [x] **Stream every log operation and build byte indexes.** Use `node:fs` read streams with
   `readline` in the backend for discovery, metadata scans, initial indexing, search and tailing;
   do not use whole-file read APIs. Record turn start/end byte offsets as lines are parsed, taking
   UTF-8 byte lengths and CRLF/LF delimiters into account. Keep only header statistics and offsets
   in the index. Return one bounded turn window at a time (with raw JSON fetched only for a
   requested item); the frame must never receive or retain an entire log. Begin rendering the
   header and first indexed turns as soon as they are available, then continue reporting index
   progress. Folder scans recursively discover `.jsonl` files and calculate summary metadata only.
   On an append/change, resume from the last complete line/byte offset, extend the active session,
   and rescan folder membership for new files.

5. [x] **Implement source selection and summary caching** in `app.js`. On an associated-file
   open, call `persephone.getFilePath()` and load that one session. The Change source picker uses
   `persephone.openFileDialog({ multiSelections: true, filters: [...] })` and
   `persephone.openFolderDialog(...)`, with actions for the Claude Code projects and Codex sessions
   presets and a recent-sources list. Resolve presets in the backend from `CLAUDE_CONFIG_DIR` /
   `CODEX_HOME`, falling back to `USERPROFILE` or `HOME` and the documented default subfolders.
   Keep the summary cache and the recent-sources list in the backend, in
   `<boardRoot>/cache/summaries.json` (located from `import.meta.url`; written atomically through a
   temp file and rename). Entries are keyed by normalized path plus size plus mtime, so unchanged
   files are skipped on the next scan. The folder is not shipped (`.gitignore`). Each entry holds
   only summary fields (title = the first ~120 characters of the session title or prompt, project,
   counts, tokens) and never raw records or tool output.
   *(Review correction: `persephone.pageState` is deleted when the page closes and is per page, so
   it cannot serve "the second open uses the cache".)*

6. [x] **Build the UI** in `index.html`, `app.js`, and board-local styles. Follow the compact
   file/title bar, scroll region, loading/error overlay, and live `--p-*` styling in
   `boards/word-viewer/index.html`; use `board-base.css` first. Declare host toolbar controls with
   `persephone.toolbar.set()` and handle them with `onAction()` (source action, search input, and
   list/transcript segmented view); use `persephone.statusBar.set()/update()` for scan progress,
   current live-tail state, and errors. Keep source actions and detailed filters in the board's own
   `.p-toolbar`/`.p-btn` controls so the host toolbar stays within its eight-control cap. Use
   av-grid for the virtualized multi-session table. Render the transcript in bounded turn windows:
   grouped user/assistant turns, paired collapsible tool calls/results, token/context bars,
   compaction and setting-change dividers, subagent-on-demand links, outline/error navigation,
   type/error filters, highlighted search, keyboard navigation, and per-item raw-record disclosure.
   Render charts as small native SVG so no chart framework is needed. Render Markdown with locally
   vendored `marked` 15.0.12 (MIT), sanitize its HTML with DOMPurify 3.4.12 (Apache-2.0), and use
   highlight.js 11.11.1 (BSD-3-Clause) for fenced code. Parse unified patch lines into safe DOM
   nodes for add/remove context styling; do not add a diff framework. Keep `network: false` and
   load all code, CSS and licenses locally.

7. [x] **Create synthetic coverage** under `_test/agent-log-viewer/`. Add
   `generate-fixtures.mjs` to generate small Claude Code and Codex `.jsonl` examples covering
   multiple turns, tool call/result pairing, sidechain/subagent links, model changes, compacted
   records, repeated Claude usage ids, cumulative and direct Codex usage, unknown types, Unicode,
   CRLF, malformed/trailing partial lines, and appends. Generated examples must be synthetic only;
   do not read real prompt or response text into fixtures or documentation. Use the fixtures to
   verify parser totals, raw fallback, byte-window boundaries, cache hits/invalidations, search,
   and live-tail behavior before checking representative real logs locally without retaining their
   content.

### Bridge calls and version floor

| API | Use in this plan | Documented requirement |
|------|------------------|------------------------|
| `persephone.executeNode(script, args, { name })` and returned handle `on/write/kill` | One resident bundled-Node process with JSON lines over stdin/stdout; requires `execute: true`. | `executeNode` is available from app 4.0.16. |
| `persephone.getFilePath()` | Get the initial custom-editor file path; read it from the Node process, not via a frame file read. | Documented Promise path API; `fileSystem: "board"` is present for source pickers. |
| `persephone.openFileDialog({ multiSelections, filters })` / `openFolderDialog(...)` | Multi-file and folder source selection. | Native dialogs require `fileSystem: "board"` or `"full"`; multi-file picker returns selected paths. |
| `persephone.settings.get(id)` / `onChange(callback)` | Read and react to the cost-display setting. | Bridge 1.13.0; setting declarations also require stable manifest `author` and `name`. |
| `persephone.toolbar.set()` / `onAction()` | Host source/search/view controls. | `segmented` control is bridge 1.28.0; catalog limit is eight controls. |
| `persephone.statusBar.set()` / `update()` | Host scan/live/error progress items. | Bridge 1.27.0; up to eight text/button items. |

The binding version is therefore `minBridgeVersion: "1.30.0"` and `minAppVersion: "5.0.7"`. The
**Open with → Board** entry for logs outside the default folders arrives in app 5.0.8. The board
does not depend on it.
The permission combination is intentional: the Node child reads the selected logs with the user's
OS rights (`execute: true` is the approved Full access grant), while bridge file operations are
limited to the board and its dialogs (`fileSystem: "board"`); the board has no network access.

## Concerns / Open Questions

1. **Permissions — decided.** An `executeNode` resident Node process does the reading and
   streaming (`execute: true`), with `fileSystem: "board"` for the pickers and `network: false`.
   The user accepts the **Full access** line, because logs of 400 MB and more must open.
2. **Privacy.** Logs contain prompts, code, and secrets pasted into sessions. The board must be
   fully offline (`network: false`) and must never write log content outside its own cache.
3. **Cost accuracy.** Prices change, and plan users are not billed per token. Label costs as
   estimates and allow hiding them.
4. **Search — decided.** Keep it simple: a streaming scan, with no index and no SQLite.
5. **Format drift.** Pin the parser to known record types. Unknown records go to the raw view and
   never cause a failure.
6. **Testing data.** Fixtures must be synthetic; no real sessions are committed.

## Acceptance Criteria

- [ ] The manifest declares exactly `fileMasks: ["*.jsonl"]` and
  `folderMasks: [".claude/projects/**", ".codex/sessions/**"]`; Claude and Codex logs in their
  default folders route to the board by default, while unrelated `.jsonl` files remain on the
  JSONL grid unless explicitly opened with this board.
- [ ] Open-file, multi-file, folder, Claude-project and Codex-session sources work; format is
  detected from records, and recent sources can be reopened.
- [ ] Claude and Codex transcripts show normalized turns, paired tool calls/results, raw-record
  access, filters, in-session search/highlighting, turn navigation, and on-demand subagent content;
  unknown record types remain available in raw view without breaking the session.
- [ ] The local 400 MB Claude log opens without freezing the frame, streams its header/first turns to
  the UI within a few seconds, and serves later turn windows without transferring the whole file.
- [ ] Folder mode lists the ~1,500 local Codex sessions with token totals and progress; a second
  open (including on a new page) reuses summaries when path, size and mtime still match.
- [ ] Claude usage is deduplicated by `message.id`; Codex usage uses cumulative deltas or direct
  usage records without double-counting. Totals match ccusage within rounding for comparable
  sessions; estimated cost is hidden by default and can be enabled in board settings.
- [ ] Appending to an active session adds complete new turns without rereading its whole file, and
  newly created folder sessions appear after refresh.
- [ ] Synthetic fixtures and their generator contain no real session content; summary caching
  stores no transcript or raw record text, and no log content is written outside the board's own
  cache.
- [ ] `ui.log` is clean (no CSP violations or uncaught errors); the board makes no network
  requests and uses no SQLite/FTS.

## Files Changed

| File | Change |
|------|--------|
| `boards/agent-log-viewer/board-manifest.json` | New — editor masks, permissions, versions, cost setting, identity, icon and priority. |
| `boards/agent-log-viewer/index.html` | New — board shell and locally loaded assets. |
| `boards/agent-log-viewer/app.js` | New — bridge lifecycle, source selection, cache, bounded UI windows, list/transcript rendering and controls. |
| `boards/agent-log-viewer/board-base.css` | New — standard Persephone base theme and `.p-*` controls. |
| `boards/agent-log-viewer/icon.svg` | New — board icon. |
| `boards/agent-log-viewer/CLAUDE.md` | New — board-specific architecture, file map, run steps and gotchas. |
| `boards/agent-log-viewer/scripts/log-server.mjs` | New — resident JSON-lines server, streaming index/search/folder scan/tail and turn-window reader. |
| `boards/agent-log-viewer/scripts/session-model.mjs` | New — normalized record, turn, pairing and usage model. |
| `boards/agent-log-viewer/scripts/parsers/claude-code.mjs` | New — Claude Code record parser and message-id usage dedupe. |
| `boards/agent-log-viewer/scripts/parsers/codex.mjs` | New — Codex envelope parser, tool pairing and token usage normalization. |
| `boards/agent-log-viewer/lib/**` | New — pinned av-grid 2.12.1 (MIT), marked 15.0.12 (MIT), highlight.js 11.11.1 (BSD-3-Clause), DOMPurify 3.4.12 (Apache-2.0), theme CSS, version notices and license texts. |
| `boards/agent-log-viewer/.gitignore` | New — excludes `cache/`. |
| `_test/agent-log-viewer/generate-fixtures.mjs` | New — generator for synthetic Claude and Codex logs only. |
| `_test/agent-log-viewer/fixtures/*.jsonl` | New — small generated synthetic parser, pairing, usage, malformed-line and tail fixtures. |

## Build time log

The time the user will quote: from the **first scaffold file** of the board to the **"done" report** to
the user. It includes writing the board, opening it in Persephone, testing it, and fixing what the
testing finds. Requirements and planning are excluded. The builder is Claude (Opus 5.5). Times are
local (FLEDT).

| Event | Time |
|---|---|
| Scaffold started | 2026-10-06 23:25:03 |
| Done reported | 2026-10-06 23:39:58 |
| **Total** | **14 min 55 s** |

## Notes

- **Deviations from the plan:**
  - The session list is a plain sortable table rather than av-grid. About 1,500 rows render
    instantly, and it keeps the board free of a grid dependency.
  - Fenced code is not syntax-highlighted (highlight.js is not vendored). Markdown is rendered by
    marked and sanitized by DOMPurify.
  - "Open a session in its own page" is not implemented; it would need `appScripting`.
- **Verified live, 2026-10-06:**
  - **Large Claude log (407 MB):** opens by default from `~/.claude/projects` and is indexed in
    about 1 s. Its 1,217 turns show in the outline. Jumping to turn 1000 takes 0.14 s; scrolling up
    and down loads windows.
  - **Find:** a search across the whole 407 MB file takes 1.6 s.
  - **Folder presets:**
    - Claude projects: 41 sessions in 1.5 s.
    - Codex sessions: about 1,570 files (3.1 GB). The first scan takes 10 s; from the cache it
      takes 0.1 s headlessly and 0.7 s in the board.
  - **Content search:** across 3.1 GB, 14.5 s.
  - **Synthetic fixtures (by hand):**
    - Claude usage is deduplicated per `message.id`.
    - Codex cumulative deltas are correct, and a duplicate event adds 0.
    - The diff, the error state, the subagent drill-down and Back all work.
    - The live tail (`--append`) adds turns within about 1 s.
    - CRLF line endings and a partial trailing line are read correctly.
  - **`ui.log`:** clean.
- **Release floor:** at publish, `minAppVersion` was raised to **5.0.8** (user decision), the
  Persephone version with **Open with → Board** for logs outside the default folders.
- **Not verified:**
  - token totals against ccusage;
  - the "Open with" entry, which needs app 5.0.8;
  - the light theme.
