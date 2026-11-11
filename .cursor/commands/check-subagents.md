# Moved

Use `/swarm` and the `external-swarm` subagent.

`/swarm` calls `swarm_search`, then `swarm_run` or `swarm_panel`. Set `dryRun: true` when the user says dry run. Do not spawn `codex`, `agy`, `claude`, or `agent` in the terminal.
