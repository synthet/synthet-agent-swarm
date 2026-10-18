# Transcript mining review — subagent-orchestrator

**Tier:** B · **Chats routed:** 9

## Top sessions (by relevance)

| UUID | Relevance | Themes | Summary |
|------|-----------|--------|---------|
| `2fe8db40` | 0.90 | wsl_env, mcp, gallery_ipc, db_postgres | @image-scoring-gallery/.cursor/mcp.json @image-scoring-backend/.cursor/mcp.json  |
| `60686407` | 0.90 | wsl_env, mcp, gallery_ipc, db_postgres | @image-scoring-backend/.cursor/mcp.json does any of the mcp tools allow remote c |
| `b54bc7ee` | 0.83 | gallery_ipc, db_postgres, pipeline, release | add .cursor/, .claude/, agents.md, calude.md, etc setup similar to D:\Projects\i |
| `65abf8da` | 0.71 | gallery_ipc, db_postgres, pipeline | code review codex://threads/019e7eb4-902d-7d21-b984-a644eff09e11 |
| `80a1fe60` | 0.71 | wsl_env, pytest, pipeline | review logs, auditlog, DB rceods; searhc for anomalies, errors, exceptions, warn |
| `0d02678e` | 0.66 | wsl_env, db_postgres, pipeline | # Cursor Prompt: Add External CLI Sub-Agents to Cursor Workflow

You are working |
| `08c1fcc6` | 0.64 | wiki_okf, pipeline | @d:\Projects\subagent-orchestrator onboard this tool, add skills/slash commands/ |
| `f970f41c` | 0.64 | gallery_ipc, pipeline | @.cursor/mcp.json make video-gallery own MCPs |
| `fb2dfce4` | 0.59 | wsl_env, pipeline | /image-scoring-backend/check-subagents 

Running sub-agent detection via the sub |

## Proposed memory candidates

### `2fe8db40` — @image-scoring-gallery/.cursor/mcp.json @image-scoring-backe

- **working_rule** (high): Python app/scripts importing modules should run in WSL with ~/.venvs/tf unless documented otherwise. _(chat 2fe8db40)_

### `60686407` — @image-scoring-backend/.cursor/mcp.json does any of the mcp 


### `b54bc7ee` — add .cursor/, .claude/, agents.md, calude.md, etc setup simi

- **successful_pattern** (low): Session outcome pattern: The background cleanup finished successfully: **`driftara-video-backend`** references were corrected back to **`image-scoring-backend`**, and the gallery MCP debug agent files were removed. _(chat b54bc7ee)_

### `65abf8da` — code review codex://threads/019e7eb4-902d-7d21-b984-a644eff0

- **successful_pattern** (low): Session outcome pattern: ## Code review: gallery sub-stack support _(chat 65abf8da)_

### `0d02678e` — # Cursor Prompt: Add External CLI Sub-Agents to Cursor Workf

- **successful_pattern** (low): Session outcome pattern: All Cursor MCP guidance from the plan is in place. Here is what was added: _(chat 0d02678e)_

### `08c1fcc6` — @d:\Projects\subagent-orchestrator onboard this tool, add sk

- **successful_pattern** (medium): Doc changes should go through OKF wiki ingest and append docs/log.md. _(chat 08c1fcc6)_

### `f970f41c` — @.cursor/mcp.json make video-gallery own MCPs

- **successful_pattern** (low): Session outcome pattern: The **mcp-server** setup finished successfully: dependencies installed, TypeScript built, and the live-server smoke test passed (`video-gallery-live` on a dynamic port, `/mcp-status` OK). _(chat f970f41c)_

### `fb2dfce4` — /image-scoring-backend/check-subagents 

Running sub-agent d

- **successful_pattern** (low): Session outcome pattern: That background command was stopped before it finished. It had started `node dist/index.js` (the MCP server), which blocks the terminal, so the combined detect script never completed. _(chat fb2dfce4)_

