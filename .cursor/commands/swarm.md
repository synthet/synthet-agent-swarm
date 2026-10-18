# Swarm

One entry point for read-only judge harnesses. Use the `synthet-agent-swarm` MCP server. Do not spawn `codex`, `agy`, `claude`, `gemini`, or `agent` in the terminal unless the user explicitly asks to bypass the orchestrator.

## Inputs

Everything after `/swarm` is the task. `@` paths become `files`. Words that name a provider become `harnesses`. A model name the user gives becomes `model`. `dry run` sets `dryRun: true`.

Harness ids: `codex`, `claude`, `agy`, `cursor`, `gemini`, `grok`. `antigravity` is `agy`. `agent` is `cursor`. `gemini` uses the Gemini CLI when that binary is available, otherwise `agy`.

## Steps

1. Read the tool schemas, then call `swarm_search`. Optional `query` matches id, title, command, transport, and notes.
2. For a review or one judgement, call `swarm_run`. Omit `harnesses` to use every available harness. Set `transport` to `auto`, `cli`, or `acp` only when the user asked. Set `mode` to `review` unless the user asked for `judge`.
3. For a frozen manifest of item ids and evidence files, call `run_judge_panel` with the same `harnesses`, `model`, and `transport`. Blind panels reject `extraContext`.
4. Read `.agent-runs/` output. Summarize findings with severity blocker, high, medium, low, or nit. Agreement is evidence, not a human label.
5. Do not apply patches unless the user asks.

## Example

```json
{
  "task": "Review the runner for sandbox flags",
  "files": ["agent-orchestrator/src/runners/codex.ts"],
  "harnesses": ["codex"],
  "mode": "review",
  "dryRun": true
}
```

## Guardrails

- Never enable writes. ACP permission requests are denied by the server.
- No secrets in `task`, `files`, or `extraContext`.
- If `model_unsupported` comes back, retry with the harness ids in `next_steps`, or omit `model`.
