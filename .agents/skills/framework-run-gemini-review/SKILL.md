---
name: framework-run-gemini-review
description: "Explicit framework workflow: run-gemini-review. Use /swarm."
disable-model-invocation: true
---

# Moved

Use `/swarm` and `external-swarm`. Call `swarm_run` with `harnesses: ["gemini"]`. That selects the Gemini CLI when it is available, and `agy` otherwise. Do not spawn `gemini` or `agy`.
