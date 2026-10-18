import { describe, expect, it, beforeEach } from "vitest";
import {
  buildCodexArgv,
  clearCodexDetectionCache,
} from "./codex.js";
import type { AgentDetectionInfo, OrchestratorConfig } from "../types.js";

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

const detection: AgentDetectionInfo = {
  available: true,
  command: "codex",
  mode: "exec",
  version: "1.0.0",
  notes: [],
  supportsCd: true,
  helpSnippet: "--json",
};

describe("buildCodexArgv", () => {
  beforeEach(() => {
    clearCodexDetectionCache();
  });

  it("uses read-only sandbox and never bypass flags", () => {
    const argv = buildCodexArgv("review task", "/repo", detection, config);
    expect(argv[0]).toBe("codex");
    expect(argv).toContain("exec");
    expect(argv).toContain("read-only");
    expect(argv).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--full-auto");
    expect(argv).not.toContain("workspace-write");
  });

  it("includes --cd when supported", () => {
    const argv = buildCodexArgv("task", "/repo", detection, config);
    expect(argv).toContain("--cd");
    expect(argv).toContain("/repo");
  });

  it("attaches judge images without bypass flags", () => {
    const argv = buildCodexArgv("task", "/repo", detection, config, [
      "/repo/blind/a.jpg",
    ]);
    expect(argv).toContain("--image");
    expect(argv).toContain("/repo/blind/a.jpg");
    expect(argv.join(" ")).not.toContain("dangerously");
  });
});
