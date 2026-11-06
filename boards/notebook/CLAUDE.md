# Notebook board

Content-host editor for `.note.json`. `app.js` owns host and shared-state coordination; `model.js` preserves unknown data; `cards.js` reconciles keyed paged cards and `editor.js` owns CodeMirror. `nav.js` is the BT-079 placeholder.

Build the offline bundle with `npm ci` and `npm run build:codemirror`. Open a notebook in Persephone and reload via `pages[id].editor.reload()`. Use `persephone://guides/boards` for the bridge reference. Do not write view state to the file; preserve unknown fields and editor values.
