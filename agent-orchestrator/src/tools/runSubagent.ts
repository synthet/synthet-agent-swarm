import { z } from "zod";
import { redactSecrets } from "../services/redaction.js";
import type { RunSubagentMcpResponse } from "../types.js";
import { executeSwarm } from "./executeSwarm.js";

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

  const harness = input.agent === "antigravity" ? "agy" : input.agent;
  const result = await executeSwarm({
    task: input.task,
    files: input.files,
    harnesses: [harness],
    mode: input.mode,
    timeoutMs: input.timeoutMs,
    dryRun: input.dryRun,
    extraContext: input.extraContext,
  });
  const row = result.harnesses[0];
  if (!row) {
    return {
      ok: false,
      agent: input.agent,
      exitCode: null,
      durationMs: 0,
      summary: result.error?.message ?? "The harness did not run.",
      error: result.error?.message,
    };
  }
  return {
    ok: row.ok,
    agent: input.agent,
    exitCode: row.exitCode,
    durationMs: row.durationMs,
    outputFile: row.outputFile,
    outputDir: row.outputDir,
    summary: row.error
      ? row.error.message
      : summarizeOutput(redactSecrets(row.stdout)),
    error: row.error?.message,
    commandPreview: row.commandPreview,
  };
}
