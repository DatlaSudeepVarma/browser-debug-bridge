import { inspectWorkspacePath } from "@browser-debug-bridge/redaction";
import type { ProjectContext } from "../project/types.js";

export type CandidateOpenRejection = "not-allowed" | "unsafe" | "outside-workspace";

export interface ResolvedCandidatePath {
  relativePath: string;
  folderRoot: string;
  folderName: string;
}

export type ResolveCandidatePathResult =
  | { status: "ok"; resolved: ResolvedCandidatePath }
  | { status: "rejected"; reason: CandidateOpenRejection };

export function allowedCandidatePaths(project: ProjectContext): ReadonlySet<string> {
  return new Set(project.candidates.map((candidate) => candidate.relativePath));
}

export function resolveCandidatePath(
  relativePath: string,
  project: ProjectContext,
  allowedRelativePaths: ReadonlySet<string> = allowedCandidatePaths(project),
): ResolveCandidatePathResult {
  if (!allowedRelativePaths.has(relativePath)) {
    return { status: "rejected", reason: "not-allowed" };
  }
  const candidate = project.candidates.find((item) => item.relativePath === relativePath);
  if (candidate === undefined) {
    return { status: "rejected", reason: "not-allowed" };
  }
  const inspection = inspectWorkspacePath(candidate.workspaceRoot, relativePath);
  if (!inspection.safe) {
    return {
      status: "rejected",
      reason: inspection.reason === "outside-workspace" ? "outside-workspace" : "unsafe",
    };
  }
  return {
    status: "ok",
    resolved: {
      relativePath: inspection.relativePath,
      folderRoot: candidate.workspaceRoot,
      folderName: candidate.workspaceFolder,
    },
  };
}
