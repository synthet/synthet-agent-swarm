import { z } from "zod";
import { swarmError, type SwarmError } from "../harness/registry.js";
import {
  executeSwarm,
  publicHarnesses,
  type ExecuteSwarmInput,
} from "./executeSwarm.js";

export const modelChainsSchema = z.record(
  z.string().min(1).max(40),
  z.array(z.string().min(1).max(200)).min(1).max(5),
);

export const swarmRunInputSchema = z.object({
  task: z.string().min(1).max(8000),
  files: z.array(z.string()).max(20).optional(),
  harnesses: z.array(z.string().min(1).max(40)).max(12).optional(),
  model: z.string().min(1).max(200).optional(),
  modelChains: modelChainsSchema.optional(),
  transport: z.enum(["auto", "cli", "acp"]).optional(),
  mode: z
    .enum(["review", "implement", "explain", "test", "tie-breaker", "judge", "respond"])
    .optional()
    .describe("respond answers one quoted message read-only with a plain reply: exactly one of claude, codex or cursor."),
  timeoutMs: z.number().int().positive().optional(),
  dryRun: z.boolean().optional().default(false),
  extraContext: z.string().max(4000).optional(),
  budgetUsd: z.number().positive().max(20).optional()
    .describe("Spend cap for this run where the harness supports one (Claude --max-budget-usd)."),
  resume: z
    .object({
      sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
    })
    .strict()
    .optional()
    .describe("Continue a session a previous run reported in sessionId. Exactly one harness. Claude forks it (--fork-session) instead of writing into the original transcript."),
});

function runSwarm(input: z.infer<typeof swarmRunInputSchema>) {
  const { resume, ...rest } = input;
  return executeSwarm({ ...rest, resumeSessionId: resume?.sessionId } satisfies ExecuteSwarmInput);
}

export async function swarmRunTool(input: z.infer<typeof swarmRunInputSchema>) {
  const result = await runSwarm(input);
  return {
    ok: result.ok,
    dryRun: result.dryRun,
    outputDir: result.outputDir,
    harnesses: publicHarnesses(result.harnesses),
    agreement: result.agreement,
    error: result.error,
  };
}

/**
 * The machine contract behind `synthet-agent-swarm run --request`. Same response as swarm_run, plus
 * `reply`: the reply text when exactly one harness ran and succeeded. The caller decides what to do
 * with it; this server never sends it anywhere.
 */
export async function swarmRunRequest(input: z.infer<typeof swarmRunInputSchema>) {
  const result = await runSwarm(input);
  const only = result.harnesses.length === 1 ? result.harnesses[0] : undefined;
  return {
    ok: result.ok,
    dryRun: result.dryRun,
    outputDir: result.outputDir,
    harnesses: publicHarnesses(result.harnesses),
    agreement: result.agreement,
    error: result.error,
    reply: only?.ok && !result.dryRun ? only.stdout : undefined,
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
