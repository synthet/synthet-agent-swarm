import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeRunResult } from "./resultStore.js";
import type { OrchestratorConfig, SubagentRequest, SubagentResult } from "../types.js";

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

describe("resultStore", () => {
  let workspace: string;

  afterEach(() => {
    if (workspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("writes run artifacts under .agent-runs", () => {
    workspace = mkdtempSync(join(tmpdir(), "ao-test-"));
    const request: SubagentRequest = {
      agent: "codex",
      task: "Review test",
      workspaceRoot: workspace,
    };
    const result: SubagentResult = {
      agent: "codex",
      ok: true,
      exitCode: 0,
      stdout: "# findings",
      stderr: "",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 100,
      commandPreview: "codex exec ...",
    };

    const paths = storeRunResult(workspace, request, result, config);
    expect(paths).not.toBeNull();
    expect(existsSync(paths!.stdoutFile)).toBe(true);
    expect(existsSync(paths!.requestFile)).toBe(true);
    const saved = JSON.parse(readFileSync(paths!.resultFile, "utf8"));
    expect(saved.ok).toBe(true);
  });
});
