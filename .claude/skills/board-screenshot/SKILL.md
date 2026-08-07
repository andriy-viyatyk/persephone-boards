---
name: board-screenshot
description: Capture a board's catalog screenshot (screenshot.png) through the Persephone MCP server
allowed-tools: Read, Write, Edit, Bash, mcp__persephone__execute_script, mcp__persephone__browser_take_screenshot
---

# Capture a board screenshot

Every published board carries a `screenshot.png` that Persephone shows on its card in the
**Search boards** tab and on the Board Info page. This skill captures one end to end — no
manual snipping, no image editor.

**Output contract:** `boards/<id>/screenshot.png`, **1120×700 (16:10)**, under ~300 KB,
containing **no personal data**.

## Prerequisites

1. **Persephone is running** with its MCP server enabled (Settings → MCP).
2. **The board is registered and works** — open it once by hand and confirm it renders.
3. **A sample file exists** that opens in this board. Generate a synthetic one; see
   *Sample files* below.

## Why the whole content area, not just the board frame

Capture the app's content area **below the page-tab strip** — not the board iframe alone.
A board with a secondary view (sidebar panel) keeps that panel *outside* its own frame, so a
frame-only capture silently drops it: the SQLite viewer loses its Tables list, the Todo board
loses Lists & Tags. The wider region also picks up the editor-switch chips and the status
footer, which make the image read as a real product screenshot.

The page-tab strip itself is excluded — it shows whatever unrelated tabs happen to be open.

## Step 1 — Create a sample file

Invent the content. **Never use a real customer document**: the screenshot is published to a
public repo. Neutral subject matter (a book database, a trail survey, invented sales figures)
works well and keeps the image legible.

Write it somewhere gitignored — `_test/` is already ignored in this repo.

## Step 2 — Open it in Persephone

```js
// mcp__persephone__execute_script
await app.pages.openFile("C:\\projects\\persephone-boards\\_test\\sample.db");
"opened"
```

Then look at it (`browser_take_screenshot` with `pageId: "app"`) and make sure the board is
showing something worth capturing. Interact first if the default state is empty — click a
table, scroll to an interesting page, select a tab. A screenshot of an empty state is worse
than none.

## Step 3 — Capture

Paste the script below into `mcp__persephone__execute_script`, changing only `TITLE` and
`BOARD_ID` at the top.

```js
const fsNode = require("fs");
const TITLE = "sample.db";                    // the page tab's exact text
const BOARD_ID = "sqlite-viewer";             // boards/<id>/
const OUT = "C:\\projects\\persephone-boards\\boards\\" + BOARD_ID + "\\screenshot.png";

function ipc(command, args) {
    return new Promise(function (resolve, reject) {
        const id = "cap_" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
        window.electron.ipcRenderer.once(command + "_" + id, function (a) {
            if (a instanceof Error) reject(a); else resolve(a);
        });
        window.electron.ipcRenderer.sendMessage(command, args, id);
    });
}
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// app.pages.showPage() does NOT switch the visible tab — click the tab element.
const tabs = Array.from(document.querySelectorAll("[data-type=page-tab]"));
const tab = tabs.find(function (x) { return (x.textContent || "").trim() === TITLE; });
if (!tab) throw new Error("tab not found: " + TITLE);
tab.click();
await wait(1600);

// Hide absolute-path labels — the board toolbar shows the board root, which on an installed
// board contains the user profile path. Restored immediately after the capture.
const hidden = [];
Array.from(document.querySelectorAll("div,span")).forEach(function (e) {
    const txt = (e.textContent || "").trim();
    if (!/^[A-Za-z]:[\\/]/.test(txt) || txt.length > 160) return;
    const r = e.getBoundingClientRect();
    if (r.height > 0 && r.height < 30 && e.children.length <= 1) {
        hidden.push([e, e.style.visibility]);
        e.style.visibility = "hidden";
    }
});
await wait(120);

let png;
try {
    const tabsEl = document.querySelector("[data-type=page-tabs]");
    const top = Math.round(tabsEl.getBoundingClientRect().bottom);
    png = await ipc("capturePageRegion", [
        { x: 0, y: top, width: window.innerWidth, height: window.innerHeight - top },
    ]);
} finally {
    hidden.forEach(function (p) { p[0].style.visibility = p[1] || ""; });
}

// Scale onto a 1120x700 canvas, letterboxed with the capture's own corner colour.
const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
const img = await new Promise(function (res, rej) {
    const i = new Image();
    i.onload = function () { res(i); };
    i.onerror = function () { rej(new Error("decode failed")); };
    i.src = url;
});
const probe = document.createElement("canvas");
probe.width = 1; probe.height = 1;
const pctx = probe.getContext("2d");
pctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
const d = pctx.getImageData(0, 0, 1, 1).data;
const W = 1120, H = 700;
const c = document.createElement("canvas");
c.width = W; c.height = H;
const ctx = c.getContext("2d");
ctx.fillStyle = "rgb(" + d[0] + "," + d[1] + "," + d[2] + ")";
ctx.fillRect(0, 0, W, H);
const s = Math.min(W / img.width, H / img.height);
const dw = Math.round(img.width * s), dh = Math.round(img.height * s);
ctx.imageSmoothingQuality = "high";
ctx.drawImage(img, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
const outBlob = await new Promise(function (r) { c.toBlob(r, "image/png"); });
URL.revokeObjectURL(url);
fsNode.writeFileSync(OUT, Buffer.from(await outBlob.arrayBuffer()));
"wrote " + OUT + " (" + fsNode.statSync(OUT).size + " bytes)"
```

## Step 4 — Look at what you captured

`Read` the written PNG. Do not skip this. Check:

- The board's **sidebar panel** is present, if it has one.
- No **absolute path** survived the masking anywhere in the image.
- No **customer or personal content**.
- The board is showing **real content**, not an empty state or a spinner.
- Size is under ~300 KB.

Re-shoot if any of these fail.

## Step 5 — Declare it and release

1. Add `"screenshot": "screenshot.png"` to `boards/<id>/board-manifest.json`.
2. Bump `version`.
3. Add a `WHATS-NEW.md` line under the new version heading.
4. Merge `develop` → `main` to publish.

`screenshot.png` is **excluded from the release ZIP** (`EXCLUDE` in
`scripts/publish-board.mjs`) — the app loads it from this repo's raw URL, so shipping a copy
in every install would be dead weight.

## Gotchas

**Do not maximize the window.** A 2556 px capture shrunk into a 200 px card makes every
element illegible. A normal window (~900–1000 px wide) puts fewer, larger elements in frame.

**`app.pages.showPage()` does not switch the visible tab.** It returns without error and the
old page stays on screen — capture eight boards that way and you get eight identical images.
Click the tab element instead. Always confirm the images differ.

**Filter board iframes by `view=main`** if you ever capture a frame directly: a board with a
secondary view mounts several `board://` iframes, and the sidebar frame may match first.

**The `execute_script` parser is fussy.** Template literals and single-quoted strings
containing double quotes have both produced `missing ) after argument list`. Use string
concatenation and unquoted CSS attribute selectors (`[data-type=page-tab]`).

**The script's return value is often reported as `undefined`** on long scripts even when they
succeed. Write a log file, or verify by reading the output, rather than trusting the return.
