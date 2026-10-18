# synthet-agent-swarm

Local MCP server that runs the same read-only judgement on the harnesses that are installed, then reports strict-majority agreement. Ties stay disputed. Votes are evidence, not ground truth.

Harnesses: Codex, Claude Code, Antigravity (`agy`), Cursor (`agent`), Gemini CLI, and Grok. Code review is `swarm_run` with `mode: "review"`. Blind labelling is `mode: "judge"` or [docs/judges-swarm.md](docs/judges-swarm.md). The tool contract is [docs/api.md](docs/api.md).

## Quick start

```bash
cd agent-orchestrator
npm install
npm run build
npm test
```

Detect installed CLIs:

```bash
npm run detect
```

Dry-run one judge, or the whole swarm (no subprocess):

```bash
node dist/index.js run --agent codex --task "Review README" --dry-run
node dist/index.js swarm --task "Label the evidence" --files blind/a.jpg --dry-run
```

## Cursor integration

Full map: **[AGENTS.md](AGENTS.md)**

| Kind | Location |
|------|----------|
| Rules | `.cursor/rules/` (`external-cli-subagents.mdc` always on) |
| Skill | `.cursor/skills/subagent-review/` |
| Commands | `/swarm` |
| Subagents | `external-swarm` |

1. Build the package (see above).
2. Enable MCP (see [agent-orchestrator/README.md](agent-orchestrator/README.md)).
3. Reload MCP in Cursor.
4. Try `/swarm` with "dry run" in the prompt.
5. **Reads only.** `allowWrites=true` is rejected. Do not treat swarm agreement as a human label.

External agents return votes or review notes. Cursor remains the primary editor. Jev adjudication stays in the calling project.

## Layout

- `agent-orchestrator/` - TypeScript MCP server + CLI
- `docs/acp-harness-matrix.md` - ACP research note; runners stay one-shot CLIs
- `.agent-runs/` - persisted run outputs (gitignored)
