import { z } from "zod";
import { getWorkspaceRoot, loadConfig } from "../config.js";
import {
  validateAndResolveFiles,
  validateEvidenceFiles,
} from "../services/pathSafety.js";
import {
  relativeOutputPath,
  storeRunResult,
} from "../services/resultStore.js";
import { redactSecrets } from "../services/redaction.js";
import { runSubagentForRequest } from "../runners/index.js";
import { validateSubagentRequest } from "../runners/base.js";
import type { RunSubagentMcpResponse, SubagentRequest } from "../types.js";

export const runSubagentInputSchema = z.object({
  agent: z.enum(["codex", "antigravity", "claude"]),
  task: z.string().min(1).max(8000),
  files: z.array(z.string()).max(20).optional(),
  mode: z
    .enum(["review", "implement", "explain", "test", "tie-breaker", "judge"])
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  allowWrites: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
  extraContext: z.string().max(4000).optional(),
});

function summarizeOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "No stdout output.";

  // Try to find "## Verdict" or "## Findings"
  const verdictMatch = trimmed.match(/## Verdict\s*([\s\S]+?)(?:\n##|$)/i);
  if (verdictMatch && verdictMatch[1].trim()) {
    return `Verdict: ${verdictMatch[1].trim().split("\n")[0].slice(0, 300)}...`;
  }

  const findingsMatch = trimmed.match(/## Findings\s*([\s\S]+?)(?:\n##|$)/i);
  if (findingsMatch && findingsMatch[1].trim()) {
    const lines = findingsMatch[1]
      .trim()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      return `Findings: ${lines[0].slice(0, 300)}${lines.length > 1 ? " ..." : ""}`;
    }
  }

  const firstLine =
    trimmed.split("\n").find((l) => l.trim().length > 0) ?? trimmed;
  if (trimmed.length <= 500) return trimmed;
  return `${firstLine.slice(0, 200)}... (${trimmed.length} chars total)`;
}

export async function runSubagentTool(
  input: z.infer<typeof runSubagentInputSchema>,
): Promise<RunSubagentMcpResponse> {
  const workspaceRoot = getWorkspaceRoot();
  const config = loadConfig(workspaceRoot);

  if (input.allowWrites) {
    return {
      ok: false,
      agent: input.agent,
      exitCode: null,
      durationMs: 0,
      summary: "allowWrites=true is not supported in v0.1",
      error: "allowWrites=true is not implemented in v0.1",
    };
  }

  if ((input.mode ?? "review") === "judge") {
    validateEvidenceFiles(workspaceRoot, input.files);
  } else {
    validateAndResolveFiles(workspaceRoot, input.files);
  }

  const request: SubagentRequest = validateSubagentRequest(
    {
      ...input,
      workspaceRoot,
    },
    config,
  );

  const result = await runSubagentForRequest(request, config);

  const stored = storeRunResult(
    workspaceRoot,
    request,
    result,
    config,
    result.prompt,
  );

  let outputFile: string | undefined;
  if (stored) {
    outputFile = relativeOutputPath(workspaceRoot, stored.stdoutFile);
    result.outputFile = stored.stdoutFile;
    result.outputDir = stored.runDir;
  }

  return {
    ok: result.ok,
    agent: result.agent,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    outputFile,
    outputDir: result.outputDir
      ? relativeOutputPath(workspaceRoot, result.outputDir)
      : undefined,
    summary: result.error
      ? result.error
      : summarizeOutput(redactSecrets(result.stdout)),
    error: result.error,
    commandPreview: result.commandPreview,
  };
}
