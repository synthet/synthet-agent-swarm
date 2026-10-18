import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";

/** Windows PATHEXT order: prefer native binaries over npm .cmd shims. */
const WIN32_EXT_PRIORITY = [".exe", ".com", ".cmd", ".bat"] as const;

export interface SpawnTarget {
  file: string;
  args: string[];
}

function fileExists(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function uniqueExtensions(pathext: string | undefined): string[] {
  const fromEnv = (pathext ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith(".") ? e : `.${e}`));

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const ext of [...WIN32_EXT_PRIORITY, ...fromEnv]) {
    const key = ext.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(ext);
  }
  return ordered;
}

function isExecutableExtension(ext: string): boolean {
  const lower = ext.toLowerCase();
  return (
    lower === ".exe" ||
    lower === ".com" ||
    lower === ".cmd" ||
    lower === ".bat"
  );
}

/**
 * Resolve a command name to a concrete file on Windows PATH (honors PATHEXT).
 * Skips extensionless shim files when a .exe/.cmd sibling exists.
 */
export function resolveExecutableOnPath(
  command: string,
  env: Record<string, string>,
): string | null {
  if (path.isAbsolute(command)) {
    if (fileExists(command)) return command;
    if (path.extname(command)) return null;
    for (const ext of uniqueExtensions(env.PATHEXT)) {
      const candidate = command + ext;
      if (fileExists(candidate)) return candidate;
    }
    return null;
  }

  if (command.includes("/") || command.includes("\\")) {
    if (fileExists(command)) return command;
    return null;
  }

  const pathDirs = (env.PATH ?? process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);

  const existingExt = path.extname(command);
  if (existingExt) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, command);
      if (fileExists(candidate)) return candidate;
    }
    return null;
  }

  for (const ext of uniqueExtensions(env.PATHEXT)) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, command + ext);
      if (fileExists(candidate)) return candidate;
    }
  }

  return null;
}

function quoteCmdMetaArg(arg: string): string {
  if (!/[\s"]/u.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Wrap .cmd/.bat invocations for spawn(shell: false) on Windows.
 */
export function wrapWindowsCmdInvocation(
  scriptPath: string,
  args: string[],
  env: Record<string, string>,
): SpawnTarget {
  const comspec = env.COMSPEC ?? process.env.COMSPEC ?? "cmd.exe";
  const inner = [scriptPath, ...args].map(quoteCmdMetaArg).join(" ");
  return {
    file: comspec,
    args: ["/d", "/s", "/c", inner],
  };
}

/**
 * Resolve argv[0] for child_process.spawn on the current platform.
 */
export function resolveSpawnTarget(
  command: string,
  args: string[],
  env: Record<string, string>,
): SpawnTarget {
  if (process.platform !== "win32") {
    return { file: command, args };
  }

  const resolved = resolveExecutableOnPath(command, env);
  if (!resolved) {
    return { file: command, args };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    return wrapWindowsCmdInvocation(resolved, args, env);
  }

  if (!ext || isExecutableExtension(ext)) {
    return { file: resolved, args };
  }

  return { file: command, args };
}
