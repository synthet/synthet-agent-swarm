# Moved

Use `/swarm` and the `external-swarm` subagent.

Call `swarm_run` with `harnesses: ["gemini"]`. That selects the Gemini CLI when it is available, and `agy` otherwise. Set `dryRun: true` when the user says dry run. Do not spawn `gemini` or `agy` in the terminal.
