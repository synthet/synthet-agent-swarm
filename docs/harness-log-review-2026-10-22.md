# CLI harness and judge review — 2026-10-22

The retained MCP panel artifacts did not establish multi-judge agreement: no live panel had two parsed judges. The review also reproduced defects in agreement, response validation, artifact retention, ACP diagnostics, Windows argument delivery, and filesystem boundaries. The deterministic swarm fixes below are implemented locally; provider image access and startup isolation still need bounded live verification.

## Evidence and scope

Read-only inspection covered `D:/Projects/image-scoring-skills`, this repository's source and Git history, and current primary vendor documentation. No photo judges, swarms, or paid image evaluations were launched. No sibling files, global harness configuration, hooks, or running study jobs were changed.

| Corpus | Snapshot |
|---|---|
| Exported sessions at the image-scoring-skills root | 21 files, 95,597,545 bytes; searched for invocation and failure evidence, with selected passages inspected |
| `.agent-runs/*/result.json` | 68 records: 10 successful previews with null exit status, 49 live process successes, 9 live process failures |
| `.agent-runs/*/panel.json` | 59 records: 5 dry runs, 54 live panels |
| Live panel parsed-judge coverage | 48 with one parsed judge, 6 with none, 0 with two or more |
| Failed judges counted as parsed votes | 1 live panel |
| Live panels whose returned ids did not cover their manifest | 6; all six had no parsed votes |

These are retained artifact records, not unique task counts or model-quality measurements. Several session exports overlap or repeat the same session. Do not count transcript keyword hits as independent incidents. The active study's scratch logs and code were still changing during inspection.

Reviewed-only Wiki search returned no matches; `stats` reported 465 candidate and 9 stale current claims, with no reviewed claims. An explicitly candidate-only search also returned no swarm matches. Findings therefore use local evidence rather than inferred Wiki claims.

## How calls are made

| Caller | Invocation and evidence | Result boundary |
|---|---|---|
| This MCP server | `swarm_search` observes PATH/help; `swarm_run` plans CLI or ACP and fans out one task. Canonical aliases now launch once. | Per-harness process status, stored raw output, optional parsed agreement |
| Codex CLI runner | Global approval option before `exec`, read-only sandbox, repeated `--image`, prompt sent to stdin through `-` | Successful exit plus parsable text; CLI images are attachments |
| Claude CLI runner | `claude -p`, judge evidence directories, built-in `Read` tool list | File-read permissions, hooks, inherited MCPs, and actual image access remain separate concerns |
| Antigravity CLI runner | Detected prompt flag plus `--add-dir`; asks the model to open evidence | A supported prompt flag does not establish that images were successfully viewed |
| Cursor / Gemini CLI paths | Generic detected print/prompt command | No provider-specific image-success receipt in this server |
| Grok / other ACP paths | Installed peer; `initialize`, optional Grok `authenticate`, `session/new`, `session/prompt`; text arrives as updates | All permission requests denied; only `end_turn` is accepted as completion |
| `run_judge_panel` | Deduplicates evidence and now supplies explicit item-to-evidence positions | Every accepted reply must cover the exact manifest ids; Jev is not called |
| Skills' vendored panel | [`scripts/panel.py`](../../image-scoring-skills/scripts/neardupe_study/vendor/judge_panel/scripts/panel.py): `build → run → votes → jev → analyze`; batches and resumable raw text | Different implementation from this MCP server; its fixes do not follow automatically |
| Skills' newer study runner | [`run_panel.py`](../../image-scoring-skills/scripts/neardupe_study/run_panel.py): fingerprints, receipts, budget reservations, stream-event processing | Includes stronger input and resume checks than the older vendored runner |
| Current library label-set runner | [`labelset.py`](../../image-scoring-skills/.agent/scratch/library-dedupe-development/labelset.py): separate Claude inline-image path; judges and Jev feed study labels | Study evidence, not owner-verified labels; this scratch implementation is evolving |

The MCP server's `swarm_run` defaults to all available allowed harnesses. Its manifest panel retains the compatibility default of Codex, Antigravity and Claude. The skills panel and scratch label-set runner have their own rosters. A change to one roster does not update the others.

## Historical failures

Paths below are relative to `D:/Projects/image-scoring-skills/.agent-runs/`.

| Evidence | Observation | Assessment |
|---|---|---|
| `20261019-194026-codex-for-each-listed-blind-composite-compare-/result.json` | Exit 2: unexpected `--ask-for-approval` | Already addressed by existing commit `9ec75d3`; preserve its global-option ordering regression test |
| `20261019-211653-codex-for-each-listed-blind-composite-compare-/result.json` | Exit 1: no prompt on stdin | Existing commit `9ec75d3` now delivers prompts via stdin and closes it |
| `20261019-211952-codex-for-each-listed-blind-composite-compare-/result.json` | Exit 2: unexpected positional `judge` | Windows argv/prompt delivery was unreliable; current Codex path avoids passing prompt text through CMD |
| `20261019-194717-agy-compare-a-and-b-in-each-listed-image-top/result.json` and corresponding `...-panel-.../panel.json` | Timed out at 60 seconds after emitting valid-looking JSON; panel counted Antigravity as parsed | Confirmed vote-eligibility defect, fixed in all three swarm/panel paths |
| Three other Antigravity failure records | Timeouts at 180, 120 and 120 seconds, with empty stdout | Preserve as timeouts; the records do not establish whether startup, tools or inference stalled |
| `20261019-211702-claude-for-each-listed-blind-composite-compare-/result.json` | Exit 1 with weekly usage-limit message | Capacity failure, not a visual judgment; no automatic immediate retry |
| `20261019-214431-codex-for-each-listed-blind-composite-compare-/result.json` | Exit 1; stderr reports a usage limit and a retry time | Same distinction; shared subscription capacity can invalidate an otherwise correct command |
| `20261019-194326-panel-for-each-listed-blind-composite-compare-/panel.json` | `ok: true`, zero parsed judges | Process status was being confused with a usable manifest panel; now fails at the panel level |

The recent [`labelset-judge-test.log`](../../image-scoring-skills/.agent/scratch/library-dedupe-development/labelset-judge-test.log) has Codex 5/5 and Antigravity 5/5 parsed, Claude 0/5, and Cursor 0/5. Cursor explicitly reports every image read blocked by a shell syntax error near `&` when starting `hook-pre-tool.ps1`. This localizes that attempt to the hook/tool boundary. It is not evidence that Cursor's model cannot judge images. The later Claude inline-image code is a separate workaround; its existence does not prove this MCP server's Read-based path works.

The user's Grok observation is **user-reported**: 14 inherited MCP servers took approximately 100 seconds to start, exhausting most of a 120-second “say ok” run. The inspected `labelset-grok-test.log` was empty; I did not independently establish those timings from a Grok debug trace. Do not classify that report as an inference hang or assume a longer timeout proves image support.

## Implemented fixes and acceptance criteria

| Priority | Defect | Implemented behavior and proof |
|---|---|---|
| P1 | Plurality reported as strict majority | At least two identical votes and more than half of valid answers to that field are required. 2–1–1 and 2–1–1–1 stay disputed. Regression tests reproduce both failures. |
| P1 | Junction/symlink evidence escaped lexical path validation | Validate physical locations as well as lexical paths, including existing ancestors of missing evidence. Neutral link names cannot hide a secret target. Tests use real temporary Windows junctions; ordinary in-workspace links remain supported. |
| P1 | Artifact-root junction could redirect writes outside the workspace | Resolve and check `.agent-runs` before creating a run directory. A temporary output-root junction is rejected without creating anything in its external target. |
| P1 | Windows batch launch reinterpreted prompt or filename characters | A strictly recognized standard npm Node shim launches its existing JavaScript entry point directly through Node, preserving argv without CMD. Unsupported custom batch launchers reject shell-sensitive arguments. A local subprocess test verifies literal percent expressions, ampersands, quotes, newlines, empty arguments, trailing backslashes and Unicode. Custom bootstrap commands are never silently skipped. |
| P1 | Unexpected runner exception aborted the entire fan-out | Isolate each planned step and return `execution_failed` for that row. Other harnesses finish and retain their outputs and votes. No automatic retry is introduced. |
| P1 | Summary-storage error discarded collected results | Swarm returns `artifact_storage`, `ok: false`, and the collected harness rows. A failed panel-summary write similarly returns the existing votes and stages with an explicit error. |
| P1 | Prompt-pipe errors could crash the host or be marked successful | Handle stdin errors before writing, record failed delivery, and treat every command error as failure even when exit status is zero. Synchronous launch failures also return a failed result instead of rejecting the shared command promise. |
| P1 | Failed or timed-out stdout used as a vote | Only successful harness rows enter agreement in `executeSwarm`, the legacy wrapper, and the manifest panel. Raw failed output remains available for diagnostics. Integration test reproduces the timed-out JSON case. |
| P1 | Empty, malformed, duplicate or wrong-id replies accepted | Empty/malformed rows and duplicate ids reject that reply. A panel reply must contain exactly its manifest ids. A live panel with no usable replies returns `ok: false`; process status remains separately visible in `stages.run`. |
| P1 | JSON extraction selected nested metadata or rescued an inner row from truncated JSON | Parser advances over complete outer objects and does not salvage nested data from an unfinished outer object. Aggregation dictionaries also handle prototype-name keys without crashing. |
| P1 | Artifact collisions | Each run, swarm and panel directory is allocated atomically with a unique suffix. Same-second retries preserve both outputs. Frozen-clock regression test covers all three artifact types. Existing artifacts are untouched. |
| P1 | ACP EOF appeared to hang until timeout; stderr discarded | EOF/read failures fail promptly with the active method name. A bounded 16 KiB stderr/exit diagnostic tail reaches redacted artifact storage. Tests cover launch failure and a final JSON line without a newline. |
| P1 | ACP timeout and incomplete completion were indistinguishable | One total deadline is retained; errors name `initialize`, `authenticate`, `session/new`, or `session/prompt`. Cancelled and other non-`end_turn` replies fail even if they streamed plausible JSON. Tests use simulated peers, not paid requests. |
| P1 | CLI force-kill escalation mistook a sent signal for process exit | Escalation now checks the child's close/error state and clears its timers. A simulated SIGTERM-resistant child receives SIGKILL and resolves as timed out. Descendant process-tree containment remains separate work. |
| P1 | Grok ACP skipped documented authentication | For Grok, select only an advertised `cached_token` or, when already present in the environment, `xai.api_key` method. No browser login or unknown method is attempted. The existing environment whitelist now forwards `XAI_API_KEY`, matching the other providers. No credential is put in the prompt or authentication payload. |
| P2 | Harness aliases caused duplicate launches | Canonicalize before deduplicating planned steps. `agy`, `antigravity`, and fallback `gemini` launch Antigravity once; `agent` and `cursor` launch Cursor once. |
| P2 | Flag discovery matched substrings rather than option names | Share exact flag matching between catalog and legacy detection. `--prompt` and `--print` no longer imply short `-p`; `--permission-mode`, `--prompt-file`, and `--model-route` do not advertise prompt/model flags. Reproduced in unit tests. |
| P2 | Dry-run preview accepted an unsafe custom batch command | Dry-run performs local launch-target validation without starting a child. Unsafe custom batch invocations now fail preflight as well as live execution. |
| P2 | Item ids were disconnected from attachment order | Task includes each item's positions in the deduplicated evidence list. Shared evidence and multiple files per item retain their association without adding filenames to the task suffix. |
| P2 | Blind-panel note contradicted actual prompts | Documentation and returned build note now disclose that evidence paths remain visible. Git context and `extraContext` are omitted; filenames are not anonymized by the server. |

“Majority” means valid answers for that item and field, not the requested roster. Two successful answers can agree even if other requested judges fail or omit that field. One answer remains disputed. A panel's `ok` means at least one usable manifest reply, not that a quorum agreed or that its answer is correct. Rubric-specific enums and required fields are still caller-owned.

The second pass inspected installed launcher metadata and shim source without running provider generations. On this workstation Claude, Antigravity and Grok resolve to native executables; Codex and Gemini have standard npm shims; Cursor's custom batch launcher starts PowerShell and performs separate bootstrap work. Only the exact supported npm template is unwrapped. Other npm versions or customized wrappers may need a native executable or an advertised ACP transport for rich prompts. These are launch-boundary findings and controlled reproductions, not evidence of a historical command-injection incident.

Dry-run is not a hermetic no-process operation: uncached discovery invokes version/help probes. The installed Cursor batch source also calls a staged-version promotion script before delegating to PowerShell. That bootstrap was inspected as text, not executed in this review. A reviewed custom launch profile must account for setup side effects in detection as well as generation; do not treat help probes as proof that inherited startup hooks or MCP initialization are absent.

Physical path validation prevents the reproduced static link escapes. It is not an OS sandbox and cannot eliminate a link-swap race between validation and a provider opening a file, detect every hard-link alias, or constrain what an inherited provider tool can read. Secret detection still uses the configured filename/path rules. Unknown or inaccessible links fail closed; nonexistent evidence can still be previewed if its existing ancestors are safe.

## Remaining work, in dependency order

1. **P1 — establish a controlled judge profile for each provider.** Inventory effective hooks, instructions, tool availability and MCP configuration without logging credentials. Review a per-run isolation plan before changing setup. Claude's `--tools Read` restricts built-in tools, not MCP tools; its documented `--strict-mcp-config` is a separate control. Grok similarly distinguishes built-in tools from MCP servers. ACP's `mcpServers: []` is not evidence that global/project configuration was disabled. Acceptance: a text probe records startup/phase timing and the expected MCP roster; a known image probe demonstrates actual visual access; prohibited writes remain denied. Do not disable global hooks to get a pass. [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), [Grok MCP configuration](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md).

2. **P1 — repair the Cursor hook boundary in its owning setup.** Inspect the actual shell/argv used to launch the PowerShell hook, then fix quoting or shell selection while preserving its policy. Acceptance: the same five-file probe completes five image reads with the safety hook enabled; deliberately denied actions stay denied. Current log identifies the shell error but does not show enough of the launch contract to justify editing shared configuration here.

3. **P1 — unify resume and provenance rules across the skills runners.** The older vendored panel skips existing text based on parse-count ratio alone and folds nonzero exits into a string containing stderr. The newer study runner fingerprints inputs and stores receipts/history; use that as the starting point rather than inventing a third implementation. Acceptance: changed prompt, model, ordered item roster, image bytes, or invocation policy invalidates cached answers; failures retain exit status and partial stdout; collection joins by canonical item id, never list position. Historical raw files are preserved. See the older [`panel.py`](../../image-scoring-skills/scripts/neardupe_study/vendor/judge_panel/scripts/panel.py) and newer [`run_panel.py`](../../image-scoring-skills/scripts/neardupe_study/run_panel.py).

4. **P1 — verify remaining custom launch and process-tree cancellation contracts.** Standard npm Node-shim argument delivery is fixed and unsupported batch-shell syntax is rejected. Cursor's custom launcher still needs a provider-specific, reviewed launch contract that preserves its bootstrap behavior. CLI direct-child escalation is fixed, but MCP grandchildren or inherited stdio can outlive their parent; ACP cleanup currently sends SIGTERM. Acceptance: supported custom launchers deliver the same inert argument fixtures without shell effects; platform timeout tests include descendants holding stdio; only the spawned process tree is cleaned up.

5. **P2 — add bounded readiness and provider failure categories.** Unexpected execution and summary-storage failures now have dedicated codes, but ordinary non-ACP process failures can still surface as generic `harness_unavailable`. Distinguish authentication, subscription limit, image denial, parse failure, MCP startup, and inference timeout. Use saved stderr and status to diagnose before spending another attempt; never turn quota errors into retry loops. Help/PATH discovery remains capability evidence rather than a successful model/image probe. The catalog and legacy runners also have different detection-cache lifetimes; rebuilding or changing a CLI during a running host session requires renewed validation or a reload.

6. **P2 — validate judgments independently.** A unanimous panel can share crop, pose, prompt and model biases. Keep owner labels separate, record unresolved/abstaining items, and evaluate a held-out human-labelled set. Scores and polished explanations do not prove image access. Jev's judgment is not permission to modify files or promote model labels to owner labels. The existing [subject-quality proposal](../../image-scoring-skills/docs/burst-judge-quality-evidence.md) already distinguishes blind labels from informed decisions.

These follow-ups are scoped plans, not claims of deployed fixes. No global setup plan was applied and no paid smoke test was run. Sibling runners require changes and checks in their owning workspace; existing long-running jobs must retain their current receipts and inputs.

## Primary-source checks

- ACP separates initialization, session creation, and prompt turns. A client must honor prompt capabilities, and completion is reported through `stopReason`. This server continues to send text-only ACP prompts; CLI image attachment support must not be assumed to transfer to ACP. [ACP session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx), [ACP prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn).
- Grok's official ACP example performs `authenticate` after `initialize`; assistant text arrives in updates. Its docs also describe suppressing automatic update checks for scripting. Such flags must be verified against the installed binary before adoption. [Grok headless and ACP documentation](https://docs.x.ai/build/cli/headless-scripting).
- Grok now documents headless CLI mode, while this server deliberately exposes Grok through ACP only. Supporting a CLI fallback would require provider-specific detection, image and permission tests; it is not established by the current hardcoded ACP catalog. [Grok CLI reference](https://docs.x.ai/build/cli/reference).

## Additional quota research assessment

The user supplied `D:/Downloads/deep-research-report (12).md` during release preparation. It is dated October 23, whereas this review is dated October 22, and its citation markers do not resolve to source URLs. Treat it as research input rather than evidence of installed capabilities or account entitlement. The relevant claims were checked against official pages on October 22:

| Provider | Verified documented interface | Integration boundary |
|---|---|---|
| Codex | App Server `account/rateLimits/read` and `account/rateLimits/updated`; windows expose used percentage, duration and reset time. | Prefer `rateLimitsByLimitId` when present; the single `rateLimits` view is backward compatible. This is a separate local protocol, not ACP or an API-key subscription lookup. [Official account protocol](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt). |
| Claude Code | Status-line stdin includes optional `rate_limits.five_hour` and `seven_day`, after the first response for supported subscriber sessions. | A missing field means unknown, not zero usage. This does not establish that headless judge runs emit status-line events. Gateway spend is a separate kind of limit. [Official status-line contract](https://code.claude.com/docs/en/statusline). |
| Antigravity | Status-line stdin includes a quota-bucket map with optional remaining fraction/amount and reset fields. | Preserve bucket ids and units. The Windows command runs through CMD; the report's Bash collector cannot be installed unchanged. A TUI payload does not prove a standalone headless quota command exists. [Official status-line contract](https://antigravity.google/docs/cli/statusline). |
| Cursor | Official usage help directs individuals to their plan's dashboard; the API catalog includes organization/team telemetry. | No personal allowance API was established by this check. This is a bounded documentation finding, not proof no such interface exists. Plan windows vary; do not infer personal allowance from spend or request counts. [Usage help](https://prod.cursor.com/help/models-and-usage/usage-limits), [API catalog](https://cursor.com/docs/api). |

Planned readiness work should accept provider-specific, allowlisted quota snapshots with source, account mode, bucket id, units, capture time and reset time. Validate finite numbers and timestamp units; expired or missing snapshots become unknown. Never infer capacity from per-run token counts, API RPM/TPM, or organization budgets. A known exhausted subscription should stop immediate retries; an unknown snapshot must remain visibly unknown. Capability discovery and quota state belong in separate fields.

Implement deterministic snapshot parsing and freshness tests before adding collectors. Codex can later use an explicit read-only App Server adapter; Claude and Antigravity collectors need an inventory and reviewed setup plan, preserve any existing status line, and retain only allowlisted quota data rather than raw payloads containing email, paths and session metadata. Use unique temporary files and atomic replacement for concurrent writers. Do not trigger paid generations merely to fill a quota cache, redeem reset credits, enable overages, read credential stores, or install hooks as a side effect of discovery. These adapters are follow-up scope, not part of the 0.1.1 correctness patch.

## Verification and rollout

Regression cases were run red before their corresponding behavior fixes; targeted suites then passed. Final verification after the second pass: `npm test` passed 119 tests in 20 files; `npm run build` passed; `git diff --check` passed. The package declares no separate lint command. Tests exercise mocked protocol peers, temporary filesystem links, and local Node subprocesses; they do not certify provider availability, model quality, quota, or live image access.

Rebuild completed locally. Reload the MCP host to activate this process's new server code; existing MCP processes keep their loaded version. No host was reloaded during the review.
