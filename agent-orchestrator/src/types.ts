import type { RunOutcome } from "./services/eventParse.js";

export type SubagentName = "claude" | "antigravity" | "codex";

export type HarnessId =
  | "codex"
  | "claude"
  | "agy"
  | "cursor"
  | "gemini"
  | "grok";

export type SwarmTransport = "cli" | "acp";

export type SubagentMode =
  | "review"
  | "implement"
  | "explain"
  | "test"
  | "tie-breaker"
  | "judge"
  | "respond";

export interface SubagentRequest {
  agent: string;
  task: string;
  workspaceRoot: string;
  files?: string[];
  mode?: SubagentMode;
  timeoutMs?: number;
  dryRun?: boolean;
  allowWrites?: boolean;
  extraContext?: string;
  model?: string;
  /** Continue this harness session instead of starting a new one (swarm_run `resume`). */
  resumeSessionId?: string;
  /** Per-run spend cap, where the harness supports one (Claude --max-budget-usd). */
  budgetUsd?: number;
}

export interface SubagentResult {
  agent: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  commandPreview: string;
  outputFile?: string;
  outputDir?: string;
  error?: string;
  prompt?: string;
  /** Model requested for this run. */
  model?: string;
  /** Model the ACP session confirmed. */
  reportedModel?: string;
  /** How the run ended, from the harness's own result payload where one exists. */
  outcome?: RunOutcome;
  /** Session, thread, chat or conversation id the harness reported. */
  sessionId?: string;
  /** Client-side cost estimate, when the harness reports one. */
  costUsd?: number;
  /** Permission requests the harness reported as denied. */
  denials?: number;
}

export interface AgentDetectionInfo {
  available: boolean;
  command: string;
  mode: string | null;
  version: string | null;
  notes: string[];
  helpSnippet?: string;
  supportsCd?: boolean;
  promptFlag?: "-p" | "--prompt" | "--print";
}

export interface DetectionResult {
  agents: Record<SubagentName, AgentDetectionInfo>;
  detectedAt: string;
}

export interface RunSubagentMcpResponse {
  ok: boolean;
  agent: string;
  exitCode: number | null;
  durationMs: number;
  outputFile?: string;
  outputDir?: string;
  summary: string;
  error?: string;
  commandPreview?: string;
  model?: string;
  reportedModel?: string;
  attempts?: ModelAttempt[];
}

/** One model tried in a fallback chain. */
export interface ModelAttempt {
  model: string;
  ok: boolean;
  error?: string;
  outputDir?: string;
  outputFile?: string;
  durationMs: number;
}

export interface OrchestratorConfig {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  allowWritesByDefault: boolean;
  allowedAgents: string[];
  workspaceBoundary: string;
  redactEnv: boolean;
  storeOutputs: boolean;
  storePrompts: boolean;
  detectionTimeoutMs: number;
  codex?: { jsonOutput?: boolean };
  claude?: { maxBudgetUsd?: number };
  /** Concurrent runs per harness inside one server process. Default 2. */
  concurrency?: { perHarness?: number };
}

export interface CommandRunOptions {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  /** Optional UTF-8 input; stdin is always closed after delivery. */
  stdin?: string;
}

export interface CommandRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface WorkspaceSnapshot {
  repositoryRoot: string;
  branch: string | null;
  statusShort: string | null;
  diffStat: string | null;
  fileDiffs: Record<string, string>;
  fileExcerpts: Record<string, string>;
  notes: string[];
}
