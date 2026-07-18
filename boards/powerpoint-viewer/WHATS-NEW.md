# What's New — PowerPoint Viewer

One line per change, newest first. Keep it short. Record pending changes under a heading for
the **next version** you'll release (the version `board-manifest.json` will be bumped to).

## 1.0.0
- Read-only viewer for PowerPoint decks (`.pptx`) — every slide rendered to HTML.
- Slides stack in a scrollable view, scaled to fit the board width, with a slide counter and
  prev/next buttons (and arrow / PageUp-Down keys).
- Renders slide text, images, and basic shapes; embedded charts via the bundled renderer.
- Fully offline — one self-contained bundled renderer (pptx-preview), no network access.
