# Translate

Translate provides the local `text.translate` v1 service using Firefox desktop translation models and CLD2 language detection. Other trusted boards and Persephone can discover it through service channels. Translation accepts keyed plain-text or HTML-fragment items; a non-English pair can pivot through English.

## First use

Open the board and use **Download** for each required directed model. The manager displays advertised sizes, installed state and download progress. A non-English pair needs both legs through English unless a direct model is available. The paste-text panel detects a source language, allows correction, shows the route and translates only when all required models are installed. Translation itself never downloads models.

Downloads are explicit and can be cancelled. Verified model files are stored in `%LOCALAPPDATA%\Persephone\board-data\translate`, outside the installed board. Model discovery and downloading may require a network connection; translation and detection run locally after models are installed.

## Privacy and licenses

Text sent to this provider remains on this computer. Firefox Bergamot runtime licensing and provenance are documented in `vendor/bergamot/`; CLD2's Apache-2.0 license and Firefox worker provenance are in `vendor/cld2/`. CLD2 detection runs in a separate Node worker thread.

## Screenshot

TODO: capture the running Persephone board with the model manager and populated translation result, at 1120×700 and under 300 KB. Persephone could not be launched during this implementation, so no screenshot is fabricated.
