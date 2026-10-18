import {
  formatCommandPreview,
  runCommand,
} from "../services/commandRunner.js";
import { evidenceImagePaths } from "../services/pathSafety.js";
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
import { detectCodex } from "./detection.js";

let cachedDetection: AgentDetectionInfo | null = null;

export async function getCodexDetection(
  config: OrchestratorConfig,
  cwd: string,
): Promise<AgentDetectionInfo> {
  if (!cachedDetection) {
    cachedDetection = await detectCodex(config.detectionTimeoutMs, cwd);
  }
  return cachedDetection;
}

export function clearCodexDetectionCache(): void {
  cachedDetection = null;
}

export function buildCodexArgv(
  prompt: string,
  workspaceRoot: string,
  detection: AgentDetectionInfo,
  config: OrchestratorConfig,
  imagePaths: string[] = [],
): string[] {
  const argv = [
    "codex",
    "exec",
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
  ];

  if (detection.supportsCd) {
    argv.push("--cd", workspaceRoot);
  }

  if (config.codex?.jsonOutput && detection.helpSnippet?.includes("--json")) {
    argv.push("--json");
  }

  for (const image of imagePaths) {
    argv.push("--image", image);
  }

  argv.push(prompt);
  return argv;
}

export async function runCodex(
  request: SubagentRequest,
  config: OrchestratorConfig,
): Promise<SubagentResult> {
  const startedAt = new Date().toISOString();
  const detection = await getCodexDetection(config, request.workspaceRoot);

  const snapshot =
    request.mode === "judge"
      ? blindSnapshot(request.workspaceRoot)
      : await captureWorkspaceSnapshot(request.workspaceRoot, request.files);

  const prompt = buildSubagentPrompt({
    agent: "codex",
    task: request.task,
    workspaceRoot: request.workspaceRoot,
    mode: request.mode ?? "review",
    allowWrites: false,
    files: request.files,
    snapshot,
    extraContext: request.extraContext,
  });

  const argv = buildCodexArgv(
    prompt,
    request.workspaceRoot,
    detection,
    config,
    request.mode === "judge"
      ? evidenceImagePaths(request.workspaceRoot, request.files)
      : [],
  );
  const commandPreview = formatCommandPreview(argv);

  if (request.dryRun) {
    const finishedAt = new Date().toISOString();
    const unavailable =
      !detection.available || detection.mode !== "exec";
    return {
      agent: "codex",
      ok: !unavailable,
      exitCode: null,
      stdout: `[dry-run] Would run:\n${commandPreview}${
        unavailable
          ? "\n\n[warning] codex exec not detected on PATH; command may fail if run live."
          : ""
      }`,
      stderr: "",
      startedAt,
      finishedAt,
      durationMs: 0,
      commandPreview,
      prompt,
      error: unavailable
        ? "codex is not available or does not support `codex exec` (dry-run preview only)"
        : undefined,
    };
  }

  if (!detection.available || detection.mode !== "exec") {
    return createErrorResult(
      "codex",
      "codex is not available or does not support `codex exec`",
      commandPreview,
      startedAt,
    );
  }

  const run = await runCommand({
    argv,
    cwd: request.workspaceRoot,
    timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
  });

  const result = finalizeResult("codex", startedAt, commandPreview, run);
  result.prompt = prompt;
  return result;
}
