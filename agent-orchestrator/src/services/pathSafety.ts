import { existsSync, readFileSync, statSync } from "node:fs";
import {
  resolve,
  normalize,
  relative,
  extname,
  basename,
  dirname,
  isAbsolute,
} from "node:path";

const SECRET_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
]);

const SECRET_PREFIXES = ["credentials", "secret", ".npmrc"];

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export function isPathInsideWorkspace(
  workspaceRoot: string,
  targetPath: string,
): boolean {
  const root = normalize(resolve(workspaceRoot));
  const target = normalize(resolve(workspaceRoot, targetPath));
  const rel = relative(root, target);
  if (rel === "") return true;
  // On Windows, path.relative() across different drives returns the absolute
  // target unchanged (e.g. "C:\\foo"), which would silently bypass a
  // ".."-prefix check. Reject any absolute relative result too.
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function isSecretPath(filePath: string): boolean {
  const base = basename(filePath).toLowerCase();
  if (SECRET_BASENAMES.has(base)) return true;
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) {
    return true;
  }
  for (const prefix of SECRET_PREFIXES) {
    if (base.startsWith(prefix)) return true;
  }
  if (filePath.includes(".ssh/") || filePath.includes("\\.ssh\\")) {
    return true;
  }
  return false;
}

export function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function resolveListedFiles(
  workspaceRoot: string,
  files: string[] | undefined,
  allowImages: boolean,
): string[] {
  if (!files?.length) return [];

  const resolved: string[] = [];
  for (const file of files) {
    if (!file || typeof file !== "string") {
      throw new PathSafetyError("Invalid file path in request");
    }
    if (!isPathInsideWorkspace(workspaceRoot, file)) {
      throw new PathSafetyError(
        `Path escapes workspace boundary: ${file}`,
      );
    }
    const abs = resolve(workspaceRoot, file);
    if (isSecretPath(file) || isSecretPath(abs)) {
      throw new PathSafetyError(
        `Refusing to include secret file in context: ${file}`,
      );
    }
    if (isBinaryPath(file) && !(allowImages && isImagePath(file))) {
      throw new PathSafetyError(
        `Refusing to include binary file in context: ${file}`,
      );
    }
    resolved.push(abs);
  }
  return resolved;
}

export function validateAndResolveFiles(
  workspaceRoot: string,
  files: string[] | undefined,
): string[] {
  return resolveListedFiles(workspaceRoot, files, false);
}

export function validateEvidenceFiles(
  workspaceRoot: string,
  files: string[] | undefined,
): string[] {
  return resolveListedFiles(workspaceRoot, files, true);
}

export function evidenceImagePaths(
  workspaceRoot: string,
  files: string[] | undefined,
): string[] {
  return (files ?? [])
    .filter((file) => isImagePath(file))
    .map((file) => resolve(workspaceRoot, file));
}

export function evidenceDirectories(
  workspaceRoot: string,
  files: string[] | undefined,
): string[] {
  const dirs = new Set<string>();
  for (const file of files ?? []) {
    dirs.add(dirname(resolve(workspaceRoot, file)));
  }
  return [...dirs].slice(0, 8);
}

export function safeReadFileExcerpt(
  filePath: string,
  maxBytes = 16384,
): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes * 4) {
      return `[file too large: ${stat.size} bytes, skipped]`;
    }
    const buf = readFileSync(filePath);
    if (buf.length > maxBytes) {
      return buf.subarray(0, maxBytes).toString("utf8") + "\n...[truncated]";
    }
    return buf.toString("utf8");
  } catch {
    return null;
  }
}
