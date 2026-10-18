import { getWorkspaceRoot, loadConfig } from "../config.js";
import { clearHarnessCache, observeHarnesses } from "../harness/observe.js";
import type { HarnessObservation } from "../harness/registry.js";
import type { AgentDetectionInfo, DetectionResult } from "../types.js";

export function clearDetectionCache(): void {
  clearHarnessCache();
}

function legacyInfo(
  observation: HarnessObservation | undefined,
  command: string,
): AgentDetectionInfo {
  if (!observation || !observation.binaryFound) {
    return {
      available: false,
      command: observation?.spec.cliArgv?.[0] ?? command,
      mode: null,
      version: null,
      notes: observation?.notes.length ? observation.notes : ["not found on PATH"],
      helpSnippet: observation?.cliHelp,
    };
  }
  return {
    available: true,
    command: observation.spec.cliArgv?.[0] ?? command,
    mode: observation.cliMode,
    version: observation.version,
    notes: observation.notes,
    helpSnippet: observation.cliHelp,
    supportsCd: observation.supportsCd,
    promptFlag: observation.promptFlag,
  };
}

export async function detectSubagents(): Promise<DetectionResult> {
  const workspaceRoot = getWorkspaceRoot();
  const config = loadConfig(workspaceRoot);
  const rows = await observeHarnesses(workspaceRoot, config.detectionTimeoutMs);
  const byId = new Map(rows.map((row) => [row.spec.id, row]));
  return {
    agents: {
      codex: legacyInfo(byId.get("codex"), "codex"),
      antigravity: legacyInfo(byId.get("agy"), "agy"),
      claude: legacyInfo(byId.get("claude"), "claude"),
    },
    detectedAt: new Date().toISOString(),
  };
}
