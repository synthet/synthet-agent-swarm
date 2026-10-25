# synthet-agent-swarm API

The MCP server name is `synthet-agent-swarm`. Tools are read-only judges. `allowWrites` stays off. An ACP session that asks to edit files or run a shell is denied. This server does not call Jev and does not render images.

Votes are evidence. A field is agreed only when at least two judges share a strict majority. Ties and single votes stay disputed.

Only successful harness results vote. Strict majority means more than half of valid answers to that item and field, with at least two identical votes; a 2–1–1 split is disputed. Failed stdout is retained as diagnostic evidence. Aliases resolving to the same harness launch it once.

Registered tools: `swarm_search`, `swarm_run`, `swarm_decide`, `run_judge_panel`, `detect_subagents`, `run_subagent`, `run_judge_swarm`.

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
| `dryRun` | Default false. Omits `agreement` and does not start a generation. Uncached discovery can still execute CLI version/help probes. |
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

Codes: `unknown_harness`, `harness_unavailable`, `model_unsupported`, `transport_unavailable`, `path_rejected`, `timeout`, `acp_protocol`, `invalid_arguments`, `execution_failed`, `artifact_storage`.

`unknown_harness` and `model_unsupported` fail the whole call. A missing transport or an ACP handshake failure is recorded on that harness and does not stop the others.

An unexpected step exception is an `execution_failed` harness row; other rows are retained. If the swarm summary cannot be stored, the response is `ok: false` with `artifact_storage` and the collected rows. A panel-summary write failure likewise retains its stages and votes with an error.

Path validation checks both lexical and resolved filesystem locations, including existing ancestors of missing evidence. Links outside the workspace and links hiding known secret paths are rejected. Artifact storage rejects a `.agent-runs` link escaping the workspace. This validation does not replace the provider's sandbox or permissions.

On Windows, the supported standard npm Node shim is resolved directly to its existing JavaScript entry point. Custom batch launchers reject shell-sensitive arguments, including multiline prompts, rather than applying speculative escaping. Dry-run validates that local launch target without starting it. Discovery matches exact option names, not prefixes such as `--prompt-file` or `--model-route`.

ACP errors identify the active phase (`initialize`, `authenticate`, `session/new`, or `session/prompt`). `timeoutMs` is one total deadline including startup and MCP initialization. Peer EOF fails promptly; bounded stderr diagnostics are saved in the run artifacts. Grok authenticates with an advertised headless method using an existing login or environment credential. Non-`end_turn` completions are failed runs.

## swarm_decide

Fast, zero-tool Jev-compatible structured decision engine (`noul`, `choice`, `score`) over lightweight flash coding models (`claude` $\to$ `haiku`, `codex` $\to$ `gpt-6-luna`, `cursor` $\to$ `composer-2.5`, `agy` $\to$ `gemini-3.8-flash-medium`, `grok` $\to$ `grok-build-0.1`).

| Field | Role |
|---|---|
| `state` | JSON object or string to evaluate as untrusted data (automatically secret-redacted). |
| `questions` | Map of question IDs to `{ type: "noul" \| "choice" \| "score", instructions?: string, criteria?: string[] \| Record<string, string> }`. |
| `harnesses` | Optional array of harness IDs. Defaults to fastest available one-shot CLI harness; multiple harnesses run in parallel and aggregate probabilities. |
| `model` | Optional model override (defaults to `"lightweight"` per-harness flash model). |
| `timeoutMs` | Default 6000 ms. |
| `dryRun` | Default false. |

## run_judge_panel

Frozen manifest workflow. Adds optional `harnesses`, `model`, and `transport` to the existing item list. Blind is the default. Blind panels reject `extraContext`. Human labels are not shown to judges. The response always has `stages.jev.called: false` and `stages.rules.applied: false`. The text-only `stages.jev.state` is for the caller’s own `jev_system_one` call.

When `harnesses` is omitted, the panel runs `codex`, `agy`, and `claude` that the config allows. The legacy `agents` field still accepts `codex`, `antigravity`, and `claude`.

Each item is mapped to positions in the deduplicated evidence list. Accepted replies must contain exactly one nonempty row per manifest id. Missing, additional or duplicate ids reject that judge's reply. A live panel with no usable replies is `ok: false`; `stages.run.ok` still describes process success. A single usable reply can make the panel `ok: true` while its fields remain disputed. Rubric-specific fields and values remain the caller's contract.

Blind mode omits git context and rejects `extraContext`; it does not anonymize filenames, remove inherited instructions, or certify image access. Evidence paths remain visible to file-reading judges. The caller must supply neutral filenames and blind renditions.

Run, swarm and panel artifact directories have a unique suffix after the timestamp/harness/task prefix, so repeated same-second calls do not overwrite earlier evidence.

## Aliases

`detect_subagents`, `run_subagent`, and `run_judge_swarm` call the same functions and return the previous JSON shape. `antigravity` in those responses is the `agy` harness. New callers use `swarm_search` and `swarm_run`.

## Config

`allowedAgents` in `.agent-orchestrator.json` replaces the default list. A file that names only `codex`, `antigravity`, and `claude` does not select `cursor`, `gemini`, or `grok`. `antigravity` and `agy` are the same harness.

## Reload

Reload MCP after this server is rebuilt so hosts pick up `swarm_search` and `swarm_run`.
