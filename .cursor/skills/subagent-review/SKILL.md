---
name: subagent-review
description: Runs detect_subagents, run_judge_swarm, run_judge_panel, or run_subagent via synthet-agent-swarm MCP. Use for a blind LLM judge swarm, a manifest judge panel, external CLI review, codex/antigravity review, tie-breaker, or /check-subagents, /run-codex-review, /run-antigravity-review, /run-subagent-review.
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

Note: include Claude only when `detect_subagents` reports non-interactive print mode.

## Step 3 - Build request

- **task** - clear review goal (from user or slash command text)
- **files** - workspace-relative paths from `@` mentions (max 20; no `.env` or keys). Code review still rejects images. A judge swarm may include png, jpg, jpeg, gif, and webp evidence.
- **mode** - `review` (default) or `tie-breaker` when comparing opinions
- **allowWrites** - always `false`
- **dryRun** - `true` when user says "dry run" or you are validating setup

## Step 4 - Run

Call **`run_subagent`** with JSON per [references/mcp-tools.md](references/mcp-tools.md).

For a blind judgement swarm, call **`run_judge_swarm`** once with the same `task` and evidence `files`. Agreement is not ground truth. See [docs/judges-swarm.md](../../../docs/judges-swarm.md).

For a frozen manifest of item ids and evidence files, call **`run_judge_panel`**. It runs the swarm, returns votes, a text-only Jev state, and an optional comparison with human labels. It does not call Jev or change files. Pass `dryRun: true` before a live panel.

For a code-review panel, run **`run_subagent`** sequentially (codex, then antigravity) with `mode: "review"`.

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
| Claude print mode missing | Use Codex or Antigravity |
| MCP server missing | Point to `AGENTS.md` and `npm run build` |

## Related

- Rule: `external-cli-subagents.mdc`
- Commands: `/check-subagents`, `/run-codex-review`, `/run-antigravity-review`, `/run-subagent-review`
- Package docs: [agent-orchestrator/README.md](../../../agent-orchestrator/README.md)
