# How-to: board recipes

Short, code-first recipes for building Persephone **boards** — with an emphasis on
**Persephone integration cases** (the `window.persephone` bridge): opening things in the app,
talking to built-in editors, dialogs, theming, and so on.

Each file is one self-contained recipe: what it does, the exact API to call, the constraints
that bite, and a minimal working snippet. When you hit an integration need, skim this folder
first — the plumbing has usually been solved once already.

> These docs are **repo documentation**, not board content. They live at the repo root
> (`how-to/`), outside any `boards/<id>/` folder, so they are **never** included in a published
> board ZIP.

## Recipes

| Recipe | What it covers |
|--------|----------------|
| [Open an image in the Drawing (Excalidraw) editor](open-image-in-drawing-editor.md) | Turn a board-rendered diagram/image into a new, editable Excalidraw drawing via `persephone.openRawLink(dataUrl, { editor: "draw-view" })`. |

## Adding a recipe

- One file per case, kebab-case name, added to the table above.
- Keep it short and concrete: **use case → API → constraints/gotchas → minimal snippet**.
- Prefer a real, working example (link to the board in this repo that uses it).
- The generic board authoring reference (the `persephone.*` bridge, `--p-*` theme contract, CSP,
  reload/test loop) lives in the Persephone app — from inside Persephone use the
  **`read_guide("boards")`** MCP tool. These recipes are the *specific* cases that guide points to.
- Board UI languages (`lang/<code>.json` packs, `persephone.i18n.t()`, the `manifest.*` keys and
  the steps for adding a language to a board) are covered in the **Languages** section of that
  same guide (`guides.agents.boards` over MCP, or the `persephone://guides/boards` resource). A
  board that uses `persephone.locale` or `persephone.i18n` needs `minBridgeVersion: "1.36.0"`.
