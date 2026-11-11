import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJudgePanelInputSchema, runJudgePanelTool } from "./runJudgePanel.js";
import { swarmSearch, swarmSearchInputSchema } from "./swarmSearch.js";
import { invalidArguments, swarmRunInputSchema, swarmRunTool } from "./swarmRun.js";
import { swarmDecideInputSchema, swarmDecideTool } from "./swarmDecide.js";
import {
  swarmChoiceInputSchema,
  swarmChoiceTool,
  swarmNoulInputSchema,
  swarmNoulTool,
  swarmScoreInputSchema,
  swarmScoreTool,
  swarmSystemOneInputSchema,
  swarmSystemOneTool,
} from "./swarmJev.js";
import { swarmSessionsInputSchema, swarmSessionsTool } from "./swarmSessions.js";

export const TOOL_NAMES = [
  "swarm_search",
  "swarm_run",
  "swarm_sessions",
  "swarm_panel",
  "swarm_decide",
  "swarm_choice",
  "swarm_score",
  "swarm_noul",
  "swarm_system_one",
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
    "swarm_decide",
    {
      description:
        "Fast, zero-tool Jev-compatible structured decision engine (noul, choice, score) over lightweight flash coding models (Haiku 5.5, GPT-6 Luna, Composer 2.5, Gemini 3.8 Flash). Ideal for coin-flip permission adjudication and typed semantic routing.",
      inputSchema: swarmDecideInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmDecideInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      const result = await swarmDecideTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "swarm_noul",
    {
      description:
        "One yes/no probability over a local harness. Not the paid Jev service. Optional criteria is an object.",
      inputSchema: swarmNoulInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmNoulInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      const result = await swarmNoulTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "swarm_choice",
    {
      description:
        "One choice from a criteria object over a local harness. Not the paid Jev service. Include a no-match option when none may fit.",
      inputSchema: swarmChoiceInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmChoiceInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      const result = await swarmChoiceTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "swarm_score",
    {
      description:
        "One score on an ordered low-to-high criteria list over a local harness. Not the paid Jev service. Scores run from 0 to N-1.",
      inputSchema: swarmScoreInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmScoreInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      const result = await swarmScoreTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "swarm_system_one",
    {
      description:
        "Several noul, choice, and score questions on one state, over a local harness. Not the paid Jev service. Images and box questions are not accepted.",
      inputSchema: swarmSystemOneInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmSystemOneInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      const result = await swarmSystemOneTool(parsed.data);
      return textResult(result, !result.ok);
    },
  );

  server.registerTool(
    "swarm_sessions",
    {
      description:
        "List harness runs and sessions: runs in flight in this server, its recent runs, stored results under .agent-runs with their sessionId and outcome, and the harnesses' own sessions where a machine-readable listing exists (claude agents --json). Contains no prompts or replies. Pass a sessionId to swarm_run resume to continue one.",
      inputSchema: swarmSessionsInputSchema.shape,
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = swarmSessionsInputSchema.safeParse(input);
      if (!parsed.success) return textResult(invalidArguments(parsed.error.flatten()), true);
      return textResult(await swarmSessionsTool(parsed.data));
    },
  );

  server.registerTool(
    "swarm_panel",
    {
      description:
        "Validate a frozen manifest, run the read-only swarm, and return votes plus a text-only Jev state. Does not call Jev or render images. Blind panels reject extraContext. Votes are not ground truth.",
      inputSchema: runJudgePanelInputSchema.innerType().shape,
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

}
