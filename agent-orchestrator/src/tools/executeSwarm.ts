import { AcpTurnError, runAcpTurn } from "../acp/client.js";
import { spawnAcpProcess } from "../acp/spawn.js";
import { clampTimeout, getWorkspaceRoot, loadConfig } from "../config.js";
import { detectionFromObservation, observeHarnesses } from "../harness/observe.js";
import {
  applyModel,
  helpHasFlag,
  planSwarmRun,
  swarmError,
  type HarnessObservation,
  type PlanStep,
  type RunnablePlan,
  type SwarmError,
  type TransportChoice,
} from "../harness/registry.js";
import { buildAntigravityArgv } from "../runners/antigravity.js";
import { buildClaudeArgv } from "../runners/claude.js";
import { buildCodexArgv } from "../runners/codex.js";
import { runSubagentForRequest } from "../runners/index.js";
import { buildChildEnv, formatCommandPreview, runCommand } from "../services/commandRunner.js";
import { withHarnessSlot } from "../services/harnessSlots.js";
import { beginRun, endRun } from "../services/runRegistry.js";
import { resolveSpawnTarget } from "../services/resolveExecutable.js";
import {
  evidenceDirectories,
  evidenceImagePaths,
  PathSafetyError,
  validateAndResolveFiles,
  validateEvidenceFiles,
} from "../services/pathSafety.js";
import { blindSnapshot, buildSubagentPrompt, usesBlindSnapshot } from "../services/promptBuilder.js";
import {
  relativeOutputPath,
  storeRunResult,
  storeSwarmSummary,
} from "../services/resultStore.js";
import { redactSecrets } from "../services/redaction.js";
import { agreeVotes, type SwarmAgreement } from "../services/votes.js";
import { captureWorkspaceSnapshot } from "../services/workspaceSnapshot.js";
import type { OutputFormat, RunOutcome } from "../services/eventParse.js";
import type {
  ModelAttempt,
  OrchestratorConfig,
  SubagentMode,
  SubagentRequest,
  SubagentResult,
} from "../types.js";
import { finalizeResult } from "../runners/base.js";

export interface ExecuteSwarmInput {
  task: string;
  files?: string[];
  harnesses?: string[];
  model?: string;
  modelChains?: Record<string, string[]>;
  transport?: TransportChoice;
  mode?: SubagentMode;
  timeoutMs?: number;
  dryRun?: boolean;
  extraContext?: string;
  observations?: HarnessObservation[];
  /** Continue this session id on the one selected harness. */
  resumeSessionId?: string;
  /** Per-run spend cap where the harness supports one. */
  budgetUsd?: number;
}

export interface HarnessRunRow {
  id: string;
  transport: "cli" | "acp" | null;
  ok: boolean;
  summary: string;
  outputDir?: string;
  outputFile?: string;
  commandPreview?: string;
  exitCode: number | null;
  durationMs: number;
  error?: SwarmError;
  stdout: string;
  model?: string;
  reportedModel?: string;
  attempts?: ModelAttempt[];
  outcome?: RunOutcome;
  sessionId?: string;
  costUsd?: number;
  denials?: number;
}

export interface SwarmRunResponse {
  ok: boolean;
  dryRun: boolean;
  outputDir?: string;
  harnesses: HarnessRunRow[];
  agreement?: SwarmAgreement;
  error?: SwarmError;
}

function brief(result: SubagentResult): string {
  if (result.error) return result.error;
  const redacted = redactSecrets(result.stdout).trim();
  const line = redacted.split("\n").find((item) => item.trim().length > 0) ?? "";
  if (!line) return "No stdout output.";
  return line.length > 240 ? `${line.slice(0, 240)}...` : line;
}

function runtimeError(result: SubagentResult): SwarmError | undefined {
  if (result.ok) return undefined;
  const message = result.error ?? "Harness failed.";
  if (result.outcome === "auth_required") {
    return swarmError("auth_required", message, { harness: result.agent }, [
      "Sign the harness in on this host, or set its API key in the environment, then retry.",
    ]);
  }
  if (result.outcome === "rate_limited") {
    return swarmError("rate_limited", message, { harness: result.agent }, [
      "Wait for the provider's rate limit to reset, or use another harness.",
    ], true);
  }
  if (result.outcome === "empty_output") {
    return swarmError("empty_output", message, { harness: result.agent }, [
      "The process exited 0 without a reply. On Windows, agy prints nothing without a TTY (antigravity-cli#76); use another harness or its ACP transport.",
    ]);
  }
  if (/timed out/i.test(message) || message === "timeout") {
    return swarmError(
      "timeout",
      message,
      {},
      ["Inspect the recorded phase and stderr before retrying. timeoutMs covers startup, MCP initialization, and the prompt; increase it only within the run budget."],
      true,
    );
  }
  if (/acp_protocol|\bACP\b/i.test(message)) {
    return swarmError(
      "acp_protocol",
      message,
      { message },
      ["Inspect the phase and saved stderr. Use transport cli only when swarm_search advertises it."],
    );
  }
  return swarmError("harness_unavailable", message, { harness: result.agent });
}

function commandArgv(
  plan: RunnablePlan,
  request: SubagentRequest,
  config: OrchestratorConfig,
  prompt: string,
): string[] {
  const detection = detectionFromObservation(plan.observation);
  const images =
    request.mode === "judge"
      ? evidenceImagePaths(request.workspaceRoot, request.files)
      : [];
  const dirs =
    request.mode === "judge"
      ? evidenceDirectories(request.workspaceRoot, request.files)
      : [];
  // Blind file-only judges must not initialize unrelated user MCP servers.
  // This reserved non-matching allowlist entry changes only the child invocation.
  const geminiIsolation = plan.id === "gemini" && request.mode === "judge" &&
    /(?:^|\s)--allowed-mcp-server-names(?=[\s,=]|$)/m.test(plan.observation.cliHelp)
      ? ["--allowed-mcp-server-names", "__synthet_swarm_file_only__"] : [];
  if (plan.transport === "acp") {
    return [...(plan.observation.acpArgv ?? []), ...geminiIsolation];
  }
  if (plan.id === "codex") {
    return buildCodexArgv(
      prompt,
      request.workspaceRoot,
      detection,
      config,
      images,
      plan.model,
      request.resumeSessionId,
    );
  }
  if (plan.id === "agy") {
    return buildAntigravityArgv(prompt, detection, dirs, plan.model, request.resumeSessionId);
  }
  if (plan.id === "claude") {
    return buildClaudeArgv(prompt, dirs, plan.model, {
      maxBudgetUsd: request.budgetUsd ?? config.claude?.maxBudgetUsd,
      resumeSessionId: request.resumeSessionId,
      respond: request.mode === "respond",
    });
  }
  const flag = plan.observation.promptFlag ?? "-p";
  const bin = plan.observation.spec.cliArgv?.[0] ?? plan.id;
  return applyModel(
    [
      bin, ...geminiIsolation, flag, prompt, ...cursorJson(plan),
      ...(request.resumeSessionId && plan.id === "cursor" ? ["--resume", request.resumeSessionId] : []),
      ...(request.mode === "respond" && plan.id === "cursor" ? ["--mode=ask"] : []),
    ],
    plan.id,
    plan.model,
  );
}

function cursorJson(plan: RunnablePlan): string[] {
  return plan.id === "cursor" && helpHasFlag(plan.observation.cliHelp, "--output-format")
    ? ["--output-format", "json"]
    : [];
}

function genericFormat(plan: RunnablePlan, argv: string[]): OutputFormat | undefined {
  return plan.transport === "cli" && plan.id === "cursor" && argv.includes("--output-format")
    ? "cursor-json"
    : undefined;
}

async function runPlan(
  plan: RunnablePlan,
  request: SubagentRequest,
  config: OrchestratorConfig,
  prompt: string,
): Promise<SubagentResult> {
  const argv = commandArgv(plan, request, config, prompt);
  const commandPreview = formatCommandPreview(argv);
  const startedAt = new Date().toISOString();

  if (request.dryRun) {
    resolveSpawnTarget(argv[0] ?? "", argv.slice(1), buildChildEnv());
    return {
      agent: plan.id,
      ok: true,
      exitCode: null,
      stdout: `[dry-run] Would run:\n${commandPreview}`,
      stderr: "",
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      commandPreview,
      prompt,
    };
  }

  if (plan.transport === "cli" && (plan.id === "codex" || plan.id === "agy" || plan.id === "claude")) {
    const legacyAgent = plan.id === "agy" ? "antigravity" : plan.id;
    const result = await runSubagentForRequest(
      { ...request, agent: legacyAgent, model: plan.model },
      config,
    );
    return { ...result, agent: plan.id };
  }

  if (plan.transport === "acp") {
    const io = spawnAcpProcess(argv, request.workspaceRoot);
    try {
      const turn = await runAcpTurn(io, {
        cwd: request.workspaceRoot,
        prompt,
        timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
        model: plan.model,
        authMethodIds: plan.id === "grok"
          ? process.env.XAI_API_KEY ? ["xai.api_key", "cached_token"] : ["cached_token"]
          : undefined,
        resumeSessionId: request.resumeSessionId,
      });
      const stderr =
        turn.deniedPermissions > 0
          ? `Denied ${turn.deniedPermissions} ACP permission request(s).`
          : "";
      const restoreWarning = turn.modelRestoreFailed
        ? "Could not restore the ACP peer's previous default model."
        : "";
      const result = finalizeResult(plan.id, startedAt, commandPreview, {
        exitCode: 0,
        stdout: turn.text,
        stderr: [io.diagnostics?.(), stderr, restoreWarning].filter(Boolean).join("\n"),
      });
      if (turn.deniedPermissions > 0) {
        result.denials = turn.deniedPermissions;
        if (result.outcome === "ok") result.outcome = "permission_denied";
      }
      return { ...result, reportedModel: turn.reportedModel, sessionId: turn.sessionId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return finalizeResult(plan.id, startedAt, commandPreview, {
        exitCode: null,
        stdout: err instanceof AcpTurnError ? err.text : "",
        stderr: io.diagnostics?.() ?? "",
        error: err instanceof AcpTurnError ? redactSecrets(message) : "acp_protocol",
        timedOut: err instanceof AcpTurnError && err.code === "timeout",
      });
    }
  }

  const run = await runCommand({
    argv,
    cwd: request.workspaceRoot,
    timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
  });
  return finalizeResult(plan.id, startedAt, commandPreview, run, genericFormat(plan, argv));
}

/** Try models in order until one answers. Scoring the answer stays with the caller. */
export async function walkModelChain<T extends { ok: boolean; stdout: string }>(
  models: string[],
  attempt: (model: string) => Promise<T>,
): Promise<{ row: T; attempts: T[] }> {
  const attempts: T[] = [];
  for (const model of models) {
    const row = await attempt(model);
    attempts.push(row);
    if (row.ok && row.stdout.trim() !== "") break;
  }
  return { row: attempts[attempts.length - 1], attempts };
}

async function executeStep(
  step: PlanStep,
  request: SubagentRequest,
  config: OrchestratorConfig,
  promptFor: (plan: RunnablePlan) => Promise<string>,
): Promise<HarnessRunRow> {
  if (step.kind === "skip") {
    return {
      id: step.skip.id,
      transport: null,
      ok: false,
      summary: step.skip.error.message,
      exitCode: null,
      durationMs: 0,
      error: step.skip.error,
      stdout: "",
    };
  }

  const prompt = await promptFor(step.plan);
  const chain = step.plan.models;
  if (!chain) return runModel(step.plan, request, config, prompt);
  const { row, attempts } = await walkModelChain(
    request.dryRun ? chain.slice(0, 1) : chain,
    (model) => runModel({ ...step.plan, model }, request, config, prompt),
  );
  return {
    ...row,
    attempts: attempts.map((attempt) => ({
      model: attempt.model as string,
      ok: attempt.ok,
      error: attempt.error?.message,
      outputDir: attempt.outputDir,
      outputFile: attempt.outputFile,
      durationMs: attempt.durationMs,
    })),
  };
}

async function runModel(
  plan: RunnablePlan,
  request: SubagentRequest,
  config: OrchestratorConfig,
  prompt: string,
): Promise<HarnessRunRow> {
  const run = async () => {
    const runId = beginRun({ harness: plan.id, transport: plan.transport, model: plan.model });
    try {
      const done = await runPlan(plan, request, config, prompt);
      endRun(runId, { ok: done.ok, outcome: done.outcome, sessionId: done.sessionId });
      return done;
    } catch (err) {
      endRun(runId, { ok: false, outcome: "error" });
      throw err;
    }
  };
  const result = {
    ...(await (request.dryRun
      ? runPlan(plan, request, config, prompt)
      : withHarnessSlot(plan.id, config.concurrency?.perHarness ?? 2, run))),
    model: plan.model,
  };
  const stored = storeRunResult(
    request.workspaceRoot,
    { ...request, agent: plan.id, model: plan.model },
    result,
    config,
    result.prompt,
  );
  return {
    id: plan.id,
    transport: plan.transport,
    model: plan.model,
    reportedModel: result.reportedModel,
    ok: result.ok,
    summary: brief(result),
    outputDir: stored ? relativeOutputPath(request.workspaceRoot, stored.runDir) : undefined,
    outputFile: stored ? relativeOutputPath(request.workspaceRoot, stored.stdoutFile) : undefined,
    commandPreview: result.commandPreview,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    error: runtimeError(result),
    stdout: result.stdout,
    outcome: result.outcome,
    sessionId: result.sessionId,
    costUsd: result.costUsd,
    denials: result.denials,
  };
}

export async function executeSwarm(input: ExecuteSwarmInput): Promise<SwarmRunResponse> {
  const workspaceRoot = getWorkspaceRoot();
  const config = loadConfig(workspaceRoot);
  const dryRun = input.dryRun ?? false;
  const mode = input.mode ?? "review";

  try {
    if (mode === "judge") validateEvidenceFiles(workspaceRoot, input.files);
    else validateAndResolveFiles(workspaceRoot, input.files);
  } catch (err) {
    const message = err instanceof PathSafetyError ? err.message : String(err);
    return {
      ok: false,
      dryRun,
      harnesses: [],
      error: swarmError("path_rejected", message, {}, [
        "Pass workspace-relative evidence paths inside the workspace boundary.",
      ]),
    };
  }

  const observations =
    input.observations ??
    (await observeHarnesses(workspaceRoot, config.detectionTimeoutMs));
  const planned = planSwarmRun({
    observations,
    harnesses: input.harnesses,
    model: input.model,
    modelChains: input.modelChains,
    transport: input.transport,
    allowed: config.allowedAgents,
  });
  if (!planned.ok) {
    return { ok: false, dryRun, harnesses: [], error: planned.error };
  }
  if (mode === "respond") {
    const problem = respondProblem(input, planned.steps);
    if (problem) {
      return {
        ok: false, dryRun, harnesses: [],
        error: swarmError("invalid_arguments", problem, { mode }, [
          `Pass exactly one of ${RESPOND_HARNESSES.join(", ")} on the cli transport.`,
        ]),
      };
    }
  }
  if (input.resumeSessionId) {
    const problem = resumeProblem(input, planned.steps, mode);
    if (problem) {
      return {
        ok: false, dryRun, harnesses: [],
        error: swarmError("invalid_arguments", problem, { resume: input.resumeSessionId }, [
          "Pass resume with exactly one harness, no modelChains, and a mode other than judge.",
        ]),
      };
    }
  }

  const request: SubagentRequest = {
    agent: "swarm",
    task: input.task,
    workspaceRoot,
    files: input.files,
    mode,
    timeoutMs: clampTimeout(input.timeoutMs, config),
    dryRun,
    allowWrites: false,
    extraContext: input.extraContext,
    model: input.model,
    resumeSessionId: input.resumeSessionId,
    budgetUsd: input.budgetUsd,
  };

  const promptFor = async (plan: RunnablePlan): Promise<string> => {
    const snapshot =
      usesBlindSnapshot(mode)
        ? blindSnapshot(workspaceRoot)
        : await captureWorkspaceSnapshot(workspaceRoot, input.files);
    return buildSubagentPrompt({
      agent: plan.id === "agy" ? "antigravity" : plan.id,
      task: input.task,
      workspaceRoot,
      mode,
      allowWrites: false,
      files: input.files,
      snapshot,
      extraContext: input.extraContext,
    });
  };

  const harnesses = await Promise.all(
    planned.steps.map(async (step): Promise<HarnessRunRow> => {
      try {
        return await executeStep(step, request, config, promptFor);
      } catch (err) {
        const id = step.kind === "run" ? step.plan.id : step.skip.id;
        const message = redactSecrets(err instanceof Error ? err.message : String(err));
        return {
          id,
          transport: step.kind === "run" ? step.plan.transport : null,
          ok: false,
          summary: message,
          stdout: "",
          exitCode: null,
          durationMs: 0,
          error: swarmError("execution_failed", message, { harness: id }, [
            "Inspect this harness's launch and artifact-storage diagnostics. Other harness results are retained.",
          ]),
        };
      }
    }),
  );

  const votes = harnesses.filter((row) => row.transport !== null && row.ok);
  const agreement =
    !dryRun && harnesses.filter((row) => row.transport !== null).length >= 2
      ? agreeVotes(votes.map((row) => ({ agent: row.id, text: row.stdout })))
      : undefined;

  const ok = dryRun ? harnesses.every((row) => row.ok) : harnesses.some((row) => row.ok);
  const publicRows = harnesses;
  let stored: string | null;
  try {
    stored = storeSwarmSummary(
      workspaceRoot,
      input.task,
      {
        task: input.task,
        dryRun,
        harnesses: publicRows.map(({ stdout: _stdout, ...row }) => row),
        agreement,
      },
      config,
    );
  } catch (err) {
    return {
      ok: false, dryRun, harnesses, agreement,
      error: swarmError("artifact_storage", "Could not store the swarm summary.", {
        message: redactSecrets(err instanceof Error ? err.message : String(err)),
      }, ["Check output-directory access and disk space. Collected harness results are included in this response."]),
    };
  }

  const failed = harnesses.filter((row) => !row.ok);
  return {
    ok,
    dryRun,
    outputDir: stored ? relativeOutputPath(workspaceRoot, stored) : undefined,
    harnesses,
    agreement,
    error:
      ok || failed.length === 0
        ? undefined
        : failed.length === harnesses.length
          ? failed[0]?.error
          : undefined,
  };
}

/**
 * Harnesses whose read-only limits a responder relies on: Claude with --tools Read,Grep,Glob, Codex in
 * its read-only sandbox, Cursor in ask mode. Antigravity is left out: a non-TTY child on Windows prints
 * nothing (antigravity-cli#76) and soft-denies with exit 0.
 */
export const RESPOND_HARNESSES = ["claude", "codex", "cursor"] as const;

function respondProblem(input: ExecuteSwarmInput, steps: PlanStep[]): string | null {
  if ((input.harnesses?.length ?? 0) !== 1 || steps.length !== 1) return "respond mode needs exactly one harness.";
  const step = steps[0];
  if (step?.kind !== "run") return null;
  if (!(RESPOND_HARNESSES as readonly string[]).includes(step.plan.id)) {
    return `respond mode does not support ${step.plan.id}.`;
  }
  if (step.plan.transport !== "cli") return "respond mode runs only on the cli transport.";
  return null;
}

/** Resume continues one known session; it is not a fan-out. */
function resumeProblem(input: ExecuteSwarmInput, steps: PlanStep[], mode: SubagentMode): string | null {
  if ((input.harnesses?.length ?? 0) !== 1 || steps.length !== 1) return "resume needs exactly one harness.";
  if (input.modelChains && Object.keys(input.modelChains).length > 0) return "resume cannot be combined with modelChains.";
  if (mode === "judge") return "resume is not available in judge mode; judges start fresh.";
  const step = steps[0];
  if (step?.kind === "run" && step.plan.transport === "cli" && step.plan.id === "gemini") {
    return "The gemini CLI runner has no resume flag.";
  }
  return null;
}

/** Drop stdout before an MCP response. Agreement already consumed it. */
export function publicHarnesses(
  harnesses: HarnessRunRow[],
): Omit<HarnessRunRow, "stdout">[] {
  return harnesses.map(({ stdout: _stdout, ...row }) => row);
}

export function legacyAgentName(id: string): string {
  if (id === "agy") return "antigravity";
  return id;
}
