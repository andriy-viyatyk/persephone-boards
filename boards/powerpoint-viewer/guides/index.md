---
title: "PowerPoint Viewer"
audience: both
summary: "The PowerPoint Viewer board: what it opens, and how an AI assistant reads the deck you have open."
editorId: "board"
---

# PowerPoint Viewer

PowerPoint Viewer is a Persephone **board** that opens `.pptx` decks. It renders every slide
offline and stacks them in a scrollable view, with a slide counter and prev/next buttons in the
toolbar (the arrow and PageUp/PageDown keys step through them too).

It is **read-only**. Nothing you do in the board changes the deck. To edit one, switch to another
editor from the page toolbar.

It opens a `.pptx` from anywhere Persephone can reach one: a file on disk, a deck inside a `.zip`,
or an `http(s)` URL.

Legacy `.ppt` files — the old binary PowerPoint format — are not supported.

## Letting an assistant read the deck

This is the part worth knowing about. With a deck open, you can simply ask your AI assistant about
it — "summarise this deck", "what's in the budget table?", "what am I meant to say on slide 4?" —
and it reads the deck **directly from the page you are looking at**.

There is no conversion step, no export, and no upload: the deck is already parsed inside the
board, and the assistant reads it there. Nothing is sent anywhere.

A few things follow from that:

- **It reads the slides in the order you see them.** Slides are canvases, and the shapes on them
  are stored in the order they were drawn, not the order they are read. The board sorts them back
  into visual order, so a footnote never gets read before the headline.
- **It reads your speaker notes.** These are not on the slides — they are the script — and they
  are often the clearest statement of what a deck actually means. The assistant reads them along
  with the slides.
- **It reads charts as numbers, not pictures.** A chart's real series and values come from the
  deck's own data, so the assistant quotes exact figures instead of guessing from the axis.
- **It can tell you where something is.** Ask where a topic comes up and it searches every slide
  *and* the notes, then answers with slide numbers.
- **It can point at things.** Ask it to show you a phrase and it scrolls your view to that slide
  and highlights it for a moment.
- **It can look at your diagrams.** A diagram, screenshot or SmartArt graphic is a picture, and
  words cannot describe what is inside it — so the assistant pulls the picture out and looks at it
  directly. That matters more here than in other formats, because this renderer draws complex
  shapes only approximately.
- **It can save pieces for you.** The deck as Markdown or plain text, or any of its pictures,
  written wherever you ask.

One honest limit: bullet styling is not reported. The assistant sees each line's **indent level**
correctly, but it does not distinguish a bulleted list from a numbered one.

## For agents

The model and every method are documented in
[PowerPoint Viewer for agents](./agent.md).
