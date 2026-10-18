import { describe, expect, it } from "vitest";
import { runJudgeSwarmInputSchema } from "./runJudgeSwarm.js";
import { runSubagentInputSchema } from "./runSubagent.js";

describe("runSubagentInputSchema", () => {
  it("parses valid input", () => {
    const parsed = runSubagentInputSchema.parse({
      agent: "codex",
      task: "Review",
      allowWrites: false,
    });
    expect(parsed.agent).toBe("codex");
    expect(parsed.allowWrites).toBe(false);
  });

  it("rejects empty task", () => {
    expect(() =>
      runSubagentInputSchema.parse({ agent: "codex", task: "" }),
    ).toThrow();
  });

  it("accepts judge mode", () => {
    const parsed = runSubagentInputSchema.parse({
      agent: "claude",
      task: "Label the crop",
      mode: "judge",
      files: ["blind/a.jpg"],
    });
    expect(parsed.mode).toBe("judge");
    expect(parsed.allowWrites).toBe(false);
  });
});

describe("runJudgeSwarmInputSchema", () => {
  it("defaults to a dry-run-off swarm and accepts an agent subset", () => {
    const parsed = runJudgeSwarmInputSchema.parse({
      task: "Grade the box",
      agents: ["codex", "antigravity"],
    });
    expect(parsed.dryRun).toBe(false);
    expect(parsed.agents).toEqual(["codex", "antigravity"]);
  });
});
