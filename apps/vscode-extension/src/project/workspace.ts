import { inspectWorkspacePath } from "@browser-debug-bridge/redaction";
import {
  IGNORED_DIRECTORY_NAMES,
  MANIFEST_BASENAMES,
  MANIFEST_PREFIXES,
  SOURCE_EXTENSIONS,
} from "./constants.js";
import type { DiscoveredFile, WorkspaceFolderRef } from "./types.js";

const IGNORED_DIRECTORY_SET = new Set<string>(IGNORED_DIRECTORY_NAMES);

export function normalizeFsPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function posixBasename(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? "";
}

export function posixExtension(relativePath: string): string {
  const name = posixBasename(relativePath);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot).toLowerCase();
}

export function posixStem(relativePath: string): string {
  const name = posixBasename(relativePath);
  const extension = posixExtension(relativePath);
  return extension.length > 0 ? name.slice(0, -extension.length) : name;
}

export type WorkspaceResolution =
  | { status: "none" }
  | { status: "single"; folder: WorkspaceFolderRef }
  | { status: "multi"; folders: WorkspaceFolderRef[] };

export function resolveWorkspaceFolders(folders: WorkspaceFolderRef[]): WorkspaceResolution {
  if (folders.length === 0) {
    return { status: "none" };
  }
  if (folders.length === 1) {
    const folder = folders[0];
    if (folder === undefined) {
      return { status: "none" };
    }
    return { status: "single", folder };
  }
  return { status: "multi", folders };
}

export function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORY_SET.has(name);
}

export function isSecretOrProtectedFileName(name: string): boolean {
  if (name === ".env" || name.startsWith(".env.")) {
    return true;
  }
  const lower = name.toLowerCase();
  if (lower.endsWith(".pem") || lower.endsWith(".key")) {
    return true;
  }
  if (lower.startsWith("id_rsa") || lower.startsWith("id_dsa") || lower.startsWith("id_ed25519")) {
    return true;
  }
  if (lower.includes("credentials") || lower.includes("secrets")) {
    return true;
  }
  return false;
}

export function isIgnoredRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => isIgnoredDirectoryName(segment))) {
    return true;
  }
  const name = segments[segments.length - 1] ?? "";
  return isSecretOrProtectedFileName(name);
}

export function isSourceFileName(relativePath: string): boolean {
  if (isIgnoredRelativePath(relativePath)) {
    return false;
  }
  return SOURCE_EXTENSIONS.some((extension) => relativePath.toLowerCase().endsWith(extension));
}

export function isManifestFileName(relativePath: string): boolean {
  if (isIgnoredRelativePath(relativePath)) {
    return false;
  }
  const name = posixBasename(relativePath);
  if (MANIFEST_BASENAMES.has(name)) {
    return true;
  }
  return MANIFEST_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isSafeWorkspaceRelativePath(workspaceRoot: string, relativePath: string): boolean {
  return inspectWorkspacePath(workspaceRoot, relativePath).safe;
}

export function toSafeRelativePath(
  workspaceRoot: string,
  proposedPath: string,
): string | undefined {
  const inspection = inspectWorkspacePath(workspaceRoot, proposedPath);
  if (!inspection.safe) {
    return undefined;
  }
  return inspection.relativePath;
}

export function filterSafeDiscoveredFiles(files: DiscoveredFile[]): DiscoveredFile[] {
  return files.filter(
    (file) =>
      !isIgnoredRelativePath(file.relativePath) &&
      isSafeWorkspaceRelativePath(file.folderRoot, file.relativePath),
  );
}

export function maxDiscoverPerFolder(folderCount: number, totalLimit: number): number {
  if (folderCount <= 1) {
    return totalLimit;
  }
  return Math.max(80, Math.floor(totalLimit / folderCount));
}
