import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getWorkspaceRoot } from "../config.js";
import { runCommand } from "../services/commandRunner.js";
import { runSnapshot, type RunRecord } from "../services/runRegistry.js";

export const swarmSessionsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
  native: z.boolean().optional().default(true)
    .describe("Also list the harnesses' own sessions where a machine-readable listing exists (claude agents --json)."),
});

export interface StoredRun {
  harness: string;
  ok?: boolean;
  outcome?: string;
  sessionId?: string;
  startedAt?: string;
  finishedAt?: string;
  outputDir: string;
}

export interface NativeSession {
  harness: string;
  sessionId: string;
  name?: string;
  cwd?: string;
  kind?: string;
  status?: string;
  pid?: number;
  startedAt?: number;
}

export interface SwarmSessionsResponse {
  ok: true;
  active: RunRecord[];
  recent: RunRecord[];
  stored: StoredRun[];
  native: Record<string, { sessions?: NativeSession[]; note?: string; error?: string }>;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Recent per-harness results under .agent-runs, newest first. Swarm and panel summaries are skipped. */
export function storedRuns(workspaceRoot: string, limit: number): StoredRun[] {
  const root = join(workspaceRoot, ".agent-runs");
  if (!existsSync(root)) return [];
  const rows: StoredRun[] = [];
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const dir of dirs) {
    if (rows.length >= limit) break;
    const file = join(root, dir, "result.json");
    if (!existsSync(file)) continue;
    try {
      const result = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      rows.push({
        harness: str(result.agent) ?? "unknown",
        ok: typeof result.ok === "boolean" ? result.ok : undefined,
        outcome: str(result.outcome),
        sessionId: str(result.sessionId),
        startedAt: str(result.startedAt),
        finishedAt: str(result.finishedAt),
        outputDir: `.agent-runs/${dir}`,
      });
    } catch {
      // A partial or foreign file is skipped.
    }
  }
  return rows;
}

export function parseClaudeAgents(stdout: string): NativeSession[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("claude agents --json did not return a list.");
  return parsed.flatMap((row): NativeSession[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const sessionId = str(record.sessionId);
    if (!sessionId) return [];
    return [{
      harness: "claude",
      sessionId,
      name: str(record.name),
      cwd: str(record.cwd),
      kind: str(record.kind),
      status: str(record.status),
      pid: typeof record.pid === "number" ? record.pid : undefined,
      startedAt: typeof record.startedAt === "number" ? record.startedAt : undefined,
    }];
  });
}

async function claudeSessions(cwd: string): Promise<{ sessions?: NativeSession[]; error?: string }> {
  const run = await runCommand({ argv: ["claude", "agents", "--json"], cwd, timeoutMs: 15_000 });
  if (run.exitCode !== 0) return { error: run.error ?? `claude agents --json exited with ${run.exitCode}.` };
  try {
    return { sessions: parseClaudeAgents(run.stdout) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function swarmSessionsTool(
  input: z.infer<typeof swarmSessionsInputSchema>,
): Promise<SwarmSessionsResponse> {
  const workspaceRoot = getWorkspaceRoot();
  const snapshot = runSnapshot(input.limit);
  const native: SwarmSessionsResponse["native"] = {};
  if (input.native) {
    native.claude = await claudeSessions(workspaceRoot);
    native.cursor = { note: "agent ls is an interactive picker with no machine-readable listing." };
    native.codex = { note: "No session listing command. Use sessionId from a stored run with resume." };
    native.agy = { note: "No session listing command. Use sessionId from a stored run with resume." };
  }
  return {
    ok: true,
    active: snapshot.active,
    recent: snapshot.recent,
    stored: storedRuns(workspaceRoot, input.limit),
    native,
  };
}
