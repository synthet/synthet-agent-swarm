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
| `mode` | `review` \| `implement` \| `explain` \| `test` \| `tie-breaker` \| `judge` | no | `review` | `judge` omits git context and allows image evidence |
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

## run_judge_swarm

Same read-only task on each judge, in parallel. Default agents are the configured allow-list (`codex`, `antigravity`, `claude`).

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `task` | string | yes | - | Max 8000 chars. Ask for exact JSON if you want agreement |
| `files` | string[] | no | - | Workspace-relative evidence. Images allowed. Max 20 |
| `agents` | array | no | all allowed | `codex`, `antigravity`, `claude` |
| `timeoutMs` | number | no | 300000 | Per judge |
| `dryRun` | boolean | no | `false` | Command preview only. No votes |
| `extraContext` | string | no | - | Max 4000 chars. Do not put labels the judges must not see |

Agreement reads the last JSON object in each reply. An `images` array is one item per row. A field agrees only when at least two judges share a strict majority. The response `note` states that the panel is not ground truth. The tool does not consult an external quota dashboard.

## run_judge_panel

Judge-panel workflow for a frozen manifest. Stages are `build`, `run`, `votes`, `jev`, `analyze`, and `rules`. `build` checks the manifest. `run` is the read-only swarm. `votes` is strict-majority agreement. `jev.called` is always false: the state is text for the calling project to send to `jev_system_one` after a dry-run. `analyze` compares agreed fields with `humanLabels` when those labels are present, and does not overwrite them. `rules.applied` is always false. This tool does not render images, call Jev, or mutate files. Cursor is not one of the judges.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `task` | string | yes | - | Max 8000 chars. The tool appends the item ids and a JSON output contract |
| `items` | `{ id, files }[]` | yes | - | 1–20 items. Ids are unique. At most 20 evidence files in total |
| `agents` | array | no | all allowed | `codex`, `antigravity`, `claude` |
| `timeoutMs` | number | no | 300000 | Per judge |
| `dryRun` | boolean | no | `false` | Command preview only. No votes |
| `blind` | boolean | no | `true` | Blind panels reject `extraContext` and omit evidence paths from the prompt text |
| `extraContext` | string | no | - | Informed panels only. Max 4000 chars |
| `rubric` | string | no | - | Stored on the build stage. Not sent to judges. Max 200 chars |
| `humanLabels` | object | no | - | `item id` → field → label. Used only in `analyze` |

```json
{
  "task": "Choose A or B for each item.",
  "items": [{ "id": "a", "files": ["blind/a.jpg"] }],
  "dryRun": true
}
```

```json
{
  "task": "Return only JSON {\"images\":[{\"id\":\"a\",\"choice\":\"A|B\"}]}",
  "files": ["blind/a.jpg"],
  "agents": ["codex", "antigravity"],
  "dryRun": true
}
```

## On-disk artifacts

```text
.agent-runs/YYYYMMDD-HHMMSS-<agent>-<slug>/
  request.json
  stdout.md
  stderr.log
  result.json

.agent-runs/YYYYMMDD-HHMMSS-swarm-<slug>/
  swarm.json

.agent-runs/YYYYMMDD-HHMMSS-panel-<slug>/
  panel.json
```
