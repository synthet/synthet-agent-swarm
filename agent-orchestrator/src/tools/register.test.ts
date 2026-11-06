import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerSwarmTools, TOOL_NAMES } from "./register.js";
import { runJudgePanelInputSchema } from "./runJudgePanel.js";

describe("tool contract", () => {
  it("matches the tool names published in docs/api.md", () => {
    const api = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../docs/api.md"),
      "utf8",
    );
    const published = [...api.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    for (const name of TOOL_NAMES) {
      expect(published).toContain(name);
    }
    expect(TOOL_NAMES).toEqual([
      "swarm_search",
      "swarm_run",
      "swarm_decide",
      "run_judge_panel",
      "detect_subagents",
      "run_subagent",
      "run_judge_swarm",
    ]);
  });

  it("publishes every run_judge_panel field through the MCP schema", () => {
    const published: Record<string, { inputSchema: Record<string, unknown> }> = {};
    const server = {
      registerTool(name: string, config: { inputSchema: Record<string, unknown> }) {
        published[name] = config;
      },
    };
    registerSwarmTools(server as unknown as Parameters<typeof registerSwarmTools>[0]);
    expect(Object.keys(published.run_judge_panel.inputSchema).sort()).toEqual(
      Object.keys(runJudgePanelInputSchema.innerType().shape).sort(),
    );
    expect(published.run_judge_panel.inputSchema).toHaveProperty("modelChains");
  });
});
