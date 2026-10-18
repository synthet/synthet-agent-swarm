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
    const plan = planSwarmRun({
      observations: [agy, cursor],
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
