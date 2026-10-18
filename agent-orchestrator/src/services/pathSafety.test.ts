import { describe, expect, it } from "vitest";
import {
  isPathInsideWorkspace,
  isSecretPath,
  validateAndResolveFiles,
  validateEvidenceFiles,
  PathSafetyError,
} from "./pathSafety.js";
import { resolve } from "node:path";

const ROOT = resolve("/workspace/project");

describe("pathSafety", () => {
  it("allows paths inside workspace", () => {
    expect(isPathInsideWorkspace(ROOT, "src/foo.ts")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isPathInsideWorkspace(ROOT, "../../../etc/passwd")).toBe(false);
  });

  it("detects secret paths", () => {
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath("config/secrets.json")).toBe(true);
  });

  it("allows image evidence for judges and still blocks images in text context", () => {
    expect(validateEvidenceFiles(ROOT, ["blind/a.jpg"])).toEqual([
      resolve(ROOT, "blind/a.jpg"),
    ]);
    expect(() => validateAndResolveFiles(ROOT, ["blind/a.jpg"])).toThrow(
      PathSafetyError,
    );
    expect(() => validateEvidenceFiles(ROOT, ["clip.mp4"])).toThrow(
      PathSafetyError,
    );
  });

  it("rejects secret files in validateAndResolveFiles", () => {
    expect(() =>
      validateAndResolveFiles(ROOT, [".env"]),
    ).toThrow(PathSafetyError);
  });

  it("rejects paths outside workspace", () => {
    expect(() =>
      validateAndResolveFiles(ROOT, ["../outside.txt"]),
    ).toThrow(PathSafetyError);
  });

  it("rejects absolute paths that resolve outside the workspace", () => {
    // On Windows, path.relative across drives returns the absolute target
    // unchanged — guard must reject that too, not just "..".
    const outside =
      process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    expect(isPathInsideWorkspace(ROOT, outside)).toBe(false);
    expect(() =>
      validateAndResolveFiles(ROOT, [outside]),
    ).toThrow(PathSafetyError);
  });
});
