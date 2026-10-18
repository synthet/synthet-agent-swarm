import { spawn } from "node:child_process";
import { buildChildEnv } from "../services/commandRunner.js";
import { resolveSpawnTarget } from "../services/resolveExecutable.js";
import { createLineQueue, type AcpIo } from "./client.js";

/** Spawn an ACP peer. Callers must kill the child on timeout. */
export function spawnAcpProcess(argv: string[], cwd: string): AcpIo {
  const command = argv[0];
  if (!command) {
    const queue = createLineQueue();
    queue.push(null);
    return {
      write() {},
      read: () => queue.read(),
      kill() {},
    };
  }
  const env = buildChildEnv();
  const target = resolveSpawnTarget(command, argv.slice(1), env);
  const child = spawn(target.file, target.args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const queue = createLineQueue();
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      queue.push(buffer.slice(0, index).replace(/\r$/, ""));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  const finish = () => queue.push(null);
  child.on("close", finish);
  child.on("error", finish);
  return {
    write(line) {
      const payload = line.endsWith("\n") ? line : `${line}\n`;
      child.stdin?.write(payload);
    },
    read: () => queue.read(),
    kill() {
      child.kill("SIGTERM");
      queue.push(null);
    },
  };
}
