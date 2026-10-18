---
trigger: always_on
description: "Use synthet-agent-swarm MCP for external CLI reviews; review-only, no secrets, no raw codex/antigravity shell by default."
---

# External CLI sub-agents

External CLI agents (Codex, Antigravity, Claude) are **review and tie-breaker** tools. **Cursor remains the primary editor.**

## How to invoke

- Use MCP server **synthet-agent-swarm** tools only:
  - `detect_subagents` - check availability first
  - `run_judge_swarm` - same task on each judge
  - `run_judge_panel` - manifest workflow: swarm, votes, text-only Jev state, optional human comparison. Does not call Jev
  - `run_subagent` - one judge (`mode: "judge"` or `"review"`)
- Server identifier for `CallMcpTool` may be `user-synthet-agent-swarm` or `project-0-synthet-agent-swarm-synthet-agent-swarm`; confirm via enabled MCP / `SERVER_METADATA.json` (`serverName`: `synthet-agent-swarm`).
- Read tool schemas under `mcps/*/tools/` before calling.

## Do not

- Run `codex exec`, `agy -p`, or `claude -p` in the integrated terminal **unless the user explicitly asks to bypass the orchestrator**.
- Set `allowWrites: true` on `run_subagent` (rejected in v0.1).
- Pass API keys, tokens, or `.env` content in `task` or `extraContext`.
- Auto-apply patches from external agent output without user approval.

## Workflow

1. `detect_subagents` before the first live run in a session.
2. Prefer `dryRun: true` when validating setup.
3. `run_subagent` with `mode: "review"`, `allowWrites: false`, workspace-relative `files`.
4. Read `outputFile` under `.agent-runs/`; summarize with severity (blocker | high | medium | low | nit).

## Claude

Claude may appear in detection but **execution is stubbed in v0.1** - use Codex or Antigravity for live reviews.

## Related

- Skill: `subagent-review`
- Commands: `/check-subagents`, `/run-codex-review`, `/run-antigravity-review`, `/run-subagent-review`
- Index: [AGENTS.md](../../AGENTS.md)
