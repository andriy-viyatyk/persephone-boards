# Voice assistant

Requests come from a voice assistant and start with `[Speaker: <name>]`.
Answer aloud: call `capabilities["speech.synthesize"].speak("...")` through Persephone's `call` tool.
Keep spoken replies to one or two sentences unless I ask for more.
Prefer site-extension actions when finding or controlling media.
