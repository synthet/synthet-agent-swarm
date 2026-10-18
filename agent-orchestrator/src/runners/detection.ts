import { runCommand } from "../services/commandRunner.js";
import type { AgentDetectionInfo, SubagentName } from "../types.js";

const AGENT_COMMANDS: Record<Exclude<SubagentName, "antigravity">, string> = {
  codex: "codex",
  claude: "claude",
};

export function getAntigravityCommand(): string {
  return process.env.AGY_BINARY?.trim() || "agy";
}

async function probe(
  argv: string[],
  timeoutMs: number,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
  const result = await runCommand({ argv, cwd, timeoutMs });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    error: result.error,
  };
}

function extractVersion(output: string): string | null {
  const line = output.split("\n").find((l) => l.trim().length > 0);
  return line?.trim().slice(0, 200) ?? null;
}

function helpSupportsFlag(help: string, flags: string[]): boolean {
  const lower = help.toLowerCase();
  return flags.some((f) => lower.includes(f.toLowerCase()));
}

export async function detectCodex(
  timeoutMs: number,
  cwd: string,
): Promise<AgentDetectionInfo> {
  const command = AGENT_COMMANDS.codex;
  const notes: string[] = [];
  let version: string | null = null;
  let helpSnippet = "";
  let mode: string | null = null;
  let supportsCd = false;

  const versionProbe = await probe([command, "--version"], timeoutMs, cwd);
  if (versionProbe.exitCode === 0) {
    version = extractVersion(versionProbe.stdout || versionProbe.stderr);
  } else {
    const vShort = await probe([command, "-V"], timeoutMs, cwd);
    if (vShort.exitCode === 0) {
      version = extractVersion(vShort.stdout || vShort.stderr);
    }
  }

  const helpProbe = await probe([command, "--help"], timeoutMs, cwd);
  if (helpProbe.exitCode === 0 || helpProbe.stdout || helpProbe.stderr) {
    helpSnippet = (helpProbe.stdout || helpProbe.stderr).slice(0, 4000);
  } else if (versionProbe.error) {
    return {
      available: false,
      command,
      mode: null,
      version: null,
      notes: ["not found on PATH"],
    };
  }

  const execHelp = await probe([command, "exec", "--help"], timeoutMs, cwd);
  const execHelpText = execHelp.stdout || execHelp.stderr;
  if (execHelp.exitCode === 0 || execHelpText.includes("exec")) {
    mode = "exec";
    supportsCd =
      helpSupportsFlag(execHelpText, ["--cd"]) ||
      helpSupportsFlag(helpSnippet, ["--cd"]);
    if (!supportsCd) {
      notes.push("codex exec --cd not detected; will use spawn cwd only");
    }
  } else {
    notes.push("codex exec subcommand not detected");
  }

  const available = mode === "exec" || version !== null || helpSnippet.length > 0;
  if (!available) {
    notes.push("not found on PATH");
  }

  return {
    available,
    command,
    mode,
    version,
    notes,
    helpSnippet,
    supportsCd,
  };
}

export async function detectAntigravity(
  timeoutMs: number,
  cwd: string,
): Promise<AgentDetectionInfo> {
  const command = getAntigravityCommand();
  const notes: string[] = [];

  const versionProbe = await probe([command, "--version"], timeoutMs, cwd);
  let version: string | null = null;
  if (versionProbe.exitCode === 0) {
    version = extractVersion(versionProbe.stdout || versionProbe.stderr);
  }

  const helpProbe = await probe([command, "--help"], timeoutMs, cwd);
  const helpText = helpProbe.stdout || helpProbe.stderr;

  if (helpProbe.error && !helpText) {
    return {
      available: false,
      command,
      mode: null,
      version: null,
      notes: ["not found on PATH"],
    };
  }

  let promptFlag: "-p" | "--prompt" | "--print" | undefined;
  const hasP =
    helpSupportsFlag(helpText, ["-p"]) || /\s-p[,|\s]/i.test(helpText);
  const hasPrompt = helpText.includes("--prompt");
  const hasPrint = helpText.includes("--print");

  if (hasP) {
    promptFlag = "-p";
  } else if (hasPrompt) {
    promptFlag = "--prompt";
  } else if (hasPrint) {
    promptFlag = "--print";
  }

  const mode = promptFlag ? "prompt" : null;
  if (!promptFlag) {
    notes.push(
      "non-interactive -p/--prompt/--print flag not detected in help",
    );
  }

  return {
    available: Boolean(version || helpText.length > 0),
    command,
    mode,
    version,
    notes,
    helpSnippet: helpText.slice(0, 4000),
    promptFlag,
  };
}

export async function detectClaude(
  timeoutMs: number,
  cwd: string,
): Promise<AgentDetectionInfo> {
  const command = AGENT_COMMANDS.claude;
  const notes: string[] = [];

  const versionProbe = await probe([command, "--version"], timeoutMs, cwd);
  let version: string | null = null;
  if (versionProbe.exitCode === 0) {
    version = extractVersion(versionProbe.stdout || versionProbe.stderr);
  }

  const helpProbe = await probe([command, "--help"], timeoutMs, cwd);
  const helpText = helpProbe.stdout || helpProbe.stderr;

  if (helpProbe.error && !helpText) {
    return {
      available: false,
      command,
      mode: null,
      version: null,
      notes: ["not found on PATH"],
    };
  }

  let mode: string | null = null;
  if (
    helpSupportsFlag(helpText, ["-p", "--print", "--print-mode"]) ||
    /\s-p[,|\s]/i.test(helpText)
  ) {
    mode = "print";
  } else {
    notes.push(
      "CLI found but no supported non-interactive mode (-p/--print) detected in help",
    );
  }

  return {
    available: Boolean(version || helpText.length > 0),
    command,
    mode,
    version,
    notes,
    helpSnippet: helpText.slice(0, 4000),
  };
}

export async function detectAgent(
  agent: SubagentName,
  timeoutMs: number,
  cwd: string,
): Promise<AgentDetectionInfo> {
  switch (agent) {
    case "codex":
      return detectCodex(timeoutMs, cwd);
    case "antigravity":
      return detectAntigravity(timeoutMs, cwd);
    case "claude":
      return detectClaude(timeoutMs, cwd);
  }
}
