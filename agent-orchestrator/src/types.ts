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
  | "judge";

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
}

export interface CommandRunOptions {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
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
