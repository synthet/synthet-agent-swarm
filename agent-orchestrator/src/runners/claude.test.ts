import { describe, expect, it } from "vitest";
import { buildClaudeArgv } from "./claude.js";

describe("buildClaudeArgv", () => {
  it("uses claude -p with the prompt as the next argv", () => {
    const argv = buildClaudeArgv("hello world");
    expect(argv).toEqual([
      "claude", "-p", "hello world", "--output-format", "json",
      "--permission-mode", "dontAsk", "--permission-prompts", "none", "--strict-mcp-config",
    ]);
    expect(argv).not.toContain("--bare");
  });

  it("adds Read and evidence directories for a judge call", () => {
    const argv = buildClaudeArgv("hello world", ["/repo/blind"]);
    expect(argv).toEqual([
      "claude",
      "-p",
      "hello world",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--strict-mcp-config",
      "--tools",
      "Read",
      "--add-dir",
      "/repo/blind",
    ]);
  });

  it("caps spend when a budget is configured", () => {
    const argv = buildClaudeArgv("hi", [], undefined, { maxBudgetUsd: 0.25 });
    expect(argv.slice(-2)).toEqual(["--max-budget-usd", "0.25"]);
  });
});
