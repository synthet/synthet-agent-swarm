import { relative } from "node:path";
import {
  formatCommandPreview,
  runCommand,
} from "./commandRunner.js";
import {
  safeReadFileExcerpt,
  validateAndResolveFiles,
} from "./pathSafety.js";
import type { WorkspaceSnapshot } from "../types.js";

const MAX_STATUS_LINES = 80;
const MAX_DIFF_STAT_LINES = 60;
const MAX_FILE_DIFF_LINES = 120;

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n...[truncated ${lines.length - maxLines} lines]`
  );
}

async function git(
  workspaceRoot: string,
  args: string[],
  timeoutMs = 15000,
): Promise<string | null> {
  const result = await runCommand({
    argv: ["git", ...args],
    cwd: workspaceRoot,
    timeoutMs,
  });
  if (result.error && result.exitCode === null) return null;
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}

async function isIgnored(workspaceRoot: string, relPath: string): Promise<boolean> {
  const result = await git(workspaceRoot, ["check-ignore", relPath], 5000);
  return result !== null;
}

export async function captureWorkspaceSnapshot(
  workspaceRoot: string,
  files?: string[],
): Promise<WorkspaceSnapshot> {
  const notes: string[] = [];
  let repositoryRoot = workspaceRoot;

  const topLevel = await git(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (topLevel) {
    repositoryRoot = topLevel;
  } else {
    notes.push("git unavailable or not a repository; using workspace root only");
  }

  const branch = await git(workspaceRoot, ["branch", "--show-current"]);
  const statusShort = await git(workspaceRoot, ["status", "--short"]);
  const diffStat = await git(workspaceRoot, ["diff", "--stat"]);

  const fileDiffs: Record<string, string> = {};
  const fileExcerpts: Record<string, string> = {};

  let resolvedFiles: string[] = [];
  try {
    resolvedFiles = validateAndResolveFiles(workspaceRoot, files);
  } catch (err) {
    notes.push(
      err instanceof Error ? err.message : "File validation failed",
    );
  }

  for (const abs of resolvedFiles) {
    const rel = relative(workspaceRoot, abs).replace(/\\/g, "/");

    // Check if ignored
    if (await isIgnored(workspaceRoot, rel)) {
      notes.push(`Skipping ignored file: ${rel}`);
      continue;
    }

    const diff = await git(workspaceRoot, [
      "diff",
      "--",
      rel,
    ]);
    if (diff) {
      fileDiffs[rel] = truncateLines(diff, MAX_FILE_DIFF_LINES);
    } else {
      const excerpt = safeReadFileExcerpt(abs);
      if (excerpt) {
        fileExcerpts[rel] = excerpt;
      } else {
        notes.push(`Could not read or diff file: ${rel}`);
      }
    }
  }

  return {
    repositoryRoot,
    branch,
    statusShort: statusShort
      ? truncateLines(statusShort, MAX_STATUS_LINES)
      : null,
    diffStat: diffStat ? truncateLines(diffStat, MAX_DIFF_STAT_LINES) : null,
    fileDiffs,
    fileExcerpts,
    notes,
  };
}

export { formatCommandPreview };
