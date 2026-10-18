# synthet-agent-swarm

This repo runs the same read-only judgement on Codex, Antigravity, and Claude, stores each raw reply, and reports agreement. A field is agreed only when at least two judges share a strict majority. Ties and single votes stay disputed.

Agent-panel labels are evidence. They are not owner labels and not ground truth. Rendering blind images, calling Jev, and writing label files stay in the project that owns the study.

Cursor and Gemini appear in the image-scoring panels below. This server does not invoke them yet.

## What the image-scoring projects do

### Shared harness

`judge-panel` (`scripts/panel.py`, vendored at `D:\Projects\image-scoring-skills\scripts\neardupe_study\vendor\judge_panel\`) runs Claude, Codex, Antigravity, and Cursor over blind images:

`build -> run -> votes -> jev -> analyze`

Judges do not see scores, model names, or human labels. Raw replies are resumable. Jev adjudicates text only, after a dry-run. Human labels are never overwritten. Near-duplicate audit `audit_v27_panel.py` used that harness: Claude, Codex, Antigravity, and Cursor answered SAME 4/4, then one Jev call chose `keep_5213_only`.

### Backend research panels

| Script | Judges | Decision |
|---|---|---|
| `D:\Projects\image-scoring-backend\scripts\research\judges\species_panel.py` | claude, codex, agy, cursor, gemini | Blind species A/B. Consensus is an agent-panel label. |
| `scripts\research\judges\box_panel.py` | same CLI plumbing | Box grades (`usable` or `tight`). Not an owner gate. |
| `scripts\research\judges\culling_panel.py` | same CLI plumbing | Burst pick / keep / reject. Splits go to Jev outside the script. |
| `scripts\research\scene_route\cli_judges.py` | codex, agy, claude | Scene majority. Not ground truth. |
| `scripts\research\detector_benchmark\v1_regate_judges.py` | reuses `cli_judges.command` | Box pre-screen before owner labelling. |

`species_panel.py` is the shared host runner for the three `judges\` panels. Codex receives `--image` attachments. Claude is told to Read the files. Cursor is invoked through `node index.js` because the `.cmd` shim splits the prompt. Antigravity in that script passes `--dangerously-skip-permissions`. This swarm does not. It stays on the non-interactive prompt flag and `--add-dir`.

The focus-measure report (`docs\reports\BIRD_CROP_FOCUS_MEASURES_2026-08-03.md`) records the limit: judges who see the same sheet make correlated errors, so the panel does not replace a human label.

### Skills workflows

| Workflow | What the swarm does | What it must not do |
|---|---|---|
| `photo-folder-score` | Cursor, Claude, Codex, and Antigravity each score 1–10 as evidence | Jev makes keep / cull / carousel decisions |
| `bird-crop-label` | Claude, Codex, and Antigravity vote `best` / `good` / `reject` per burst | The merge writes only the `verdict` column, with a UUID sidecar |
| `lightroom-edit`, `species-caption` | Several CLIs contribute to one artifact | Not a blind vote with a majority rule |

## This server

```bash
cd agent-orchestrator
npm run build
node dist/index.js swarm --task "Return JSON only: {\"images\":[{\"id\":\"a\",\"choice\":\"A\"}]}" --files blind/a.jpg --dry-run
```

MCP: `swarm_search`, then `swarm_run` with `mode: "judge"` and the evidence `files`. Omit `harnesses` to use every available harness, or pass ids such as `codex` and `agy`. Optional `model` is sent only when every selected harness advertises `--model`. `run_judge_panel` is the manifest workflow: it validates item ids and evidence, runs that swarm, and returns votes, a text-only Jev state, and an optional comparison with human labels. It does not call Jev, render images, or mutate files. `mode: "review"` remains a code review.

Judge mode omits git status and diffs, allows image evidence (png, jpg, jpeg, gif, webp) inside the workspace, and still refuses secrets and other binaries. Codex gets `--image`. Claude gets `--tools Read` and `--add-dir`. Antigravity gets `--add-dir` and no permission-skip flag.

Parsed votes come from the last JSON object in each reply. An `images` array is one item per row (`id`, `image_id`, or `key`). Any other JSON object is a single `_reply` item. The swarm writes `.agent-runs/<timestamp>-swarm-<slug>/swarm.json` plus one directory per judge.

This server is a standalone MCP. It does not call the ai-quotas dashboard or any other quota service before starting a judge.

Default transport is `auto`: the one-shot CLI when help shows exec or print mode, otherwise ACP when that command is already on PATH. ACP permission requests are denied. The harness matrix is [acp-harness-matrix.md](acp-harness-matrix.md). The tool contract is [api.md](api.md).
