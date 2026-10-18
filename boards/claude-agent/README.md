# Claude Agent

Claude Agent provides the `agent.session` v1 service and a local chat page backed by your installed `claude` CLI.

## Requirements and first run

- Install the `claude` command line application and sign in through its normal login flow.
- Open the board, review the SDK download notice, and choose **Accept and download**. It downloads `@anthropic-ai/claude-agent-sdk` 0.3.302 from `registry.npmjs.org`, verifies the pinned SHA-512 digest before extraction, and stores the SDK under `%LOCALAPPDATA%\Persephone\board-data\claude-agent\sdk\0.3.302`. The SDK is not included in this board's files.
- Use of the SDK and CLI is subject to Anthropic's legal agreements.
- Choose a working directory and permission mode before starting a session. The empty model and effort choices preserve the CLI defaults.

The installed SDK file is hash-checked each time it loads. A missing or modified file returns the board to the consent and download flow. Discovery (`describe`) remains available without the SDK; listing or opening sessions requires it.

## Permissions and network behavior

The board asks for `service` and `appScripting`. `service` runs its resident Node process and launches the installed CLI with your account privileges. `appScripting` is required to issue an optional private Persephone MCP endpoint; that endpoint gives the associated Claude session full control of Persephone. Each session gets its own endpoint, and it is revoked when the session ends. Cross-board calls are clamped by the configured permission ceiling, which defaults to `read-only`.

Manifest `network` stays disabled. The board's Node module service downloads the pinned SDK directly from npm only after consent; that Node process can access the network independently of bridge networking. The board never reads CLI credential files or handles login tokens. It relies on the unmodified installed CLI and its existing login.

Configure provider instructions, executable override, model, effort, default mode, and the cross-board ceiling in **Settings → Editors → Claude Agent**. The service reads these effective settings itself; page and consumer messages cannot replace the provider instruction or ceiling settings.

## Privacy

Prompts, working-directory content, and tool activity are handled by the installed CLI as part of its normal operation. The board sends bounded event summaries to a connected consumer and never sends file contents in `file-change` events. SDK files are kept in user data and are not written into or shipped with the board.
