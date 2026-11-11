import { describe, expect, it } from "vitest";
import type { HarnessObservation } from "../harness/registry.js";
import {
  swarmChoiceInputSchema,
  swarmNoulTool,
  swarmScoreInputSchema,
  swarmSystemOneInputSchema,
  swarmSystemOneTool,
} from "./swarmJev.js";

const claude: HarnessObservation = {
  spec: {
    id: "claude",
    title: "Claude Code",
    command: "claude -p",
    cliArgv: ["claude", "-p"],
    acpArgv: null,
    notes: [],
  },
  cliOnPath: true,
  cliHelp: "--model -p",
  version: "test",
  acpOnPath: false,
  acpArgv: null,
  modelFlag: "--model",
  transports: ["cli"],
  available: true,
  binaryFound: true,
  cliMode: "print",
  promptFlag: "-p",
  supportsCd: false,
  notes: [],
};

describe("jev-like swarm tools", () => {
  it("rejects a choice whose criteria is a list", () => {
    const parsed = swarmChoiceInputSchema.safeParse({
      state: "x",
      instructions: "Pick",
      criteria: ["a", "b"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a score whose criteria is an object", () => {
    const parsed = swarmScoreInputSchema.safeParse({
      state: "x",
      instructions: "Rate",
      criteria: { low: "Low" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a batch question with no instructions", () => {
    const parsed = swarmSystemOneInputSchema.safeParse({
      state: "x",
      questions: { q: { type: "noul" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("returns one noul answer under result", async () => {
    const parsed = swarmSystemOneInputSchema.safeParse({
      state: { text: "ping" },
      questions: { q: { type: "noul", instructions: "Is this short?" } },
      dryRun: true,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const response = await swarmSystemOneTool(parsed.data, [claude]);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.model).toBe("claude:haiku");
    expect(response.result.answers.q).toMatchObject({ type: "noul" });
  });

  it("uses question_id answer by default", async () => {
    const response = await swarmNoulTool(
      {
        state: "ping",
        instructions: "Is this short?",
        question_id: "answer",
        dryRun: true,
      },
      [claude],
    );
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.answers.answer).toMatchObject({ type: "noul" });
  });
});
