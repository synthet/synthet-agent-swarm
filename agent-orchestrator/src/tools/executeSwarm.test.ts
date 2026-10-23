import { describe, expect, it, vi } from "vitest";
import { classifyObservation, HARNESS_SPECS } from "../harness/registry.js";
import { runSubagentForRequest } from "../runners/index.js";
import { executeSwarm } from "./executeSwarm.js";
import { runJudgePanelTool } from "./runJudgePanel.js";
import { runJudgeSwarmTool } from "./runJudgeSwarm.js";
import { spawnAcpProcess } from "../acp/spawn.js";
import { storeRunResult, storeSwarmSummary, storePanelSummary } from "../services/resultStore.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../config.js", async (original) => {
  const actual = await original<typeof import("../config.js")>();
  return { ...actual, loadConfig: (root: string) => ({ ...actual.loadConfig(root), storeOutputs: false }) };
});
vi.mock("../runners/index.js", () => ({ runSubagentForRequest: vi.fn() }));
vi.mock("../acp/spawn.js", () => ({ spawnAcpProcess: vi.fn() }));
vi.mock("../services/resultStore.js", async (original) => {
  const actual = await original<typeof import("../services/resultStore.js")>();
  return { ...actual, storeRunResult: vi.fn(actual.storeRunResult), storeSwarmSummary: vi.fn(actual.storeSwarmSummary),
    storePanelSummary: vi.fn(actual.storePanelSummary) };
});
vi.mock("../harness/observe.js", async (original) => {
  const actual = await original<typeof import("../harness/observe.js")>();
  return { ...actual, observeHarnesses: async () => observations };
});

const observations = HARNESS_SPECS.filter(spec => ["codex", "agy", "claude"].includes(spec.id))
  .map(spec => classifyObservation({
    spec, cliOnPath: true, cliHelp: "exec -p --model", version: "test", acpOnPath: false,
  }));

describe("failed harness vote eligibility", () => {
  it("rejects an unsafe custom batch launch during dry-run without starting it", async () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), "swarm-dry-launch-"));
    try {
      const script = join(root, "custom.cmd");
      writeFileSync(script, "@echo off\necho inert fixture\n");
      const cursorSpec = HARNESS_SPECS.find(spec => spec.id === "cursor")!;
      const result = await executeSwarm({
        task: "say ok", mode: "judge", harnesses: ["cursor"], dryRun: true,
        observations: [classifyObservation({
          spec: { ...cursorSpec, cliArgv: [script] }, cliOnPath: true,
          cliHelp: "-p <text>", version: "test", acpOnPath: false,
        })],
      });
      expect(result.ok).toBe(false);
      expect(result.harnesses[0].error?.message).toMatch(/safely.*batch/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains other harness results when one runner unexpectedly throws", async () => {
    vi.mocked(runSubagentForRequest).mockImplementation(async request => {
      if (request.agent === "antigravity") throw new Error("spawn failed");
      return {
        agent: request.agent, ok: true, exitCode: 0, stdout: '{"choice":"A"}', stderr: "",
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        durationMs: 0, commandPreview: "test",
      };
    });
    const result = await executeSwarm({
      task: "Choose", mode: "judge", harnesses: ["codex", "agy"], observations,
    });
    expect(result.ok).toBe(true);
    expect(result.harnesses).toEqual([
      expect.objectContaining({ id: "codex", ok: true }),
      expect.objectContaining({ id: "agy", ok: false, error: expect.objectContaining({ code: "execution_failed" }) }),
    ]);
    expect(result.agreement?.parsedAgents).toEqual(["codex"]);
  });

  it("returns the collected results with a structured summary-storage failure", async () => {
    vi.mocked(runSubagentForRequest).mockResolvedValue({
      agent: "codex", ok: true, exitCode: 0, stdout: '{"choice":"A"}', stderr: "",
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      durationMs: 0, commandPreview: "test",
    });
    vi.mocked(storeSwarmSummary).mockImplementationOnce(() => { throw new Error("disk full"); });
    const result = await executeSwarm({
      task: "Choose", mode: "judge", harnesses: ["codex"], observations,
    });
    expect(result.ok).toBe(false);
    expect(result.harnesses[0]).toMatchObject({ ok: true, stdout: '{"choice":"A"}' });
    expect(result.error).toMatchObject({ code: "artifact_storage" });
  });

  it("retains parsed panel votes when the panel summary cannot be written", async () => {
    vi.mocked(runSubagentForRequest).mockResolvedValue({
      agent: "codex", ok: true, exitCode: 0, stdout: '{"images":[{"id":"a","choice":"A"}]}', stderr: "",
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0, commandPreview: "test",
    });
    vi.mocked(storePanelSummary).mockImplementationOnce(() => { throw new Error("disk full"); });
    const panel = await runJudgePanelTool({
      task: "Choose", harnesses: ["codex"], items: [{ id: "a", files: [] }], blind: true, dryRun: false,
    });
    expect(panel.ok).toBe(false);
    expect(panel.error).toMatch(/store.*panel/i);
    expect(panel.stages.votes.parsedAgents).toEqual(["codex"]);
  });

  it("reports the ACP failure phase and sends stderr to artifact storage", async () => {
    vi.mocked(spawnAcpProcess).mockReturnValue({
      write() {}, read: async () => null, kill() {},
      diagnostics: () => "MCP startup diagnostic",
    });
    const grok = HARNESS_SPECS.find(spec => spec.id === "grok")!;
    const result = await executeSwarm({
      task: "say ok", harnesses: ["grok"], mode: "judge",
      observations: [classifyObservation({ spec: grok, cliOnPath: true, cliHelp: "", version: "test", acpOnPath: true })],
    });
    expect(result.harnesses[0]).toMatchObject({
      ok: false, error: { code: "acp_protocol", message: expect.stringContaining("initialize") },
    });
    expect(vi.mocked(storeRunResult).mock.calls.at(-1)?.[2]).toMatchObject({
      ok: false, stderr: "MCP startup diagnostic", error: expect.stringContaining("initialize"),
    });
  });

  it("excludes timed-out JSON from swarm, compatibility and panel agreement", async () => {
    vi.mocked(runSubagentForRequest).mockImplementation(async request => ({
      agent: request.agent,
      ok: request.agent !== "antigravity",
      exitCode: request.agent === "antigravity" ? null : 0,
      error: request.agent === "antigravity" ? "Command timed out after 60000ms" : undefined,
      stdout: '{"images":[{"id":"a","choice":"A"}]}', stderr: "",
      startedAt: "2026-10-22T00:00:00Z", finishedAt: "2026-10-22T00:01:00Z",
      durationMs: 60000, commandPreview: "test",
    }));
    const common = { task: "Choose A or B", harnesses: ["codex", "agy"] };
    const swarm = await executeSwarm({ ...common, mode: "judge", observations });
    expect(swarm.harnesses.find(row => row.id === "agy")?.ok).toBe(false);
    expect(swarm.agreement?.parsedAgents).toEqual(["codex"]);
    expect(swarm.agreement?.items.a.fields.choice.disputed).toBe(true);

    const legacy = await runJudgeSwarmTool({
      task: common.task, agents: ["codex", "antigravity"], dryRun: false,
    });
    expect(legacy.agreement.parsedAgents).toEqual(["codex"]);
    expect(legacy.agreement.items.a.fields.choice.disputed).toBe(true);

    // Evidence files are validated before launch; no attachment is needed for this mocked text panel.
    const panel = await runJudgePanelTool({
      ...common, items: [{ id: "a", files: [] }], blind: true, dryRun: false,
    });
    expect(panel.stages.votes.parsedAgents).toEqual(["codex"]);
    expect(panel.stages.votes.items.a.fields.choice.disputed).toBe(true);

    const wrongManifest = await runJudgePanelTool({
      ...common, items: [{ id: "another-id", files: [] }], blind: true, dryRun: false,
    });
    expect(wrongManifest.ok).toBe(false);
    expect(wrongManifest.stages.votes.items).toEqual({});
  });
});
