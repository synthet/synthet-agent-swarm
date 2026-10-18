---
name: subagent-review
description: Runs detect_subagents then run_subagent (codex/antigravity) in review mode via synthet-agent-swarm MCP, reads .agent-runs outputs, and summarizes findings. Use when the user asks for external CLI review, codex/antigravity review, subagent panel, tie-breaker, or invokes /check-subagents, /run-codex-review, /run-antigravity-review, /run-subagent-review.
---

# Subagent review (MCP)

Run external CLI coding agents **through the synthet-agent-swarm MCP server** - not by spawning `codex` / `agy` / `claude` directly in the terminal.

## Prerequisites

- `agent-orchestrator` built (`npm run build` in `agent-orchestrator/`)
- MCP server `synthet-agent-swarm` enabled and reloaded in Cursor

## Step 1 - Resolve MCP server

Before `CallMcpTool`, find the enabled server where `serverName` is `synthet-agent-swarm` (identifiers often `user-synthet-agent-swarm` or `project-0-synthet-agent-swarm-synthet-agent-swarm`). Read tool schemas from `mcps/*/tools/detect_subagents.json` and `run_subagent.json`.

## Step 2 - Detect

Call **`detect_subagents`** (no arguments). Present a short table:

| Agent | Available | Mode | Notes |
|-------|-----------|------|-------|

Note: **Claude** is detection-only in v0.1 - do not rely on it for live `run_subagent`.

## Step 3 - Build request

- **task** - clear review goal (from user or slash command text)
- **files** - workspace-relative paths from `@` mentions (max 20; no `.env`, keys, binaries)
- **mode** - `review` (default) or `tie-breaker` when comparing opinions
- **allowWrites** - always `false`
- **dryRun** - `true` when user says "dry run" or you are validating setup

## Step 4 - Run

Call **`run_subagent`** with JSON per [references/mcp-tools.md](references/mcp-tools.md).

For a "panel" (user wants both agents): run **sequentially** - codex then antigravity (or vice versa) with the same `task` and `files`. There is no `run_subagent_panel` tool in v0.1.

## Step 5 - Read results

1. Parse MCP response (`outputFile`, `summary`, `ok`, `error`).
2. Read `.agent-runs/.../stdout.md` at the returned path.
3. Summarize for the user:

```markdown
## External review summary

### Verdict
### Findings (blocker | high | medium | low | nit)
### Suggested changes
### Agent agreement (if multiple runs)
### Next steps
```

Do **not** apply patches unless the user explicitly asks.

## Errors

| Situation | Action |
|-----------|--------|
| Agent not on PATH | Report `detect_subagents` notes; suggest install/auth |
| `allowWrites` rejected | Explain v0.1 is review-only |
| Claude run requested | Use Codex or Antigravity instead |
| MCP server missing | Point to `AGENTS.md` and `npm run build` |

## Related

- Rule: `external-cli-subagents.mdc`
- Commands: `/check-subagents`, `/run-codex-review`, `/run-antigravity-review`, `/run-subagent-review`
- Package docs: [agent-orchestrator/README.md](../../../agent-orchestrator/README.md)
