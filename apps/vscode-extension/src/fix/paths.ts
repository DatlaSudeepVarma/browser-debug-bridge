import { inspectWorkspacePath } from "@browser-debug-bridge/redaction";
import type { ProjectContext } from "../project/types.js";
import { isSecretOrProtectedFileName, posixBasename } from "../project/workspace.js";
import { inspectCanonicalWorkspaceTarget, type CanonicalPathIo } from "./canonical-path.js";

export type FixPathRejection = "not-allowed" | "unsafe" | "outside-workspace" | "sensitive";

export type FixPathResult =
  | { status: "ok"; relativePath: string }
  | { status: "rejected"; reason: FixPathRejection };

export function validateFixPath(
  relativePath: string,
  project: ProjectContext,
  allowedPaths: ReadonlySet<string>,
  io?: CanonicalPathIo,
): FixPathResult {
  const candidate = project.candidates.find((item) => item.relativePath === relativePath);
  const workspaceRoot = candidate?.workspaceRoot ?? project.workspaceRoot;
  const inspection = inspectWorkspacePath(workspaceRoot, relativePath);
  if (!inspection.safe) {
    if (inspection.reason === "outside-workspace") {
      return { status: "rejected", reason: "outside-workspace" };
    }
    if (
      inspection.reason === "env-file" ||
      inspection.reason === "private-key" ||
      inspection.reason === "credentials-file" ||
      inspection.reason === "pem-file"
    ) {
      return { status: "rejected", reason: "sensitive" };
    }
    return { status: "rejected", reason: "unsafe" };
  }
  if (isSecretOrProtectedFileName(posixBasename(inspection.relativePath))) {
    return { status: "rejected", reason: "sensitive" };
  }
  if (!allowedPaths.has(inspection.relativePath) || candidate === undefined) {
    return { status: "rejected", reason: "not-allowed" };
  }
  const canonical = inspectCanonicalWorkspaceTarget(workspaceRoot, inspection.relativePath, io);
  if (canonical.status === "rejected") {
    return { status: "rejected", reason: canonical.reason };
  }
  return { status: "ok", relativePath: inspection.relativePath };
}
