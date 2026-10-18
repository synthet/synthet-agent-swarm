---
name: framework-run-antigravity-review
description: "Explicit framework workflow: run-antigravity-review. Use /swarm."
disable-model-invocation: true
---

# Moved

Use `/swarm` and `external-swarm`. Antigravity is harness `agy`. Call `swarm_run` with `harnesses: ["agy"]`. Set `dryRun: true` when the user says dry run. Do not spawn `agy`.
