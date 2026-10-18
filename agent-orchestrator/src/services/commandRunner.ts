import { spawn } from "node:child_process";
import type { CommandRunOptions, CommandRunResult } from "../types.js";
import { resolveSpawnTarget } from "./resolveExecutable.js";

const ENV_WHITELIST_PREFIXES = ["LC_", "LANG"];
const ENV_WHITELIST_EXACT = new Set([
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "COMSPEC",
  "WINDIR",
  "AGY_BINARY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
]);

export function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (ENV_WHITELIST_EXACT.has(key)) {
      env[key] = value;
      continue;
    }
    if (ENV_WHITELIST_PREFIXES.some((p) => key.startsWith(p))) {
      env[key] = value;
    }
  }
  return env;
}

export function formatCommandPreview(argv: string[]): string {
  return argv
    .map((arg) => {
      if (arg.length > 120) {
        return `"${arg.slice(0, 80)}...[${arg.length} chars]"`;
      }
      if (/[\s"'\\]/.test(arg)) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    })
    .join(" ");
}

let spawnImpl = spawn;

/** @internal Test hook */
export function setSpawnImpl(
  impl: typeof spawn,
): void {
  spawnImpl = impl;
}

export function resetSpawnImpl(): void {
  spawnImpl = spawn;
}

export async function runCommand(
  options: CommandRunOptions,
): Promise<CommandRunResult> {
  const { argv, cwd, timeoutMs } = options;
  const command = argv[0];
  if (!command) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "Empty argv",
    };
  }

  const env = { ...buildChildEnv(), ...options.env };
  const { file, args } = resolveSpawnTarget(command, argv.slice(1), env);

  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawnImpl(file, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? `Command timed out after ${timeoutMs}ms` : undefined,
      });
    });
  });
}
