# Run external sub-agent review (MCP)

Delegate a **review-only** task to one or more external CLIs via **synthet-agent-swarm** MCP.

## Inputs

Text after the command is the **task**. Optional leading keywords:

| Prefix | Behavior |
|--------|----------|
| `codex ...` | Run Codex only |
| `antigravity ...` | Run Antigravity only |
| `both ...` / `panel ...` | Run Codex and Antigravity **sequentially** with `run_subagent` for a code review. For a blind label swarm, call `run_judge_swarm` instead |
| (none) | Call `detect_subagents`, then use the best available agent (prefer codex, then antigravity) |

Use `@` file paths for context.

Examples:

- `/run-subagent-review Review the refactor in agent-orchestrator/src/tools/`
- `/run-subagent-review both Review README for clarity and security wording`
- `/run-subagent-review codex dry run Review index.ts`

## Steps

1. Apply skill **`subagent-review`** end-to-end.
2. Parse agent choice from user text (see table above).
3. For **panel/both**: run `run_subagent` twice (codex then antigravity, or reverse if one is unavailable); compare agreements and disagreements in the final summary.
4. For a single agent: one `run_subagent` call with `mode: "review"`, `allowWrites: false`.
5. Use `dryRun: true` when user says "dry run".
6. Summarize all `.agent-runs/` outputs; do not auto-apply patches.

## Panel summary template

When two agents ran:

```markdown
## Panel review

### Agreement
### Disagreements
### Strongest finding
### Likely false positives
### Recommended next action
```

## Future

`/run-subagent-panel` may be added when the MCP server exposes `run_subagent_panel`.

## Related

- Skill: `subagent-review` - Subagent: `external-cli-reviewer` - [AGENTS.md](../../AGENTS.md)
