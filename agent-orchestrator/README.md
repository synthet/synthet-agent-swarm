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

- `detect_subagents` — no arguments; returns JSON availability
- `run_subagent` — one judge. `mode` `review` (default) or `judge`. `allowWrites` must stay `false`
- `run_judge_swarm` — `{ "task": "...", "files": ["blind/a.jpg"], "agents": ["codex", "antigravity"], "dryRun": true }`
- `run_judge_panel` — `{ "task": "...", "items": [{ "id": "a", "files": ["blind/a.jpg"] }], "dryRun": true }`

**Cursor workflow:** skill [`.cursor/skills/subagent-review`](../.cursor/skills/subagent-review/SKILL.md), slash commands in [`.cursor/commands/`](../.cursor/commands/), index [AGENTS.md](../AGENTS.md).

Start MCP stdio mode explicitly:

```bash
npm start
# or: node dist/index.js mcp
```

## Tools behavior

| Tool | Description |
|------|-------------|
| `detect_subagents` | Probes `codex`, `antigravity`, `claude` with timeouts; never fails entirely if one is missing |
| `run_subagent` | Builds bounded prompt (git status/diff, file excerpts), runs CLI, saves under `.agent-runs/` |
| `run_judge_panel` | Manifest workflow: blind swarm, votes, text-only Jev state, optional human comparison. Does not call Jev or mutate files |

### `run_subagent` parameters

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `agent` | `codex` \| `antigravity` \| `claude` | required | Claude runs when detection reports print mode |
| `task` | string | required | Max 8000 chars |
| `files` | string[] | optional | Workspace-relative; secrets/binaries rejected |
| `mode` | enum | `review` | `judge` skips git context and allows image evidence |
| `timeoutMs` | number | 300000 | Clamped to `maxTimeoutMs` (900000) |
| `allowWrites` | boolean | `false` | **Rejected in v0.1** |
| `dryRun` | boolean | `false` | Returns command preview only |
| `extraContext` | string | optional | Max 4000 chars |

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
- Codex runs with `exec --sandbox read-only --ask-for-approval never` — no bypass/sandbox-disable flags.
- Antigravity runs in non-interactive prompt mode (`agy -p` / `--prompt` / `--print`) only — no permission-skip flags.
- `.env`, keys, and binary files are excluded from prompts.

## Output storage

Each run creates:

```text
.agent-runs/YYYYMMDD-HHMMSS-<agent>-<slug>/
  request.json
  stdout.md
  stderr.log
  result.json
  prompt.md          # only if storePrompts: true
```

## Known limitations (v0.1)

- Claude runs only when detection reports non-interactive print mode
- `allowWrites=true` and implement mode not enabled
- `run_judge_swarm` agrees string fields in the last JSON object. It does not render images, call Jev, or grade domain rubrics
- Cursor and Gemini judges are not wired
- Code-review panels still compare separate `run_subagent` replies by hand
- CLI flags vary by installed version; see `notes` in `detect_subagents` output

## Tests

```bash
npm test
```

Uses mocked `spawn` — no real CLIs required in CI.

## Next steps

1. Claude `claude -p` with `--permission-mode dontAsk` behind a feature flag
2. Cursor and Gemini judge runners, matching the image-scoring panels
3. Optional Jev handoff that stays outside this process
