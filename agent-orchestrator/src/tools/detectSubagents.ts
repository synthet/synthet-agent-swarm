import { loadConfig, getWorkspaceRoot } from "../config.js";
import {
  detectAgent,
} from "../runners/detection.js";
import type { DetectionResult, SubagentName } from "../types.js";

const AGENTS: SubagentName[] = ["codex", "antigravity", "claude"];

let cache: { result: DetectionResult; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function clearDetectionCache(): void {
  cache = null;
}

export async function detectSubagents(): Promise<DetectionResult> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.result;
  }

  const workspaceRoot = getWorkspaceRoot();
  const config = loadConfig(workspaceRoot);

  const agents = {} as DetectionResult["agents"];

  await Promise.all(
    AGENTS.map(async (name) => {
      agents[name] = await detectAgent(
        name,
        config.detectionTimeoutMs,
        workspaceRoot,
      );
    }),
  );

  const result: DetectionResult = {
    agents,
    detectedAt: new Date().toISOString(),
  };

  cache = { result, expiresAt: now + CACHE_TTL_MS };
  return result;
}
