import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "./register.js";

describe("tool contract", () => {
  it("matches the tool names published in docs/api.md", () => {
    const api = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../docs/api.md"),
      "utf8",
    );
    const published = [...api.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    for (const name of TOOL_NAMES) {
      expect(published).toContain(name);
    }
    expect(TOOL_NAMES).toEqual([
      "swarm_search",
      "swarm_run",
      "run_judge_panel",
      "detect_subagents",
      "run_subagent",
      "run_judge_swarm",
    ]);
  });
});
