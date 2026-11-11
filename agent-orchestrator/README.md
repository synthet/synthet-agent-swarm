# synthet-agent-swarm

Local swarm of read-only LLM CLI judges (Codex, Antigravity, Claude) for Cursor, via MCP.

The calling project renders blind evidence and, when it wants a paid adjudicator, calls Jev itself. This package fans the judgement out, stores raw replies, and reports agreement. It does not depend on the ai-quotas dashboard. See [docs/judges-swarm.md](../docs/judges-swarm.md).

## Install

```bash
cd agent-orchestrator
npm install
npm run build
```

## CLI

```bash
# Detect codex / antigravity / claude on PATH
npm run detect

# One judge. mode=review is a code review; mode=judge is one blind vote.
node dist/index.js run --agent antigravity --task "Review src/index.ts for error handling" --files src/index.ts --dry-run

# Same task on every allowed judge.
node dist/index.js swarm --task "Return only JSON for the listed images" --files blind/a.jpg --dry-run
```

## MCP server (Cursor)

After `npm run build`, configure Cursor MCP (project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "synthet-agent-swarm": {
      "command": "node",
      "args": ["agent-orchestrator/dist/index.js"],
      "env": {
        "WORKSPACE_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Reload MCP in Cursor, then use tools:

- `swarm_search` — optional `{ "query": "cursor" }`. Returns short harness rows
- `swarm_run` — `{ "task": "...", "files": ["blind/a.jpg"], "harnesses": ["codex", "agy"], "dryRun": true }`
- `swarm_panel` — `{ "task": "...", "items": [{ "id": "a", "files": ["blind/a.jpg"] }], "dryRun": true }`
- `swarm_decide`, `swarm_choice`, `swarm_score`, `swarm_noul`, `swarm_system_one` — typed text questions on a local harness. Not the paid Jev service

**Cursor workflow:** skill [`.cursor/skills/subagent-review`](../.cursor/skills/subagent-review/SKILL.md), slash commands in [`.cursor/commands/`](../.cursor/commands/), index [AGENTS.md](../AGENTS.md).

Start MCP stdio mode explicitly:

```bash
npm start
# or: node dist/index.js mcp
```

## Tools behavior

| Tool | Description |
|------|-------------|
| `swarm_search` | Lists harnesses with the transports detection found |
| `swarm_run` | Runs one read-only task. Omit `harnesses` for every available harness |
| `swarm_sessions` | In-flight runs, stored results, and live Claude sessions |
| `swarm_panel` | Manifest workflow: blind swarm, votes, text-only Jev state. Does not call Jev or mutate files |
| `swarm_decide` | Batch of noul, choice, and score questions. Looser criteria shape |
| `swarm_choice` | One choice. Criteria is an object |
| `swarm_score` | One score. Criteria is an ordered list |
| `swarm_noul` | One yes/no probability |
| `swarm_system_one` | Several of those three questions on one state |

Field shapes are in [docs/api.md](../docs/api.md). The CLI `run` and `swarm` commands remain for a terminal. MCP no longer registers `detect_subagents`, `run_subagent`, or `run_judge_swarm`.

## Configuration

Defaults: `config.default.json`. Override per workspace with `.agent-orchestrator.json`:

```json
{
  "defaultTimeoutMs": 300000,
  "maxTimeoutMs": 900000,
  "allowWritesByDefault": false,
  "storePrompts": false
}
```

## Security

- **Do not** send proprietary code to external CLIs unless you accept their data policies.
- Credentials are **not** injected by this package; CLIs use your existing login (`codex`, `agy`, `claude` auth).
- Child processes receive a **whitelist** env subset only (PATH, locale, provider API keys if already set).
- Logs and `.agent-runs/` are **redacted** for common token patterns.
- Codex runs with `--ask-for-approval never exec --sandbox read-only` — no bypass/sandbox-disable flags.
- Antigravity runs in non-interactive prompt mode (`agy -p` / `--prompt` / `--print`) only — no permission-skip flags.
- `.env`, keys, and binary files are excluded from prompts.

## Output storage

Each run creates:

```text
.agent-runs/YYYYMMDD-HHMMSS-<agent>-<slug>-<unique>/
  request.json
  stdout.md
  stderr.log
  result.json
  prompt.md          # only if storePrompts: true
```

## Known limitations (v0.1)

- A harness runs its one-shot CLI only when help shows exec or print mode. Cursor and Grok otherwise use ACP when that command is already on PATH
- `allowWrites=true` is rejected. ACP permission requests are denied
- Agreement uses string fields in the last JSON object. The server does not render images, call Jev, or grade domain rubrics
- A requested `model` fails the whole call when any selected harness does not advertise `--model`
- CLI flags vary by installed version; see `notes` from `swarm_search`
- Standard npm Node shims launch without CMD on Windows. Rich prompts through unsupported custom batch launchers are rejected; use a native executable or an advertised ACP transport
- Evidence and artifact roots are checked through filesystem links. Provider permissions still govern later reads and tool activity

## Tests

```bash
npm test
```

Uses mocked `spawn` — no real CLIs required in CI.

## Next steps

1. Claude `claude -p` with `--permission-mode dontAsk` behind a feature flag
2. Cursor and Gemini judge runners, matching the image-scoring panels
3. Optional Jev handoff that stays outside this process
