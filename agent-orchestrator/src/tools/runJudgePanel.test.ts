import { describe, expect, it } from "vitest";
import { emptyAgreement } from "../services/votes.js";
import {
  assembleJudgePanel,
  runJudgePanelInputSchema,
} from "./runJudgePanel.js";
import type { JudgeSwarmResponse } from "./runJudgeSwarm.js";

describe("runJudgePanelInputSchema", () => {
  it("defaults to a blind live panel", () => {
    const parsed = runJudgePanelInputSchema.parse({
      task: "Choose A or B",
      items: [{ id: "a", files: ["blind/a.jpg"] }],
    });
    expect(parsed.blind).toBe(true);
    expect(parsed.dryRun).toBe(false);
  });

  it("rejects extra context on a blind panel", () => {
    expect(() =>
      runJudgePanelInputSchema.parse({
        task: "Choose A or B",
        items: [{ id: "a", files: ["blind/a.jpg"] }],
        extraContext: "score 0.9",
      }),
    ).toThrow(/extraContext/);
  });

  it("rejects duplicate item ids and more than 20 evidence files", () => {
    expect(() =>
      runJudgePanelInputSchema.parse({
        task: "Choose",
        items: [
          { id: "a", files: ["blind/a.jpg"] },
          { id: "a", files: ["blind/b.jpg"] },
        ],
      }),
    ).toThrow(/unique/);

    const items = [
      { id: "i0", files: ["blind/extra.jpg", "blind/0.jpg"] },
      ...Array.from({ length: 19 }, (_, index) => ({
        id: `i${index + 1}`,
        files: [`blind/${index + 1}.jpg`],
      })),
    ];
    expect(() =>
      runJudgePanelInputSchema.parse({ task: "Choose", items }),
    ).toThrow(/20 evidence files/);
  });
});

describe("assembleJudgePanel", () => {
  it("returns a text-only Jev state and does not call Jev", () => {
    const swarm: JudgeSwarmResponse = {
      ok: true,
      dryRun: false,
      judges: [],
      agreement: emptyAgreement("No parsed votes."),
      note: "Agent-panel labels are not ground truth.",
    };
    const panel = assembleJudgePanel({
      build: {
        blind: true,
        items: [{ id: "a", files: ["blind/a.jpg"] }],
        files: ["blind/a.jpg"],
        note: "Evidence paths are attachments only and are omitted from the prompt text.",
      },
      swarm,
      dryRun: false,
    });

    expect(panel.stages.jev.called).toBe(false);
    expect(panel.stages.jev.state.items).toEqual([]);
    expect(panel.stages.rules.applied).toBe(false);
    expect(panel.stages.analyze).toMatchObject({ skipped: true });
  });
});
