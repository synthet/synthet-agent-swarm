import { describe, expect, it } from "vitest";
import { validateSubagentRequest } from "./base.js";
import type { OrchestratorConfig } from "../types.js";

const config: OrchestratorConfig = {
  defaultTimeoutMs: 300000,
  maxTimeoutMs: 900000,
  allowWritesByDefault: false,
  allowedAgents: ["codex", "antigravity", "claude"],
  workspaceBoundary: ".",
  redactEnv: true,
  storeOutputs: true,
  storePrompts: false,
  detectionTimeoutMs: 10000,
};

describe("validateSubagentRequest", () => {
  it("rejects allowWrites=true", () => {
    expect(() =>
      validateSubagentRequest(
        {
          agent: "codex",
          task: "t",
          workspaceRoot: "/w",
          allowWrites: true,
        },
        config,
      ),
    ).toThrow(/allowWrites/);
  });

  it("clamps timeout to max", () => {
    const req = validateSubagentRequest(
      {
        agent: "antigravity",
        task: "t",
        workspaceRoot: "/w",
        timeoutMs: 99999999,
      },
      config,
    );
    expect(req.timeoutMs).toBe(900000);
  });
});
