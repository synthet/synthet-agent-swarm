# Moved

Use `/swarm` and the `external-swarm` subagent.

To limit the run to Codex, call `swarm_run` with `harnesses: ["codex"]`. Set `dryRun: true` when the user says dry run. Do not spawn `codex` in the terminal.
