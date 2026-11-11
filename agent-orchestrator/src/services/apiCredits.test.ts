import { describe, expect, it } from "vitest";
import { classifyObservation, HARNESS_SPECS, type PlanStep } from "../harness/registry.js";
import { applyCreditPreference, classifyCreditProbe } from "./apiCredits.js";

function runnable(id: "claude" | "ant"): PlanStep {
  const spec = HARNESS_SPECS.find((item) => item.id === id)!;
  const observation = classifyObservation({
    spec,
    cliOnPath: true,
    cliHelp: id === "ant" ? "messages\n--model string\n" : "-p\n--model",
    version: "test",
    acpOnPath: false,
  });
  return { kind: "run", plan: { id, transport: "cli", observation } };
}

describe("API credit preference", () => {
  it("reads a message as credits and a low balance as none", () => {
    expect(classifyCreditProbe(0, '{"type":"message","content":[]}', "")).toBe("available");
    expect(classifyCreditProbe(
      1,
      '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
      "",
    )).toBe("unavailable");
    expect(classifyCreditProbe(1, "", "connection reset")).toBe("unknown");
  });

  it("keeps the Messages API and skips the CLI when credits are available", () => {
    const steps = applyCreditPreference([runnable("claude"), runnable("ant")], "available");
    expect(steps.map((step) => (step.kind === "run" ? step.plan.id : step.skip.id))).toEqual([
      "claude",
      "ant",
    ]);
    expect(steps[0]?.kind).toBe("skip");
    expect(steps[0]?.kind === "skip" && steps[0].skip.error.message).toMatch(/claude CLI/);
    expect(steps[1]?.kind).toBe("run");
  });

  it("keeps the CLI when the API reports no credits", () => {
    const steps = applyCreditPreference([runnable("ant"), runnable("claude")], "unavailable");
    expect(steps[0]?.kind).toBe("skip");
    expect(steps[1]?.kind).toBe("run");
    expect(steps[1]?.kind === "run" && steps[1].plan.id).toBe("claude");
  });

  it("leaves an explicit single harness alone", () => {
    const steps = [runnable("claude")];
    expect(applyCreditPreference(steps, "available")).toBe(steps);
    expect(applyCreditPreference([runnable("claude"), runnable("ant")], "unknown")).toHaveLength(2);
  });
});
