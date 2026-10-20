import { describe, expect, it, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import {
  runCommand,
  setSpawnImpl,
  resetSpawnImpl,
  formatCommandPreview,
  buildChildEnv,
} from "./commandRunner.js";

describe("commandRunner", () => {
  afterEach(() => {
    resetSpawnImpl();
  });

  it("closes stdin for noninteractive prompt-argument children", async () => {
    const result = await runCommand({
      argv: [process.execPath, "-e", "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('stdin-eof'))"],
      cwd: process.cwd(),
      timeoutMs: 1000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("stdin-eof");
  });

  it("delivers multiline prompts exactly through stdin before EOF", async () => {
    const prompt = 'first line\n"quoted" & | < > %PATH% \u03c0';
    const result = await runCommand({
      argv: [process.execPath, "-e", "process.stdin.setEncoding('utf8'); let text=''; process.stdin.on('data', part => text+=part); process.stdin.on('end', () => process.stdout.write(text));"],
      cwd: process.cwd(),
      timeoutMs: 2000,
      stdin: prompt,
    });
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe(prompt);
  });

  it("formats command preview with quoted long args", () => {
    const preview = formatCommandPreview(["codex", "exec", "x".repeat(200)]);
    expect(preview).toContain("codex");
    expect(preview).toContain("chars");
  });

  it("times out hung processes", async () => {
    setSpawnImpl((() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig?: string) => void;
        killed: boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        child.emit("close", null);
      };
      return child as never;
    }) as never);

    const result = await runCommand({
      argv: ["sleep", "999"],
      cwd: process.cwd(),
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain("timed out");
  });

  it("resolves npm .cmd shims on Windows before spawn", async () => {
    if (process.platform !== "win32") return;

    const npmBin = path.join(
      process.env.APPDATA ?? "",
      "npm",
      "codex.cmd",
    );
    if (!npmBin || !path.isAbsolute(npmBin)) return;

    let spawnedFile = "";
    let spawnedArgs: string[] = [];
    setSpawnImpl(((file: string, args: string[]) => {
      spawnedFile = file;
      spawnedArgs = args;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.emit("data", "ok\n");
        child.emit("close", 0);
      });
      return child as never;
    }) as never);

    const env = buildChildEnv();
    await runCommand({
      argv: ["codex", "--version"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      env,
    });

    const lowerComspec = (env.COMSPEC ?? "cmd.exe").toLowerCase();
    expect(spawnedFile.toLowerCase()).toBe(lowerComspec);
    expect(spawnedArgs[0]).toBe("/d");
    expect(spawnedArgs.join(" ")).toMatch(/codex\.cmd/i);
  });
});
