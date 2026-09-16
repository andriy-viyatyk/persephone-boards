# AiVision Explorer board

## Purpose

AiVision Explorer is a trusted, offline viewer for the live Persephone object model. It starts at
the Persephone root (`""`). Every descriptor member is a tree row, so a rendered board or browser
page's `editor.app` appears in place as an ordinary expandable node. It is a generic board and has
no file association.

## How it works

`index.html` supplies the shell: a full-height, resizable tree pane on the left, and a centre column
of toolbar (selected path, operation status, Refresh), tab bar, and tab content. `app.js` uses one
`persephone.call` adapter, preflights the root with `$describe`, caches descriptors, and merges every
`children[]` entry with every `members[]` entry into the tree, prefixed by a `$help` row for the node
itself. Live children and `node: true` members are expandable; leaf properties and methods stay
selectable and use their parent member record for the detail editor. `style.css` uses the live
`--p-*` palette and `board-base.css`.

The centre has four tabs. **Agent** is the point of the board: it shows what a `call` actually hands
an agent — the returned value (JSON-highlighted) and the hint, rebuilt from the same `$describe`
payload in `buildHint`'s format and, unlike a real session, never deduplicated — except on a `$help`
row, which hides the Hint block entirely, because the resolver answers a help segment with the prose
alone and attaches no hint to it. It also carries the operation controls for a selected leaf. **Members** lists the selected node's whole member list, with
its count on the tab. **Search** and **Events** are contextual: they belong to AiVision rather than to
any node, so their two root members (`helpSearch`, `events`) are marked green in the tree and each
reveals its own tab when selected.

**A tab's results stay on that tab.** Invoke, Read and Assign on the **Members** tab show what came
back in a result dialog; only the Agent tab's own **Operate on this member** panel writes into the
Agent tab's "Returned value" block. `renderMember` builds both lists, so it takes an `origin`
(`"agent"` / `"members"`) and `deliverResult` routes on it. Writing a Members-tab result into the
Agent panel coupled two tabs that describe different things — the Agent tab is about the *selected*
node, the Members tab is a list of that node's members — and put the answer on a tab the user was
not looking at.

**The tree and the Members tab sort members by name; the Hint never does.** The two lists a person
scans are easier to scan sorted, but the hint is a rebuild of what the agent is handed, and a host
orders its members by importance — `pages` before `boardVars` — which is a ranking an agent reads.
Live children keep descriptor order in both places: they are often indexed (`[0]`, `[1]`, `[10]`),
which sorts as text into nonsense.

There are no backend scripts or vendored libraries. The board is fully offline and uses native DOM
and JSON. Help search calls `helpSearch`; the events panel reads `events.recent()` and then waits
with the documented `events.wait()` loop. Member assignment and invocation parse JSON locally and
show a fresh in-frame caution dialog whenever descriptor metadata contains `caution`.

## Key files

- `board-manifest.json` — public identity, version `1.0.5`, and `minAppVersion` `5.0.3`.
- `icon.svg` — the board's tab/tile/sidebar icon. Keep it valid XML: `--` is illegal inside an
  XML comment and silently renders nothing.
- `index.html` — boot/trust state, tree, descriptor details, search, events, and dialog mounts.
- `app.js` — bridge adapter, descriptor projection, explicit operations, theme listener, and event loop.
- `style.css` — themed layout and CSP-safe in-frame confirmation overlay.
- `WHATS-NEW.md` — release note.

## Run & test

Open the board with `boards.openBoard` and inspect its page via `pages[pageId].editor.snapshot()`.
After edits, call `pages[pageId].editor.reload()` and inspect a visual screenshot. Expand root and
node rows, walk into `pages[i].editor.app`, select properties and methods, use Read/Assign/Invoke,
run help search, and inspect the events feed. Use a harmless writable board property for assignment;
exercise a cautioned member by cancelling first, then only confirm a call whose effect is safe for
the current session. A never-activated editor page has no `app` member; its descriptor shows the
activation-and-refresh hint.

## Gotchas

The bridge returns the plain JSON-safe result, not MCP envelope metadata such as truncation hints.
The selected value is therefore labelled “Returned value”. Child paths from descriptors are used
verbatim; static member paths use dot syntax for identifiers and bracketed JSON names otherwise.
The boot state hides the tree until the root preflight succeeds and converts trust failures into
host trust instructions. Only expandable rows are described; a leaf is rendered from its parent's
member record. **Every row reads on selection except one whose descriptor declares a `caution`** —
reading is an ordinary resolve, and reading a method path returns its descriptor rather than calling
it, but a caution on a property is exactly the statement that reading acts (`pages[i].grouped`
CREATES a grouped page). Those read only through the Read control, behind a fresh confirmation. No
`window.confirm`/`window.prompt`, network request, external asset, or implicit getter/method call is
used during discovery. Search results are sanitized before selection so call syntax cannot invoke a
method.

## Reference

For the bridge contract, `$describe`, theme tokens, and board testing workflow, read the canonical
Persephone guide at `persephone://guides/boards` (also available as `guides.agents.boards`).
