# Moved

Use `/swarm` and the `external-swarm` subagent.

`/swarm` calls `swarm_search`, then `swarm_run` or `run_judge_panel`. Set `dryRun: true` when the user says dry run. Do not spawn `codex`, `agy`, `claude`, or `agent` in the terminal.
