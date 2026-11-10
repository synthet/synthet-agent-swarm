import { spawn, type ChildProcess } from "node:child_process";

/** Spawn option that lets {@link killProcessTree} signal the whole POSIX process group. */
export function treeSpawnOptions(): { detached?: boolean } {
  // On Windows, detached opens a new console and outlives the parent; taskkill /T covers the tree.
  return process.platform === "win32" ? {} : { detached: true };
}

/**
 * Stop a child and every process it started. Harness CLIs start shells, MCP servers and
 * node subprocesses; killing only the direct child leaves those running.
 */
export function killProcessTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => child.kill(signal));
    } catch {
      child.kill(signal);
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
}
