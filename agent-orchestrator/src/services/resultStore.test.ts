import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeRunResult, storeSwarmSummary, storePanelSummary } from "./resultStore.js";
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
    vi.useRealTimers();
    if (workspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("refuses an artifact root linked outside the selected workspace", () => {
    workspace = mkdtempSync(join(tmpdir(), "ao-test-"));
    const repo = join(workspace, "repo");
    const outside = join(workspace, "outside");
    mkdirSync(repo);
    mkdirSync(outside);
    symlinkSync(outside, join(repo, ".agent-runs"), process.platform === "win32" ? "junction" : "dir");
    expect(() => storeSwarmSummary(repo, "test", { ok: true }, config)).toThrow(/boundary/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("preserves separate same-second run and summary attempts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    workspace = mkdtempSync(join(tmpdir(), "ao-test-"));
    const request: SubagentRequest = { agent: "codex", task: "Same task", workspaceRoot: workspace };
    const result: SubagentResult = {
      agent: "codex", ok: true, exitCode: 0, stdout: "first", stderr: "",
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      durationMs: 0, commandPreview: "codex exec ...",
    };
    const first = storeRunResult(workspace, request, result, config)!;
    const second = storeRunResult(workspace, request, { ...result, stdout: "second" }, config)!;
    expect(second.runDir).not.toBe(first.runDir);
    expect(readFileSync(first.stdoutFile, "utf8")).toBe("first");
    expect(readFileSync(second.stdoutFile, "utf8")).toBe("second");
    for (const [store, name] of [[storeSwarmSummary, "swarm.json"], [storePanelSummary, "panel.json"]] as const) {
      const one = store(workspace, request.task, { attempt: 1 }, config)!;
      const two = store(workspace, request.task, { attempt: 2 }, config)!;
      expect(two).not.toBe(one);
      expect(JSON.parse(readFileSync(join(one, name), "utf8")).attempt).toBe(1);
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
