import { describe, expect, it } from "vitest";
import { finalizeResult, validateSubagentRequest } from "./base.js";
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

describe("finalizeResult", () => {
  it("does not treat a zero exit as success when prompt delivery failed", () => {
    const result = finalizeResult("codex", new Date().toISOString(), "test", {
      exitCode: 0, stdout: '{"choice":"A"}', stderr: "", error: "Failed to deliver stdin: EPIPE",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("EPIPE");
  });
});

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
