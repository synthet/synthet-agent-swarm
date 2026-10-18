import { resolve } from "node:path";
import type { SubagentMode, WorkspaceSnapshot } from "../types.js";

const JUDGE_HOW = {
  codex:
    "Image files in the evidence list are attached to this call, in listed order. Do not modify files.",
  claude:
    "Use the Read tool on each evidence file before answering. Do not modify files or open unlisted paths.",
  antigravity:
    "Open each evidence file and look at it. Do not modify files or run programs.",
} as const;

function judgeHow(agent: string): string {
  if (agent === "codex" || agent === "claude" || agent === "antigravity") {
    return JUDGE_HOW[agent];
  }
  if (agent === "agy") return JUDGE_HOW.antigravity;
  return "Read only the listed evidence. Do not modify files or run programs.";
}

export function blindSnapshot(workspaceRoot: string): WorkspaceSnapshot {
  return {
    repositoryRoot: workspaceRoot,
    branch: null,
    statusShort: null,
    diffStat: null,
    fileDiffs: {},
    fileExcerpts: {},
    notes: [],
  };
}

export function buildJudgePrompt(input: PromptBuildInput): string {
  const files = (input.files ?? []).map((file) => resolve(input.workspaceRoot, file));
  const lines = [
    `Independent judge (${input.agent}). Answer only from the task and the evidence list.`,
    "",
    judgeHow(input.agent),
    "",
    "## Task",
    input.task.trim(),
    "",
    "## Evidence",
    ...(files.length ? files.map((file) => `- ${file}`) : ["- (none listed)"]),
  ];
  if (input.extraContext?.trim()) {
    lines.push("", "## Extra context", input.extraContext.trim());
  }
  lines.push(
    "",
    "## Constraints",
    "- Do not modify any files.",
    "- Do not browse files that are not listed as evidence.",
    "- Do not include secrets, tokens, or credentials.",
    "- Return only the format the task requests, with no preamble.",
    "",
    "This reply is an agent-panel vote. It is not ground truth.",
  );
  return lines.join("\n");
}

export interface PromptBuildInput {
  agent: string;
  task: string;
  workspaceRoot: string;
  mode: SubagentMode;
  allowWrites: boolean;
  files?: string[];
  snapshot: WorkspaceSnapshot;
  extraContext?: string;
}

export function buildSubagentPrompt(input: PromptBuildInput): string {
  if (input.mode === "judge") return buildJudgePrompt(input);

  const {
    agent,
    task,
    workspaceRoot,
    mode,
    allowWrites,
    files,
    snapshot,
    extraContext,
  } = input;

  const roleByMode: Record<Exclude<SubagentMode, "judge">, string> = {
    review:
      "You are an external code reviewer. Analyze the task and context carefully.",
    implement:
      "You are an external implementation assistant. Propose or apply focused changes.",
    explain:
      "You are an external technical explainer. Clarify design and behavior.",
    test:
      "You are an external test strategist. Recommend tests and coverage gaps.",
    "tie-breaker":
      "You are an external tie-breaker reviewer. Resolve disagreements with evidence.",
  };

  const sections: string[] = [
    `# Sub-agent delegation (${agent})`,
    "",
    "## Role",
    roleByMode[mode],
    "",
    "## Task",
    task.trim(),
    "",
    "## Repository",
    `- Root: \`${workspaceRoot}\``,
    `- Detected git root: \`${snapshot.repositoryRoot}\``,
  ];

  if (snapshot.branch) {
    sections.push(`- Branch: \`${snapshot.branch}\``);
  }

  if (files?.length) {
    sections.push("", "## Relevant files", ...files.map((f) => `- \`${f}\``));
  }

  if (snapshot.statusShort) {
    sections.push("", "## Git status (short)", "```", snapshot.statusShort, "```");
  }

  if (snapshot.diffStat) {
    sections.push("", "## Git diff stat", "```", snapshot.diffStat, "```");
  }

  for (const [path, diff] of Object.entries(snapshot.fileDiffs)) {
    sections.push("", `## Diff: \`${path}\``, "```diff", diff, "```");
  }

  for (const [path, excerpt] of Object.entries(snapshot.fileExcerpts)) {
    sections.push("", `## File excerpt: \`${path}\``, "```", excerpt, "```");
  }

  if (snapshot.notes.length) {
    sections.push("", "## Context notes", ...snapshot.notes.map((n) => `- ${n}`));
  }

  if (extraContext?.trim()) {
    sections.push("", "## Extra context", extraContext.trim());
  }

  sections.push(
    "",
    "## Constraints",
    allowWrites
      ? "- You MAY modify files only as needed for the task."
      : "- **REVIEW ONLY**: Do NOT modify any files on disk.",
    "- Do NOT run destructive commands (rm -rf, drop database, force push, etc.).",
    "- Do NOT expose secrets, tokens, API keys, or credentials in your output.",
    "- Provide suggested patches or notes instead of applying edits when review-only.",
    "",
    "## Expected output format",
    "```md",
    `# Subagent Result: ${agent}`,
    "",
    "## Verdict",
    "",
    "## Findings",
    "(Label each finding severity: blocker | high | medium | low | nit)",
    "",
    "## Suggested Changes",
    "",
    "## Risks",
    "",
    "## Commands / Tests Recommended",
    "",
    "## Patch Summary",
    "```",
  );

  if (!allowWrites || mode === "review" || mode === "tie-breaker") {
    sections.push(
      "",
      "## Review mode requirements",
      "- Provide precise, actionable findings.",
      "- Do not write or edit project files.",
      "- Prefer concrete file/line references when possible.",
    );
  }

  return sections.join("\n");
}
