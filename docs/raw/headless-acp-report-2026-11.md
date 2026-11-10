# Headless Spawning and ACP Support in Claude Code, Cursor CLI, Codex CLI and Google Antigravity (November 2026)

All four agents can run headless, but only two have native ACP: Cursor (`agent acp`) and Antigravity (`agy acp`).\[1\]\[2\] Claude Code and Codex speak ACP only through official adapters maintained under the `agentclientprotocol` GitHub org: `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`.\[1\]\[3\] If you are building an orchestrator, use ACP as the common control plane, since it gives you one client, one event model, cancellation and permission round-trips. Keep each vendor's own surface as the fallback when you need more fidelity: the Claude Agent SDK / `claude -p` stream-json, the Codex app-server, the Cursor SDK and `agy` stream-json.

## TL;DR

- **Native ACP:** Cursor (`agent acp`) and Antigravity (`agy acp`, added in CLI v1.5.0). **Adapter ACP:** Claude Code (`npx -y @agentclientprotocol/claude-agent-acp`, v0.100.0 as of 2 Nov 2026) and Codex (`npx -y @agentclientprotocol/codex-acp`, built on `codex app-server`). Neither Anthropic nor OpenAI ships a native `acp` subcommand.
- **Headless commands:**
  - `claude -p --output-format stream-json`
  - `codex exec --json`
  - `agent -p --output-format stream-json` (the Cursor binary is now `agent`; `cursor-agent` is the legacy name)
  - `agy -p --output-format stream-json`

  All four emit NDJSON events, support resume by session/conversation ID, and exit non-zero on failure. Permission semantics differ a lot between them and are the main source of silent failures.
- **Most robust control path per agent:**
  - Claude: the Agent SDK, or ACP via the adapter.
  - Codex: `codex app-server` JSON-RPC, or ACP via `codex-acp`, which wraps it.
  - Cursor: `agent acp`, or `@cursor/sdk`.
  - Antigravity: `agy acp`, or `agy --input-format stream-json --output-format stream-json`.

  Antigravity has the weakest unattended story: it has no documented API-key headless auth, and a soft-denied tool still exits 0.

## Comparison table

| | **Claude Code** | **Cursor CLI** | **OpenAI Codex CLI** | **Google Antigravity CLI** |
|---|---|---|---|---|
| **Headless command** | `claude -p "<prompt>"` (stdin also accepted, capped at 10MB) | `agent -p "<prompt>"` (alias `cursor-agent`) | `codex exec "<prompt>"` (alias `codex e`; `codex exec -` reads stdin) | `agy -p "<prompt>"` (aliases `--print`, `--prompt`) |
| **Output formats** | `text` / `json` / `stream-json` (stream-json needs `--verbose`; add `--include-partial-messages` for token deltas); `--json-schema` | `text` / `json` / `stream-json`; `--stream-partial-output` for deltas | Default: final message on stdout, progress on stderr. `--json` gives JSONL events (`thread.started`, `turn.completed`, `error`…). `--output-schema` + `-o` | `text` / `json` / `stream-json` (`init` → `step_update` → `result`); `--json-schema` |
| **Multi-turn in one process** | `--input-format stream-json` | No (print mode exits after the turn) | No in `exec`; yes via app-server | `--input-format stream-json` (requires stream-json output)\[4\] |
| **Resume** | `--continue`, `--resume <session_id>` | `--resume [chatId]`, `--continue`, `agent create-chat`, `agent ls` | `codex exec resume --last` / `resume <SESSION_ID>` | `--continue` / `-c`, `--conversation <id>` |
| **Permissions** | `--allowedTools`, `--permission-mode` (`default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`), `--permission-prompts none`, `--bare` | Proposes only unless `--force`/`--yolo`; `--trust` for workspace trust; `--mode plan\|ask` | Approvals are always `never` in exec. `--sandbox read-only` (default) / `workspace-write` / `danger-full-access`; `--yolo` = bypass both | Settings `permissions.allow` rules; `--dangerously-skip-permissions`; `--sandbox`; unapproved tools are soft-denied (exit 0) |
| **Unattended auth** | `ANTHROPIC_API_KEY` (mandatory with `--bare`); Bedrock/Vertex/Foundry creds | `CURSOR_API_KEY` / `--api-key` | `CODEX_API_KEY` (exec only) | Cached login only (officially). Issue #223 requests headless auth |
| **Timeouts / limits** | `--max-turns`, `--max-budget-usd`; 10-min background-work wait cap | None documented; wrap with your own timeout | None documented in exec; wrap externally | `--print-timeout` (default `0s` = no limit per docs) |
| **Programmatic SDK** | Claude Agent SDK (TS `@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`) | `@cursor/sdk` (TS, Node ≥22.13), `cursor-sdk` (Python), SDK Bridge\[5\] | `@openai/codex-sdk` (TS), `openai-codex` (Python), `codex app-server` | `google-antigravity` (Python)\[6\] |
| **ACP status** | Adapter (official org, not Anthropic) | **Native** | Adapter (official org, wraps app-server) | **Native** (v1.5.0+) |
| **ACP launch** | `npx -y @agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`) | `agent acp` (optionally `agent --api-key "$CURSOR_API_KEY" acp`) | `npx -y @agentclientprotocol/codex-acp` (bin `codex-acp`) | `agy acp` (`agy acp --login` for browserless sign-in) |
| **Other protocols** | `claude mcp serve` (Claude Code as MCP server); stream-json in/out | Cursor ACP extension methods; SDK Bridge (Connect/protobuf) | `codex app-server` JSON-RPC (stdio; WebSocket experimental); `codex mcp-server` deprecated Aug 2026 and removed 5 Sep 2026 per OpenAI's changelog | stream-json in/out; Remote Control; SDK over a Go harness |
| **Key caveat** | `-p` loads project hooks/MCP from untrusted folders unless `--bare` | No `--force` = nothing written; stream-json schema not formally documented | `--full-auto` deprecated and rejected in recent builds; MCP approvals auto-cancel in exec | Windows non-TTY empty-stdout bug (#76); soft-denies exit 0 |

## Key Findings

1. **The ACP picture changed in 2026, so older guides are wrong.**
   - Cursor added `agent acp`.\[7\] Antigravity added `agy acp` in CLI v1.5.0, released 4 Nov 2026; Google's own changelog says "Antigravity CLI 1.5.0 introduces agy acp to run as an Agent Client Protocol server for editors".
   - The Zed-era package names are deprecated: `@zed-industries/claude-code-acp` (stopped at 0.16.2), `@zed-industries/claude-agent-acp` (0.23.1) and `@zed-industries/codex-acp`.\[8\]
   - The community Antigravity adapters (`agy-acp`, `google-antigravity-acp`, `agy-agent-acp`) were written when "Antigravity CLI does not natively support the ACP protocol yet".\[9\] They are now redundant.
2. **ACP is the right common denominator, but it is lossy.**
   - Codex's richer app-server protocol exposes things ACP lacks. A Zed user notes "ACP lacks lots of things like edit previous messages, fork etc.", and the app-server has `thread/fork` and `turn/steer`.\[10\]\[11\]
   - Claude's ACP adapter ignores client `fs/*` and `terminal/*` capabilities in practice. A tester observed that across "eleven ACP runs the agent never once called fs/read_text_file, fs/write_text_file, or any terminal/* method".\[8\]
   - Do not rely on ACP file-system mediation for sandboxing. Use worktrees or containers.
3. **Permission handling is the biggest cross-agent hazard.** Each agent fails differently when no human is present:
   - **Claude** denies, and emits `permission_denied` messages.\[12\]
   - **Codex exec** never asks. MCP tool calls that need approval auto-cancel.
   - **Cursor print mode** silently proposes instead of writing unless you pass `--force`. In ACP, it blocks if you never answer `session/request_permission`.\[7\]\[13\]
   - **Antigravity** soft-denies and still exits 0.\[14\]

   Your orchestrator must inspect events, not just exit codes.
4. **Auth for CI is solved for three of the four.** Claude, Cursor and Codex all accept API keys. Antigravity officially requires a cached interactive login: in CI, an unauthenticated run "exits with an `authentication required` error instead of hanging".\[4\] Issue #223 says every non-interactive path, including ADC/Vertex variables, still hits the OAuth prompt.\[15\] A third-party cheat sheet claims `modelProvider: "gemini"` plus `GEMINI_API_KEY` works; treat that as unverified.\[14\]

## Details by agent

### Claude Code (Anthropic)

**Headless.**
- **Invocation:** `claude -p "<prompt>"`, which reads stdin (10MB cap).\[12\]
- **Output:** `--output-format text|json|stream-json`. The JSON result carries `result`, `session_id`, usage and `total_cost_usd`, which is a client-side estimate. stream-json requires `--verbose`, and `--include-partial-messages` adds `stream_event` token deltas. The last line is a `result` message.\[12\]\[16\]
- **Structured output:** `--json-schema` places validated output in `structured_output`. That field is absent if the run declines, so check it exists before using it.\[12\]
- **Multi-turn and resume:** `--input-format stream-json` enables multi-turn input over stdin. Use `--continue`/`--resume <id>` to resume.\[17\]\[18\]
- **Permissions:**
  - `--allowedTools "Read,Edit,Bash"` pre-approves tools.\[12\]
  - `--permission-mode` (for example `dontAsk`) sets the mode.\[17\]
  - `--permission-prompts none` removes human-only tools such as AskUserQuestion. Denials surface as `permission_denied` system messages and in `permission_denials`.\[12\]
- **Bare mode:**
  - `--bare` skips auto-discovery of hooks, skills, plugins, MCP servers, CLAUDE.md and OAuth/keychain, so `ANTHROPIC_API_KEY` must be set.\[12\]
  - Anthropic says `--bare` "is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release".\[12\]
  - Without it, `-p` runs a repo's `.claude/settings.json` hooks and `.mcp.json` servers with no trust dialog.\[12\] That is a real risk when spawning against untrusted checkouts.
- **Lifecycle:**
  - Exit 0 on success, non-zero on failure. Auth failures print as the result on stdout.\[12\]
  - SIGTERM exits 143 and leaves the turn unfinished. Send SIGINT, or call the SDK's `interrupt()`, to end the turn cleanly first.\[12\]
  - Background work keeps `-p` alive for up to 10 minutes by default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`).\[12\]
  - Retryable API errors emit `system/api_retry` events with `error` categories such as `rate_limit` and `overloaded`.\[12\] Wire these into your backoff and observability.
  - Subagent messages carry `parent_tool_use_id`.\[12\]
- **Model:** `--model`. Bound runs with `--max-turns` and `--max-budget-usd`.\[12\]\[19\]

**SDK.** The Claude Agent SDK is available as TypeScript (`@anthropic-ai/claude-agent-sdk`) and Python (`claude-agent-sdk`).
- `query()` streams messages and accepts `cwd`, `model`, `allowedTools`, `permissionMode` and a `canUseTool` callback.\[20\]
- `PermissionMode` values: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto`.\[21\]\[22\]
- In TypeScript, `interrupt()`, `setPermissionMode()` and `setModel()` are available on the Query object.\[23\] In Python, use `ClaudeSDKClient`.\[24\]
- This is the highest-fidelity way to control Claude.

**ACP.** Adapter only. Anthropic ships no `claude acp` and no `--acp`, and the request issue anthropics/claude-code#6686 exists.\[25\]\[26\]\[27\]
- **Package:** `@agentclientprotocol/claude-agent-acp`, latest v0.100.0 (2 Nov 2026), which bundles Claude Agent SDK 0.3.316 / Claude Code 2.1.316.\[28\]
- **Launch:** `npx -y @agentclientprotocol/claude-agent-acp`. Set `CLAUDE_CODE_EXECUTABLE` to use your own `claude` binary.\[26\]\[29\]
- **Features (README):**
  - @-mentions and images\[29\]
  - Tool calls with permission requests\[29\]
  - Edit review, TODO lists and nested subagent transcripts\[29\]
  - Interactive/background terminals, exposed as a display extension rather than ACP `terminal/create`\[30\]
  - Custom slash commands and client MCP servers passed via `session/new`\[29\]\[30\]
  - `session/load`/resume
  - Modes `default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`. `bypassPermissions` is unavailable as root. The starting mode comes from the user's `defaultMode`, and issue #1489 asks to let the client choose.\[22\]\[30\]\[31\]
  - Experimental ACP v2 (since v0.95.0), selectable via `CLAUDE_AGENT_ACP_PROTOCOL`, per a third-party code review.\[28\]\[30\]
- **Auth:** ACP methods `claude-ai-login`/`console-login`. An `ANTHROPIC_API_KEY` in the environment takes priority over subscription login.\[30\]\[32\]
- **Billing caveat:** subscription use via ACP has had policy churn. Some versions returned "This integration does not support using claude.ai subscriptions", and a reported June 2026 "Agent SDK credit" pool change was paused.\[33\]\[34\] Verify before relying on Max plans for fleet use.

**Other protocol.** `claude mcp serve` runs Claude Code as a stdio MCP server and is still documented. It exposes Claude's tools rather than an agent session,\[35\]\[36\] so it is weaker than ACP for orchestration.

### Cursor CLI (`agent`, formerly `cursor-agent`)

**Headless.**
- **Invocation:** `agent -p "<prompt>"` with `--output-format text|json|stream-json`. `--stream-partial-output` streams deltas and works only with stream-json.\[37\]
- **stream-json events:** `system` (model), `assistant`, `tool_call` started/completed, and a final `result`. `thinking` events are never emitted in print mode.\[13\]\[38\]
- **JSON failures:** `json` produces no well-formed object on failure, only a non-zero exit plus stderr.\[38\]
- **Writes:** without `--force`/`--yolo`, print mode only *proposes* edits. `--trust` skips the workspace-trust prompt and works in headless mode only.\[13\]\[37\]\[38\]
- **Other flags:**
  - Resume: `--resume [chatId]`, `--continue`.\[38\] `agent create-chat` pre-allocates an ID for deterministic resume.\[39\]\[40\]
  - `--model`, `--mode plan|ask`, `--workspace <path>`.\[40\]
- **Auth:** `CURSOR_API_KEY`/`--api-key`, or `NO_OPEN_BROWSER=1 agent login` on servers.\[13\]\[41\]
- **Caveat:** a Cursor forum feature request (Oct–Nov 2026) asks for a *documented* stream-json schema, a locked-down tool allowlist and a guarantee that an explicit `--model` never falls back. Treat the event schema as unstable. The suggested workaround is to watch `tool_call` started events and kill the process tree on disallowed tools.\[42\]

**ACP (native).**
- **Launch:** `agent acp`. Transport is stdio, JSON-RPC 2.0 with newline-delimited messages, and logs go to stderr.\[7\]\[40\]
- **Flow:** `initialize` → `authenticate` with `methodId: "cursor_login"` → `session/new` or `session/load` → `session/prompt` → `session/update` notifications → `session/request_permission` (`allow-once`/`allow-always`/`reject-once`) → optional `session/cancel`.\[7\]
- **Modes:** `agent`, `plan`, `ask`.\[7\]
- **MCP:** loaded from project/user `.cursor/mcp.json`. Team-level dashboard MCP servers are **not** supported in ACP.\[7\]
- **Extension methods:** blocking `cursor/ask_question` and `cursor/create_plan`, which your client *must* answer or the agent stalls. Notifications: `cursor/update_todos`, `cursor/task` and `cursor/generate_image`.\[7\]
- **Auth:** pre-authenticate with `agent login`, `CURSOR_API_KEY` or `CURSOR_AUTH_TOKEN`.\[7\]
- **Integration gap:** an OpenAgents integration issue notes that generic ACP clients don't handle Cursor's auth step or extension methods.\[43\] Budget custom handling.

**SDK.** `@cursor/sdk` has been in public beta since 29 Apr 2026.\[44\]
- It provides `Agent.create({ local: { cwd } })` or a cloud runtime, then `agent.send()`, `run.stream()` and `run.wait()`.\[45\]
- A Python `cursor-sdk` and a language-neutral SDK Bridge (Connect/protobuf on loopback) are also available.\[5\]
- Local SDK agents run with the sandbox **off** and auto-approve tools by default. Add hooks or enable `local.sandboxOptions` before pointing them at real code.\[46\]

### OpenAI Codex CLI

**Headless.**
- **Invocation:** `codex exec "<prompt>"`. Progress goes to stderr and only the final message to stdout.\[47\] `codex exec -` forces stdin as the prompt.\[48\]
- **Events:** `--json` turns stdout into JSONL events (`thread.started` carries the thread ID, then `turn.completed`, `error` and so on).\[49\]\[50\]
- **Structured output:** `--output-schema schema.json -o out.json` for schema-validated output.\[48\]
- **Resume:** `codex exec resume --last "<prompt>"` or `resume <SESSION_ID>`. Only conversation context is preserved, so re-pass flags.\[51\]
- **Sandbox and approvals:**
  - Sandbox defaults to `read-only`. Use `--sandbox workspace-write` for edits and `danger-full-access` only in disposable containers.\[47\]\[50\]\[52\]
  - `exec` always uses `never` approvals and has no `-a` flag.\[51\]\[53\]\[54\]\[55\]
  - `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`) removes both.\[54\]
- **Version note:** OpenAI pages still describe `--full-auto` as a deprecated flag that warns, but recent builds reject it. On 0.154.0 it fails with "error: unexpected argument '--full-auto'" (PolyArch/humanize #237), and fotoetienne/gru #939 says "Codex CLI 0.156 removed the --full-auto flag from codex exec". The CodeAgentSwarm guide, checking 0.159.0 on 31 Oct 2026, found both forms fail while "--yolo and --approve-for-me are accepted." Treat it as removed.
- **Other behavior:**
  - `--model`, `-c key=value` overrides and profiles.\[56\]
  - Requires a Git repo unless you pass `skipGitRepoCheck`/`--skip-git-repo-check`.\[57\]\[58\]
  - Exits immediately if a `required` MCP server fails to start.\[50\]
  - MCP tool calls that need approval auto-cancel in exec (openai/codex#24135).\[59\]
- **Auth:** `CODEX_API_KEY` works only with `exec`. Otherwise `~/.codex/auth.json` is used; treat it like a password.\[60\]\[61\]

**App-server (the real control plane).**
- **Launch:** `codex app-server`, which speaks bidirectional JSON-RPC 2.0 (the `jsonrpc` header is omitted on the wire). Transport is stdio JSONL by default; WebSocket via `--listen ws://…` is experimental.\[62\]\[63\]
- **Primitives:**
  - Thread: `thread/start` (cwd, model, sandbox), `thread/resume`, `thread/fork`.\[11\]
  - Turn: `turn/start` (per-turn model/sandbox/approval/output-schema overrides), `turn/steer` to inject mid-turn, `turn/interrupt` to cancel.\[11\]\[64\]
  - Streamed events: `item/*`, `turn/completed`.\[11\]
  - Approvals arrive as server→client requests.
- **Status:** OpenAI describes the App Server as the protocol powering every Codex surface. Typed clients come from `codex app-server generate-ts`.\[11\]\[65\]
- **Deprecation:** OpenAI's ChatGPT & Codex changelog (24 Aug 2026) says "The codex mcp-server command is now deprecated. Use the Codex app server instead." An update dated 5 Sep 2026 says "The command and standalone codex-mcp-server binary have been removed." The deprecation warning shipped in v0.149.0 (PR #39657).
- **SDK:** `@openai/codex-sdk` (TS, Node ≥18; `startThread()`, `thread.run()`, `resumeThread(id)`, `workingDirectory`, `skipGitRepoCheck`) wraps the CLI over JSONL. The Python package is `openai-codex`.\[58\]\[66\]\[67\]

**ACP (adapter).**
- **Package:** `@agentclientprotocol/codex-acp`. The `zed-industries/codex-acp` repo says "Development has moved… built on the new Codex App Server".\[68\]
- **Launch:** `npx -y @agentclientprotocol/codex-acp`. It bundles a compatible `@openai/codex` (package.json pins `^0.160.1`; package v2.2.2); override the binary with `CODEX_PATH`.\[3\]\[69\]
- **Features:**
  - Model, reasoning-effort, approval, sandbox and permission-profile selection.\[3\]
  - Initial mode via `INITIAL_AGENT_MODE`: `read-only`, `workspace-write`, `agent` or `agent-full-access`.\[70\]
  - Slash commands such as `/review`, `/init` and `/compact`.\[68\]
  - Client MCP servers.\[68\]
  - Automatic app-server crash restart, capped by `CODEX_ACP_APP_SERVER_CRASH_LIMIT` (default 5).\[71\]
  - Subagent sessions per the draft ACP subagent RFD.\[3\]
- **Auth:** ChatGPT login, or `CODEX_API_KEY`/`OPENAI_API_KEY`.\[3\]
- **Limitation:** a thread is persisted only after its first message, so an empty session cannot be resumed after a crash.\[71\]
- **Maturity:** active. The GitHub page showed 557 stars, 201 forks and 99 open pull requests in Nov 2026. Open PRs include fixes for session-mode initialization and host-managed sandboxes.

### Google Antigravity (IDE + `agy` CLI)

The Antigravity IDE/desktop app is not a spawnable headless agent. The automation surfaces are the `agy` CLI and the Python SDK.

**Headless.**
- **Invocation:** `agy -p "<prompt>"`. The response goes to stdout and diagnostics to stderr.\[4\]
- **JSON output:** `--output-format json` produces one envelope: `conversation_id`, `status`, `response`, `error`, `duration_seconds`, `num_turns`, `usage` and, with `--json-schema`, `structured_output`.\[4\]
- **stream-json output:**
  - Emits one `init` (cwd, tools, `permission_mode`), then `step_update` events (`step_type`: `user_input`, `agent_response`, `tool`, `checkpoint`; `tool_info`, `subagent_info`), then `result`.\[4\]
  - `--input-format stream-json` keeps one process alive for many turns;\[14\] send `{"event":"user","message":{"content":"…"}}` lines. In that mode `usage`/`num_turns` are cumulative, `/model`-style slash commands end the session with exit 2, and you must close stdin to end the session.\[4\]
- **Resume:** `--continue`/`-c` or `--conversation <id>`.\[4\]
- **Model, effort, agent:** `--model` fails loudly on unknown slugs, unlike the TUI. Also `--effort` and `--agent`.\[4\]\[72\]
- **Status values:** `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING`. Exit is 0 on success and non-zero on failure.\[4\]
- **Timeout:** `--print-timeout` defaults to `0s`, meaning no limit, per the official docs.\[4\] A third-party cheat sheet says 5m; trust the docs, but set the flag explicitly.\[14\]
- **Permissions:**
  - The default mode is `request-review`, and tools needing approval are **soft-denied**: the run continues, exits 0 and prints a notice on stderr.\[4\]\[14\]
  - Grant rules in `~/.gemini/antigravity-cli/settings.json`, for example `"command(git)"` or `"write_file(src/)"`.\[4\]
  - Or pass `--dangerously-skip-permissions`, which shows as `always-proceed`. `--sandbox` enables terminal sandboxing.\[4\]
- **Known issues:**
  - google-antigravity/antigravity-cli#76: `agy` gates stdout on `isatty()`, so non-TTY callers, notably on Windows, can get empty output. Community workarounds wrap it in a PTY (agy-headless-bridge) or read the conversation store.\[73\]\[74\]\[75\]
  - Issue #223: no non-interactive auth.\[15\]
  - Policy ambiguity: a Google forum reply says launching the official `agy` binary with `--input-format stream-json --output-format stream-json --dangerously-skip-permissions` as a child process is supported. The FAQ reportedly says wrapping `agy` is unsupported on consumer plans.\[76\] Confirm terms for your plan.

**ACP (native).**
- **Launch:** `agy acp`. It speaks ACP protocol version 1 over stdio and identifies as "Antigravity ACP Server".\[77\]
- **Auth and flags:** credentials come from a cached interactive login or `agy acp --login`. `--agent` selects the agent.\[2\]\[77\]
- **Features:** the docs list permissions, sessions, model and thinking-level pickers, and rendering of tool calls, diffs and permission requests in clients such as Zed, JetBrains, Android Studio and Xcode.\[77\]
- **Not documented:** detailed capability coverage for `session/load`, MCP passthrough and fs/terminal, so probe `initialize` capabilities at runtime.
- **Maturity:** the newest of the four, arriving in v1.5.0, released 4 Nov 2026 (toolsbase.dev: "verified on v1.5.0 / 2026-11-04").

**SDK.** `google-antigravity` (Python; PyPI 0.1.23) runs a bundled Go harness over WebSockets.\[78\]\[79\] `Agent(LocalAgentConfig)` with `await agent.chat()` provides policies/hooks, MCP, subagents, structured output and workflows, authenticated via `GEMINI_API_KEY` or Vertex.\[80\]\[81\] It is good for building agents, but it is not the same as driving the user's CLI setup.

## Orchestrator guidance (running several agents in parallel)

**Concurrency.**
- Give each agent process its own git worktree or container. All four write directly to disk, and Claude's ACP adapter bypasses client fs mediation.
- Isolate per-agent state directories so parallel runs don't fight over session stores or config:
  - Claude: `~/.claude`
  - Codex: `~/.codex`
  - Cursor: `CURSOR_CONFIG_DIR`, noted as an unofficial variable in the forum\[42\]
  - Antigravity: `~/.gemini/antigravity-cli`
- Pin versions: npx-resolved adapters (`@agentclientprotocol/*`) change weekly.

**Lifecycle and cancellation.**
- Prefer protocol-level cancel before signals: ACP `session/cancel`, Codex `turn/interrupt`, the Claude SDK's `interrupt()`, or SIGINT for `claude -p`.
- Then escalate to SIGTERM and kill the process group. Claude handles SIGTERM by killing Bash subtrees,\[12\] and Antigravity reports `INTERRUPTED` on SIGINT.
- Always wrap each run in your own wall-clock timeout. Only Antigravity (`--print-timeout`) and Claude (`--max-turns`/`--max-budget-usd`) offer built-in bounds.

**Capturing events.**
- Read stdout line by line and never wait for exit first; Antigravity's stdin-streaming session never exits until stdin closes.
- Send stderr to logs. All four put diagnostics there, and codex-acp needs `APP_SERVER_LOGS`.
- Decide success from the final `result`/`turn.completed`/`status` payload and from permission-denial events, **not** from exit codes alone. Antigravity soft-denies with exit 0, and Cursor without `--force` "succeeds" without writing.

**Permissions in ACP.**
- Your client must answer every `session/request_permission` and every Cursor blocking extension call, or the agent hangs.\[7\]
- Implement a policy engine (an allowlist by tool kind and path) rather than blanket `allow-always`.

**Cost and rate limits.**
- Claude emits `total_cost_usd` (an estimate) and `system/api_retry` with `rate_limit`. Antigravity and the Codex events report token `usage`.\[4\]\[12\]
- Use per-provider concurrency semaphores, because each vendor rate-limits by account. Subscription-backed auth (Claude Max, ChatGPT, Cursor plans, Google accounts) has stricter and sometimes policy-restricted automation terms than API keys.

**ACP client libraries.** The `agentclientprotocol` GitHub org maintains official SDKs:\[82\]
- TypeScript (`@agentclientprotocol/sdk`, 2.x; Claude's adapter uses 2.4.0)\[28\]\[82\]
- Rust (`rust-sdk`)\[82\]
- Python (`python-sdk`)\[82\]
- Kotlin (`kotlin-sdk`)\[82\]

The org also maintains the public agent **registry**, which lists IDs such as `claude-acp` and `cursor`.\[1\]\[82\]

**Existing multi-agent ACP clients.**
- **acpx** (openclaw): a headless ACP CLI with persistent named sessions, prompt queues, crash reconnect and built-in aliases for codex, claude, gemini and cursor.\[83\]\[84\]
- **acp-bridge:** an HTTP API with parallel tasks and dependency chains.\[85\]
- Also Jockey, SpurCode (parallel agents across worktrees in a TUI), acp-runner (YAML workflows),\[86\] Zed, JetBrains AI Chat and Emacs agent-shell. agent-shell already has Cursor and Antigravity command presets.\[87\]

For reference, Gemini CLI was the first native ACP agent, originally via `--experimental-acp`. Its docs (`docs/cli/acp-mode.md`) now say "To start Gemini CLI in ACP mode, use the --acp flag", and `config.ts` labels `--experimental-acp` "deprecated, use --acp instead" (google-gemini/gemini-cli #29010). The CLI reference table still lists only the old flag; PR #29371 fixes that.

## Recommendations

1. **Standardize on ACP for interactive or long-lived orchestration, and implement one client with the official TypeScript or Rust SDK.** Launch commands:
   - Claude: `npx -y @agentclientprotocol/claude-agent-acp@<pinned>` with `ANTHROPIC_API_KEY`.
   - Codex: `npx -y @agentclientprotocol/codex-acp@<pinned>` with `CODEX_API_KEY` and `INITIAL_AGENT_MODE=workspace-write`.
   - Cursor: `agent acp`, after `CURSOR_API_KEY`, then `authenticate` with `cursor_login`.
   - Antigravity: `agy acp`, with credentials pre-cached on the host.

   Add per-agent shims for Cursor's `cursor/*` methods and for Claude's mode/subagent extensions. Before you write your own client, evaluate acpx as a ready-made baseline.
2. **For fire-and-forget CI jobs, skip ACP and use the native headless mode with explicit flags:**
   - `claude --bare -p … --output-format stream-json --verbose --permission-mode dontAsk --allowedTools … --max-turns N`
   - `codex exec --json --sandbox workspace-write -o result.json …`
   - `agent -p --force --trust --output-format stream-json --model <id> …`
   - `agy -p … --output-format json --print-timeout 15m`, with `permissions.allow` rules.
3. **When you need maximum fidelity, use the vendor-native control planes over ACP:**
   - Claude Agent SDK, for `canUseTool` callbacks, hooks and `setModel`.
   - Codex app-server, for fork, steer, interrupt and typed events.
   - `@cursor/sdk`, for cloud or self-hosted runs, with the sandbox enabled.
4. **Treat Antigravity as the least production-ready for unattended fleets.** Until issue #223 lands, run it only on hosts with a cached login. Use `agy acp` or stream-json via a PTY on Windows. Parse `status` and stderr soft-deny notices, and clarify plan terms before automating consumer accounts.

## Caveats

- Several details come from third-party guides rather than vendor docs and may drift:
  - the exact build that first rejected `--full-auto`
  - Antigravity's API-key provider setting
  - claude-agent-acp's mode list and auth method IDs
- The Cursor stream-json schema and storage environment variables are not formally documented.
- Antigravity's ACP capability coverage (session/load, MCP, fs/terminal) is not detailed in Google's docs. Probe the `initialize` response.
- Experimental ACP v2, served by claude-agent-acp, reportedly drops `fs/*` and `terminal/*` in favor of MCP-over-ACP.\[88\] Build against v1 now and keep the transport layer swappable.

## Sources

1. [Which Coding Agents Support ACP? — AgentRQ Blog](https://agentrq.com/blog/which-coding-agents-support-acp-agent-client-protocol)
2. [Agent Client Protocol (ACP) - Antigravity CLI](https://antigravity.google/docs/cli/acp/)
3. [GitHub - agentclientprotocol/codex-acp: ACP server implementation that exposes Codex CLI functionality for smoother client and IDE integration. · GitHub](https://github.com/agentclientprotocol/codex-acp)
4. [Headless mode - Antigravity CLI | Google Antigravity Docs](https://antigravity.google/docs/cli/headless/)
5. [The Cursor SDK: Run the Agent From Your Own Code · Learn Cursor](https://www.learncursor.dev/learn/cursor-agents/cursor-sdk)
6. [GitHub - google-antigravity/antigravity-sdk-python: A Python library for building AI agents that leverage the full power of Google Antigravity. · GitHub](https://github.com/google-antigravity/antigravity-sdk-python)
7. [ACP](https://cursor.com/docs/cli/acp)
8. [Claude Code in Zed: claude-code-acp is deprecated](https://leanzero.net/blog/claude-code-in-zed-vs-the-terminal-what-the-acp-wire-actually-carries)
9. [GitHub - hicder/agy-acp: Fork from https://github.com/openabdev/openab/tree/main/agy-acp with additional fixes · GitHub](https://github.com/hicder/agy-acp)
10. [Codex ACP CAS: an experimental Codex adapter for Zed built around codex app-server · zed-industries/zed · Discussion #52749 · GitHub](https://github.com/zed-industries/zed/discussions/52749)
11. [The Codex App-Server: Building Custom Integrations with the JSON-RPC Protocol](https://codex.danielvaughan.com/2026/03/28/codex-app-server-json-rpc-protocol/)
12. [Run Claude Code programmatically - Claude Code Docs](https://code.claude.com/docs/en/headless)
13. [Cursor CLI: install, agent commands, and headless use](https://continuumcode.ai/guides/cursor-cli/)
14. [Antigravity CLI Cheat Sheet: agy Commands and Flags](https://computingforgeeks.com/antigravity-cli-cheat-sheet/)
15. [Support non-interactive/headless authentication · Issue #223 · google-antigravity/antigravity-cli · GitHub](https://github.com/google-antigravity/antigravity-cli/issues/223)
16. [Claude Code Headless Mode in Docker, Plus Codex and OpenCode](https://camelai.com/blog/claude-code-headless-docker)
17. [Claude Code in CI/CD and Headless Automation - Running the Agent Unattended in Pipelines](https://hidekazu-konishi.com/entry/claude_code_cicd_and_headless_automation.html)
18. [Claude Code /batch vs claude -p: Parallel Changes or CI Automation - SmartScope](https://smartscope.blog/en/generative-ai/claude/claude-code-batch-processing/)
19. [The Complete Claude Code CLI Guide](https://claude-world.com/tutorials/claude-code-cli-complete-guide/)
20. [Claude Agent SDK TypeScript - Building Production AI Agents With the Full API](https://team400.ai/blog/2026-04-claude-agent-sdk-typescript-building-production-agents)
21. [Agent SDK reference - TypeScript - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/typescript)
22. [snappy-agent-host — Snappy Skills](https://skills.snappy.ai/skills/snappy-agent-host)
23. [Claude Agent SDK Complete Guide - Building Custom Agents Beyond the CLI](https://hidekazu-konishi.com/entry/claude_agent_sdk_complete_guide.html)
24. [Configure your agent - Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/configuration)
25. [claudeacp package - github.com/hollis-labs/libs/harness/core/adapters/claudeacp - Go Packages](https://pkg.go.dev/github.com/hollis-labs/libs/harness/core/adapters/claudeacp)
26. [Epic: Add Claude Code compatibility (harness via ACP adapter) · Issue #123 · Performant-Labs/holler-client · GitHub](https://github.com/Performant-Labs/holler-client/issues/123)
27. [Feature Request: Add support for Agent Client Protocol (ACP) · Issue #6686 · anthropics/claude-code · GitHub](https://github.com/anthropics/claude-code/issues/6686)
28. [Releases · agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp/releases)
29. [GitHub - agentclientprotocol/claude-agent-acp: Use Claude Agent SDK from any ACP client · GitHub](https://github.com/agentclientprotocol/claude-agent-acp)
30. [Layer 10 part 7 spec: Claude Code over ACP (claude-agent-acp), waiting for owner approval by Miguel-Shinyenyi · Pull Request #19 · Miguel-Shinyenyi/umwayi-os · GitHub](https://github.com/Miguel-Shinyenyi/umwayi-os/pull/19)
31. [Let the client choose the permission mode a new session starts in · Issue #1489 · agentclientprotocol/claude-agent-acp · GitHub](https://github.com/agentclientprotocol/claude-agent-acp/issues/1489)
32. [Added ACP agent category and Claude Agent recipe by seffs · Pull Request #2 · TeXlyre/chelys-recipes · GitHub](https://github.com/TeXlyre/chelys-recipes/pull/2)
33. [docs(agents): explain how to log in to Claude Code before using claude-agent-acp · Issue #15 · byjg/parolsh · GitHub](https://github.com/byjg/parolsh/issues/15)
34. [Claude Credit Overhaul 2026: Anthropic Pauses the June 15 Change](https://www.digitalapplied.com/blog/anthropic-claude-credit-overhaul-june-15-2026)
35. [Connect Claude Code to tools via MCP - Claude Code Docs](https://code.claude.com/docs/en/mcp)
36. [Claude Code MCP Server: Complete Setup Guide (2026)](https://www.ksred.com/claude-code-as-an-mcp-server-an-interesting-capability-worth-understanding/)
37. [Parameters](https://cursor.com/docs/cli/reference/parameters)
38. [Cursor CLI](https://docs.arantic.com/cursor/cli)
39. [Background agent handoff - Discussions - Cursor - Community Forum](https://forum.cursor.com/t/background-agent-handoff/157041)
40. [Cursor CLI Cheat Sheet & Quick Reference](https://cheatsheets.zip/cursor-cli)
41. [Cursor CLI on Linux: Install Cursor Agent on Ubuntu, Debian, Fedora (2026)](https://www.codeagentswarm.com/en/guides/cursor-cli-on-linux)
42. [Cursor CLI: a locked-down headless mode (file tools only, no hooks/MCP/plugins, enforced tool allowlist) - Feature Requests - Cursor - Community Forum](https://forum.cursor.com/t/cursor-cli-a-locked-down-headless-mode-file-tools-only-no-hooks-mcp-plugins-enforced-tool-allowlist/173496)
43. [ACP Subagents: first-class Cursor agent support (agent acp) · Issue #10984 · OpenAgentsInc/openagents · GitHub](https://github.com/OpenAgentsInc/openagents/issues/10984)
44. [Cursor turns its coding agent into a TypeScript SDK anyone can build on - Startup Fortune](https://startupfortune.com/cursor-turns-its-coding-agent-into-a-typescript-sdk-anyone-can-build-on/)
45. [Cursor SDK Tutorial: Run Coding Agents With TypeScript](https://www.datacamp.com/tutorial/cursor-sdk)
46. [What the Cursor SDK is for, and when an automation is enough](https://www.spotdev.co.uk/blog/cursor-sdk-internal-agents)
47. [Codex exec: execute Codex non-interactively in scripts and CI - DEV Community](https://dev.to/vibeidedev/codex-exec-execute-codex-non-interactively-in-scripts-and-ci-4g50)
48. [Non-interactive mode](https://developers.openai.com/codex/noninteractive)
49. [Codex CLI for CI/CD: codex exec, Non-Interactive Mode and Pipeline Integration](https://codex.danielvaughan.com/2026/03/26/codex-cli-cicd-non-interactive/)
50. [How to use codex exec](https://note.com/_soutao/n/n2d0cf14988ba?hl=en)
51. [Non-interactive mode · Codex Docs](https://docs.onlinetool.cc/codex/docs/exec.html)
52. [Codex Hooks Reference: PreToolUse, PostToolUse, hooks.json](https://agenticcontrolplane.com/blog/codex-cli-hooks-reference)
53. [Codex CLI sandbox modes: read-only, workspace-write, and when each is right](https://backgrind.com/blog/codex-cli-sandbox-modes/)
54. [Codex CLI Sandbox & Approvals (2026): Auto-Approve, Web Access — AgentsCamp](https://agentscamp.com/guides/configuration/codex-sandbox-and-approvals)
55. [Codex CLI Guide 2026: Setup, Sandbox, AGENTS.md & MCP](https://blakecrosley.com/guides/codex)
56. [Developer commands](https://developers.openai.com/codex/cli/reference)
57. [Codex CLI Headless and Batch Mode: Non-Interactive Automation Guide](https://codex.danielvaughan.com/2026/04/18/codex-cli-headless-batch-mode-automation/)
58. [codex/sdk/typescript/README.md at main · openai/codex · GitHub](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
59. [Codex Exec and MCP Approvals: Headless Without the Bypass Flag](https://agenticcontrolplane.com/blog/codex-headless-mcp-approvals)
60. [Non-interactive mode](https://dev-docs.moodybeard.com/en/codex/noninteractive/)
61. [Non-interactive mode](https://www.codex-docs.com/en/docs/non-interactive-mode)
62. [Codex App Server](https://developers.openai.com/codex/app-server)
63. [Technical Survey - Codex App Server](https://zenn.dev/suwash/articles/codex-app-server_20260514?locale=en)
64. [Codex CLI App Server: Remote Access, WebSocket Transport, and Headless Deployment](https://codex.danielvaughan.com/2026/03/31/codex-cli-app-server-remote-websocket/)
65. [The Codex App Server: A Complete Guide to the Protocol That Powers Every Surface](https://codex.danielvaughan.com/2026/04/15/codex-app-server-complete-guide/)
66. [Codex SDK](https://developers.openai.com/codex/sdk)
67. [Codex SDK Tutorial: Automate Coding Tasks in TypeScript](https://www.matthewswong.com/en/blog/codex-sdk-typescript-automation/)
68. [GitHub - zed-industries/codex-acp · GitHub](https://github.com/zed-industries/codex-acp)
69. [codex-acp/package.json at main · agentclientprotocol/codex-acp · GitHub](https://github.com/agentclientprotocol/codex-acp/blob/main/package.json)
70. [codex-acp/README.md at main · agentclientprotocol/codex-acp · GitHub](https://github.com/agentclientprotocol/codex-acp/blob/main/README.md)
71. [codex-acp/readme-dev.md at main · agentclientprotocol/codex-acp · GitHub](https://github.com/agentclientprotocol/codex-acp/blob/main/readme-dev.md)
72. [CLI commands - Antigravity CLI](https://antigravity.google/docs/cli/reference/)
73. [agy-headless: reliable non-interactive Google Antigravity CLI (agy) on Windows — closes stdin (hang fix), reads answers/errors from agy's conversation SQLite store (silent-stdout/silent-error fix). Context: google-antigravity/antigravity-cli#76 · GitHub](https://gist.github.com/allahsan/a9a9e9c8a49aecede67ce974e64ef3cf)
74. [GitHub - rhishi99/agy-headless-bridge: Call the Google Antigravity CLI (agy) headlessly from any non-TTY context — Windows ConPTY + POSIX pty + MCP server. Fixes the empty-output bug (#76). · GitHub](https://github.com/rhishi99/agy-headless-bridge)
75. [Agy Headless Bridge: Headless \`agy\` CLI Execution for Agents & CI](https://mcpmarket.com/server/agy-headless-bridge)
76. [Is external orchestration of Antigravity CLI headless mode supported with account-based usage? - Google Antigravity - Google AI Developers Forum](https://discuss.ai.google.dev/t/is-external-orchestration-of-antigravity-cli-headless-mode-supported-with-account-based-usage/183051)
77. [Other editors (ACP) - IDE Extensions | Google Antigravity Docs](https://antigravity.google/docs/ide/extensions/acp/)
78. [Google Antigravity SDK](https://pypi.org/project/google-antigravity/)
79. [Google Antigravity SDK: The developer guide - DEV Community](https://dev.to/googleai/google-antigravity-sdk-the-developer-guide-4o8m)
80. [antigravity-sdk-python/examples/getting\_started at main · google-antigravity/antigravity-sdk-python · GitHub](https://github.com/google-antigravity/antigravity-sdk-python/tree/main/examples/getting_started)
81. [Build with Google](https://antigravity.google/docs/build-with-google/)
82. [Agent Client Protocol (ACP) · GitHub](https://github.com/agentclientprotocol)
83. [ACPX Agent Communicator - Claude Code Skill for ACP](https://mcpmarket.com/tools/skills/acpx-agent-communicator)
84. [acpx by openclaw - SourcePulse](https://www.sourcepulse.org/projects/25835038)
85. [GitHub - allvegetable/acp-bridge: Multi-agent orchestrator for OpenClaw. Manages coding agents (Codex, Claude, Gemini, OpenCode) via Agent Client Protocol (ACP) with parallel tasks, dependency chains, and diagnostics. · GitHub](https://github.com/allvegetable/acp-bridge)
86. [Clients - Agent Client Protocol](https://agentclientprotocol.com/get-started/clients)
87. [GitHub - xenodium/agent-shell: Brings your favorite AI agents to Emacs, keeping you at home: familiar buffers and bindings, no terminal emulation. Powered by ACP. · GitHub](https://github.com/xenodium/agent-shell)
88. [ACP-3: serve fs/read\_text\_file + fs/write\_text\_file through buffers (and fix the closed-file write hole) · Issue #954 · JDonaghy/vimcode · GitHub](https://github.com/JDonaghy/vimcode/issues/954)
