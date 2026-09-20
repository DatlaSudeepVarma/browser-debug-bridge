import type { ProjectContext } from "../project/types.js";
import { missingCandidateMessage, UNSAFE_CANDIDATE_MESSAGE } from "./messages.js";
import { asPlainTreeText } from "./plain-text.js";
import { resolveCandidatePath, type CandidateOpenRejection } from "./open-path.js";

export interface CandidateFileOpener {
  exists(folderRoot: string, relativePath: string): Promise<boolean>;
  open(folderRoot: string, relativePath: string): Promise<void>;
}

export type OpenCandidateOutcome =
  | { status: "opened" }
  | { status: "missing"; message: string }
  | { status: "rejected"; reason: CandidateOpenRejection | "no-diagnosis"; message: string };

export async function openCandidateFile(
  relativePath: string,
  project: ProjectContext | undefined,
  opener: CandidateFileOpener,
): Promise<OpenCandidateOutcome> {
  if (project === undefined) {
    return {
      status: "rejected",
      reason: "no-diagnosis",
      message: UNSAFE_CANDIDATE_MESSAGE,
    };
  }
  const resolved = resolveCandidatePath(relativePath, project);
  if (resolved.status === "rejected") {
    return {
      status: "rejected",
      reason: resolved.reason,
      message: UNSAFE_CANDIDATE_MESSAGE,
    };
  }
  const exists = await opener.exists(resolved.resolved.folderRoot, resolved.resolved.relativePath);
  if (!exists) {
    return {
      status: "missing",
      message: missingCandidateMessage(asPlainTreeText(resolved.resolved.relativePath)),
    };
  }
  await opener.open(resolved.resolved.folderRoot, resolved.resolved.relativePath);
  return { status: "opened" };
}
