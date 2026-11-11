import { antMessagesArgv, antMessagesStdin } from "../runners/ant.js";
import { runCommand } from "./commandRunner.js";
import { swarmError, type PlanStep } from "../harness/registry.js";

export type ApiCreditStatus = "available" | "unavailable" | "unknown";

const NO_CREDIT =
  /credit balance is too low|credit_balance_too_low|billing_error|insufficient credits|purchase credits/i;

let cached: { status: ApiCreditStatus; at: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;

export function clearApiCreditCache(): void {
  cached = null;
}

/** A one-token Messages call is the credit check. Admin billing endpoints are a different scope. */
export function classifyCreditProbe(
  exitCode: number | null,
  stdout: string,
  stderr: string,
): ApiCreditStatus {
  const evidence = `${stdout}\n${stderr}`;
  if (NO_CREDIT.test(evidence)) return "unavailable";
  if (exitCode === 0 && /"type"\s*:\s*"message"/.test(stdout)) return "available";
  return "unknown";
}

export async function probeApiCredits(cwd: string, timeoutMs: number): Promise<ApiCreditStatus> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.status;
  const run = await runCommand({
    argv: antMessagesArgv("claude-haiku-5-5", { maxTokens: 1 }),
    cwd,
    timeoutMs,
    stdin: antMessagesStdin("Reply with the letter p."),
  });
  const status = classifyCreditProbe(run.exitCode, run.stdout, run.stderr);
  if (status !== "unknown") cached = { status, at: now };
  return status;
}

/**
 * Default fan-out lists both the Claude Code CLI and the Messages API.
 * Credits pay for the API and do not pay for Claude Code, so one of the two runs.
 */
export function applyCreditPreference(steps: PlanStep[], status: ApiCreditStatus): PlanStep[] {
  if (status === "unknown") return steps;
  const ids = new Set(
    steps.flatMap((step) => (step.kind === "run" ? [step.plan.id] : [])),
  );
  if (!ids.has("claude") || !ids.has("ant")) return steps;
  const drop = status === "available" ? "claude" : "ant";
  const reason =
    status === "available"
      ? "Skipped the claude CLI because the Claude API has credits."
      : "Skipped the Claude API because it reported no credits.";
  return steps.map((step) =>
    step.kind === "run" && step.plan.id === drop
      ? {
          kind: "skip" as const,
          skip: {
            id: drop,
            error: swarmError("harness_unavailable", reason, { harness: drop }, [
              status === "available"
                ? "The ant harness sends this judgement to the Messages API."
                : "The claude harness uses claude -p.",
            ]),
          },
        }
      : step,
  );
}
