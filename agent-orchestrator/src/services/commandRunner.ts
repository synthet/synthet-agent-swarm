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
  "XAI_API_KEY",
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
  let target: ReturnType<typeof resolveSpawnTarget>;
  try {
    target = resolveSpawnTarget(command, argv.slice(1), env);
  } catch (err) {
    return { exitCode: null, stdout: "", stderr: "", timedOut: false,
      error: err instanceof Error ? err.message : String(err) };
  }
  const { file, args } = target;

  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let closed = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let stdinError: string | undefined;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(file, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolvePromise({ exitCode: null, stdout, stderr, timedOut: false,
        error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      forceKillTimer = setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 2000);
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolvePromise({
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? `Command timed out after ${timeoutMs}ms` : stdinError,
      });
    });

    // A provider can exit before reading the prompt. Handle EPIPE before writing
    // so that a rejected prompt cannot crash the MCP process or count as a vote.
    child.stdin?.on("error", (err) => { stdinError = `Failed to deliver stdin: ${err.message}`; });
    try {
      child.stdin?.end(options.stdin);
    } catch (err) {
      stdinError = `Failed to deliver stdin: ${err instanceof Error ? err.message : String(err)}`;
      if (!closed) child.kill("SIGTERM");
    }
  });
}
