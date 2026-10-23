import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
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

const NPM_NODE_SHIM = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "{{ENTRY}}" %*`;

function resolveNpmNodeShim(scriptPath: string, args: string[]): SpawnTarget | null {
  let body: string;
  try {
    body = readFileSync(scriptPath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
  } catch {
    return null;
  }
  const entry = body.match(/"(%dp0%\\[^"\r\n]+)" %\*$/)?.[1];
  if (!entry || body !== NPM_NODE_SHIM.replace("{{ENTRY}}", entry)) return null;
  const relativeEntry = entry.slice(6);
  if (!/\.(?:js|cjs|mjs)$/i.test(relativeEntry) || /[%!^&|<>()]/.test(relativeEntry)) return null;
  const resolvedEntry = path.resolve(path.dirname(scriptPath), relativeEntry);
  if (!fileExists(resolvedEntry)) return null;
  const bundledNode = path.join(path.dirname(scriptPath), "node.exe");
  return {
    file: fileExists(bundledNode) ? bundledNode : process.execPath,
    args: [resolvedEntry, ...args],
  };
}

function quoteCmdMetaArg(arg: string): string {
  if (arg && !/\s/u.test(arg)) return arg;
  return `"${arg.replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * Wrap .cmd/.bat invocations for spawn(shell: false) on Windows.
 */
export function wrapWindowsCmdInvocation(
  scriptPath: string,
  args: string[],
  env: Record<string, string>,
): SpawnTarget {
  // Custom batch launchers can parse their argv again. Never guess an escaping
  // scheme for arbitrary prompt text; standard npm Node shims avoid CMD above.
  if ([scriptPath, ...args].some(arg => /[\x00-\x1f"%!^&|<>()]/u.test(arg))) {
    throw new Error("Cannot safely pass shell-sensitive arguments through this Windows batch launcher. Use a native executable, a standard npm Node shim, or an advertised ACP transport.");
  }
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
    const nodeShim = resolveNpmNodeShim(resolved, args);
    if (nodeShim) return nodeShim;
    return wrapWindowsCmdInvocation(resolved, args, env);
  }

  if (!ext || isExecutableExtension(ext)) {
    return { file: resolved, args };
  }

  return { file: command, args };
}
