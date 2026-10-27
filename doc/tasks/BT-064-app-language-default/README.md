# BT-064: Speech to Text default language hints follow the Persephone UI language

## Status

**Status:** Active  
**Priority:** Medium  
**Board id:** `speech-to-text`  
**Started:** 2026-10-27  
**Completed:** —

## Goal

Make the Speech to Text board's default allowed language list follow Persephone's current UI language while retaining English as a fallback. Resolve the special `app` hint in the service so the behavior covers the board test page, Persephone Voice Typing, and other callers, including requests handled while the board page is closed.

## Background

- `boards/speech-to-text/board-manifest.json` currently declares `language-hints` with default `uk,en`. Its description says the setting applies to callers that do not name their own languages.
- In `boards/speech-to-text/scripts/service.mjs`, `parseLanguages()` validates codes with `languageNameForCode()` from `scripts/whisper-languages.mjs`; `applySetting()` stores the parsed result in `settings.languages`. `allowedLanguages(requested)` first parses the request's `languages` and uses that non-empty caller list in preference to `settings.languages`. `infer()` calls `allowedLanguages(request.languages)` before applying the allowed list to Whisper. Preserve this caller override behavior: a valid explicit caller list remains authoritative, while an absent or empty list uses the board setting.
- `startTranscription()` copies `open.languages` into each request. The board page's `startRecording()` in `boards/speech-to-text/app.js` currently sends a list parsed from the raw setting. Once the default contains `app`, that would send `app` as if it were a caller-supplied ISO code; `parseLanguages()` would discard it and the page would prevent service fallback to the UI locale. The page should omit `languages` (or send an empty list) and let the service apply the configured default.
- `scripts/whisper-languages.mjs` exports `languageNameForCode()` backed by its Whisper code table. Use that table to validate both configured explicit codes and the locale-derived primary subtag; do not duplicate the supported-language list.
- The Persephone contract guide at `C:/projects/persephone/assets/guides/agents/speech-transcribe.md` uses `languages: ["uk", "en"]` in lines 41 and 114 as optional consumer-request examples. Those are caller examples, not the provider setting's default, so neither line needs to change for this task. The guide describes absent or empty `languages` as asking the provider to use its configured languages (line 47).
- Persephone task **US-1729** (“Give board services the app locale”) defines `process.env.PERSEPHONE_LOCALE` as the resolved Persephone UI locale (for example `uk`, `zh-CN`, `pt-BR`, `en`, or `en-XA`). It is set when the service is spawned and updated in place by the service host when the app language changes. Read `process.env.PERSEPHONE_LOCALE` each time resolving the `app` hint; do not cache it at service startup. This is a Node service environment value, not a board-frame bridge API.
- The manifest already has `minAppVersion: "5.0.15"`, and US-1729 is planned for Persephone 5.0.15. No minimum-version bump is needed provided US-1729 ships in 5.0.15. If US-1729 slips to a later app version, move `minAppVersion` to that version. Keep `minBridgeVersion: "1.42.0"`; the environment value does not require a bridge-version bump.
- BT-063 is unreleased and already plans `speech-to-text` 1.3.0. Recommend folding this change into that same unreleased 1.3.0: add a second 1.3.0 changelog line and keep the manifest at 1.3.0. If BT-063's 1.3.0 has been released before implementation, use 1.4.0 instead and keep the manifest and top `WHATS-NEW.md` heading aligned.

## Implementation Plan

1. [x] **Preserve the `app` setting token.** In `boards/speech-to-text/scripts/service.mjs`, adjust the setting parser used by `applySetting()` so it retains the exact special token `app` while continuing to normalize, validate, and de-duplicate explicit codes through `languageNameForCode()`. Keep request-supplied `languages` parsing restricted to valid Whisper codes; `app` is a board-setting token, not a new `speech.transcribe` request code. Continue loading the setting once at service startup and responding to later setting changes through the existing `persephone.settings.onChange()` handler.
2. [x] **Resolve the setting in the shared service path.** Update `allowedLanguages()`/`infer()` in `scripts/service.mjs` to select a valid non-empty caller-supplied list first, preserving today's override. Otherwise resolve every `app` token in `settings.languages` against `process.env.PERSEPHONE_LOCALE`, reading the environment variable at resolution time for each request so a running service observes in-place updates. Take its primary subtag, normalize it for Whisper (`zh-CN` → `zh`, `pt-BR` → `pt`, `en-XA` → `en`), validate it with `languageNameForCode()`, discard unknown codes, and de-duplicate the result with explicit configured codes. Resolve from the shared service request path used by same-board and host/cross-board requests. This keeps the default effective for Persephone Voice Typing with the page closed and for other boards; no locale logic belongs only in `app.js`.
3. [x] **Define locale-unavailable behavior.** As a defensive path only, if `process.env.PERSEPHONE_LOCALE` is unavailable, treat `app` as absent and retain other configured hints. With the default `app,en`, this leaves English alone. This fallback is acceptable only because `minAppVersion: "5.0.15"` makes it unreachable in practice once US-1729 ships in 5.0.15. If US-1729 ships later, raise `minAppVersion` accordingly. Do not silently substitute an unrelated locale.
4. [x] **Stop the test page from overriding the service default.** In `boards/speech-to-text/app.js`, remove the `languages` field built from the raw `language-hints` setting in `startRecording()` (or pass `[]`). Keep the setting available in Persephone Settings. This allows the service to resolve `app` consistently. A future UI change that offers caller-specific explicit languages may send those codes and retain caller-list precedence.
5. [x] **Update setting copy and board documentation.** In `boards/speech-to-text/board-manifest.json`, change the setting default from `uk,en` to `app,en`; explain that `app` follows Persephone's UI language and is mapped to a supported Whisper language, explicit codes can be combined with it, and an empty setting allows any language. Update the Settings section in `boards/speech-to-text/README.md` to describe the new default, locale fallback, explicit caller-list precedence, and that saved setting values are not migrated or overwritten.
6. [x] **Record the release note.** Add a terse language-hints line under `## 1.3.0` in `boards/speech-to-text/WHATS-NEW.md` and retain manifest version 1.3.0 while that release remains unreleased. If 1.3.0 has shipped, instead bump the manifest and top changelog heading together to 1.4.0.
7. [x] **Use the US-1729 locale environment contract.** Add a small helper that reads `process.env.PERSEPHONE_LOCALE` when resolving the setting, rather than caching the locale at startup. Keep `minAppVersion` at `5.0.15` provided US-1729 ships in 5.0.15; if it slips to a later app version, raise `minAppVersion` to that version. No `minBridgeVersion` bump is needed for this process environment value.
8. [x] **Update the Persephone guide only if its wording proves inaccurate.** The checked `speech-transcribe.md` lines 41 and 114 are explicit consumer examples using optional `uk,en`, not a claim about the board's default. No guide edit is currently needed; do not edit the separate Persephone repository as part of this task.

## Concerns / Open Questions

- Release timing only: BT-063's 1.3.0 is currently unreleased. Fold this change into 1.3.0 while it remains unreleased; if 1.3.0 ships before implementation, use 1.4.0 and align the manifest version with the top `WHATS-NEW.md` heading.

## Acceptance Criteria

- [ ] The setting default is `app,en`; `app` means Persephone's current UI locale, reduced to its primary subtag and validated against the Whisper code list.
- [ ] A locale such as `zh-CN`, `pt-BR`, or `en-XA` maps to `zh`, `pt`, or `en`; unsupported locale subtags are dropped, and duplicate codes are removed (`en` UI plus configured `en` yields only `en`).
- [ ] If the locale environment variable is unavailable, the defensive path treats `app` as absent and retains other configured codes; with `app,en`, English alone remains. This should be unreachable in practice because the minimum app version includes US-1729.
- [ ] The service resolves configured `app` hints for all callers through the shared transcription inference path, including board-page calls, Voice Typing while the board page is closed, and other boards.
- [ ] Valid non-empty caller-supplied `languages` continue to override the board setting as today. Missing, empty, or wholly invalid caller lists fall back to the service setting, which resolves `app` when present.
- [ ] The board test page no longer sends the literal setting token as a caller language list; explicit user-entered language codes remain supported in the setting.
- [ ] Existing saved setting values are not migrated or overwritten by the manifest default change.
- [ ] The setting description and board README explain `app`, explicit codes, and fallback behavior.
- [ ] WHATS-NEW and the manifest use the recommended unreleased 1.3.0 version together, or both move to 1.4.0 if 1.3.0 has already shipped.
- [ ] `minAppVersion` remains `5.0.15` if US-1729 ships in 5.0.15, and moves with US-1729 if that work slips to a later app version; `minBridgeVersion` remains unchanged because the locale is supplied through the service process environment.
- [ ] `speech-transcribe.md` lines 41 and 114 remain unchanged unless the consumer examples themselves become inaccurate; they are not descriptions of the provider default.
- [ ] No unit tests are added or run for this task.

## Files Changed

| File | Planned change |
|------|---------------|
| `boards/speech-to-text/board-manifest.json` | Set `language-hints` default to `app,en`; describe locale-derived and explicit hints; keep `minAppVersion` at 5.0.15 if US-1729 ships there, moving it only if US-1729 slips to a later app version |
| `boards/speech-to-text/scripts/service.mjs` | Preserve the setting token, resolve `app` from the current locale in the shared service fallback path, and retain explicit caller-list precedence |
| `boards/speech-to-text/app.js` | Let the service apply its configured language default instead of sending the raw setting as caller-supplied languages |
| `boards/speech-to-text/README.md` | Explain the UI-language default, locale fallback, and caller overrides |
| `boards/speech-to-text/WHATS-NEW.md` | Add the language-default release note under 1.3.0, or 1.4.0 if 1.3.0 ships first |
| `doc/active-work.md` | Add BT-064 under Planned |
| `C:/projects/persephone/assets/guides/agents/speech-transcribe.md` | Read-only check; no current line change required |

## Notes

- Verified against `parseLanguages()`, `allowedLanguages()`, `infer()`, `startTranscription()`, `applySetting()`, and the settings initialization in `boards/speech-to-text/scripts/service.mjs`; the board test open message is assembled in `startRecording()` in `boards/speech-to-text/app.js`.
- The Whisper code validator and source list are `languageNameForCode()` and `LANGUAGES` in `boards/speech-to-text/scripts/whisper-languages.mjs`.
- Current release metadata is 1.3.0 in both `boards/speech-to-text/board-manifest.json` and the first heading of `boards/speech-to-text/WHATS-NEW.md`; BT-063 plans that release but is unreleased.
- The Persephone guide was checked read-only. Its `uk,en` examples are optional request examples, not a promised default. No unit tests were run for this documentation-only planning task.
