# What's New — PowerPoint Viewer

One line per change, newest first. Keep it short. Record pending changes under a heading for
the **next version** you'll release (the version `board-manifest.json` will be bumped to).

## 1.1.0

- An AI assistant can now read the open deck directly from the board — slides as Markdown in
  visual reading order, speaker notes, chart data, tables, outline, search and embedded pictures.
- Speaker notes and chart series/values are now available even though they are not drawn on the
  slides.
- Ask the assistant to show you a phrase: it scrolls to that slide and highlights it briefly.
- Decks can now be opened from inside a `.zip` or from an `http(s)` URL, not just from disk.
- Added board guides, shown on the board's Info page.

## 1.0.2

- Added a catalog screenshot, shown on the board's card in Persephone's Search boards tab.

## 1.0.1

- Toolbar chrome now follows Persephone's own theme chrome color (Persephone 4.0.16+; unchanged look on older versions), with softer hover highlights.

## 1.0.0
- Read-only viewer for PowerPoint decks (`.pptx`) — every slide rendered to HTML.
- Slides stack in a scrollable view, scaled to fit the board width, with a slide counter and
  prev/next buttons (and arrow / PageUp-Down keys).
- Renders slide text, images, and basic shapes; embedded charts via the bundled renderer.
- Resilient loading — a slide with an unresolvable template picture no longer drops the slide.
- Fully offline — one self-contained bundled renderer (pptx-preview), no network access.
