import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveExecutableOnPath,
  resolveSpawnTarget,
  wrapWindowsCmdInvocation,
} from "./resolveExecutable.js";

describe("resolveExecutable", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeBinDir(files: Record<string, string>): string {
    const dir = path.join(
      os.tmpdir(),
      `orch-resolve-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it("prefers .cmd over extensionless npm shim on Windows", () => {
    if (process.platform !== "win32") return;

    const bin = makeBinDir({
      codex: "#!/bin/sh\necho shim\n",
      "codex.cmd": "@echo off\necho codex-cmd\n",
    });
    const env = { PATH: bin, PATHEXT: ".EXE;.CMD;.BAT;.COM" };

    expect(resolveExecutableOnPath("codex", env)).toBe(
      path.join(bin, "codex.cmd"),
    );
  });

  it("wraps .cmd for COMSPEC spawn on Windows", () => {
    if (process.platform !== "win32") return;

    const script = "C:\\tools\\codex.cmd";
    const wrapped = wrapWindowsCmdInvocation(script, ["--version"], {
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(wrapped.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(wrapped.args[0]).toBe("/d");
    expect(wrapped.args[2]).toBe("/c");
    expect(wrapped.args[3]).toContain("codex.cmd");
    expect(wrapped.args[3]).toContain("--version");
  });

  it("resolveSpawnTarget leaves non-Windows unchanged", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(resolveSpawnTarget("codex", ["--help"], {})).toEqual({
        file: "codex",
        args: ["--help"],
      });
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
  });
});
