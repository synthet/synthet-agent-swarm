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
import { createErrorResult, finalizeResult } from "./base.js";
import { detectAntigravity, getAntigravityCommand } from "./detection.js";

let cachedDetection: AgentDetectionInfo | null = null;

export async function getAntigravityDetection(
  config: OrchestratorConfig,
  cwd: string,
): Promise<AgentDetectionInfo> {
  if (!cachedDetection) {
    cachedDetection = await detectAntigravity(config.detectionTimeoutMs, cwd);
  }
  return cachedDetection;
}

export function clearAntigravityDetectionCache(): void {
  cachedDetection = null;
}

export function buildAntigravityArgv(
  prompt: string,
  detection: AgentDetectionInfo,
  addDirs: string[] = [],
): string[] {
  const flag = detection.promptFlag ?? "-p";
  const command = detection.command || getAntigravityCommand();
  const argv = [command, flag, prompt];
  for (const dir of addDirs) argv.push("--add-dir", dir);
  return argv;
}

export async function runAntigravity(
  request: SubagentRequest,
  config: OrchestratorConfig,
): Promise<SubagentResult> {
  const startedAt = new Date().toISOString();
  const detection = await getAntigravityDetection(config, request.workspaceRoot);

  const snapshot =
    request.mode === "judge"
      ? blindSnapshot(request.workspaceRoot)
      : await captureWorkspaceSnapshot(request.workspaceRoot, request.files);

  const prompt = buildSubagentPrompt({
    agent: "antigravity",
    task: request.task,
    workspaceRoot: request.workspaceRoot,
    mode: request.mode ?? "review",
    allowWrites: false,
    files: request.files,
    snapshot,
    extraContext: request.extraContext,
  });

  const argv = buildAntigravityArgv(
    prompt,
    detection,
    request.mode === "judge"
      ? evidenceDirectories(request.workspaceRoot, request.files)
      : [],
  );
  const commandPreview = formatCommandPreview(argv);

  if (request.dryRun) {
    const finishedAt = new Date().toISOString();
    const unavailable =
      !detection.available || detection.mode !== "prompt";
    return {
      agent: "antigravity",
      ok: !unavailable,
      exitCode: null,
      stdout: `[dry-run] Would run:\n${commandPreview}${
        unavailable
          ? "\n\n[warning] agy -p/--prompt/--print not detected on PATH; command may fail if run live."
          : ""
      }`,
      stderr: "",
      startedAt,
      finishedAt,
      durationMs: 0,
      commandPreview,
      prompt,
      error: unavailable
        ? "antigravity is not available or does not support non-interactive -p/--prompt/--print mode (dry-run preview only)"
        : undefined,
    };
  }

  if (!detection.available || detection.mode !== "prompt") {
    return createErrorResult(
      "antigravity",
      "antigravity is not available or does not support non-interactive -p/--prompt/--print mode",
      commandPreview,
      startedAt,
    );
  }

  const run = await runCommand({
    argv,
    cwd: request.workspaceRoot,
    timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
  });

  const result = finalizeResult("antigravity", startedAt, commandPreview, run);
  result.prompt = prompt;
  return result;
}
