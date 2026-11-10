import { describe, expect, it } from "vitest";
import { runCommand } from "./commandRunner.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("process-tree cleanup", () => {
  it("kills a grandchild when the command times out", async () => {
    const parent = [
      "const { spawn } = require('node:child_process');",
      // On Windows a node child's children die with its libuv job object; detached breaks away
      // from it, as a native harness's subprocesses do. POSIX keeps the shared process group.
      `const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${process.platform === "win32"} });`,
      "process.stdout.write(String(g.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const result = await runCommand({
      argv: [process.execPath, "-e", parent],
      cwd: process.cwd(),
      timeoutMs: 1500,
    });
    expect(result.timedOut).toBe(true);
    const grandchild = Number(result.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    const deadline = Date.now() + 5000;
    while (alive(grandchild) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(alive(grandchild)).toBe(false);
  }, 15000);
});
