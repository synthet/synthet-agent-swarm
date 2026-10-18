---
type: Report
title: ACP harness matrix
description: Project reading of an external report on Agent Client Protocol support in Codex, Cursor, Grok, Claude Code, and Antigravity. This swarm still launches one-shot CLIs.
resource: docs/acp-harness-matrix.md
tags: [acp, codex, cursor, grok, claude, antigravity]
timestamp: 2026-10-18T00:00:00Z
okf_version: 0.1
---

# ACP harness matrix

External research, archived on 2026-10-18 from `D:\Downloads\deep-research-report.md`. The unchanged source is [raw/deep-research-report-acp.md](raw/deep-research-report-acp.md). This page says what that report means for synthet-agent-swarm. It does not re-verify every vendor claim.

The Agent Client Protocol (ACP) is a JSON-RPC session between an editor and a coding agent. The report compares five harnesses. This server does not speak ACP. It still spawns one judge process per vote. See [judges-swarm.md](judges-swarm.md).

## What this repo runs

| Judge | Launch used here |
|---|---|
| Codex | `codex exec` in a read-only sandbox. Live runs require detection to report `exec`. |
| Antigravity | `agy -p`, `--prompt`, or `--print`, plus `--add-dir` for judge evidence. No permission-skip flag. |
| Claude | `claude -p`. Judge mode adds `--tools Read` and `--add-dir`. Live runs require detection to report print mode. |

ACP sessions in the report can edit files and run shell commands. That is a different contract from `allowWrites: false`.

## What the report claims

These launch lines are the report's, not commands this repo runs.

| Harness | Report's ACP status | Report's launch |
|---|---|---|
| Codex CLI | No native ACP. Community adapter [codex-acp](https://github.com/agentclientprotocol/codex-acp). | `npx -y @agentclientprotocol/codex-acp` |
| Cursor CLI | Built-in ACP v1. Team MCP servers from the Cursor dashboard are not available in ACP mode. | `agent acp` |
| Grok Build CLI | Built-in ACP v1 over stdio. Auth via `grok login` or `XAI_API_KEY`. | `grok agent stdio` |
| Claude Code | Adapter, not the `claude` binary itself. Experimental draft v2 via `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=1`. Auth is `claude` login. | `claude-code-acp` after `pip install claude-code-acp` |
| Antigravity CLI | No ACP mode found in public docs. The CLI is its own TUI. | `agy` or `ant`, with no ACP subcommand |

The report's editor matrix marks Codex, Cursor, Grok, and Claude Code as spawnable ACP servers, and Antigravity as not an ACP server. The full tables, auth notes, and limitation list stay in the archive.

Antigravity is one of the three judges. A swarm that includes it cannot move entirely onto ACP on the evidence in this report.

## Checks on this machine (2026-10-18)

- `agy --help` lists print mode (`-p`, `--print`, `--prompt`) and does not mention ACP. That matches the Antigravity runner.
- `grok agent --help` lists a `stdio` subcommand, described as "Run the agent over stdio". `grok agent stdio --help` does not say ACP. The report is the source of the ACP label for that subcommand.
- `grok --help`, `claude --help`, and `agent --help` did not return within 8 seconds.
- `codex` did not start from this shell. That is a PATH result, not a finding about ACP.

## Report limits

The archive says its details come from each agent's docs and the ACP spec. The body links the codex-acp repo, `https://docs.x.ai`, `https://code.claude.com`, and `https://antigravity.google/cli/install.sh`. The Codex ACP-version cell mentions Claude's `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2` variable. The report also calls Grok "SpaceXAI" and "SpaceXSI" and describes it as fully open-source. This repo does not use those names.
