## 1.0.3

- A `$help` node no longer shows a Hint block: the resolver returns help prose alone, with no hint, so showing one was inventing something the agent never sees.

## 1.0.2

- Reworked the layout: a full-height resizable tree, and a centre column with Agent, Members and contextual Search/Events tabs.
- The Agent tab now shows what an agent is actually handed — the returned value and the hint, with the hint always shown rather than deduplicated.
- `$help` is a tree node, so the prose an agent reads is one click away at any path.
- Every path reads on selection unless its descriptor declares a caution; cautioned members read only through Read, after confirmation.
- Added a board icon, JSON syntax highlighting, and a flatter panel style.

## 1.0.1

- Unified the Explorer tree across every descriptor member, including in-place board and browser page models.

## 1.0.0

- Added the offline AiVision Explorer for descriptor browsing, help search, events, and explicit member operations.
