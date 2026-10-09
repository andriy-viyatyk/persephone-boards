# Theme Editor — author notes

Offline editor for Persephone custom themes, using the narrow `persephone.themes.*` bridge. Task plans: `doc/tasks/BT-034-theme-editor/README.md` and `doc/tasks/BT-036-theme-generator/README.md`. Canonical bridge reference: `assets/guides/boards.md#persephone-themes-bridge` (`persephone://guides/boards`).

## Files

| File | Role |
|---|---|
| `index.html` | Editor shell, Generator/Details views, base controls, dialogs and import input. |
| `app.js` | Shared draft, generator controls, bridge calls, palette rendering, preview, contrast, CRUD and theme JSON transfer. |
| `styles.css` | Responsive generator and palette layout; board chrome colors come from the `--p-*` contract. |
| `board-base.css` | Scaffolded Persephone board defaults and `.p-*` controls. |
| `board-manifest.json` | Board identity, compatibility, the `themes`-only permission grant and `theme.edit@1` claim. |
| `icon.svg`, `WHATS-NEW.md` | Local board icon and catalog changelog. |

## Rules that matter

- Use Persephone for derivation and contrast. The editor lists all 77 CSS colors and seven Monaco override keys; palette overrides use their `--color-*` names and Monaco overrides use `monaco:<key>`.
- Initialization and user changes are separate flows. Loading a theme (Edit, Revert, import, rename reload) keeps its exact colors: every override it carries is recorded in `state.sourceExact`, and the generator controls only show where its base colors sit; no notice or pin marker is shown for them. The first base-color, mode or Generate/Reroll change (`releaseSourceExact()` in `mutateBaseColor`, `mutateMode`, `randomizeCore`) drops all of those overrides so the generator drives the palette. Overrides set by hand in Details are not in the set and survive; only they get the "set in Details" notice and pin markers. The set is persisted with the `pageState` draft.
- Generator and Details edit the same draft. Generator strips display `derive()` values and mark overridden values as pinned; Details shows effective editable values and per-row Reset. The sidebar and contrast list stay visible across tabs.
- Generator locks are session-only. Random theme checks candidates with the bridge's contrast report, keeps overrides, and never invents optional semantic colors.
- Unsaved drafts use `page.setModified`, `onSaveRequest`, and `pageState`; Save on close saves and applies, and restart restoration leaves the draft dirty with Revert available.
- The board claims `theme.edit@1` at priority 50 and omits `alwaysOpensNewPage`, so Persephone reuses and focuses its page. Register `persephone.intent.onRequest()` at startup; validate `id`, `version`, and the exact payload shape, reject malformed requests, and resolve valid requests as accepted before loading themes or showing UI. This works for the initial request on a newly opened page and later requests on a reused page. `edit` loads the requested id directly: custom themes use `themes.file(id)`, built-ins use an exact fork named "<name> copy". `new` snapshots the active custom file or exact built-in fork, removes its id and all overrides (base colors and mode only, so the generator drives every color), sets `sourceId = null` and `sourceKind = "new"`, names it `New <active name>`, and marks it dirty so Save creates a custom theme. A dirty or restored draft is protected on a repeated request by the in-board Save / Discard / Cancel dialog. Save persists then loads the request's source; Discard drops the draft then loads it; Cancel retains the draft and reapplies its preview with `queueDraftRefresh({ preview: true })`. Intent work is queued and `scheduleExternalRefresh()` yields while a request is being handled.
- Edits preview live; there is no separate Apply. While the draft is clean, an outside theme change (Settings, another editor) reloads the board; a dirty draft is never replaced. The board has no toolbar of its own: Rename, Save, Save as and Revert are labelled `persephone.toolbar` buttons, Delete theme / Export JSON / Import JSON are a `placement: "board-menu"` menu (the top of Persephone's … menu), and the theme name fills `toolbar.setText()`; `syncPageToolbar()` keeps their disabled state current. Import opens an in-board dialog first because a toolbar pick gives the frame no user activation for the file chooser. Rename renames a custom theme in place (or the draft name of a built-in copy); Save (enabled only with changes) replaces the retained custom id; Save as asks for a name and removes the id. Save and Save as then apply; Import saves and applies; Delete loads Persephone's fallback theme.
- Preview is temporary and window-local. The bridge cleans up a frame-owned preview on close/reload. Explicit `endPreview()` has no ownership token; check bridge ownership behavior before adding calls that could end someone else's later preview.
- `themes: true` grants only the themes bridge. Keep file and network permissions disabled. Import/export use the in-frame File API, Blob download and file input; do not add broad filesystem access.
- Keep all UI chrome colors on `--p-*` variables. Never use native `alert`, `confirm`, or `prompt`.

## Testing

Open the board in Persephone and reload it after source edits. Check palette counts, base omission and polarity, built-in fork fidelity, custom replace/save-as, live preview and Revert, contrast, rename/delete, JSON import/export, external theme changes, and `ui.log`. The implementing agent does not run live verification; capture the catalog screenshot at 1120×700 in Persephone after verifying the UI.
