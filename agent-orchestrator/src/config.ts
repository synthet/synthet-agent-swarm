import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OrchestratorConfig, SubagentName } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");

const DEFAULT_CONFIG: OrchestratorConfig = {
  defaultTimeoutMs: 300000,
  maxTimeoutMs: 900000,
  allowWritesByDefault: false,
  allowedAgents: ["codex", "antigravity", "claude"],
  workspaceBoundary: ".",
  redactEnv: true,
  storeOutputs: true,
  storePrompts: false,
  detectionTimeoutMs: 10000,
  codex: { jsonOutput: false },
};

function loadJsonFile(path: string): Partial<OrchestratorConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<OrchestratorConfig>;
  } catch {
    return null;
  }
}

export function loadConfig(workspaceRoot: string): OrchestratorConfig {
  const defaults =
    loadJsonFile(join(PACKAGE_ROOT, "config.default.json")) ?? {};
  const workspaceOverride = loadJsonFile(
    join(workspaceRoot, ".agent-orchestrator.json"),
  );

  const merged: OrchestratorConfig = {
    ...DEFAULT_CONFIG,
    ...defaults,
    ...workspaceOverride,
    codex: { ...DEFAULT_CONFIG.codex, ...defaults.codex, ...workspaceOverride?.codex },
  };

  return merged;
}

export function clampTimeout(
  requested: number | undefined,
  config: OrchestratorConfig,
): number {
  const base = requested ?? config.defaultTimeoutMs;
  return Math.min(Math.max(base, 1000), config.maxTimeoutMs);
}

export function isAgentAllowed(
  agent: SubagentName,
  config: OrchestratorConfig,
): boolean {
  return config.allowedAgents.includes(agent);
}

export function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT?.trim() || process.cwd();
}
