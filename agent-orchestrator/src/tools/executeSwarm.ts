import { runAcpTurn } from "../acp/client.js";
import { spawnAcpProcess } from "../acp/spawn.js";
import { clampTimeout, getWorkspaceRoot, loadConfig } from "../config.js";
import { detectionFromObservation, observeHarnesses } from "../harness/observe.js";
import {
  applyModel,
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
import { formatCommandPreview, runCommand } from "../services/commandRunner.js";
import {
  evidenceDirectories,
  evidenceImagePaths,
  PathSafetyError,
  validateAndResolveFiles,
  validateEvidenceFiles,
} from "../services/pathSafety.js";
import { blindSnapshot, buildSubagentPrompt } from "../services/promptBuilder.js";
import {
  relativeOutputPath,
  storeRunResult,
  storeSwarmSummary,
} from "../services/resultStore.js";
import { redactSecrets } from "../services/redaction.js";
import { agreeVotes, type SwarmAgreement } from "../services/votes.js";
import { captureWorkspaceSnapshot } from "../services/workspaceSnapshot.js";
import type {
  OrchestratorConfig,
  SubagentMode,
  SubagentRequest,
  SubagentResult,
} from "../types.js";
import { createErrorResult, finalizeResult } from "../runners/base.js";

export interface ExecuteSwarmInput {
  task: string;
  files?: string[];
  harnesses?: string[];
  model?: string;
  transport?: TransportChoice;
  mode?: SubagentMode;
  timeoutMs?: number;
  dryRun?: boolean;
  extraContext?: string;
  observations?: HarnessObservation[];
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
  if (/timed out/i.test(message) || message === "timeout") {
    return swarmError(
      "timeout",
      message,
      {},
      ["Raise timeoutMs or retry this harness."],
      true,
    );
  }
  if (/acp_protocol/i.test(message)) {
    return swarmError(
      "acp_protocol",
      "The ACP handshake failed for this harness.",
      { message },
      ["Retry with transport cli when that harness has a print mode."],
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
  if (plan.transport === "acp") {
    return plan.observation.acpArgv ?? [];
  }
  if (plan.id === "codex") {
    return buildCodexArgv(
      prompt,
      request.workspaceRoot,
      detection,
      config,
      images,
      plan.model,
    );
  }
  if (plan.id === "agy") {
    return buildAntigravityArgv(prompt, detection, dirs, plan.model);
  }
  if (plan.id === "claude") {
    return buildClaudeArgv(prompt, dirs, plan.model);
  }
  const flag = plan.observation.promptFlag ?? "-p";
  const bin = plan.observation.spec.cliArgv?.[0] ?? plan.id;
  return applyModel([bin, flag, prompt], plan.id, plan.model);
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
      });
      const stderr =
        turn.deniedPermissions > 0
          ? `Denied ${turn.deniedPermissions} ACP permission request(s).`
          : "";
      return finalizeResult(plan.id, startedAt, commandPreview, {
        exitCode: 0,
        stdout: turn.text,
        stderr,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return createErrorResult(
        plan.id,
        message === "timeout" ? `Command timed out after ${request.timeoutMs}ms` : "acp_protocol",
        commandPreview,
        startedAt,
      );
    }
  }

  const run = await runCommand({
    argv,
    cwd: request.workspaceRoot,
    timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
  });
  return finalizeResult(plan.id, startedAt, commandPreview, run);
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
  const result = await runPlan(step.plan, request, config, prompt);
  const stored = storeRunResult(
    request.workspaceRoot,
    { ...request, agent: step.plan.id, model: step.plan.model },
    result,
    config,
    result.prompt,
  );
  return {
    id: step.plan.id,
    transport: step.plan.transport,
    ok: result.ok,
    summary: brief(result),
    outputDir: stored ? relativeOutputPath(request.workspaceRoot, stored.runDir) : undefined,
    outputFile: stored ? relativeOutputPath(request.workspaceRoot, stored.stdoutFile) : undefined,
    commandPreview: result.commandPreview,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    error: runtimeError(result),
    stdout: result.stdout,
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
    transport: input.transport,
    allowed: config.allowedAgents,
  });
  if (!planned.ok) {
    return { ok: false, dryRun, harnesses: [], error: planned.error };
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
  };

  const promptFor = async (plan: RunnablePlan): Promise<string> => {
    const snapshot =
      mode === "judge"
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
    planned.steps.map((step) => executeStep(step, request, config, promptFor)),
  );

  const votes = harnesses.filter((row) => row.transport !== null);
  const agreement =
    !dryRun && votes.length >= 2
      ? agreeVotes(votes.map((row) => ({ agent: row.id, text: row.stdout })))
      : undefined;

  const ok = dryRun ? harnesses.every((row) => row.ok) : harnesses.some((row) => row.ok);
  const publicRows = harnesses;
  const stored = storeSwarmSummary(
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
