import { z } from "zod";
import { clampTimeout, isAgentAllowed } from "../config.js";
import type {
  OrchestratorConfig,
  SubagentRequest,
  SubagentResult,
} from "../types.js";

export const subagentRequestSchema = z.object({
  agent: z.enum(["codex", "antigravity", "claude"]),
  task: z.string().min(1).max(8000),
  workspaceRoot: z.string().min(1),
  files: z.array(z.string()).max(20).optional(),
  mode: z
    .enum(["review", "implement", "explain", "test", "tie-breaker", "judge"])
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
  allowWrites: z.boolean().optional(),
  extraContext: z.string().max(4000).optional(),
  model: z.string().min(1).max(200).optional(),
});

export function validateSubagentRequest(
  raw: unknown,
  config: OrchestratorConfig,
): SubagentRequest {
  const parsed = subagentRequestSchema.parse(raw);
  if (!isAgentAllowed(parsed.agent, config)) {
    throw new Error(`Agent not allowed by config: ${parsed.agent}`);
  }
  if (parsed.allowWrites === true) {
    throw new Error(
      "allowWrites=true is not implemented in v0.1. External agents run in review-only mode.",
    );
  }
  return {
    ...parsed,
    mode: parsed.mode ?? "review",
    allowWrites: false,
    timeoutMs: clampTimeout(parsed.timeoutMs, config),
  };
}

export function createErrorResult(
  agent: string,
  error: string,
  commandPreview = "",
  startedAt = new Date().toISOString(),
): SubagentResult {
  const finishedAt = new Date().toISOString();
  return {
    agent,
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    startedAt,
    finishedAt,
    durationMs: 0,
    commandPreview,
    error,
  };
}

export function finalizeResult(
  agent: string,
  startedAt: string,
  commandPreview: string,
  run: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
    timedOut?: boolean;
  },
): SubagentResult {
  const finishedAt = new Date().toISOString();
  const durationMs =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  const ok =
    run.exitCode === 0 && !run.timedOut && !run.error?.includes("timed out");

  return {
    agent,
    ok,
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    startedAt,
    finishedAt,
    durationMs,
    commandPreview,
    error: run.error ?? (ok ? undefined : `Process exited with code ${run.exitCode}`),
  };
}
