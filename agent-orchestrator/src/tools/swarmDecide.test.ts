import { describe, expect, it } from "vitest";
import {
  aggregateVotes,
  buildDecisionPrompt,
  extractJsonObject,
  LIGHTWEIGHT_MODELS,
  normalizeAnswers,
  resolveLightweightModel,
  swarmDecideTool,
} from "./swarmDecide.js";
import type { HarnessObservation } from "../harness/registry.js";

describe("swarmDecide", () => {
  it("maps each harness to its October 2026 lightweight model by default", () => {
    expect(resolveLightweightModel("claude")).toBe("haiku");
    expect(resolveLightweightModel("codex", "lightweight")).toBe("gpt-6-luna");
    expect(resolveLightweightModel("cursor", "flash")).toBe("composer-2.5");
    expect(resolveLightweightModel("agy", "auto")).toBe("gemini-3.8-flash-medium");
    expect(resolveLightweightModel("grok")).toBe("grok-build-0.1");
    expect(resolveLightweightModel("claude", "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(Object.keys(LIGHTWEIGHT_MODELS)).toContain("claude");
  });

  it("extracts JSON objects from plain text, fenced blocks, and Cursor JSON wrappers", () => {
    expect(extractJsonObject('{"answers":{"q1":{"type":"noul","noul":0.95}}}')).toEqual({
      answers: { q1: { type: "noul", noul: 0.95 } },
    });
    expect(
      extractJsonObject('Here is the decision:\n```json\n{"answers":{"q1":{"type":"noul","noul":0.88}}}\n```'),
    ).toEqual({
      answers: { q1: { type: "noul", noul: 0.88 } },
    });
    expect(
      extractJsonObject(JSON.stringify({ result: '{"answers":{"q1":{"type":"noul","noul":0.91}}}' })),
    ).toEqual({
      answers: { q1: { type: "noul", noul: 0.91 } },
    });
  });

  it("normalizes noul, choice, and score answers and aggregates multi-harness votes", () => {
    const questions = {
      in_scope: { type: "noul" as const, instructions: "In scope?" },
      action: { type: "choice" as const, criteria: ["allow", "ask"] },
      risk: { type: "score" as const, criteria: ["low", "med", "high"] },
    };

    const parsed1 = {
      answers: {
        in_scope: { type: "noul", noul: 0.9, explanation: "ok" },
        action: { type: "choice", choice: "allow", confidence: 0.85, probabilities: { allow: 0.85, ask: 0.15 } },
        risk: { type: "score", score: 0, confidence: 0.9, probabilities: { "0": 0.9 } },
      },
    };
    const parsed2 = {
      answers: {
        in_scope: { type: "noul", noul: 0.96, explanation: "safe" },
        action: { type: "choice", choice: "allow", confidence: 0.95, probabilities: { allow: 0.95, ask: 0.05 } },
        risk: { type: "score", score: 0, confidence: 0.8, probabilities: { "0": 0.8 } },
      },
    };

    const norm1 = normalizeAnswers(parsed1, questions);
    const norm2 = normalizeAnswers(parsed2, questions);
    expect(norm1).not.toBeNull();
    expect(norm2).not.toBeNull();

    const agg = aggregateVotes(
      [
        { harness: "claude", model: "haiku", ok: true, durationMs: 100, commandPreview: "claude", answers: norm1! },
        { harness: "codex", model: "gpt-6-luna", ok: true, durationMs: 120, commandPreview: "codex", answers: norm2! },
      ],
      questions,
    );

    expect(agg.in_scope).toEqual({ type: "noul", noul: 0.93, explanation: "ok | safe" });
    expect((agg.action as { choice: string }).choice).toBe("allow");
    expect((agg.risk as { score: number }).score).toBe(0);
  });

  it("supports dryRun execution across mocked observations", async () => {
    const mockObs: HarnessObservation[] = [
      {
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
        version: "2.1.293",
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
      },
    ];

    const prompt = buildDecisionPrompt('{"command":"npm test"}', {
      in_scope: { type: "noul", instructions: "In scope" },
    });
    expect(prompt).toContain("npm test");

    const res = await swarmDecideTool(
      {
        state: { command: "npm test" },
        questions: {
          in_scope: { type: "noul", instructions: "In scope" },
          local_effects: { type: "noul", instructions: "Local effects" },
          recoverable: { type: "noul", instructions: "Recoverable" },
        },
        dryRun: true,
        timeoutMs: 4000,
      },
      mockObs,
    );

    expect(res.ok).toBe(true);
    expect(res.model).toBe("claude:haiku");
    expect((res.answers.in_scope as { noul: number }).noul).toBeGreaterThan(0.9);
  });
});
