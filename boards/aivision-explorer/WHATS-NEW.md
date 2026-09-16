## 1.0.5

- Members tab: Invoke, Read and Assign now show their result in a dialog. They used to write it into the Agent tab's **Returned value** panel — a different tab, describing a different thing, where the result was not even visible from where it was asked for. The Agent tab's own **Operate on this member** panel is unchanged.

## 1.0.4

- Members tab: a read-only property no longer shows a dead Assign box, the member name is printed once, rows are separated by a rule instead of boxed, and everything under the name line is indented beneath it.
- Members are listed in name order in the tree and on the Members tab. The Hint keeps the descriptor's own order, because that is what the agent is handed.
- Selecting a leaf shows `Members [0]` instead of its parent's member list; the leaf's own controls stay on the Agent tab.

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
