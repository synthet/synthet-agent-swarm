import type { OrchestratorConfig, SubagentRequest, SubagentResult } from "../types.js";
import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import { runAntigravity } from "./antigravity.js";

export async function runSubagentForRequest(
  request: SubagentRequest,
  config: OrchestratorConfig,
): Promise<SubagentResult> {
  switch (request.agent) {
    case "codex":
      return runCodex(request, config);
    case "antigravity":
      return runAntigravity(request, config);
    case "claude":
      return runClaude(request, config);
  }
}
