// Generate SYNTHETIC Claude Code and Codex session logs for the Agent Log Viewer board.
// No real session content: every prompt, answer and tool output below is invented.
//
//   node _test/agent-log-viewer/generate-fixtures.mjs            # write the fixtures
//   node _test/agent-log-viewer/generate-fixtures.mjs --append   # append a turn (live-tail test)
//
// The folders mirror the real layouts, so the board's folderMasks claim the files:
//   fixtures/.claude/projects/C--demo-todo-app/<session>.jsonl (+ <session>/subagents/agent-*.jsonl)
//   fixtures/.codex/sessions/2026/10/06/rollout-*.jsonl
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const SESSION = "5b0c7f3e-0000-4000-8000-00000000demo";
const CLAUDE_DIR = path.join(ROOT, ".claude", "projects", "C--demo-todo-app");
const CLAUDE_FILE = path.join(CLAUDE_DIR, SESSION + ".jsonl");
const CODEX_FILE = path.join(ROOT, ".codex", "sessions", "2026", "10", "06", "rollout-2026-10-06T09-00-00-demo.jsonl");

let clock = Date.parse("2026-10-06T09:00:00Z");
const ts = (sec = 7) => new Date((clock += sec * 1000)).toISOString();
let uuidN = 0;
const uuid = () => "00000000-0000-4000-8000-" + String(++uuidN).padStart(12, "0");
const lines = (records) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";

// ---- Claude Code -----------------------------------------------------------------------------
function claudeBase(extra) {
    return { parentUuid: null, isSidechain: false, userType: "external", cwd: "C:\\demo\\todo-app", sessionId: SESSION, version: "2.9.0", gitBranch: "main", uuid: uuid(), timestamp: ts(), ...extra };
}
let msgN = 0;
function assistant(content, usage = {}) {
    const id = "msg_demo_" + ++msgN;
    return content.map((block) => claudeBase({
        type: "assistant",
        message: { id, type: "message", role: "assistant", model: "claude-opus-5", content: [block],
            usage: { input_tokens: 12, cache_creation_input_tokens: 900, cache_read_input_tokens: 15000, output_tokens: 320, ...usage } },
    }));
}
const user = (text) => claudeBase({ type: "user", message: { role: "user", content: text } });
const toolResult = (id, content, extra = {}) => claudeBase({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...(extra.is_error ? { is_error: true } : {}) }] }, ...(extra.toolUseResult ? { toolUseResult: extra.toolUseResult } : {}) });

function claudeTurn(n) {
    return [
        user(`Add a "due date" field to todo item #${n} and show overdue items in red.`),
        ...assistant([
            { type: "thinking", thinking: "The model lives in src/todo.ts. I need a dueDate field, a render rule, and a test run.", signature: "x" },
            { type: "text", text: "I'll add `dueDate` to the model, then update the list renderer." },
            { type: "tool_use", id: "toolu_read_" + n, name: "Read", input: { file_path: "C:\\demo\\todo-app\\src\\todo.ts" } },
        ]),
        toolResult("toolu_read_" + n, "export interface Todo {\n  id: number;\n  title: string;\n  done: boolean;\n}\n"),
        ...assistant([{ type: "tool_use", id: "toolu_edit_" + n, name: "Edit", input: { file_path: "C:\\demo\\todo-app\\src\\todo.ts", old_string: "  done: boolean;", new_string: "  done: boolean;\n  dueDate?: string;" } }]),
        toolResult("toolu_edit_" + n, "The file has been updated.", { toolUseResult: { filePath: "C:\\demo\\todo-app\\src\\todo.ts", oldString: "  done: boolean;", newString: "  done: boolean;\n  dueDate?: string;", structuredPatch: [{ oldStart: 3, oldLines: 3, newStart: 3, newLines: 4, lines: ["   title: string;", "   done: boolean;", "+  dueDate?: string;", " }"] }] } }),
        ...assistant([{ type: "tool_use", id: "toolu_test_" + n, name: "Bash", input: { command: "npm test", description: "Run the test suite" } }]),
        n === 2
            ? toolResult("toolu_test_" + n, "FAIL src/list.test.ts\n  ✕ renders overdue items in red (12 ms)\n\nTests: 1 failed, 23 passed", { is_error: true })
            : toolResult("toolu_test_" + n, "PASS src/list.test.ts\nTests: 24 passed, 24 total"),
        ...assistant([{ type: "text", text: n === 2
            ? "One test failed: the overdue colour uses the wrong class. I'll fix that next."
            : "Done. Item #" + n + " now has a **due date**; overdue items render with the `overdue` class:\n\n| Field | Type |\n|---|---|\n| dueDate | `string?` |" }]),
        claudeBase({ type: "system", subtype: "turn_duration", durationMs: 42000, isMeta: true }),
    ];
}

function claudeSession() {
    const records = [
        claudeBase({ type: "ai-title", aiTitle: "Due dates and overdue highlighting for the todo app" }),
        ...claudeTurn(1),
        ...claudeTurn(2),
        user("Use a subagent to review the change for accessibility."),
        ...assistant([{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { description: "Accessibility review", prompt: "Review the overdue styling for contrast and screen-reader text." } }]),
        toolResult("toolu_agent", [{ type: "text", text: "Contrast is fine (7.1:1). Add aria-label=\"overdue\" to the badge." }], { toolUseResult: { status: "completed", agentId: "a1b2c3", description: "Accessibility review" } }),
        ...assistant([{ type: "text", text: "The reviewer suggests an `aria-label`; I added it." }]),
        claudeBase({ type: "system", subtype: "compact_boundary", content: "Conversation compacted" }),
        claudeBase({ type: "user", isCompactSummary: true, message: { role: "user", content: "Summary: the todo app gained a dueDate field, overdue styling and an aria-label." } }),
        ...claudeTurn(3),
        claudeBase({ type: "some-future-record", payloadVersion: 9 }), // unknown type: must not break anything
    ];
    return records;
}

function claudeSubagent() {
    const base = (extra) => ({ ...claudeBase(extra), isSidechain: true, agentId: "a1b2c3" });
    return [
        base({ type: "user", message: { role: "user", content: "Review the overdue styling for contrast and screen-reader text." } }),
        base({ type: "assistant", message: { id: "msg_sub_1", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: "Contrast is fine (7.1:1). Add aria-label=\"overdue\" to the badge." }], usage: { input_tokens: 40, output_tokens: 90, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } } }),
    ];
}

// ---- Codex -----------------------------------------------------------------------------------
const env = (type, payload) => ({ timestamp: ts(), type, payload });
let total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
function tokenCount(input, cached, output) {
    const last = { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 40, total_tokens: input + output };
    total = { input_tokens: total.input_tokens + input, cached_input_tokens: total.cached_input_tokens + cached, output_tokens: total.output_tokens + output, reasoning_output_tokens: total.reasoning_output_tokens + 40, total_tokens: total.total_tokens + input + output };
    return env("event_msg", { type: "token_count", info: { total_token_usage: { ...total }, last_token_usage: last, model_context_window: 400000 } });
}
const msg = (role, text) => env("response_item", { type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] });

function codexTurn(n, model) {
    const patch = "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-export const TIMEOUT = 5000;\n+export const TIMEOUT = 15000;\n*** End Patch";
    return [
        env("event_msg", { type: "task_started", turn_id: "turn-" + n }),
        env("turn_context", { turn_id: "turn-" + n, cwd: "C:\\demo\\todo-app", model, effort: "high", approval_policy: "never", sandbox_policy: { type: "workspace-write" } }),
        msg("user", n === 1 ? "The API client times out on slow networks. Raise the timeout and add a retry." : "Now add a unit-free smoke check script."),
        env("response_item", { type: "reasoning", summary: [{ type: "summary_text", text: "**Locating the timeout constant** in src/api.ts before changing it." }], encrypted_content: "AAAA" }),
        env("response_item", { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["rg", "TIMEOUT", "src"] }), call_id: "call_rg_" + n }),
        env("response_item", { type: "function_call_output", call_id: "call_rg_" + n, output: JSON.stringify({ output: "src/api.ts:3:export const TIMEOUT = 5000;\n", metadata: { exit_code: 0, duration_seconds: 0.2 } }) }),
        tokenCount(9000, 6000, 350),
        env("response_item", { type: "custom_tool_call", name: "apply_patch", call_id: "call_patch_" + n, input: patch }),
        env("response_item", { type: "custom_tool_call_output", call_id: "call_patch_" + n, output: "Success. Updated the following files:\nM src/api.ts" }),
        env("response_item", { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["npm", "run", "build"] }), call_id: "call_build_" + n }),
        env("response_item", { type: "function_call_output", call_id: "call_build_" + n, output: JSON.stringify({ output: n === 2 ? "error TS2304: Cannot find name 'retry'.\n" : "built in 2.1s\n", metadata: { exit_code: n === 2 ? 2 : 0 } }) }),
        tokenCount(11000, 9000, 420),
        // A repeated event with the same cumulative total must add nothing.
        env("event_msg", { type: "token_count", info: { total_token_usage: { ...total }, last_token_usage: { input_tokens: 11000, cached_input_tokens: 9000, output_tokens: 420 } } }),
        msg("assistant", n === 2 ? "The build fails: `retry` is not imported yet. I'll add the import." : "Raised `TIMEOUT` to 15 s. The build passes."),
        env("event_msg", { type: "task_complete", turn_id: "turn-" + n, duration_ms: 38000 }),
    ];
}

function codexSession() {
    return [
        env("session_meta", { id: "019a0000-demo-7000-8000-000000000001", timestamp: ts(0), cwd: "C:\\demo\\todo-app", originator: "codex_cli", cli_version: "0.160.0", model_provider: "openai", git: { branch: "feature/retry", commit_hash: "abc1234" } }),
        msg("user", "<environment_context>\n  <cwd>C:\\demo\\todo-app</cwd>\n</environment_context>"),
        ...codexTurn(1, "gpt-5.6"),
        env("compacted", { message: "Summary: timeout raised to 15 s; retry pending." }),
        ...codexTurn(2, "gpt-5.6-luna"),
        env("event_msg", { type: "brand_new_event", value: 1 }), // unknown type
    ];
}

// ---- write -----------------------------------------------------------------------------------
if (process.argv.includes("--append")) {
    clock = Date.now();
    fs.appendFileSync(CLAUDE_FILE, lines(claudeTurn(4 + Math.floor(Math.random() * 90))));
    console.log("appended one turn to", CLAUDE_FILE);
} else {
    fs.mkdirSync(path.join(CLAUDE_DIR, SESSION, "subagents"), { recursive: true });
    fs.mkdirSync(path.dirname(CODEX_FILE), { recursive: true });
    fs.writeFileSync(CLAUDE_FILE, lines(claudeSession()));
    fs.writeFileSync(path.join(CLAUDE_DIR, SESSION, "subagents", "agent-a1b2c3.jsonl"), lines(claudeSubagent()));
    // CRLF line endings and a trailing partial line exercise the reader's byte offsets.
    fs.writeFileSync(CODEX_FILE, lines(codexSession()).replace(/\n/g, "\r\n") + '{"timestamp":"2026-10-06T10:00:00Z","type":"event_msg","pay');
    console.log("wrote", ROOT);
}
