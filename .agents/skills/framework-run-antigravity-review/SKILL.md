---
name: framework-run-antigravity-review
description: "Explicit framework workflow: run-antigravity-review"
disable-model-invocation: true
---

# Run Antigravity review (MCP)

Delegate a **review-only** task to **Antigravity CLI** through the **synthet-agent-swarm** MCP server. Do **not** run `agy -p` directly in the terminal unless the user explicitly asks to bypass the orchestrator.

Install Antigravity CLI from `https://antigravity.google/download#antigravity-cli`.

## Inputs

Everything after `/run-antigravity-review` is the **task** description. Reference files with `@` when helpful.

Examples:

- `/run-antigravity-review Review src/config.ts for timeout edge cases`
- `/run-antigravity-review dry run Summarize risks in the MCP index handler`

## Steps

1. Apply skill **`subagent-review`**.
2. Optionally call **`detect_subagents`**; confirm antigravity `mode: prompt`.
3. Collect workspace-relative **files** from `@` paths.
4. Call **`run_subagent`**:

```json
{
  "agent": "antigravity",
  "task": "<user task>",
  "files": ["..."],
  "mode": "review",
  "allowWrites": false,
  "dryRun": false
}
```

Set `"dryRun": true` when the user said \"dry run\".

5. Read **`outputFile`**; summarize with severity labels.
6. Do **not** apply file changes automatically.

## Guardrails

- Never `allowWrites: true` (v0.1).
- No secrets in prompts.
- If antigravity unavailable, report detection notes and stop.

## Related

- Skill: `subagent-review` - Rule: `external-cli-subagents.mdc` - Alternative: `/run-codex-review`

