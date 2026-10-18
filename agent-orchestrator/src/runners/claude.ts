import {
  formatCommandPreview,
  runCommand,
} from "../services/commandRunner.js";
import { evidenceDirectories } from "../services/pathSafety.js";
import {
  blindSnapshot,
  buildSubagentPrompt,
} from "../services/promptBuilder.js";
import { captureWorkspaceSnapshot } from "../services/workspaceSnapshot.js";
import type {
  AgentDetectionInfo,
  OrchestratorConfig,
  SubagentRequest,
  SubagentResult,
} from "../types.js";
import { applyModel } from "../harness/registry.js";
import { createErrorResult, finalizeResult } from "./base.js";
import { detectClaude } from "./detection.js";

let cachedDetection: AgentDetectionInfo | null = null;

export async function getClaudeDetection(
  config: OrchestratorConfig,
  cwd: string,
): Promise<AgentDetectionInfo> {
  if (!cachedDetection) {
    cachedDetection = await detectClaude(config.detectionTimeoutMs, cwd);
  }
  return cachedDetection;
}

export function clearClaudeDetectionCache(): void {
  cachedDetection = null;
}

export function buildClaudeArgv(
  prompt: string,
  addDirs: string[] = [],
  model?: string,
): string[] {
  const argv = ["claude", "-p", prompt];
  if (addDirs.length > 0) {
    argv.push("--tools", "Read");
    for (const dir of addDirs) argv.push("--add-dir", dir);
  }
  return applyModel(argv, "claude", model);
}

export async function runClaude(
  request: SubagentRequest,
  config: OrchestratorConfig,
): Promise<SubagentResult> {
  const startedAt = new Date().toISOString();
  const detection = await getClaudeDetection(config, request.workspaceRoot);

  const snapshot =
    request.mode === "judge"
      ? blindSnapshot(request.workspaceRoot)
      : await captureWorkspaceSnapshot(request.workspaceRoot, request.files);

  const prompt = buildSubagentPrompt({
    agent: "claude",
    task: request.task,
    workspaceRoot: request.workspaceRoot,
    mode: request.mode ?? "review",
    allowWrites: false,
    files: request.files,
    snapshot,
    extraContext: request.extraContext,
  });

  const argv = buildClaudeArgv(
    prompt,
    request.mode === "judge"
      ? evidenceDirectories(request.workspaceRoot, request.files)
      : [],
    request.model,
  );
  const commandPreview = formatCommandPreview(argv);

  if (request.dryRun) {
    const finishedAt = new Date().toISOString();
    const unavailable = !detection.available || detection.mode !== "print";
    return {
      agent: "claude",
      ok: !unavailable,
      exitCode: null,
      stdout: `[dry-run] Would run:\n${commandPreview}${
        unavailable
          ? "\n\n[warning] claude -p not detected on PATH; command may fail if run live."
          : ""
      }`,
      stderr: "",
      startedAt,
      finishedAt,
      durationMs: 0,
      commandPreview,
      prompt,
      error: unavailable
        ? "claude is not available or does not support non-interactive -p/--print mode (dry-run preview only)"
        : undefined,
    };
  }

  if (!detection.available) {
    return createErrorResult(
      "claude",
      "claude CLI is not available on PATH",
      commandPreview,
      startedAt,
    );
  }

  if (detection.mode !== "print") {
    return createErrorResult(
      "claude",
      "The installed Claude CLI was found, but no supported non-interactive mode was detected.",
      commandPreview,
      startedAt,
    );
  }

  const run = await runCommand({
    argv,
    cwd: request.workspaceRoot,
    timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
  });

  const result = finalizeResult("claude", startedAt, commandPreview, run);
  result.prompt = prompt;
  return result;
}
