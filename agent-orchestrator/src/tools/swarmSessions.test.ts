import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginRun, endRun, resetRunRegistry, runSnapshot } from "../services/runRegistry.js";
import { parseClaudeAgents, storedRuns } from "./swarmSessions.js";

describe("run registry", () => {
  afterEach(() => resetRunRegistry());

  it("moves a finished run from active to recent with its session and outcome", () => {
    const id = beginRun({ harness: "claude", transport: "cli" });
    expect(runSnapshot().active.map((row) => row.harness)).toEqual(["claude"]);
    endRun(id, { ok: true, outcome: "ok", sessionId: "s-1" });
    const snapshot = runSnapshot();
    expect(snapshot.active).toEqual([]);
    expect(snapshot.recent[0]).toMatchObject({ harness: "claude", ok: true, outcome: "ok", sessionId: "s-1" });
    expect(snapshot.recent[0].finishedAt).toBeDefined();
  });
});

describe("storedRuns", () => {
  it("lists newest per-harness results and skips summaries and broken files", () => {
    const root = mkdtempSync(join(tmpdir(), "swarm-sessions-"));
    try {
      const write = (dir: string, body: string | null) => {
        mkdirSync(join(root, ".agent-runs", dir), { recursive: true });
        if (body !== null) writeFileSync(join(root, ".agent-runs", dir, "result.json"), body);
      };
      write("20261101-000000-codex-old", JSON.stringify({ agent: "codex", ok: true, outcome: "ok", sessionId: "t-1" }));
      write("20261102-000000-claude-new", JSON.stringify({ agent: "claude", ok: false, outcome: "auth_required" }));
      write("20261103-000000-swarm-summary", null);
      write("20261104-000000-agy-broken", "{not json");
      const rows = storedRuns(root, 10);
      expect(rows.map((row) => row.harness)).toEqual(["claude", "codex"]);
      expect(rows[1]).toMatchObject({ sessionId: "t-1", outputDir: ".agent-runs/20261101-000000-codex-old" });
      expect(storedRuns(root, 1)).toHaveLength(1);
      expect(storedRuns(join(root, "missing"), 5)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("parseClaudeAgents", () => {
  it("maps claude agents --json rows and drops rows without a session id", () => {
    const rows = parseClaudeAgents(JSON.stringify([
      { pid: 22056, cwd: "D:/repo", kind: "interactive", startedAt: 1794278811346, sessionId: "abc", name: "a2a", status: "busy" },
      { pid: 1, cwd: "D:/x" },
    ]));
    expect(rows).toEqual([{
      harness: "claude", sessionId: "abc", name: "a2a", cwd: "D:/repo", kind: "interactive",
      status: "busy", pid: 22056, startedAt: 1794278811346,
    }]);
    expect(() => parseClaudeAgents("{}")).toThrow(/list/);
  });
});
