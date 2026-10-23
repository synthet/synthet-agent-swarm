import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  isPathInsideWorkspace,
  isSecretPath,
  validateAndResolveFiles,
  validateEvidenceFiles,
  PathSafetyError,
} from "./pathSafety.js";
import { join, resolve } from "node:path";

const ROOT = resolve("/workspace/project");

describe("pathSafety", () => {
  const temporaryRoots: string[] = [];
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function linkedWorkspace(targetName: string, inside: boolean) {
    const root = mkdtempSync(join(tmpdir(), "swarm-path-"));
    temporaryRoots.push(root);
    const workspace = join(root, "workspace");
    const target = join(inside ? workspace : root, targetName);
    mkdirSync(workspace);
    mkdirSync(target);
    writeFileSync(join(target, "image.jpg"), "synthetic fixture");
    symlinkSync(target, join(workspace, "evidence"), process.platform === "win32" ? "junction" : "dir");
    return workspace;
  }

  it("rejects an evidence path through a junction or symlink outside the workspace", () => {
    const workspace = linkedWorkspace("outside", false);
    expect(isPathInsideWorkspace(workspace, "evidence/image.jpg")).toBe(false);
    expect(() => validateEvidenceFiles(workspace, ["evidence/image.jpg"]))
      .toThrow(PathSafetyError);
  });

  it("rejects nonexistent paths whose existing ancestor points outside the workspace", () => {
    const workspace = linkedWorkspace("outside", false);
    expect(() => validateEvidenceFiles(workspace, ["evidence/missing/image.jpg"]))
      .toThrow(PathSafetyError);
  });

  it("checks the resolved secret location even when the link name is neutral", () => {
    const workspace = linkedWorkspace(".ssh", true);
    expect(() => validateEvidenceFiles(workspace, ["evidence/image.jpg"]))
      .toThrow(PathSafetyError);
  });

  it("allows links that resolve to ordinary evidence inside the workspace", () => {
    const workspace = linkedWorkspace("blind", true);
    expect(validateEvidenceFiles(workspace, ["evidence/image.jpg"]))
      .toEqual([resolve(workspace, "evidence/image.jpg")]);
  });

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
