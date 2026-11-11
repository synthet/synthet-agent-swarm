import { describe, expect, it, vi } from "vitest";
import { classifyObservation, HARNESS_SPECS } from "../harness/registry.js";
import { runSubagentForRequest } from "../runners/index.js";
import { executeSwarm, walkModelChain } from "./executeSwarm.js";
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
  it.each(["cli", "acp"] as const)("isolates Gemini judge MCP startup over %s", async transport => {
    const gemini = HARNESS_SPECS.find(spec => spec.id === "gemini")!;
    const result = await executeSwarm({
      task: "say ok", mode: "judge", harnesses: ["gemini"], dryRun: true, transport,
      observations: [classifyObservation({ spec: gemini, cliOnPath: true,
        cliHelp: "-p --acp --allowed-mcp-server-names <names>", version: "test", acpOnPath: false })],
    });
    expect(result.ok).toBe(true);
    expect(result.harnesses[0].commandPreview).toContain(
      "--allowed-mcp-server-names __synthet_swarm_file_only__");
  });

  it("preserves Gemini review MCP configuration", async () => {
    const gemini = HARNESS_SPECS.find(spec => spec.id === "gemini")!;
    const result = await executeSwarm({
      task: "say ok", mode: "review", harnesses: ["gemini"], dryRun: true, transport: "acp",
      observations: [classifyObservation({ spec: gemini, cliOnPath: true,
        cliHelp: "-p --acp --allowed-mcp-server-names <names>", version: "test", acpOnPath: false })],
    });
    expect(result.harnesses[0].commandPreview).not.toContain("--allowed-mcp-server-names");
  });

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

describe("model chains", () => {
  const row = (ok: boolean, stdout = "answer") => ({ ok, stdout });

  it("stops at the first model that answers", async () => {
    const tried: string[] = [];
    const { row: last, attempts } = await walkModelChain(["a", "b"], async model => {
      tried.push(model);
      return row(true);
    });
    expect(tried).toEqual(["a"]);
    expect(last.ok).toBe(true);
    expect(attempts).toHaveLength(1);
  });

  it("moves to the next model after a failed run", async () => {
    const { row: last, attempts } = await walkModelChain(["a", "b", "c"], async model => row(model === "b"));
    expect(attempts.map(attempt => attempt.ok)).toEqual([false, true]);
    expect(last.ok).toBe(true);
  });

  it("treats an empty reply as a failed attempt", async () => {
    const { attempts } = await walkModelChain(["a", "b"], async model => row(true, model === "a" ? "  " : "answer"));
    expect(attempts).toHaveLength(2);
  });

  it("returns the last attempt when every model fails", async () => {
    const { row: last, attempts } = await walkModelChain(["a", "b"], async () => row(false));
    expect(attempts).toHaveLength(2);
    expect(last.ok).toBe(false);
  });

  it("plans the first model of a chain and reports it on the row", async () => {
    const result = await executeSwarm({
      task: "say ok", harnesses: ["codex", "agy"], dryRun: true, observations,
      modelChains: { codex: ["gpt-a", "gpt-b"], antigravity: ["gem-a"] },
    });
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(result.harnesses.map(harness => [harness.id, harness]));
    expect(byId.codex.model).toBe("gpt-a");
    expect(byId.codex.commandPreview).toContain("gpt-a");
    expect(byId.agy.model).toBe("gem-a");
    expect(byId.agy.commandPreview).toContain("gem-a");
  });

  it("walks a live chain, keeps each attempt, and records the answering model", async () => {
    vi.mocked(runSubagentForRequest).mockImplementation(async request => ({
      agent: "codex", ok: request.model === "gpt-b", exitCode: request.model === "gpt-b" ? 0 : 1,
      stdout: request.model === "gpt-b" ? "answer" : "", stderr: "", startedAt: "", finishedAt: "",
      durationMs: 1, commandPreview: "codex", error: request.model === "gpt-b" ? undefined : "usage limit",
    }));
    const result = await executeSwarm({
      task: "say ok", harnesses: ["codex"], observations,
      modelChains: { codex: ["gpt-a", "gpt-b", "gpt-c"] },
    });
    const [harness] = result.harnesses;
    expect(harness.ok).toBe(true);
    expect(harness.model).toBe("gpt-b");
    expect(harness.attempts).toMatchObject([
      { model: "gpt-a", ok: false, error: "usage limit" },
      { model: "gpt-b", ok: true },
    ]);
  });

  it("passes the pinned model to ACP and records what the session reports", async () => {
    const cursor = classifyObservation({
      spec: HARNESS_SPECS.find(spec => spec.id === "cursor")!,
      cliOnPath: true, cliHelp: "-p --model", version: "test", acpOnPath: true,
    });
    const messages: string[] = [];
    const lines: string[] = [];
    vi.mocked(spawnAcpProcess).mockReturnValue({
      write(line) {
        const message = JSON.parse(line);
        messages.push(message.method);
        const option = (value: string) => [{ id: "model", category: "model", currentValue: value, options: [
          { value: "grok-4.7[fast=true]" }, { value: "composer-2.5[fast=true]" }] }];
        const result = message.method === "session/new"
          ? { sessionId: "s1", configOptions: option("composer-2.5[fast=true]") }
          : message.method === "session/set_config_option"
            ? { configOptions: option(message.params.value) }
            : message.method === "session/prompt" ? { stopReason: "end_turn" } : { protocolVersion: 1 };
        lines.push(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      },
      read: async () => {
        while (lines.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
        return lines.shift() ?? null;
      },
      kill() {},
    });
    const result = await executeSwarm({
      task: "say ok", harnesses: ["cursor"], observations: [cursor], modelChains: { agent: ["grok-4.7"] },
    });
    const [harness] = result.harnesses;
    expect(harness.transport).toBe("acp");
    expect(harness.model).toBe("grok-4.7");
    expect(harness.reportedModel).toBe("grok-4.7[fast=true]");
    expect(messages).toContain("session/set_config_option");
  });

  it("carries the model and attempts into panel receipts", async () => {
    vi.mocked(runSubagentForRequest).mockResolvedValue({
      agent: "codex", ok: true, exitCode: 0, stdout: '{"images":[]}', stderr: "", startedAt: "", finishedAt: "",
      durationMs: 1, commandPreview: "codex",
    });
    const panel = await runJudgePanelTool({
      task: "Choose", harnesses: ["codex"], items: [{ id: "a", files: [] }], blind: true, dryRun: false,
      modelChains: { codex: ["gpt-a"] },
    });
    expect(panel.stages.run.judges[0]).toMatchObject({ model: "gpt-a", attempts: [{ model: "gpt-a", ok: true }] });
  });
});

describe("API credit preference", () => {
  function ready(id: "claude" | "ant") {
    return classifyObservation({
      spec: HARNESS_SPECS.find((item) => item.id === id)!,
      cliOnPath: true,
      cliHelp: id === "ant" ? "messages create\n--model string\n" : "-p --print\n--model",
      version: "test",
      acpOnPath: false,
    });
  }

  it("skips the claude CLI when the caller leaves harnesses unset and credits are available", async () => {
    vi.mocked(runSubagentForRequest).mockClear();
    vi.mocked(runSubagentForRequest).mockResolvedValue({
      agent: "ant", ok: true, exitCode: 0, stdout: "from-api", stderr: "",
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      durationMs: 1, commandPreview: "ant messages create",
    });
    const result = await executeSwarm({
      task: "ping", observations: [ready("claude"), ready("ant")], apiCredits: "available",
    });
    expect(result.ok).toBe(true);
    expect(result.harnesses.find((row) => row.id === "ant")).toMatchObject({ ok: true, stdout: "from-api" });
    expect(result.harnesses.find((row) => row.id === "claude")?.summary).toMatch(/credits/);
    expect(vi.mocked(runSubagentForRequest).mock.calls.map((call) => call[0].agent)).toEqual(["ant"]);
  });
});

describe("resume", () => {
  it("rejects resume across more than one harness, in judge mode, or with model chains", async () => {
    for (const input of [
      { harnesses: ["claude", "codex"] },
      { harnesses: ["claude"], mode: "judge" as const },
      { harnesses: ["claude"], modelChains: { claude: ["a"] } },
      {},
    ]) {
      const result = await executeSwarm({ task: "continue", dryRun: true, resumeSessionId: "s-1", ...input });
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.error?.code).toBe("invalid_arguments");
    }
  });

  it("previews one ant Messages request and keeps the prompt off the command line", async () => {
    const ant = classifyObservation({
      spec: HARNESS_SPECS.find((item) => item.id === "ant")!,
      cliOnPath: true,
      cliHelp: "messages create\n--model string\n",
      version: "2.9.0",
      acpOnPath: false,
    });
    const result = await executeSwarm({
      task: "UNIQUE-ANT-PROMPT", dryRun: true, harnesses: ["ant"], observations: [ant],
    });
    expect(result.ok).toBe(true);
    expect(result.harnesses[0].commandPreview).toContain("ant messages create");
    expect(result.harnesses[0].commandPreview).toContain("--model claude-opus-5-5");
    expect(result.harnesses[0].commandPreview).not.toContain("UNIQUE-ANT-PROMPT");
  });

  it("rejects resume for a single Messages API call", async () => {
    const ant = classifyObservation({
      spec: HARNESS_SPECS.find((item) => item.id === "ant")!,
      cliOnPath: true,
      cliHelp: "messages create\n--model string\n",
      version: "2.9.0",
      acpOnPath: false,
    });
    const result = await executeSwarm({
      task: "continue", dryRun: true, harnesses: ["ant"], resumeSessionId: "s-1", observations: [ant],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/no session to resume/);
  });

  it("passes the session to the one selected harness", async () => {
    const result = await executeSwarm({
      task: "continue", dryRun: true, harnesses: ["claude"], resumeSessionId: "s-1",
    });
    expect(result.ok).toBe(true);
    expect(result.harnesses[0].commandPreview).toContain("--resume s-1 --fork-session");
  });
});
