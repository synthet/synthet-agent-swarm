import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectSubagents } from "./detectSubagents.js";
import { runJudgePanelInputSchema, runJudgePanelTool } from "./runJudgePanel.js";
import { runJudgeSwarmInputSchema, runJudgeSwarmTool } from "./runJudgeSwarm.js";
import { runSubagentInputSchema, runSubagentTool } from "./runSubagent.js";
import { swarmSearch, swarmSearchInputSchema } from "./swarmSearch.js";
import { invalidArguments, swarmRunInputSchema, swarmRunTool } from "./swarmRun.js";

export const TOOL_NAMES = [
  "swarm_search",
  "swarm_run",
  "run_judge_panel",
  "detect_subagents",
  "run_subagent",
  "run_judge_swarm",
] as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

export function registerSwarmTools(server: McpServer): void {
  server.registerTool(
    "swarm_search",
    {
      description:
        "List read-only judge harnesses. An optional query matches id, title, command, transport, and notes.",
      inputSchema: swarmSearchInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmSearchInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      return textResult(await swarmSearch(parsed.data.query));
    },
  );

  server.registerTool(
    "swarm_run",
    {
      description:
        "Run one read-only task on the selected harnesses. Omit harnesses to use every available harness. Two or more include strict-majority agreement. Votes are not ground truth.",
      inputSchema: swarmRunInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmRunInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      const result = await swarmRunTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "run_judge_panel",
    {
      description:
        "Validate a frozen manifest, run the read-only swarm, and return votes plus a text-only Jev state. Does not call Jev or render images. Blind panels reject extraContext. Votes are not ground truth.",
      inputSchema: {
        task: z.string().min(1).max(8000),
        items: z
          .array(
            z.object({
              id: z.string(),
              files: z.array(z.string()).min(1).max(20),
            }),
          )
          .min(1)
          .max(20),
        agents: z
          .array(z.enum(["codex", "antigravity", "claude"]))
          .min(1)
          .max(3)
          .optional(),
        harnesses: z.array(z.string().min(1).max(40)).max(12).optional(),
        model: z.string().min(1).max(200).optional(),
        transport: z.enum(["auto", "cli", "acp"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
        dryRun: z.boolean().optional(),
        blind: z.boolean().optional(),
        extraContext: z.string().max(4000).optional(),
        rubric: z.string().max(200).optional(),
        humanLabels: z.record(z.string(), z.record(z.string(), z.string())).optional(),
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = runJudgePanelInputSchema.safeParse(input);
      if (!parsed.success) {
        return textResult({ ok: false, error: parsed.error.flatten() }, true);
      }
      const result = await runJudgePanelTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "detect_subagents",
    {
      description:
        "Compatibility wrapper. Prefer swarm_search. Returns the legacy codex, antigravity, and claude detection records.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => textResult(await detectSubagents()),
  );

  server.registerTool(
    "run_subagent",
    {
      description:
        "Compatibility wrapper. Prefer swarm_run. Runs one of codex, antigravity, or claude in read-only mode.",
      inputSchema: runSubagentInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = runSubagentInputSchema.parse(input);
      const result = await runSubagentTool(parsed);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "run_judge_swarm",
    {
      description:
        "Compatibility wrapper. Prefer swarm_run. Runs the same read-only judgement on the legacy judges and reports strict-majority agreement.",
      inputSchema: runJudgeSwarmInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = runJudgeSwarmInputSchema.parse(input);
      const result = await runJudgeSwarmTool(parsed);
      return textResult(result, !result.ok);
    },
  );
}
