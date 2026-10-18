import { z } from "zod";
import { swarmError, type SwarmError } from "../harness/registry.js";
import {
  executeSwarm,
  publicHarnesses,
  type ExecuteSwarmInput,
} from "./executeSwarm.js";

export const swarmRunInputSchema = z.object({
  task: z.string().min(1).max(8000),
  files: z.array(z.string()).max(20).optional(),
  harnesses: z.array(z.string().min(1).max(40)).max(12).optional(),
  model: z.string().min(1).max(200).optional(),
  transport: z.enum(["auto", "cli", "acp"]).optional(),
  mode: z
    .enum(["review", "implement", "explain", "test", "tie-breaker", "judge"])
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  dryRun: z.boolean().optional().default(false),
  extraContext: z.string().max(4000).optional(),
});

export async function swarmRunTool(input: z.infer<typeof swarmRunInputSchema>) {
  const result = await executeSwarm(input satisfies ExecuteSwarmInput);
  return {
    ok: result.ok,
    dryRun: result.dryRun,
    outputDir: result.outputDir,
    harnesses: publicHarnesses(result.harnesses),
    agreement: result.agreement,
    error: result.error,
  };
}

export function invalidArguments(issues: unknown): { ok: false; error: SwarmError; harnesses: [] } {
  return {
    ok: false,
    harnesses: [],
    error: swarmError(
      "invalid_arguments",
      "The tool arguments did not match the schema.",
      { issues },
      ["Check docs/api.md for swarm_search, swarm_run, and run_judge_panel."],
    ),
  };
}
