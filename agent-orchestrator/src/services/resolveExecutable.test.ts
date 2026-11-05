import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveExecutableOnPath,
  resolveSpawnTarget,
  wrapWindowsCmdInvocation,
} from "./resolveExecutable.js";
import { runCommand } from "./commandRunner.js";

function npmNodeShim(entry: string): string {
  return `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${entry}" %*
`;
}

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
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it("launches a standard npm Node shim without CMD and preserves hostile-but-inert arguments", async () => {
    if (process.platform !== "win32") return;
    const bin = makeBinDir({
      "node_modules/fixture/cli.cjs": "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
      "fixture.cmd": npmNodeShim("node_modules\\fixture\\cli.cjs"),
    });
    const args = ["%SWARM_FIXTURE_EXPANSION%", "blind/a&b.jpg", 'line one\n"quoted" | < > ^ !', "", "folder with space\\", "π"];
    const shim = path.join(bin, "fixture.cmd");
    const target = resolveSpawnTarget(shim, args, {});
    expect(target.file.toLowerCase()).not.toContain("cmd.exe");
    const result = await runCommand({
      argv: [shim, ...args], cwd: bin, timeoutMs: 2000,
      env: { SWARM_FIXTURE_EXPANSION: "must-not-expand" },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  it("does not bypass a customized shim that adds bootstrap commands", () => {
    if (process.platform !== "win32") return;
    const bin = makeBinDir({
      "node_modules/fixture/cli.cjs": "",
      "fixture.cmd": "@echo custom bootstrap\n" + npmNodeShim("node_modules\\fixture\\cli.cjs"),
    });
    const shim = path.join(bin, "fixture.cmd");
    expect(() => resolveSpawnTarget(shim, ["prompt\nwith shell & syntax"], {}))
      .toThrow(/safely|batch/i);
  });

  it.each(["a&echo INERT", "%PATH%", 'a"b', "line\nbreak", "!value!", "a^b"])(
    "refuses unsafe arguments to an unsupported Windows batch launcher: %s", (argument) => {
      expect(() => wrapWindowsCmdInvocation("C:\\tools\\custom.cmd", [argument], {}))
        .toThrow(/safely|batch/i);
    },
  );

  it("respects PATH directory precedence before extension priority", () => {
    const first = makeBinDir({ "agent.cmd": "@echo Cursor" });
    const later = makeBinDir({ "agent.exe": "Grok fixture" });
    expect(resolveExecutableOnPath("agent", {
      PATH: [first, later].join(path.delimiter), PATHEXT: ".EXE;.CMD",
    })).toBe(path.join(first, "agent.cmd"));
  });

  it("keeps native executable priority within one PATH directory", () => {
    const bin = makeBinDir({ "agent.cmd": "shim", "agent.exe": "native" });
    expect(resolveExecutableOnPath("agent", {
      PATH: bin, PATHEXT: ".EXE;.CMD",
    })).toBe(path.join(bin, "agent.exe"));
  });

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
