import { z } from "zod";
import { agreeVotes, emptyAgreement } from "../services/votes.js";
import type { SwarmAgreement } from "../services/votes.js";
import type { RunSubagentMcpResponse } from "../types.js";
import {
  executeSwarm,
  legacyAgentName,
  type SwarmRunResponse,
} from "./executeSwarm.js";

export const runJudgeSwarmInputSchema = z.object({
  task: z.string().min(1).max(8000),
  files: z.array(z.string()).max(20).optional(),
  agents: z
    .array(z.enum(["codex", "antigravity", "claude"]))
    .min(1)
    .max(3)
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  dryRun: z.boolean().optional().default(false),
  extraContext: z.string().max(4000).optional(),
});

export interface JudgeSwarmResponse {
  ok: boolean;
  dryRun: boolean;
  outputDir?: string;
  judges: RunSubagentMcpResponse[];
  agreement: SwarmAgreement;
  note: string;
  error?: string;
}

function toLegacySwarm(result: SwarmRunResponse): JudgeSwarmResponse {
  const votes = result.harnesses.filter((row) => row.transport !== null);
  const agreement = result.dryRun
    ? emptyAgreement("Dry run previews commands only. No votes were collected.")
    : agreeVotes(
        votes.map((row) => ({
          agent: legacyAgentName(row.id),
          text: row.stdout,
        })),
      );
  return {
    ok: result.ok,
    dryRun: result.dryRun,
    outputDir: result.outputDir,
    judges: result.harnesses.map((row) => ({
      ok: row.ok,
      agent: legacyAgentName(row.id),
      exitCode: row.exitCode,
      durationMs: row.durationMs,
      outputFile: row.outputFile,
      outputDir: row.outputDir,
      summary: row.summary,
      error: row.error?.message,
      commandPreview: row.commandPreview,
    })),
    agreement,
    note: agreement.note,
    error: result.error?.message,
  };
}

export async function runJudgeSwarmTool(
  input: z.infer<typeof runJudgeSwarmInputSchema>,
): Promise<JudgeSwarmResponse> {
  const harnesses = (input.agents ?? ["codex", "antigravity", "claude"]).map((agent) =>
    agent === "antigravity" ? "agy" : agent,
  );
  const result = await executeSwarm({
    task: input.task,
    files: input.files,
    harnesses,
    mode: "judge",
    timeoutMs: input.timeoutMs,
    dryRun: input.dryRun,
    extraContext: input.extraContext,
  });
  return toLegacySwarm(result);
}
