# synthet-agent-swarm API

The MCP server name is `synthet-agent-swarm`. Tools are read-only judges. `allowWrites` stays off. An ACP session that asks to edit files or run a shell is denied. This server does not call Jev and does not render images.

Votes are evidence. A field is agreed only when at least two judges share a strict majority. Ties and single votes stay disputed.

Registered tools: `swarm_search`, `swarm_run`, `run_judge_panel`, `detect_subagents`, `run_subagent`, `run_judge_swarm`.

## swarm_search

Catalog of harnesses. Optional `query` matches id, title, command, transport, and notes.

| Query token | Rows |
|---|---|
| `gemini` | `agy` and `gemini` |
| `antigravity` | `agy` |
| `agent` | `cursor` |

Each row has `id`, `title`, `command`, `available`, `transports` (`cli` or `acp`), `modelFlag` (`--model` or null), and `notes`. Help text is not returned.

| id | CLI | ACP, only when that command is already on PATH |
|---|---|---|
| `codex` | `codex exec` read-only sandbox | `codex-acp` |
| `claude` | `claude -p` | `claude-code-acp` |
| `agy` | `agy -p`, `--print`, or `--prompt` | only if help shows an ACP mode |
| `cursor` | `agent` print mode only when help shows it | `agent acp` |
| `gemini` | `gemini` print mode when the binary exists | only if help shows an ACP mode |
| `grok` | none | `grok agent stdio` |

`npm run detect` prints this catalog.

## swarm_run

One task. Omit `harnesses` to run every allowed harness that has the resolved transport.

| Field | Role |
|---|---|
| `task` | Required. 1 to 8000 characters. |
| `files` | Optional workspace-relative paths. At most 20. |
| `harnesses` | Optional ids. `gemini` uses the gemini row when it is available, otherwise `agy`. `antigravity` is `agy`. `agent` is `cursor`. |
| `model` | Optional. Sent only when every selected harness advertises `--model`. Otherwise the call fails with `model_unsupported` and runs nothing. |
| `transport` | `auto` (default), `cli`, or `acp`. `auto` uses the one-shot CLI when detection found exec or print mode, otherwise ACP. |
| `mode` | `review` (default), `implement`, `explain`, `test`, `tie-breaker`, or `judge`. |
| `timeoutMs` | Optional. Clamped to the configured range. |
| `dryRun` | Default false. A dry run does not spawn harnesses and omits `agreement`. |
| `extraContext` | Optional. Up to 4000 characters. Blind judge panels reject it. |

One harness returns one result and omits `agreement`. Two or more run in parallel and include strict-majority agreement. `ok` is true when at least one harness succeeds. A dry run is `ok` only when every selected harness can be previewed.

Success:

```json
{ "ok": true, "dryRun": false, "harnesses": [], "agreement": {} }
```

`harnesses[]` rows: `id`, `transport`, `ok`, `summary`, `outputDir`, `commandPreview`, `error`.

Preflight failure, before any harness starts:

```json
{
  "ok": false,
  "error": {
    "code": "model_unsupported",
    "message": "",
    "details": {},
    "retryable": false,
    "next_steps": []
  },
  "harnesses": []
}
```

Codes: `unknown_harness`, `harness_unavailable`, `model_unsupported`, `transport_unavailable`, `path_rejected`, `timeout`, `acp_protocol`, `invalid_arguments`.

`unknown_harness` and `model_unsupported` fail the whole call. A missing transport or an ACP handshake failure is recorded on that harness and does not stop the others.

## run_judge_panel

Frozen manifest workflow. Adds optional `harnesses`, `model`, and `transport` to the existing item list. Blind is the default. Blind panels reject `extraContext`. Human labels are not shown to judges. The response always has `stages.jev.called: false` and `stages.rules.applied: false`. The text-only `stages.jev.state` is for the caller’s own `jev_system_one` call.

When `harnesses` is omitted, the panel runs `codex`, `agy`, and `claude` that the config allows. The legacy `agents` field still accepts `codex`, `antigravity`, and `claude`.

## Aliases

`detect_subagents`, `run_subagent`, and `run_judge_swarm` call the same functions and return the previous JSON shape. `antigravity` in those responses is the `agy` harness. New callers use `swarm_search` and `swarm_run`.

## Config

`allowedAgents` in `.agent-orchestrator.json` replaces the default list. A file that names only `codex`, `antigravity`, and `claude` does not select `cursor`, `gemini`, or `grok`. `antigravity` and `agy` are the same harness.

## Reload

Reload MCP after this server is rebuilt so hosts pick up `swarm_search` and `swarm_run`.
