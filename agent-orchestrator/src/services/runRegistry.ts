import { randomUUID } from "node:crypto";
import type { RunOutcome } from "./eventParse.js";

/** One harness run this server process started. Holds no prompt or reply text. */
export interface RunRecord {
  runId: string;
  harness: string;
  transport: "cli" | "acp";
  model?: string;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  outcome?: RunOutcome;
  sessionId?: string;
  outputDir?: string;
}

const RECENT_LIMIT = 50;
const active = new Map<string, RunRecord>();
const recent: RunRecord[] = [];

export function beginRun(record: Omit<RunRecord, "runId" | "startedAt">): string {
  const runId = randomUUID();
  active.set(runId, { ...record, runId, startedAt: new Date().toISOString() });
  return runId;
}

export function endRun(runId: string, patch: Partial<Omit<RunRecord, "runId">>): void {
  const record = active.get(runId);
  if (!record) return;
  active.delete(runId);
  recent.unshift({ ...record, ...patch, finishedAt: new Date().toISOString() });
  recent.length = Math.min(recent.length, RECENT_LIMIT);
}

export function runSnapshot(limit = 20): { active: RunRecord[]; recent: RunRecord[] } {
  return {
    active: [...active.values()],
    recent: recent.slice(0, Math.max(0, limit)),
  };
}

/** @internal Test hook. */
export function resetRunRegistry(): void {
  active.clear();
  recent.length = 0;
}
