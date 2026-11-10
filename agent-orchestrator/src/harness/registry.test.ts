import { describe, expect, it } from "vitest";
import {
  applyModel,
  classifyObservation,
  HARNESS_SPECS,
  planSwarmRun,
  resolveHarnessId,
  searchHarnesses,
  type HarnessObservation,
  type HarnessSpec,
} from "./registry.js";

function spec(id: HarnessSpec["id"]): HarnessSpec {
  const found = HARNESS_SPECS.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function observation(
  id: HarnessSpec["id"],
  patch: Partial<HarnessObservation> = {},
): HarnessObservation {
  const base = classifyObservation({
    spec: spec(id),
    cliOnPath: false,
    cliHelp: "",
    version: null,
    acpOnPath: false,
  });
  return { ...base, ...patch, spec: spec(id) };
}

const allowed = ["codex", "agy", "claude", "cursor", "gemini", "grok"];

describe("harness identity", () => {
  it("rejects Grok's agent alias as Cursor on both transports", () => {
    const row = classifyObservation({
      spec: spec("cursor"), cliOnPath: true, acpOnPath: true,
      cliHelp: "Grok Build TUI\nUsage: grok [OPTIONS] [PROMPT] [COMMAND]\n  -p, --single <PROMPT>\n  --model <MODEL>",
      version: "1.0.0",
    });
    expect(row.available).toBe(false);
    expect(row.transports).toEqual([]);
    expect(row.notes.join(" ")).toContain("Grok");
    const plan = planSwarmRun({observations:[row],harnesses:["cursor"],allowed});
    expect(plan.ok && plan.steps[0]?.kind).toBe("skip");
  });

  it("keeps Cursor when help explicitly identifies Cursor", () => {
    const row = classifyObservation({
      spec: spec("cursor"), cliOnPath: true, acpOnPath: true,
      cliHelp: "Cursor Agent\nUsage: agent [options]\n -p, --print\n --model <MODEL>",
      version: "1.0.0",
    });
    expect(row.transports).toEqual(["cli", "acp"]);
  });
});

describe("resolveHarnessId", () => {
  it("resolves gemini to agy when the gemini row is not available", () => {
    const observations = [
      observation("agy", { available: true, transports: ["cli"] }),
      observation("gemini", { available: false, transports: [] }),
    ];
    expect(resolveHarnessId("gemini", observations)).toBe("agy");
  });

  it("keeps gemini when that binary is available", () => {
    const observations = [
      observation("agy", { available: true, transports: ["cli"] }),
      observation("gemini", { available: true, transports: ["cli"] }),
      observation("cursor", { available: true, transports: ["acp"] }),
    ];
    expect(resolveHarnessId("gemini", observations)).toBe("gemini");
    expect(resolveHarnessId("antigravity", observations)).toBe("agy");
    expect(resolveHarnessId("agent", observations)).toBe("cursor");
  });
});

describe("searchHarnesses", () => {
  it("returns the cursor row and not codex for query cursor", () => {
    const observations = HARNESS_SPECS.map((item) =>
      observation(item.id, {
        available: item.id === "cursor" || item.id === "codex",
        transports: item.id === "cursor" ? ["acp"] : item.id === "codex" ? ["cli"] : [],
      }),
    );
    const rows = searchHarnesses(observations, "cursor");
    expect(rows.map((row) => row.id)).toEqual(["cursor"]);
  });

  it("includes agy when the query is gemini", () => {
    const observations = [
      observation("agy", { available: true, transports: ["cli"] }),
      observation("gemini", { available: false }),
    ];
    expect(searchHarnesses(observations, "gemini").map((row) => row.id)).toEqual([
      "agy",
      "gemini",
    ]);
  });
});

describe("planSwarmRun", () => {
  const agy = observation("agy", {
    available: true,
    transports: ["cli"],
    modelFlag: "--model",
    cliMode: "prompt",
    promptFlag: "-p",
  });
  const cursor = observation("cursor", {
    available: true,
    transports: ["acp"],
    modelFlag: null,
    cliMode: null,
  });

  it("launches each canonical harness once even when aliases resolve to it", () => {
    const plan = planSwarmRun({
      observations: [agy, cursor, observation("gemini")],
      harnesses: ["agy", "antigravity", "gemini", "cursor", "agent"],
      allowed,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map(step => step.kind === "run" ? step.plan.id : step.skip.id))
      .toEqual(["agy", "cursor"]);
  });

  it("picks CLI for agy and ACP for cursor when transport is auto", () => {
    const plan = planSwarmRun({
      observations: [agy, cursor],
      harnesses: ["agy", "cursor"],
      transport: "auto",
      allowed,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "run",
        plan: expect.objectContaining({ id: "agy", transport: "cli" }),
      }),
      expect.objectContaining({
        kind: "run",
        plan: expect.objectContaining({ id: "cursor", transport: "acp" }),
      }),
    ]);
  });

  it("fails the whole call when a selected harness has no model flag", () => {
    const cliOnly = { ...cursor, transports: ["cli" as const], cliMode: "print" as const };
    const plan = planSwarmRun({
      observations: [agy, cliOnly],
      harnesses: ["agy", "cursor"],
      model: "gpt-5",
      allowed,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe("model_unsupported");
    expect(plan.error.next_steps).toContain("agy");
    expect(plan.error.next_steps).not.toContain("cursor");
  });
});

describe("applyModel", () => {
  it("inserts --model before the codex prompt and after the command for agy", () => {
    expect(
      applyModel(
        ["codex", "exec", "--sandbox", "read-only", "review the diff"],
        "codex",
        "gpt-5",
      ),
    ).toEqual([
      "codex",
      "exec",
      "--sandbox",
      "read-only",
      "--model",
      "gpt-5",
      "review the diff",
    ]);
    expect(
      applyModel(["agy", "-p", "review the diff", "--add-dir", "blind"], "agy", "gemini-2"),
    ).toEqual([
      "agy",
      "--model",
      "gemini-2",
      "-p",
      "review the diff",
      "--add-dir",
      "blind",
    ]);
  });

  it("leaves argv unchanged when model is omitted", () => {
    const argv = ["claude", "-p", "hello"];
    expect(applyModel(argv, "claude")).toBe(argv);
  });
});

describe("classifyObservation", () => {
  it.each([
    ["  --acp  Starts ACP mode", "--acp"],
    ["  --experimental-acp  Starts ACP mode", "--experimental-acp"],
    ["  --experimental-acp  Deprecated\n  --acp  Starts ACP mode", "--acp"],
  ])("uses Gemini's advertised ACP flag: %s", (cliHelp, flag) => {
    const row = classifyObservation({
      spec: spec("gemini"), cliOnPath: true, cliHelp,
      version: "test", acpOnPath: false,
    });
    expect(row.acpArgv).toEqual(["gemini", flag]);
    expect(row.transports).toContain("acp");
  });

  it("does not turn an incidental ACP mention into a Gemini subcommand", () => {
    const row = classifyObservation({
      spec: spec("gemini"), cliOnPath: true, cliHelp: "See the ACP documentation.",
      version: "test", acpOnPath: false,
    });
    expect(row.acpArgv).toBeNull();
    expect(row.transports).not.toContain("acp");
  });

  it("does not infer prompt or model flags from longer option names", () => {
    const row = classifyObservation({
      spec: spec("agy"), cliOnPath: true,
      cliHelp: "--prompt-file <path> --model-route <name> --permission-mode <mode>",
      version: "test", acpOnPath: false,
    });
    expect(row.cliMode).toBeNull();
    expect(row.modelFlag).toBeNull();
    expect(row.promptFlag).toBeUndefined();
  });

  it("launches claude-agent-acp first and keeps a detected legacy adapter", () => {
    expect(spec("claude").acpArgv).toEqual(["claude-agent-acp"]);
    expect(spec("claude").acpFallbacks).toEqual([["claude-code-acp"]]);
    const current = classifyObservation({
      spec: spec("claude"), cliOnPath: true, cliHelp: "-p --model", version: "test", acpOnPath: true,
    });
    expect(current.acpArgv).toEqual(["claude-agent-acp"]);
    const legacy = classifyObservation({
      spec: spec("claude"), cliOnPath: true, cliHelp: "-p --model", version: "test", acpOnPath: true,
      acpArgv: ["claude-code-acp"],
    });
    expect(legacy.acpArgv).toEqual(["claude-code-acp"]);
    expect(legacy.transports).toEqual(["cli", "acp"]);
  });

  it("does not treat a help timeout as an ACP transport", () => {
    const row = classifyObservation({
      spec: spec("cursor"),
      cliOnPath: true,
      cliHelp: "",
      version: null,
      acpOnPath: true,
    });
    expect(row.transports).toEqual(["acp"]);
    expect(row.cliMode).toBeNull();
  });
});

describe("model chains and retired harnesses", () => {
  const allowedAll = ["codex", "agy", "cursor", "gemini"];
  const row = (id: HarnessSpec["id"], cliHelp = "exec -p --model", acpOnPath = false) =>
    classifyObservation({ spec: spec(id), cliOnPath: true, cliHelp, version: "test", acpOnPath });

  it("resolves chain keys through harness aliases and starts on the first model", () => {
    const plan = planSwarmRun({
      observations: [row("agy"), row("cursor", "-p --model", true)],
      harnesses: ["agy", "cursor"], allowed: allowedAll,
      modelChains: { antigravity: ["gem-a", "gem-b"], agent: ["grok-a"] },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const runs = plan.steps.flatMap(step => step.kind === "run" ? [step.plan] : []);
    expect(runs.map(run => [run.id, run.model, run.models])).toEqual([
      ["agy", "gem-a", ["gem-a", "gem-b"]],
      ["cursor", "grok-a", ["grok-a"]],
    ]);
  });

  it("rejects model and modelChains together", () => {
    const plan = planSwarmRun({
      observations: [row("agy")], harnesses: ["agy"], allowed: allowedAll,
      model: "gem-a", modelChains: { agy: ["gem-b"] },
    });
    expect(plan).toMatchObject({ ok: false, error: { code: "model_chain_invalid" } });
  });

  it("rejects a chain for a harness that is not in the run", () => {
    const plan = planSwarmRun({
      observations: [row("agy"), row("codex")], harnesses: ["agy"], allowed: allowedAll,
      modelChains: { codex: ["gpt-a"] },
    });
    expect(plan).toMatchObject({ ok: false, error: { code: "model_chain_invalid" } });
  });

  it("uses ACP for Cursor under auto when a model is pinned, and the CLI otherwise", () => {
    const cursor = row("cursor", "-p --model", true);
    const pinned = planSwarmRun({
      observations: [cursor], harnesses: ["cursor"], allowed: allowedAll, model: "grok-a",
    });
    const plain = planSwarmRun({ observations: [cursor], harnesses: ["cursor"], allowed: allowedAll });
    expect(pinned).toMatchObject({ ok: true, steps: [{ kind: "run", plan: { transport: "acp" } }] });
    expect(plain).toMatchObject({ ok: true, steps: [{ kind: "run", plan: { transport: "cli" } }] });
  });

  it("does not need a model flag on ACP, where the session pins the model", () => {
    const cursor = row("cursor", "-p", true);
    const plan = planSwarmRun({
      observations: [cursor], harnesses: ["cursor"], allowed: allowedAll, model: "grok-a", transport: "acp",
    });
    expect(plan.ok).toBe(true);
  });

  it("leaves retired Gemini out of default runs but still runs it when named", () => {
    const gemini = row("gemini", "-p --acp --model");
    const defaults = planSwarmRun({ observations: [row("agy"), gemini], allowed: allowedAll });
    expect(defaults).toMatchObject({ ok: true, steps: [{ kind: "run", plan: { id: "agy" } }] });
    if (defaults.ok) expect(defaults.steps).toHaveLength(1);
    const named = planSwarmRun({ observations: [gemini], harnesses: ["gemini"], allowed: allowedAll });
    expect(named).toMatchObject({ ok: true, steps: [{ kind: "run", plan: { id: "gemini" } }] });
    expect(gemini.notes.join(" ")).toMatch(/agy/);
  });
});
