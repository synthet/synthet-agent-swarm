import { describe, expect, it } from "vitest";
import { buildSubagentPrompt } from "./promptBuilder.js";
import type { WorkspaceSnapshot } from "../types.js";

const emptySnapshot: WorkspaceSnapshot = {
  repositoryRoot: "/workspace",
  branch: "main",
  statusShort: " M README.md",
  diffStat: null,
  fileDiffs: {},
  fileExcerpts: {},
  notes: [],
};

describe("buildSubagentPrompt", () => {
  it("includes review-only constraints when allowWrites is false", () => {
    const prompt = buildSubagentPrompt({
      agent: "codex",
      task: "Review API",
      workspaceRoot: "/workspace",
      mode: "review",
      allowWrites: false,
      snapshot: emptySnapshot,
    });
    expect(prompt).toContain("REVIEW ONLY");
    expect(prompt).toContain("Do NOT modify");
    expect(prompt).toContain("blocker | high | medium | low | nit");
  });

  it("keeps judge prompts blind to git context", () => {
    const prompt = buildSubagentPrompt({
      agent: "codex",
      task: "Choose A or B",
      workspaceRoot: "/workspace",
      mode: "judge",
      allowWrites: false,
      files: ["blind/a.jpg"],
      snapshot: emptySnapshot,
    });
    expect(prompt).toContain("not ground truth");
    expect(prompt).toContain("attached");
    expect(prompt).not.toContain("Git status");
    expect(prompt).not.toContain("blocker | high");
  });
});
