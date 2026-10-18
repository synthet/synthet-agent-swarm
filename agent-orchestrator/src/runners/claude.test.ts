import { describe, expect, it } from "vitest";
import { buildClaudeArgv } from "./claude.js";

describe("buildClaudeArgv", () => {
  it("uses claude -p with the prompt as the next argv", () => {
    const argv = buildClaudeArgv("hello world");
    expect(argv).toEqual(["claude", "-p", "hello world"]);
  });

  it("adds Read and evidence directories for a judge call", () => {
    const argv = buildClaudeArgv("hello world", ["/repo/blind"]);
    expect(argv).toEqual([
      "claude",
      "-p",
      "hello world",
      "--tools",
      "Read",
      "--add-dir",
      "/repo/blind",
    ]);
  });
});
