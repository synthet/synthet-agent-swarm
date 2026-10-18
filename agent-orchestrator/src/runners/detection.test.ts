import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import {
  setSpawnImpl,
  resetSpawnImpl,
} from "../services/commandRunner.js";
import { detectAntigravity, detectClaude, detectCodex } from "./detection.js";

function toolBaseName(cmd: string): string {
  return path.basename(cmd).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

/** Normalize spawn target after Windows PATH / .cmd resolution. */
function spawnInvocation(
  cmd: string,
  args: string[],
): { tool: string; argv: string[] } {
  if (args[0] === "/d" && args[2] === "/c" && typeof args[3] === "string") {
    const inner = args[3];
    const toolMatch = inner.match(/(?:^|[\s"\\])([\w-]+)\.(cmd|exe|bat)\b/i);
    if (toolMatch) {
      const after = inner.slice(toolMatch.index! + toolMatch[0].length).trim();
      const argv = after.length > 0 ? after.split(/\s+/) : [];
      return { tool: toolMatch[1].toLowerCase(), argv };
    }
  }
  return { tool: toolBaseName(cmd), argv: args };
}

function mockSpawn(
  handlers: Record<string, { stdout?: string; stderr?: string; code?: number; error?: Error }>,
) {
  setSpawnImpl(((cmd: string, _args: string[]) => {
    const key = cmd;
    const spec = handlers[key] ?? { code: 1, stderr: "not found" };
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
      killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };

    process.nextTick(() => {
      if (spec.error) {
        child.emit("error", spec.error);
        return;
      }
      if (spec.stdout) child.stdout.emit("data", Buffer.from(spec.stdout));
      if (spec.stderr) child.stderr.emit("data", Buffer.from(spec.stderr));
      child.emit("close", spec.code ?? 0);
    });

    return child as never;
  }) as never);
}

describe("detection", () => {
  beforeEach(() => {
    resetSpawnImpl();
  });

  afterEach(() => {
    resetSpawnImpl();
  });

  it("detects codex exec mode", async () => {
    mockSpawn({
      codex: { stdout: "codex 1.0.0\n", code: 0 },
    });
    const origSpawn = vi.fn();
    setSpawnImpl(((cmd: string, args: string[]) => {
      const { tool, argv } = spawnInvocation(cmd, args);
      if (tool === "codex" && argv[0] === "--version") {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: () => void;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
          child.stdout.emit("data", "codex 1.0.0\n");
          child.emit("close", 0);
        });
        return child as never;
      }
      if (tool === "codex" && argv[0] === "--help") {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: () => void;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
          child.stdout.emit("data", "Usage: codex exec ...\n");
          child.emit("close", 0);
        });
        return child as never;
      }
      if (tool === "codex" && argv[0] === "exec") {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: () => void;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
          child.stdout.emit("data", "exec mode --cd\n");
          child.emit("close", 0);
        });
        return child as never;
      }
      origSpawn(cmd, args);
      return new EventEmitter() as never;
    }) as never);

    const result = await detectCodex(5000, process.cwd());
    expect(result.available).toBe(true);
    expect(result.mode).toBe("exec");
  });

  it("reports antigravity missing on ENOENT", async () => {
    setSpawnImpl((() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
      });
      return child as never;
    }) as never);

    const result = await detectAntigravity(5000, process.cwd());
    expect(result.available).toBe(false);
    expect(result.notes).toContain("not found on PATH");
  });

  it("detects claude print mode from help", async () => {
    setSpawnImpl(((cmd: string, args: string[]) => {
      const { tool, argv } = spawnInvocation(cmd, args);
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        if (tool === "claude" && argv[0] === "--version") {
          child.stdout.emit("data", "1.0.0\n");
        } else if (tool === "claude") {
          child.stdout.emit("data", "  -p, --print    Print mode\n");
        }
        child.emit("close", 0);
      });
      return child as never;
    }) as never);

    const result = await detectClaude(5000, process.cwd());
    expect(result.available).toBe(true);
    expect(result.mode).toBe("print");
  });
});
