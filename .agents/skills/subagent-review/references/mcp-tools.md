# MCP tool reference - synthet-agent-swarm

Server display name: **synthet-agent-swarm**. The field contract is `docs/api.md` in the synthet-agent-swarm checkout.

Tools are read-only. `swarm_search` lists harnesses. `swarm_run` runs one task. `swarm_sessions` lists runs and sessions. `swarm_panel` runs a frozen manifest. The server does not call Jev or render images.

## swarm_search

Optional `query` matches id, title, command, transport, and notes.

```json
{ "query": "cursor" }
```

Each row has `id`, `title`, `command`, `available`, `transports`, `modelFlag`, and `notes`.

## swarm_run

| Field | Required | Notes |
|---|---|---|
| `task` | yes | Max 8000 characters |
| `files` | no | Workspace-relative. Max 20 |
| `harnesses` | no | Omit for every available harness. `antigravity` is `agy`. `agent` is `cursor` |
| `model` | no | Fails the whole call with `model_unsupported` when a selected harness has no `--model` flag |
| `modelChains` | no | Ordered models per harness, such as `{"codex": ["a", "b"]}`. Replaces `model`. Moves on only when a run fails or returns nothing |
| `transport` | no | `auto` (default), `cli`, or `acp` |
| `mode` | no | `review` by default. `judge` is one blind vote. `respond` is the read-only responder: exactly one of `claude`, `codex`, `cursor` |
| `timeoutMs` | no | Clamped to the configured maximum |
| `dryRun` | no | Does not spawn. Omits `agreement` |
| `extraContext` | no | Max 4000 characters |
| `budgetUsd` | no | Spend cap where supported (Claude `--max-budget-usd`). Max 20 |
| `resume` | no | `{"sessionId": "..."}` from an earlier row. Exactly one harness; not in `judge` mode. Claude forks the session |

Rows carry `outcome` (`ok`, `permission_denied`, `soft_denied`, `empty_output`, `auth_required`, `rate_limited`, `timeout`, `error`), `sessionId`, `costUsd` and `denials` when known.

One harness omits `agreement`. Two or more include strict-majority agreement. `ok` is true when at least one harness succeeds.

```json
{
  "task": "Review the sandbox flags",
  "files": ["agent-orchestrator/src/runners/codex.ts"],
  "harnesses": ["codex", "agy"],
  "dryRun": true
}
```

Failure envelope:

```json
{
  "ok": false,
  "error": {
    "code": "model_unsupported",
    "message": "",
    "details": {},
    "retryable": false,
    "next_steps": ["codex"]
  },
  "harnesses": []
}
```

## swarm_sessions

```json
{ "limit": 10, "native": true }
```

Returns `active` and `recent` runs of this server, `stored` per-harness results under `.agent-runs/` with `sessionId` and `outcome`, and `native.claude` from `claude agents --json`. Cursor, Codex and Antigravity have no machine-readable listing; their `native` entry is a note. No prompts or replies are included.

## CLI request contract

`synthet-agent-swarm run --request <file.json|->` takes one `swarm_run` request as JSON, so no prompt is on the command line. It prints one JSON line: the `swarm_run` response plus `reply`. Exit 0 ok, 1 run failed, 2 invalid request.

## swarm_panel

Same manifest as before, plus optional `harnesses`, `model`, and `transport`. Blind is the default and rejects `extraContext`. `stages.jev.called` and `stages.rules.applied` stay false.

```json
{
  "task": "Choose A or B for each item.",
  "items": [{ "id": "a", "files": ["blind/a.jpg"] }],
  "harnesses": ["codex", "agy"],
  "dryRun": true
}
```

## Typed questions

`swarm_choice`, `swarm_score`, and `swarm_noul` each take `state`, `instructions`, and `question_id` (default `answer`). Choice criteria is an object. Score criteria is an ordered list. Noul criteria is an optional object. `swarm_system_one` takes a `questions` map of those three types. `swarm_decide` accepts the same types with a looser criteria shape and returns `answers` at the top level. None of these call the paid Jev service. Images and box questions are not accepted.

## On-disk artifacts

```text
.agent-runs/YYYYMMDD-HHMMSS-<harness>-<slug>/
.agent-runs/YYYYMMDD-HHMMSS-swarm-<slug>/swarm.json
.agent-runs/YYYYMMDD-HHMMSS-panel-<slug>/panel.json
```
