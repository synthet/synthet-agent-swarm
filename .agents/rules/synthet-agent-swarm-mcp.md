---
paths: ["agent-orchestrator/**"]
---

# synthet-agent-swarm package

When changing [agent-orchestrator/](agent-orchestrator/):

- Keep **review-only** defaults: `allowWrites: false`, Codex `read-only` sandbox, no bypass flags.
- Do not use `shell: true` in `commandRunner` without documented justification.
- MCP tools: `swarm_search`, `swarm_run`, `run_judge_panel`, plus aliases `detect_subagents`, `run_subagent`, `run_judge_swarm`. Update [docs/api.md](../../docs/api.md) and [`.claude/skills/subagent-review/references/mcp-tools.md`](../skills/subagent-review/references/mcp-tools.md) if schemas change.
- Run `npm run build` and `npm test` before finishing.
- After MCP surface changes, remind user to reload MCP in Cursor.

## Cursor UX files

If tool names or parameters change, update in sync:

- `.cursor/skills/subagent-review/SKILL.md`
- `.cursor/commands/*.md`
- `.cursor/agents/*.md`
- [AGENTS.md](../../AGENTS.md)
