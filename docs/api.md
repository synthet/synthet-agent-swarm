# synthet-agent-swarm API

The MCP server name is `synthet-agent-swarm`. Tools are read-only judges. `allowWrites` stays off. An ACP session that asks to edit files or run a shell is denied. This server does not call Jev and does not render images.

Votes are evidence. A field is agreed only when at least two judges share a strict majority. Ties and single votes stay disputed.

Only successful harness results vote. Strict majority means more than half of valid answers to that item and field, with at least two identical votes; a 2–1–1 split is disputed. Failed stdout is retained as diagnostic evidence. Aliases resolving to the same harness launch it once.

Registered tools: `swarm_search`, `swarm_run`, `swarm_decide`, `swarm_sessions`, `run_judge_panel`, `detect_subagents`, `run_subagent`, `run_judge_swarm`.

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
| `claude` | `claude -p` | `claude-agent-acp`, then the legacy `claude-code-acp` |
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
| `model` | Optional. CLI harnesses need `--model`; otherwise the call fails with `model_unsupported` and runs nothing. ACP harnesses pin it through the session's model option, and the run stops before any prompt if that fails. |
| `modelChains` | Optional. Ordered models per harness, such as `{"claude": ["a", "b"]}`, at most 5 each. Keys accept aliases. Replaces `model`. Moves to the next model only when a run fails or returns nothing. It never reads the answer. |
| `transport` | `auto` (default), `cli`, or `acp`. `auto` uses the one-shot CLI when detection found exec or print mode, otherwise ACP. Cursor uses ACP when a model is set, because its `--model` flag only rewrites a saved default. |
| `mode` | `review` (default), `implement`, `explain`, `test`, `tie-breaker`, or `judge`. |
| `timeoutMs` | Optional. Clamped to the configured range. |
| `dryRun` | Default false. Omits `agreement` and does not start a generation. Uncached discovery can still execute CLI version/help probes. |
| `extraContext` | Optional. Up to 4000 characters. Blind judge panels reject it. |
| `resume` | Optional `{ "sessionId": "..." }` from an earlier row's `sessionId`. Needs exactly one harness, no `modelChains`, and a mode other than `judge`; otherwise `invalid_arguments`. Claude gets `--resume <id> --fork-session`, so the run forks the session and never writes into its transcript; the row's `sessionId` is the fork. Codex gets `exec resume <id>` with `-c sandbox_mode=read-only`, because `exec resume` has no `--sandbox` flag. Cursor gets `--resume <id>`, Antigravity `--conversation <id>`. Over ACP the peer must advertise `loadSession`; `session/load` replays history, and only the new turn's text is kept. The Gemini CLI runner has no resume. |

One harness returns one result and omits `agreement`. Two or more run in parallel and include strict-majority agreement. `ok` is true when at least one harness succeeds. A dry run is `ok` only when every selected harness can be previewed.

Success:

```json
{ "ok": true, "dryRun": false, "harnesses": [], "agreement": {} }
```

`harnesses[]` rows: `id`, `transport`, `ok`, `summary`, `outputDir`, `commandPreview`, `error`, plus `outcome`, `sessionId`, `costUsd` and `denials` when known.

`outcome` comes from the harness's own result payload, not the exit code alone:

| `outcome` | `ok` | Meaning |
|---|---|---|
| `ok` | true | A reply arrived and nothing was reported denied. |
| `permission_denied` | true | A reply arrived, but Claude or an ACP peer reported denied permission requests (`denials`). The reply may be incomplete. |
| `soft_denied` | true | A reply arrived, but stderr shows an Antigravity-style soft-deny notice. The reply may be incomplete. |
| `empty_output` | false | Exit 0 with no reply. On Windows, `agy` without a TTY prints nothing (antigravity-cli#76). |
| `auth_required` | false | The harness asked for sign-in or rejected its key. |
| `rate_limited` | false | The provider returned a rate-limit or overload error. |
| `timeout` | false | The run hit `timeoutMs`. |
| `error` | false | Any other failure, including a result payload that reports an error. |

To get these fields, the CLI runners request structured output: `claude --output-format json`, `codex exec --json` (when `codex.jsonOutput` is true, the default, and help shows the flag), and `--output-format json` for `agy` and Cursor print mode when their help shows that flag. The parsed reply text replaces the raw JSON in `stdout.md` and in agreement input. `sessionId` is the Claude session, Codex thread, Cursor chat or Antigravity conversation id.

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

Codes: `unknown_harness`, `harness_unavailable`, `model_unsupported`, `model_chain_invalid`, `transport_unavailable`, `path_rejected`, `timeout`, `acp_protocol`, `invalid_arguments`, `execution_failed`, `artifact_storage`, `auth_required`, `rate_limited`, `empty_output`.

`unknown_harness`, `model_unsupported` and `model_chain_invalid` fail the whole call. A missing transport or an ACP handshake failure is recorded on that harness and does not stop the others.

An unexpected step exception is an `execution_failed` harness row; other rows are retained. If the swarm summary cannot be stored, the response is `ok: false` with `artifact_storage` and the collected rows. A panel-summary write failure likewise retains its stages and votes with an error.

Path validation checks both lexical and resolved filesystem locations, including existing ancestors of missing evidence. Links outside the workspace and links hiding known secret paths are rejected. Artifact storage rejects a `.agent-runs` link escaping the workspace. This validation does not replace the provider's sandbox or permissions.

On Windows, the supported standard npm Node shim is resolved directly to its existing JavaScript entry point. Custom batch launchers reject shell-sensitive arguments, including multiline prompts, rather than applying speculative escaping. Dry-run validates that local launch target without starting it. Discovery matches exact option names, not prefixes such as `--prompt-file` or `--model-route`.

ACP errors identify the active phase (`initialize`, `authenticate`, `session/new`, `session/load`, `session/set_config_option`, or `session/prompt`) and keep the peer's error code and message. Setting a model can persist as the peer's default, so the client restores the old value after the turn and warns if it can't. Rows report `model`, `reportedModel` (what the session confirmed) and, for chains, `attempts`. `timeoutMs` is one total deadline including startup and MCP initialization. Peer EOF fails promptly; bounded stderr diagnostics are saved in the run artifacts. Grok authenticates with an advertised headless method using an existing login or environment credential. Non-`end_turn` completions are failed runs.

## swarm_sessions

Lists runs and sessions. It contains no prompts or replies.

| Field | Role |
|---|---|
| `limit` | 1 to 50, default 20. Applies to `recent` and `stored`. |
| `native` | Default true. Also lists the harnesses' own sessions where a machine-readable listing exists. |

| Response field | Content |
|---|---|
| `active` | Runs this server process has in flight: `runId`, `harness`, `transport`, `model`, `startedAt`. A run waiting for a `concurrency.perHarness` slot is not listed yet. |
| `recent` | This process's finished runs, newest first, with `ok`, `outcome` and `sessionId`. Lost on restart. |
| `stored` | Per-harness `result.json` files under `.agent-runs/`, newest first, with `outcome`, `sessionId` and `outputDir`. Covers runs from other processes, such as CLI calls. |
| `native.claude` | `claude agents --json`: `sessionId`, `name`, `cwd`, `kind`, `status`, `pid`, `startedAt`, or an `error`. |
| `native.cursor`, `native.codex`, `native.agy` | A `note`: Cursor's `agent ls` is an interactive picker, and Codex and Antigravity have no listing command. |

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

Frozen manifest workflow. Adds optional `harnesses`, `model`, `modelChains`, and `transport` to the existing item list. Judges report `model`, `reportedModel` and `attempts`. Blind is the default. Blind panels reject `extraContext`. Human labels are not shown to judges. The response always has `stages.jev.called: false` and `stages.rules.applied: false`. The text-only `stages.jev.state` is for the caller’s own `jev_system_one` call.

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
