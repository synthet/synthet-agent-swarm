import { describe, expect, it } from "vitest";
import { agreeVotes } from "./votes.js";
import {
  analyzeAgainstHuman,
  cohenKappa,
  panelEvidenceFiles,
  panelSwarmInput,
  panelTask,
} from "./panel.js";

describe("panelEvidenceFiles", () => {
  it("keeps the first path and drops slash duplicates", () => {
    expect(
      panelEvidenceFiles([
        { id: "a", files: ["blind/a.jpg", "blind\\a.jpg"] },
        { id: "b", files: ["blind/b.jpg", "blind/a.jpg"] },
      ]),
    ).toEqual(["blind/a.jpg", "blind/b.jpg"]);
  });
});

describe("panelSwarmInput", () => {
  it("keeps a blind prompt free of evidence paths and extra context", () => {
    const swarm = panelSwarmInput({
      task: "Choose A or B",
      items: [{ id: "a", files: ["renders/heron-name.jpg"] }],
      blind: true,
      extraContext: "human label A",
    });

    expect(swarm.task).toContain("Item ids: a");
    expect(swarm.task).not.toContain("heron-name.jpg");
    expect(swarm.files).toEqual(["renders/heron-name.jpg"]);
    expect(swarm.extraContext).toBeUndefined();
  });

  it("passes harnesses and model through to the swarm input", () => {
    const swarm = panelSwarmInput({
      task: "Choose A or B",
      items: [{ id: "a", files: ["blind/a.jpg"] }],
      harnesses: ["cursor", "agy"],
      model: "gpt-5",
      transport: "auto",
    });
    expect(swarm.harnesses).toEqual(["cursor", "agy"]);
    expect(swarm.model).toBe("gpt-5");
    expect(swarm.transport).toBe("auto");
  });

  it("passes extra context only when the panel is informed", () => {
    const swarm = panelSwarmInput({
      task: "Choose A or B",
      items: [{ id: "a", files: ["blind/a.jpg"] }],
      blind: false,
      extraContext: "score 0.2",
    });
    expect(swarm.extraContext).toBe("score 0.2");
  });

  it("rejects a task that cannot fit the item-id contract", () => {
    expect(() => panelTask("x".repeat(8000), ["a"])).toThrow(/8000/);
  });
});

describe("cohenKappa", () => {
  it("returns null for a single pair and 1 when both pairs match", () => {
    expect(cohenKappa([["A", "A"]])).toBeNull();
    expect(cohenKappa([["A", "A"], ["B", "B"]])).toBe(1);
  });

  it("returns -1 when the two raters always disagree", () => {
    expect(cohenKappa([["A", "B"], ["B", "A"]])).toBe(-1);
  });
});

describe("analyzeAgainstHuman", () => {
  it("counts exact matches and keeps a dissent list without treating the panel as human", () => {
    const agreement = agreeVotes([
      { agent: "codex", text: '{"images":[{"id":"a","choice":"A"}]}' },
      { agent: "antigravity", text: '{"images":[{"id":"a","choice":"A"}]}' },
      { agent: "codex", text: '{"images":[{"id":"b","choice":"keep"}]}' },
      { agent: "antigravity", text: '{"images":[{"id":"b","choice":"reject"}]}' },
    ]);
    const analysis = analyzeAgainstHuman(agreement, {
      a: { choice: "B" },
      b: { choice: "keep" },
    });

    expect(analysis.skipped).toBe(false);
    if (analysis.skipped) return;
    expect(analysis.panel.choice).toMatchObject({
      compared: 1,
      exactMatches: 0,
      unresolved: 1,
    });
    expect(analysis.perJudge.codex.choice.exactMatches).toBe(1);
    expect(analysis.disagreements).toEqual([
      { id: "a", field: "choice", human: "B", panel: "A", disputed: false },
      { id: "b", field: "choice", human: "keep", panel: null, disputed: true },
    ]);
    expect(analysis.note).toMatch(/does not overwrite/);
  });
});
