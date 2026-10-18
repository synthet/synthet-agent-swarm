# AGENTS.md - synthet-agent-swarm

This repository is a **local MCP swarm of read-only LLM judges** (Codex, Antigravity, Claude). One shared judgement is fanned out, raw replies are stored, and strict-majority agreement is reported. Ties stay disputed. Votes are not ground truth.

Code review remains available as `mode: "review"`. The image-scoring usage this follows is [docs/judges-swarm.md](docs/judges-swarm.md). Claude live execution still depends on detection reporting a non-interactive print mode.

## Prerequisites

1. Build the server: `cd agent-orchestrator && npm install && npm run build`
2. Enable MCP: project [`.cursor/mcp.json`](.cursor/mcp.json) and/or global `~/.cursor/mcp.json` with `synthet-agent-swarm`
3. Reload MCP in Cursor (Settings -> Tools & MCP)

MCP tools: `detect_subagents`, `run_subagent`, `run_judge_swarm`, `run_judge_panel` - see [agent-orchestrator/README.md](agent-orchestrator/README.md).

## Cursor integration map

| Type | Location | Purpose |
|------|----------|---------|
| Rules | [`.cursor/rules/`](.cursor/rules/) | Safety defaults and package maintainer notes |
| Skills | [`.cursor/skills/subagent-review/`](.cursor/skills/subagent-review/) | End-to-end MCP review workflow |
| Commands | [`.cursor/commands/`](.cursor/commands/) | Slash shortcuts (`/check-subagents`, etc.) |
| Subagents | [`.cursor/agents/`](.cursor/agents/) | Delegated external CLI reviewers |

## Slash commands

| Command | When to use |
|---------|-------------|
| [`/check-subagents`](.cursor/commands/check-subagents.md) | See which CLIs are on PATH before running reviews |
| [`/run-codex-review`](.cursor/commands/run-codex-review.md) | Delegate a review task to Codex via MCP |
| [`/run-antigravity-review`](.cursor/commands/run-antigravity-review.md) | Delegate a review task to Antigravity via MCP |
| [`/run-subagent-review`](.cursor/commands/run-subagent-review.md) | Code review on one agent, or Codex and Antigravity sequentially |

Blind multi-judge labelling uses MCP `run_judge_swarm`, not the review slash commands.

## Subagents

| Name | File | Role |
|------|------|------|
| `external-codex-review` | [`.cursor/agents/external-codex-review.md`](.cursor/agents/external-codex-review.md) | Codex-only review via MCP |
| `external-antigravity-review` | [`.cursor/agents/external-antigravity-review.md`](.cursor/agents/external-antigravity-review.md) | Antigravity-only review via MCP |
| `external-cli-reviewer` | [`.cursor/agents/external-cli-reviewer.md`](.cursor/agents/external-cli-reviewer.md) | Detect -> run -> compare available agents |

## Default behavior

- **Read-only** - `allowWrites: false`; do not bypass the orchestrator with raw `codex`/`agy` shell unless the user explicitly asks.
- **Swarm** - `run_judge_swarm` for one shared judgement. Agreement is evidence for a later decision.
- **Outputs** - `.agent-runs/<timestamp>-<agent>-<slug>/stdout.md` and `.agent-runs/<timestamp>-swarm-<slug>/swarm.json`
- **Claude** - included when detection reports non-interactive print mode.

## Authority

- Safety rule: [`.cursor/rules/external-cli-subagents.mdc`](.cursor/rules/external-cli-subagents.mdc) (always apply)
- Workflow skill: [`subagent-review`](.cursor/skills/subagent-review/SKILL.md)

<!-- BEGIN FRAMEWORK SETUP -->

## Shared agent setup

Project-specific instructions in this file and nested instruction files govern this workspace.
Reusable skills are authored in `.claude/skills/`; other harness trees are generated.
Run installed helpers relative to their skill directory; run project checks from this workspace.
Preserve user edits, credentials, model settings, permissions and unrelated configuration.
Project build/test/lint commands were not detected; consult project documentation before executing checks.

Installed library: 42 applicable skills. Synchronize explicitly; startup hooks never install updates.
<!-- END FRAMEWORK SETUP -->

<!-- FRAMEWORK RULE REFERENCES -->
Read the always-on project rules before working:
- `.claude/rules/external-cli-subagents.md`
- `.claude/rules/karpathy-coding.md`
- `.claude/rules/safety-and-secrets.md`
- `.claude/rules/sdlc-core.md`
<!-- END FRAMEWORK RULE REFERENCES -->
