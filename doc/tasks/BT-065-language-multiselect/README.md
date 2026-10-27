# BT-065: Speech to Text language picker setting

## Status

**Status:** Complete  
**Priority:** Medium  
**Board id:** `speech-to-text`  
**Started:** 2026-10-27  
**Completed:** 2026-10-27

## Goal

Replace the free-text `language-hints` board setting with the checkbox multi-select introduced by Persephone US-1730. Keep its declared default and persisted/API value as the comma-separated string `app,en` so existing service behavior and saved settings remain compatible.

## Background

- `boards/speech-to-text/board-manifest.json` declares `language-hints` as a string with default `app,en`. Persephone US-1730 adds `format: "multiselect"`, option entries as strings or `{ value, label }` objects, and the Settings control that displays selected ids when closed and labelled checkbox rows when open. It preserves the comma-separated string value contract.
- US-1730 sets the required board `minBridgeVersion` to `1.43.0`; set the board manifest to that version when implementing this task.
- `boards/speech-to-text/scripts/whisper-languages.mjs` contains all 100 Whisper language codes and their English names. A one-off Node check with `Intl.DisplayNames([code], { type: "language" }).of(code)` produced a name for every code; capitalize its first character for each endonym label and fall back to the table's English name if Intl returns no endonym or only the code. The check returned no fallback codes, including for `jw`, `haw`, `yue`, `sa`, `ln`, `ba`, and `sn`.
- Recommend option order `app`, `en`, then the other Whisper codes sorted alphabetically by code. This keeps the special current-application choice and the common English fallback at the top, while making the remaining long list easy to scan. Include `en` only once; the full catalog has 100 Whisper codes plus `app`.
- Put the generated labels directly into the static JSON manifest. A generator is unnecessary at runtime and would add a second source of truth for a small, fixed declaration; regenerate and review the labels if the Whisper code table changes.
- The existing `parseLanguageHints()` in `scripts/service.mjs` retains `app` and validates explicit Whisper codes; `allowedLanguages()` resolves the setting and removes duplicates. Both read the current comma-separated string, so this UI-only setting declaration needs no service parsing change.
- US-1730 confirms setting labels/descriptions can be localized with board language-pack keys, but option labels are literal manifest display strings. Preserve the existing `lang/en.json` impact only for any changed setting label or description key; do not add 101 option-label translations.
- `speech-to-text` 1.3.0 is committed but unreleased. Fold the setting change into the existing 1.3.0 release notes and README; do not create a new board version.

## Implementation Plan

1. [x] **Declare the multi-select.** In `boards/speech-to-text/board-manifest.json`, add `"format": "multiselect"` to `language-hints` and define options with `app` first, `en` second, then every remaining Whisper language sorted by code. Use `{ "value": "app", "label": "app (Persephone UI language)" }` for the special choice and `{ "value": "<code>", "label": "<code> (<capitalized endonym>)" }` for each Whisper language. Generate endonyms with `Intl.DisplayNames([code], { type: "language" }).of(code)`; fall back to the existing English table name if no endonym is returned. Keep `default: "app,en"` and the setting's `type: "string"`.
2. [x] **Require the supporting bridge.** Set the board-level `minBridgeVersion` in `board-manifest.json` to `1.43.0`, as specified by Persephone US-1730.
3. [x] **Clarify the setting description.** Update the declaration description to explain that the checked choices are allowed language hints, `app` follows Persephone's UI language when supported, `en` is the default fallback, and an empty selection allows any language. Keep `app`'s option label short and clear.
4. [x] **Keep language-pack localization aligned.** US-1730 treats option labels as literal manifest values. If changing the setting label or description, update the corresponding `manifest.settings.language-hints.label` or `.description` entry in `boards/speech-to-text/lang/en.json`; do not create translations for the endonym option labels. No metadata localization keys are used in the current English pack, so no language-pack change was needed.
5. [x] **Record the unreleased change.** Add a concise line under `## 1.3.0` in `boards/speech-to-text/WHATS-NEW.md`, and update the Settings section in `boards/speech-to-text/README.md` to describe selecting allowed languages with the multi-select while preserving the `app,en` default and comma-separated setting value. Keep manifest version 1.3.0.
6. [x] **Confirm service compatibility.** Review `parseLanguageHints()` and `allowedLanguages()` in `boards/speech-to-text/scripts/service.mjs` to ensure they still receive the same comma-separated string. No code change was needed; caller-list precedence and `app` resolution are preserved.

## Decisions

- Use `app`, `en`, then remaining language codes in alphabetical order. The first two entries make the current Persephone language choice and the fallback easy to find; sorting the rest provides predictable scanning.
- Keep all option values equal to their stored ids. The Settings closed control should display selected ids, while the open checkbox rows use the labels from the manifest.
- Store the 101 option entries directly in `board-manifest.json`; generate the endonym strings once during authoring, with no runtime generator.
- Leave service parsing and value handling unchanged. US-1730 retains `language-hints` as a comma-separated string, matching the existing service parser.
- Use `minBridgeVersion: "1.43.0"` and fold the change into unreleased `speech-to-text` 1.3.0.

## Concerns / Open Questions

- None currently. US-1730 is present and specifies both the `1.43.0` bridge requirement and literal manifest option labels.
- Intl endonym check: all 100 language codes returned a value; fallback codes: none. Keep the English-name fallback in the authoring instructions for runtimes or future codes where Intl has no endonym.

## Acceptance Criteria

- [x] `language-hints` remains a string with `format: "multiselect"`, default `app,en`, and options for `app` plus all 100 codes in `scripts/whisper-languages.mjs`.
- [x] Options are ordered `app`, `en`, then the remaining Whisper language ids alphabetically; values stay ids and labels use the required `code (endonym)` form.
- [x] Endonyms are generated with `Intl.DisplayNames([code], { type: "language" }).of(code)`, capitalized at the start, with the Whisper table's English name as fallback. The checked list has no fallback codes.
- [x] The Settings control shows selected ids when closed and labelled checkbox rows when open; the setting value remains a comma-separated string.
- [x] `default` remains `app,en`, service `parseLanguageHints()` and `allowedLanguages()` need no changes, and `app` resolution and caller-list precedence remain intact.
- [x] `minBridgeVersion` is `1.43.0`.
- [x] The description, board README, and 1.3.0 changelog line explain the setting update. `lang/en.json` is updated only for localized setting label/description keys if those strings change; option labels remain literal manifest values.
- [x] No unit tests were added or run. `board-manifest.json` and `lang/en.json` were parsed with Node as requested.

## Files Changed

| File | Planned change |
|------|---------------|
| `boards/speech-to-text/board-manifest.json` | Add the static multi-select options, clarify the setting description, and set `minBridgeVersion` to 1.43.0 while retaining the string default `app,en`. |
| `boards/speech-to-text/README.md` | Explain the multi-select language setting and its unchanged value/default. |
| `boards/speech-to-text/WHATS-NEW.md` | Add the change under the unreleased 1.3.0 heading. |
| `boards/speech-to-text/lang/en.json` | Update only if the setting label or description changes and uses localized manifest metadata keys; option labels remain literal. |
| `boards/speech-to-text/scripts/service.mjs` | Read-only compatibility review; no parser change expected. |
| `doc/active-work.md` | Remove BT-065 from Planned on completion and record the evidence in `doc/tasks/completed.md`. |

## Notes

- Read `CLAUDE.md`, `doc/active-work.md`, and BT-063/BT-064 before drafting this task.
- Read Persephone `doc/tasks/US-1730-board-multiselect-setting/README.md`: it specifies `minBridgeVersion: "1.43.0"` and says option labels are literal manifest strings, unlike setting label/description keys.
- Inspected `parseLanguageHints()` and `allowedLanguages()` in `scripts/service.mjs`; the current manifest setting value is consumed without requiring a new service parser.
- Ran a temporary Node check outside the repository against all 100 Whisper codes. Intl returned endonyms for every code, including `jw`, `haw`, `yue`, `sa`, `ln`, `ba`, and `sn`; fallback codes: none.
- Generated the static 101 options with a one-off Node script in the system temp folder; no runtime generator was added to the board.
- Updated the README and 1.3.0 changelog. The manifest version remains 1.3.0 and no service code changed.
- Validated both `board-manifest.json` and `lang/en.json` with Node. No unit tests were added or run.
- Live Settings UI rendering was not verified because Persephone MCP calls did not return.
