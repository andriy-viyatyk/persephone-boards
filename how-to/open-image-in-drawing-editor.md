# Open an image in the Drawing (Excalidraw) editor

Let the user turn something your board rendered — a diagram, chart, or any image — into a
**new, editable drawing** in Persephone's built-in Drawing editor (Excalidraw). This is the same
"Open in Drawing Editor" affordance the built-in Mermaid / Image / SVG viewers have.

## API

```js
persephone.openRawLink(imageDataUrl, { editor: "draw-view" });
```

- `imageDataUrl` — a **`data:image/...;base64,...`** URL of the image.
- `{ editor: "draw-view" }` — the real id of the Drawing editor. Persephone sees an image data
  URL aimed at `draw-view` and opens the image as a **new untitled drawing** with the image
  embedded.

That's the whole integration — one call. No new bridge method; it rides the existing
`persephone.openRawLink`.

## Constraints & gotchas

- **Data URL only.** The conversion triggers on a `data:image/*` URL. Persephone does **not**
  fetch a URL or read a file for you here. If you have an `http(s)` image or a file path, fetch /
  read it and convert it to a data URL yourself first, then call `openRawLink`.
- **A new untitled drawing — never your source.** The result is a fresh in-memory
  `*.excalidraw` page, **not** bound to any file. The user's Ctrl+S saves a new drawing; it can
  **never** overwrite the file your board is showing. (That's deliberate: the Drawing editor is a
  content-host editor that would otherwise save back over its source.)
- **Prefer PNG over SVG.** Rasterize to PNG. An SVG that uses `<foreignObject>` for HTML labels
  (drawio, some Mermaid output) does **not** render reliably when embedded as an `<img>`, which is
  how Excalidraw shows an embedded image — so it can come out blank. A PNG bitmap always renders.
- The embedded image element opens capped to ~1200px on its longer side (the image bytes are
  full-res); the user can resize it in Excalidraw.

## Minimal snippet

Rasterize a rendered SVG to a PNG **data URL**, then hand it off. (If you already have a PNG
`Blob` — e.g. from `canvas.toBlob` — skip to the `FileReader` step.)

```js
async function openInDrawing() {
    // 1. Get a PNG Blob of what you want to edit. Example: rasterize an on-screen <svg>.
    const svg = document.querySelector("svg");
    const w = 800, h = 600; // use the drawing's natural size
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const svgUrl = "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("rasterize failed"));
        im.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";            // flatten onto white — an image has no page background
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));

    // 2. Blob → data URL.
    const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = () => rej(new Error("read failed"));
        reader.readAsDataURL(blob);
    });

    // 3. Open it as a new editable drawing.
    persephone.openRawLink(dataUrl, { editor: "draw-view" });
}
```

## Real example

The **DrawIO Viewer** board (`boards/drawio-viewer/`) ships this as its toolbar "Open in Drawing
Editor" button — see `app.js` (`openInDrawing` + `diagramToPngBlob`).
