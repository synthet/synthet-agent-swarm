import { runCommand } from "../services/commandRunner.js";
import { getAntigravityCommand } from "../runners/detection.js";
import type { AgentDetectionInfo } from "../types.js";
import {
  classifyObservation,
  HARNESS_SPECS,
  type HarnessObservation,
  type HarnessSpec,
} from "./registry.js";

const CACHE_TTL_MS = 60_000;
let cache: { rows: HarnessObservation[]; expiresAt: number; cwd: string } | null = null;

export function clearHarnessCache(): void {
  cache = null;
}

function specsForHost(): HarnessSpec[] {
  const agy = getAntigravityCommand();
  return HARNESS_SPECS.map((spec) => {
    if (spec.id !== "agy") return spec;
    return {
      ...spec,
      command: `${agy} -p`,
      cliArgv: [agy, "-p"],
    };
  });
}

async function onPath(command: string, cwd: string, timeoutMs: number): Promise<boolean> {
  const argv = process.platform === "win32" ? ["where.exe", command] : ["which", command];
  const result = await runCommand({
    argv,
    cwd,
    timeoutMs: Math.min(timeoutMs, 5000),
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function helpText(argv: string[], cwd: string, timeoutMs: number): Promise<string> {
  const result = await runCommand({ argv, cwd, timeoutMs });
  return result.stdout || result.stderr || "";
}

function firstToken(argv: string[] | null): string | null {
  return argv?.[0] ?? null;
}

export async function observeHarnesses(
  cwd: string,
  timeoutMs: number,
): Promise<HarnessObservation[]> {
  const now = Date.now();
  if (cache && cache.cwd === cwd && cache.expiresAt > now) return cache.rows;

  const rows = await Promise.all(
    specsForHost().map(async (spec) => {
      const cliToken = firstToken(spec.cliArgv);
      const acpToken = firstToken(spec.acpArgv);
      const cliOnPath = cliToken ? await onPath(cliToken, cwd, timeoutMs) : false;
      const acpOnPath =
        spec.id === "grok" || spec.id === "cursor"
          ? await onPath(acpToken ?? "", cwd, timeoutMs)
          : acpToken && acpToken !== cliToken
            ? await onPath(acpToken, cwd, timeoutMs)
            : cliOnPath && Boolean(spec.acpArgv);

      let cliHelp = "";
      let version: string | null = null;
      if (cliOnPath && cliToken && spec.id !== "grok") {
        const versionProbe = await runCommand({
          argv: [cliToken, "--version"],
          cwd,
          timeoutMs,
        });
        if (versionProbe.exitCode === 0) {
          version =
            (versionProbe.stdout || versionProbe.stderr)
              .split("\n")
              .find((line) => line.trim().length > 0)
              ?.trim()
              .slice(0, 200) ?? null;
        }
        cliHelp = await helpText([cliToken, "--help"], cwd, timeoutMs);
        if (spec.id === "codex" && !/\bexec\b/.test(cliHelp)) {
          cliHelp = `${cliHelp}\n${await helpText([cliToken, "exec", "--help"], cwd, timeoutMs)}`;
        }
      }
      if (spec.id === "grok" && acpOnPath) {
        cliHelp = await helpText(["grok", "agent", "--help"], cwd, timeoutMs);
      }

      return classifyObservation({
        spec,
        cliOnPath: spec.id === "grok" ? false : cliOnPath,
        cliHelp,
        version,
        acpOnPath: Boolean(acpToken) && acpOnPath,
      });
    }),
  );

  cache = { rows, expiresAt: now + CACHE_TTL_MS, cwd };
  return rows;
}

export function detectionFromObservation(
  observation: HarnessObservation,
): AgentDetectionInfo {
  const command = observation.spec.cliArgv?.[0] ?? observation.spec.command.split(" ")[0] ?? observation.spec.id;
  return {
    available: observation.binaryFound,
    command,
    mode: observation.cliMode,
    version: observation.version,
    notes: observation.notes,
    helpSnippet: observation.cliHelp,
    supportsCd: observation.supportsCd,
    promptFlag: observation.promptFlag,
  };
}
