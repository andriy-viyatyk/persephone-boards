# Claude Agent board notes

Standalone provider board; it is not a custom editor and has no file association. The resident service implements the vendor-neutral `agent.session` v1 protocol and the local chat page uses the same service channel and protocol.

## Runtime design

- `scripts/agent-session-protocol.mjs` owns v1 validation, bounds, policy classification, and instruction composition.
- `scripts/service.mjs` owns settings, channel lifecycle, SDK query sessions, approval callbacks, MCP endpoint revocation, and child process cleanup.
- `scripts/sdk-install.mjs` downloads SDK 0.3.302 only after a local consent message and verifies both the archive SRI and the SDK entrypoint SHA-256. Do not vendor SDK files or add a package manager/build step.
- `scripts/claude-executable.mjs` resolves only the installed CLI. The SDK process spawn hook always launches that resolved executable.

The SDK's `SpawnOptions` and `SpawnedProcess` declarations are from pinned version 0.3.302. Custom spawn replaces SDK default spawning; `ChildProcess` satisfies the declared process interface. `settingSources` is explicitly `user`, `project`, and `local`. The `PreToolUse` hook must remain enabled for every contract mode because native permission settings may auto-allow tools.

## Authoring and release

Keep browser CSP limited to local assets, use Persephone `--p-*` theme tokens, and localize page text with `i18n.js` and `lang/en.json`. Do not add `node_modules`, SDK code, a bundled package, or a build script. Increase `version` and add a matching `WHATS-NEW.md` heading for release changes. Capture the catalog screenshot in the running development app with synthetic content and no personal paths or data.
