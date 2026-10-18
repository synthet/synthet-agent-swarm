import { describe, expect, it } from "vitest";
import { buildAntigravityArgv } from "./antigravity.js";
import type { AgentDetectionInfo } from "../types.js";

describe("buildAntigravityArgv", () => {
  it("uses -p flag by default", () => {
    const detection: AgentDetectionInfo = {
      available: true,
      command: "agy",
      mode: "prompt",
      version: "1.0",
      notes: [],
      promptFlag: "-p",
    };
    const argv = buildAntigravityArgv("hello", detection);
    expect(argv).toEqual(["agy", "-p", "hello"]);
  });

  it("uses --prompt when detected", () => {
    const detection: AgentDetectionInfo = {
      available: true,
      command: "agy",
      mode: "prompt",
      version: "1.0",
      notes: [],
      promptFlag: "--prompt",
    };
    const argv = buildAntigravityArgv("hello", detection);
    expect(argv[1]).toBe("--prompt");
  });

  it("uses --print when detected", () => {
    const detection: AgentDetectionInfo = {
      available: true,
      command: "agy",
      mode: "prompt",
      version: "1.0",
      notes: [],
      promptFlag: "--print",
    };
    const argv = buildAntigravityArgv("hello", detection);
    expect(argv).toEqual(["agy", "--print", "hello"]);
  });

  it("adds evidence directories and no permission-skip flag", () => {
    const detection: AgentDetectionInfo = {
      available: true,
      command: "agy",
      mode: "prompt",
      version: "1.0",
      notes: [],
      promptFlag: "-p",
    };
    const argv = buildAntigravityArgv("hello", detection, ["/repo/blind"]);
    expect(argv).toEqual(["agy", "-p", "hello", "--add-dir", "/repo/blind"]);
    expect(argv.join(" ")).not.toContain("dangerously");
  });
});
