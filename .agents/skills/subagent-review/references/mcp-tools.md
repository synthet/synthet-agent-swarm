# MCP tool reference - synthet-agent-swarm

Server display name: **synthet-agent-swarm**

## detect_subagents

No parameters.

**Example response (shape):**

```json
{
  "agents": {
    "codex": {
      "available": true,
      "command": "codex",
      "mode": "exec",
      "version": "...",
      "notes": []
    },
    "antigravity": {
      "available": true,
      "command": "agy",
      "mode": "prompt",
      "version": "...",
      "notes": []
    },
    "claude": {
      "available": true,
      "command": "claude",
      "mode": "print",
      "version": "...",
      "notes": []
    }
  },
  "detectedAt": "2026-05-27T..."
}
```

## run_subagent

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `agent` | `"codex"` \| `"antigravity"` \| `"claude"` | yes | - | Prefer codex/antigravity for live runs |
| `task` | string | yes | - | Max 8000 chars |
| `files` | string[] | no | - | Workspace-relative; max 20 |
| `mode` | `review` \| `implement` \| `explain` \| `test` \| `tie-breaker` | no | `review` | |
| `timeoutMs` | number | no | 300000 | Max 900000 |
| `allowWrites` | boolean | no | `false` | **Rejected in v0.1** |
| `dryRun` | boolean | no | `false` | Command preview only |
| `extraContext` | string | no | - | Max 4000 chars |

**Example - dry run:**

```json
{
  "agent": "codex",
  "task": "Review agent-orchestrator/src/index.ts for MCP tool registration errors",
  "files": ["agent-orchestrator/src/index.ts"],
  "mode": "review",
  "allowWrites": false,
  "dryRun": true
}
```

**Example - live review:**

```json
{
  "agent": "antigravity",
  "task": "Review the scoring schema refactor and list migration risks",
  "files": ["modules/db.py", "alembic/"],
  "mode": "review",
  "allowWrites": false
}
```

**Example response (shape):**

```json
{
  "ok": true,
  "agent": "codex",
  "exitCode": 0,
  "durationMs": 18422,
  "outputFile": ".agent-runs/20260526-203012-codex-review-api/stdout.md",
  "outputDir": ".agent-runs/20260526-203012-codex-review-api",
  "summary": "...",
  "commandPreview": "codex exec --sandbox read-only ..."
}
```

## On-disk artifacts

```text
.agent-runs/YYYYMMDD-HHMMSS-<agent>-<slug>/
  request.json
  stdout.md
  stderr.log
  result.json
```
