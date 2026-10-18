import { z } from "zod";
import { getWorkspaceRoot, loadConfig } from "../config.js";
import { validateSubagentRequest } from "../runners/base.js";
import { runSubagentForRequest } from "../runners/index.js";
import { validateEvidenceFiles, PathSafetyError } from "../services/pathSafety.js";
import {
  relativeOutputPath,
  storeRunResult,
  storeSwarmSummary,
} from "../services/resultStore.js";
import { redactSecrets } from "../services/redaction.js";
import { agreeVotes, emptyAgreement } from "../services/votes.js";
import type { SwarmAgreement } from "../services/votes.js";
import type {
  RunSubagentMcpResponse,
  SubagentName,
  SubagentResult,
} from "../types.js";

export const runJudgeSwarmInputSchema = z.object({
  task: z.string().min(1).max(8000),
  files: z.array(z.string()).max(20).optional(),
  agents: z
    .array(z.enum(["codex", "antigravity", "claude"]))
    .min(1)
    .max(3)
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  dryRun: z.boolean().optional().default(false),
  extraContext: z.string().max(4000).optional(),
});

export interface JudgeSwarmResponse {
  ok: boolean;
  dryRun: boolean;
  outputDir?: string;
  judges: RunSubagentMcpResponse[];
  agreement: SwarmAgreement;
  note: string;
  error?: string;
}

function uniqueAgents(agents: SubagentName[]): SubagentName[] {
  return [...new Set(agents)];
}

function brief(result: SubagentResult): string {
  if (result.error) return result.error;
  const redacted = redactSecrets(result.stdout).trim();
  const line = redacted.split("\n").find((item) => item.trim().length > 0) ?? "";
  if (!line) return "No stdout output.";
  return line.length > 240 ? `${line.slice(0, 240)}...` : line;
}

function failed(dryRun: boolean, error: string): JudgeSwarmResponse {
  return {
    ok: false,
    dryRun,
    judges: [],
    agreement: emptyAgreement("The swarm did not run."),
    note: "Agent-panel labels are not ground truth.",
    error,
  };
}

export async function runJudgeSwarmTool(
  input: z.infer<typeof runJudgeSwarmInputSchema>,
): Promise<JudgeSwarmResponse> {
  const workspaceRoot = getWorkspaceRoot();
  const config = loadConfig(workspaceRoot);
  const dryRun = input.dryRun ?? false;

  try {
    validateEvidenceFiles(workspaceRoot, input.files);
  } catch (err) {
    const message = err instanceof PathSafetyError ? err.message : String(err);
    return failed(dryRun, message);
  }

  const agents = uniqueAgents(input.agents ?? config.allowedAgents);
  let requests;
  try {
    requests = agents.map((agent) =>
      validateSubagentRequest(
        {
          agent,
          task: input.task,
          workspaceRoot,
          files: input.files,
          mode: "judge",
          timeoutMs: input.timeoutMs,
          allowWrites: false,
          dryRun,
          extraContext: input.extraContext,
        },
        config,
      ),
    );
  } catch (err) {
    return failed(dryRun, err instanceof Error ? err.message : String(err));
  }

  const runs = await Promise.all(
    requests.map(async (request) => {
      const result = await runSubagentForRequest(request, config);
      const stored = storeRunResult(
        workspaceRoot,
        request,
        result,
        config,
        result.prompt,
      );
      const response: RunSubagentMcpResponse = {
        ok: result.ok,
        agent: result.agent,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        outputFile: stored
          ? relativeOutputPath(workspaceRoot, stored.stdoutFile)
          : undefined,
        outputDir: stored
          ? relativeOutputPath(workspaceRoot, stored.runDir)
          : undefined,
        summary: brief(result),
        error: result.error,
        commandPreview: result.commandPreview,
      };
      return { result, response };
    }),
  );

  const agreement = dryRun
    ? emptyAgreement("Dry run previews commands only. No votes were collected.")
    : agreeVotes(
        runs.map((run) => ({
          agent: run.result.agent,
          text: run.result.stdout,
        })),
      );

  const judges = runs.map((run) => run.response);
  const stored = storeSwarmSummary(
    workspaceRoot,
    input.task,
    { task: input.task, agents, dryRun, judges, agreement },
    config,
  );

  const ok = dryRun
    ? runs.every((run) => run.response.ok)
    : runs.some((run) => run.response.ok);

  return {
    ok,
    dryRun,
    outputDir: stored ? relativeOutputPath(workspaceRoot, stored) : undefined,
    judges,
    agreement,
    note: agreement.note,
  };
}
