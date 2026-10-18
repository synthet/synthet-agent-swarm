---
type: Report
title: ACP harness matrix
description: Which harnesses synthet-agent-swarm launches over the one-shot CLI or ACP, next to the archived vendor report.
resource: docs/acp-harness-matrix.md
tags: [acp, codex, cursor, grok, claude, antigravity]
timestamp: 2026-10-18T00:00:00Z
okf_version: 0.1
---

# ACP harness matrix

External research, archived on 2026-10-18 from `D:\Downloads\deep-research-report.md`. The unchanged source is [raw/deep-research-report-acp.md](raw/deep-research-report-acp.md). This page says what that report means for synthet-agent-swarm. It does not re-verify every vendor claim.

The Agent Client Protocol (ACP) is a JSON-RPC session between an editor and a coding agent. The report compares five harnesses. This server uses the one-shot CLI when help shows exec or print mode, and ACP otherwise when that command is already on PATH. It does not download adapters. An ACP `session/request_permission` is answered with a deny. See [judges-swarm.md](judges-swarm.md) and [api.md](api.md).

## What this repo runs

| Harness | CLI | ACP, only if the command is already on PATH |
|---|---|---|
| `codex` | `codex exec` in a read-only sandbox | `codex-acp` |
| `claude` | `claude -p`. Judge mode adds `--tools Read` and `--add-dir` | `claude-code-acp` |
| `agy` | `agy -p`, `--prompt`, or `--print`, plus `--add-dir` for judge evidence | only when `agy` help shows an ACP mode |
| `cursor` | `agent` print mode only when help shows `-p`, `--print`, or `--prompt` | `agent acp` |
| `gemini` | `gemini` print mode when the binary exists | only when help shows an ACP mode |
| `grok` | none in this slice | `grok agent stdio` |

A failed ACP handshake is `acp_protocol` for that harness. The other harnesses in the same run still finish.

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
