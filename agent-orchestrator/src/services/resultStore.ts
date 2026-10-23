import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactObject, redactSecrets } from "./redaction.js";
import { isPathInsideWorkspace, PathSafetyError } from "./pathSafety.js";
import type {
  OrchestratorConfig,
  SubagentRequest,
  SubagentResult,
} from "../types.js";

function slugify(text: string, maxLen = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return slug || "task";
}

function timestampSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

export function buildRunDirName(agent: string, task: string): string {
  return `${timestampSlug()}-${agent}-${slugify(task)}`;
}

function createRunDirectory(workspaceRoot: string, agent: string, task: string): string {
  const root = resolve(workspaceRoot, ".agent-runs");
  if (!isPathInsideWorkspace(workspaceRoot, root)) {
    throw new PathSafetyError("Artifact root escapes the workspace boundary.");
  }
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `${buildRunDirName(agent, task)}-`));
}

export interface StoredRunPaths {
  runDir: string;
  stdoutFile: string;
  stderrFile: string;
  requestFile: string;
  resultFile: string;
  promptFile?: string;
}

export function storeRunResult(
  workspaceRoot: string,
  request: SubagentRequest,
  result: SubagentResult,
  config: OrchestratorConfig,
  prompt?: string,
): StoredRunPaths | null {
  if (!config.storeOutputs) return null;

  const runDir = createRunDirectory(workspaceRoot, request.agent, request.task);

  const paths: StoredRunPaths = {
    runDir,
    stdoutFile: join(runDir, "stdout.md"),
    stderrFile: join(runDir, "stderr.log"),
    requestFile: join(runDir, "request.json"),
    resultFile: join(runDir, "result.json"),
  };

  writeFileSync(
    paths.requestFile,
    JSON.stringify(redactObject(request), null, 2),
    "utf8",
  );

  writeFileSync(paths.stdoutFile, redactSecrets(result.stdout), "utf8");
  writeFileSync(paths.stderrFile, redactSecrets(result.stderr), "utf8");

  if (config.storePrompts && prompt) {
    paths.promptFile = join(runDir, "prompt.md");
    writeFileSync(paths.promptFile, redactSecrets(prompt), "utf8");
  }

  const resultPayload = redactObject({
    ...result,
    outputDir: runDir,
    outputFile: paths.stdoutFile,
  });

  writeFileSync(
    paths.resultFile,
    JSON.stringify(resultPayload, null, 2),
    "utf8",
  );

  return paths;
}

export function storePanelSummary(
  workspaceRoot: string,
  task: string,
  payload: unknown,
  config: OrchestratorConfig,
): string | null {
  if (!config.storeOutputs) return null;
  const runDir = createRunDirectory(workspaceRoot, "panel", task);
  writeFileSync(
    join(runDir, "panel.json"),
    JSON.stringify(redactObject(payload), null, 2),
    "utf8",
  );
  return runDir;
}

export function storeSwarmSummary(
  workspaceRoot: string,
  task: string,
  payload: unknown,
  config: OrchestratorConfig,
): string | null {
  if (!config.storeOutputs) return null;
  const runDir = createRunDirectory(workspaceRoot, "swarm", task);
  writeFileSync(
    join(runDir, "swarm.json"),
    JSON.stringify(redactObject(payload), null, 2),
    "utf8",
  );
  return runDir;
}

export function relativeOutputPath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  if (absolutePath.startsWith(workspaceRoot)) {
    return absolutePath
      .slice(workspaceRoot.length)
      .replace(/^[/\\]/, "")
      .replace(/\\/g, "/");
  }
  return absolutePath.replace(/\\/g, "/");
}
