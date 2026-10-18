---
type: Lessons Learned
title: Lessons Learned — synthet-agent-swarm
description: Agent capability matrix, Windows PATH/MCP-reload gotcha, and review-only safety conventions for the external-CLI orchestrator.
resource: docs/LESSONS_LEARNED.md
tags: [lessons, agent, mcp, codex, antigravity, okf]
timestamp: 2026-06-16T00:00:00Z
okf_version: 0.1
---

# Lessons Learned — synthet-agent-swarm

Distilled from agent session history (Claude Code + Cursor). This MCP server
detects and runs external CLI sub-agents (Codex, Antigravity, Claude) for
**review-only** work.

## Agent capability matrix (v0.1)
Detection reported three agents, but they are **not** equally runnable:

| Agent  | Mode      | Runnable | Notes |
|--------|-----------|----------|-------|
| codex  | `exec`    | Yes      | codex-cli (e.g. 0.134.0) |
| antigravity | `prompt`  | Yes      | Antigravity CLI (`agy`) |
| claude | `print`   | **No**   | **detection-only** in v0.1 |

**Why claude is read-only:** in v0.1 the Claude CLI is wired for *detection*
only — it's recognized and version-probed but not driven as an executing
sub-agent. Codex (`exec`) and Antigravity (`prompt`) are the review workhorses. Don't
assume "detected" means "runnable"; check the mode/runnable column.

ACP support for these CLIs is recorded in [acp-harness-matrix.md](acp-harness-matrix.md). v0.1 still runs Codex through `exec` and Antigravity through print mode.

## Windows PATH fix is required for MCP detection
Sub-agent detection over MCP depends on a **Windows PATH fix** so the CLIs are
discoverable from the MCP server's environment. Without it, otherwise-installed
CLIs won't be detected. The fix is live over MCP — after building/installing it,
**reload each project's MCP** (e.g. image-scoring-pipeline has a separate MCP
entry) so every project picks up the same build. A stale MCP process keeps the
old PATH and won't see the agents.

## Review-only safety conventions (Cursor-mined)
- Runs are **review-only**: Codex/Antigravity via MCP `run_subagent` with
  `allowWrites: false`. The orchestrator is for second opinions, not edits.
- Outputs land in the **consumer repo's `.agent-runs/`** (gitignored).
- **Never pass secrets, `secrets.json`, or a full `config.json`** in task
  payloads.
- Integration: Cursor user MCP `synthet-agent-swarm`, or a project `cli-review`
  key.

## Usage
Drive live reviews with `/check-subagents`, `/run-codex-review`,
`/run-antigravity-review`, or `/run-subagent-review` (panel/tie-breaker). See backend
[`docs/technical/EXTERNAL_CLI_REVIEWS.md`](https://github.com/synthet/image-scoring-pipeline/blob/main/docs/technical/EXTERNAL_CLI_REVIEWS.md).
