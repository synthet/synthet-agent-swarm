# AGENTS.md - synthet-agent-swarm

This repository is a **local MCP swarm of read-only LLM judges**. Harnesses are `codex`, `claude`, `agy` (Antigravity), `cursor` (`agent`), `gemini`, and `grok`. One shared judgement is fanned out, raw replies are stored, and strict-majority agreement is reported when two or more harnesses run. Ties stay disputed. Votes are not ground truth.

Code review remains available as `mode: "review"`. The image-scoring usage this follows is [docs/judges-swarm.md](docs/judges-swarm.md). The tool contract is [docs/api.md](docs/api.md).

## Prerequisites

1. Build the server: `cd agent-orchestrator && npm install && npm run build`
2. Enable MCP: project [`.cursor/mcp.json`](.cursor/mcp.json) and/or global `~/.cursor/mcp.json` with `synthet-agent-swarm`
3. Reload MCP in Cursor (Settings -> Tools & MCP)

MCP tools: `swarm_search`, `swarm_run`, `run_judge_panel`. Aliases `detect_subagents`, `run_subagent`, and `run_judge_swarm` keep the previous JSON shape. See [docs/api.md](docs/api.md).

## Cursor integration map

| Type | Location | Purpose |
|------|----------|---------|
| Rules | [`.cursor/rules/`](.cursor/rules/) | Safety defaults and package maintainer notes |
| Skills | [`.cursor/skills/subagent-review/`](.cursor/skills/subagent-review/) | End-to-end MCP review workflow |
| Commands | [`.cursor/commands/swarm.md`](.cursor/commands/swarm.md) | `/swarm` searches harnesses, then runs |
| Subagents | [`.cursor/agents/external-swarm.md`](.cursor/agents/external-swarm.md) | One delegated reviewer for every harness |

## Slash command

| Command | When to use |
|---------|-------------|
| [`/swarm`](.cursor/commands/swarm.md) | Search harnesses, then run a review, a judge swarm, or `run_judge_panel` |

Older command names (`/check-subagents`, `/run-codex-review`, `/run-antigravity-review`, `/run-gemini-review`, `/run-subagent-review`) are stubs that point here.

## Subagent

| Name | File | Role |
|------|------|------|
| `external-swarm` | [`.cursor/agents/external-swarm.md`](.cursor/agents/external-swarm.md) | `swarm_search`, then `swarm_run` or `run_judge_panel` |

`external-codex-review`, `external-antigravity-review`, `external-gemini-review`, and `external-cli-reviewer` are stubs that point at `external-swarm`.

## Default behavior

- **Read-only** - writes stay off. ACP permission requests are denied. Do not bypass the orchestrator with raw `codex`, `agy`, `claude`, or `agent` unless the user explicitly asks.
- **Swarm** - `swarm_run` for one shared judgement. Omit `harnesses` to use every available harness. Agreement is evidence for a later decision.
- **Model** - optional. The call fails with `model_unsupported` before any run when a selected harness does not advertise `--model`.
- **Transport** - `auto` uses the one-shot CLI when help shows exec or print mode, otherwise ACP when that command is already on PATH.
- **Outputs** - `.agent-runs/<timestamp>-<harness>-<slug>/stdout.md` and `.agent-runs/<timestamp>-swarm-<slug>/swarm.json`

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
