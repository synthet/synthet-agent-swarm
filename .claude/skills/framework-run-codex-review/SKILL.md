---
name: framework-run-codex-review
description: "Explicit framework workflow: run-codex-review. Use /swarm."
disable-model-invocation: true
---

# Moved

Use `/swarm` and `external-swarm`. Call `swarm_run` with `harnesses: ["codex"]`. Set `dryRun: true` when the user says dry run. Do not spawn `codex`.
