import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export interface CanonicalPathIo {
  exists(target: string): boolean;
  realpath(target: string): string;
  join(left: string, right: string): string;
  sep: string;
  ignoreCase: boolean;
}

export type CanonicalInspection =
  | { status: "ok"; canonicalPath: string }
  | { status: "skipped" }
  | { status: "rejected"; reason: "unsafe" | "outside-workspace" };

export const nodeCanonicalIo: CanonicalPathIo = {
  exists(target: string): boolean {
    return existsSync(target);
  },
  realpath(target: string): string {
    return realpathSync(target);
  },
  join(left: string, right: string): string {
    return path.join(left, right);
  },
  sep: path.sep,
  ignoreCase: process.platform === "win32",
};

function normalizeComparable(value: string, io: CanonicalPathIo): string {
  let trimmed = value;
  while (trimmed.length > io.sep.length && trimmed.endsWith(io.sep)) {
    trimmed = trimmed.slice(0, -io.sep.length);
  }
  return io.ignoreCase ? trimmed.toLowerCase() : trimmed;
}

export function isInsideCanonicalRoot(
  root: string,
  candidate: string,
  io: CanonicalPathIo = nodeCanonicalIo,
): boolean {
  const compareRoot = normalizeComparable(root, io);
  const compareCandidate = normalizeComparable(candidate, io);
  if (compareCandidate === compareRoot) {
    return true;
  }
  const sep = io.ignoreCase ? io.sep.toLowerCase() : io.sep;
  return compareCandidate.startsWith(`${compareRoot}${sep}`);
}

export function inspectCanonicalWorkspaceTarget(
  workspaceRoot: string,
  relativePath: string,
  io?: CanonicalPathIo,
): CanonicalInspection {
  const access = io ?? nodeCanonicalIo;
  if (!access.exists(workspaceRoot)) {
    return { status: "skipped" };
  }

  let rootReal: string;
  try {
    rootReal = access.realpath(workspaceRoot);
  } catch {
    return { status: "rejected", reason: "outside-workspace" };
  }

  let current = rootReal;
  const segments = relativePath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  for (const segment of segments) {
    if (segment === "..") {
      return { status: "rejected", reason: "unsafe" };
    }
    const next = access.join(current, segment);
    if (!access.exists(next)) {
      if (!isInsideCanonicalRoot(rootReal, current, access)) {
        return { status: "rejected", reason: "outside-workspace" };
      }
      return { status: "ok", canonicalPath: next };
    }
    let resolved: string;
    try {
      resolved = access.realpath(next);
    } catch {
      return { status: "rejected", reason: "unsafe" };
    }
    if (!isInsideCanonicalRoot(rootReal, resolved, access)) {
      return { status: "rejected", reason: "outside-workspace" };
    }
    current = resolved;
  }

  return { status: "ok", canonicalPath: current };
}
