# What's New

## 1.1.0
- Interface text moved to a language pack (`lang/en.json`) so the board can be translated; requires Persephone with board bridge 1.36.0.
- Opens Claude Code and Codex CLI session logs (`.jsonl`) from their default folders, or any log through Open with.
- Session view: turns with Markdown prompts and answers, paired tool calls with results, diffs for edits and patches, thinking, compaction dividers, subagent drill-down, an outline, filters, find, raw records and a live tail.
- Session list for several files or a folder (including Claude Code and Codex presets): sortable and groupable, with totals, a tokens-per-day chart and a search across prompts and answers.
- Streams large logs (400 MB+) in a background Node process; folder summaries are cached.
- Estimated API cost is off by default and can be turned on in the board's settings.
