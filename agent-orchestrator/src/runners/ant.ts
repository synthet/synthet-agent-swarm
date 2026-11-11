import { formatCommandPreview, runCommand } from "../services/commandRunner.js";
import {
  blindSnapshot,
  buildSubagentPrompt,
  usesBlindSnapshot,
} from "../services/promptBuilder.js";
import { captureWorkspaceSnapshot } from "../services/workspaceSnapshot.js";
import type { OrchestratorConfig, SubagentRequest, SubagentResult } from "../types.js";
import { finalizeResult } from "./base.js";

/** The Messages API requires a model. This is the quickstart model when a run names none. */
export const ANT_DEFAULT_MODEL = "claude-opus-5-5";
export const ANT_MAX_TOKENS = 4096;

export function antMessagesArgv(
  model: string = ANT_DEFAULT_MODEL,
  options: { maxTokens?: number; transform?: string } = {},
): string[] {
  const argv = [
    "ant",
    "messages",
    "create",
    "--format",
    "json",
    "--model",
    model,
    "--max-tokens",
    String(options.maxTokens ?? ANT_MAX_TOKENS),
  ];
  if (options.transform) argv.push("--transform", options.transform, "--raw-output");
  return argv;
}

/** User message only. Model and max_tokens stay flags so they win over this body. */
export function antMessagesStdin(prompt: string): string {
  return JSON.stringify({ messages: [{ role: "user", content: prompt }] });
}

export async function runAnt(
  request: SubagentRequest,
  config: OrchestratorConfig,
): Promise<SubagentResult> {
  const startedAt = new Date().toISOString();
  const snapshot = usesBlindSnapshot(request.mode)
    ? blindSnapshot(request.workspaceRoot)
    : await captureWorkspaceSnapshot(request.workspaceRoot, request.files);
  const prompt = buildSubagentPrompt({
    agent: "ant",
    task: request.task,
    workspaceRoot: request.workspaceRoot,
    mode: request.mode ?? "review",
    allowWrites: false,
    files: request.files,
    snapshot,
    extraContext: request.extraContext,
  });
  const argv = antMessagesArgv(request.model);
  const commandPreview = formatCommandPreview(argv);
  const run = await runCommand({
    argv,
    cwd: request.workspaceRoot,
    timeoutMs: request.timeoutMs ?? config.defaultTimeoutMs,
    stdin: antMessagesStdin(prompt),
  });
  const stdout = run.stdout.trim().startsWith("{")
    ? run.stdout
    : run.stderr.trim().startsWith("{")
      ? run.stderr
      : run.stdout;
  const result = finalizeResult("ant", startedAt, commandPreview, { ...run, stdout }, "ant-json");
  result.prompt = prompt;
  return result;
}
