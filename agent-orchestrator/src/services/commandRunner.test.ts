import { describe, expect, it, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
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
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("forwards an existing Grok API credential through the environment", () => {
    vi.stubEnv("XAI_API_KEY", "synthetic-test-value");
    expect(buildChildEnv().XAI_API_KEY).toBe("synthetic-test-value");
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

  it("force-kills a process that accepted SIGTERM but has not exited", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false,
      kill: vi.fn((signal?: string) => {
        child.killed = true;
        if (signal === "SIGKILL") child.emit("close", null);
        return true;
      }),
    });
    setSpawnImpl((() => child) as never);
    const run = runCommand({ argv: ["hung-child"], cwd: process.cwd(), timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(2050);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(await run).toMatchObject({ timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports synchronous launch errors without rejecting the command result", async () => {
    setSpawnImpl((() => { throw new Error("invalid launch argument"); }) as never);
    await expect(runCommand({ argv: ["fixture"], cwd: process.cwd(), timeoutMs: 1000 }))
      .resolves.toMatchObject({ exitCode: null, error: "invalid launch argument" });
  });

  it("reports stdin delivery errors even if the child exits with zero", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {},
      stdin: Object.assign(new EventEmitter(), { end() {
        child.stdin.emit("error", new Error("write EPIPE"));
        child.emit("close", 0);
      } }),
    });
    setSpawnImpl((() => child) as never);
    await expect(runCommand({ argv: ["fixture"], cwd: process.cwd(), timeoutMs: 1000, stdin: "prompt" }))
      .resolves.toMatchObject({ exitCode: 0, error: expect.stringContaining("EPIPE") });
    expect(vi.getTimerCount()).toBe(0);
  });
});
