#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCli } from "./cli.js";
import { detectSubagents } from "./tools/detectSubagents.js";
import {
  runSubagentInputSchema,
  runSubagentTool,
} from "./tools/runSubagent.js";
import {
  runJudgeSwarmInputSchema,
  runJudgeSwarmTool,
} from "./tools/runJudgeSwarm.js";
import {
  runJudgePanelInputSchema,
  runJudgePanelTool,
} from "./tools/runJudgePanel.js";

async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "synthet-agent-swarm",
    version: "0.1.0",
  });

  server.registerTool(
    "detect_subagents",
    {
      description:
        "Detect which external CLI judges are on PATH (codex, antigravity, claude)",
      inputSchema: {},
    },
    async () => {
      const result = await detectSubagents();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_subagent",
    {
      description:
        "Run one external CLI judge in read-only mode. mode=review is a code review; mode=judge is one blind vote. Results saved under .agent-runs/",
      inputSchema: {
        agent: z.enum(["codex", "antigravity", "claude"]),
        task: z.string().min(1).max(8000),
        files: z.array(z.string()).max(20).optional(),
        mode: z
          .enum(["review", "implement", "explain", "test", "tie-breaker", "judge"])
          .optional(),
        timeoutMs: z.number().int().positive().optional(),
        allowWrites: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        extraContext: z.string().max(4000).optional(),
      },
    },
    async (input) => {
      const parsed = runSubagentInputSchema.parse(input);
      const result = await runSubagentTool(parsed);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  server.registerTool(
    "run_judge_swarm",
    {
      description:
        "Run the same read-only judgement on each CLI judge in parallel, store raw replies, and report strict-majority agreement. Ties stay disputed. Agent votes are not ground truth.",
      inputSchema: {
        task: z.string().min(1).max(8000),
        files: z.array(z.string()).max(20).optional(),
        agents: z
          .array(z.enum(["codex", "antigravity", "claude"]))
          .min(1)
          .max(3)
          .optional(),
        timeoutMs: z.number().int().positive().optional(),
        dryRun: z.boolean().optional(),
        extraContext: z.string().max(4000).optional(),
      },
    },
    async (input) => {
      const parsed = runJudgeSwarmInputSchema.parse(input);
      const result = await runJudgeSwarmTool(parsed);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  server.registerTool(
    "run_judge_panel",
    {
      description:
        "Run the judge-panel workflow for a frozen manifest: validate evidence, run the read-only swarm, parse votes, and return a text-only Jev state plus optional comparison with human labels. Does not call Jev, render images, or mutate files. Blind panels reject extraContext. Cursor is not a judge here. Agent votes are not ground truth.",
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
        timeoutMs: z.number().int().positive().optional(),
        dryRun: z.boolean().optional(),
        blind: z.boolean().optional(),
        extraContext: z.string().max(4000).optional(),
        rubric: z.string().max(200).optional(),
        humanLabels: z.record(z.string(), z.record(z.string(), z.string())).optional(),
      },
    },
    async (input) => {
      const parsed = runJudgePanelInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { ok: false, error: parsed.error.flatten() },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      const result = await runJudgePanelTool(parsed.data);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "mcp") {
    await startMcpServer();
    return;
  }

  const code = await runCli(args);
  process.exitCode = code;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
