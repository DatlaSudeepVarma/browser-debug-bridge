import type { CanonicalPathIo } from "./canonical-path.js";
import { planSafeApply } from "./apply-plan.js";
import { posixBasename } from "../project/workspace.js";
import type { DiagnosisViewState } from "../ui/diagnosis-state.js";
import type { ApplyPlanErrorCode, ApplyPlanRefusal, StoredProposal } from "./types.js";

export type ReviewFixRefusalCode =
  | ApplyPlanErrorCode
  | "REVIEW_NO_DIAGNOSIS"
  | "REVIEW_SOURCE_DIRTY"
  | "REVIEW_DIFF_FAILED";

export interface ReviewFixRefusal {
  code: ReviewFixRefusalCode;
  message: string;
  relativePath?: string;
}

export interface ReviewFixFile {
  relativePath: string;
  workspaceRoot: string;
  currentContent: string;
  proposedContent: string;
  title: string;
}

export type PrepareFixReviewResult =
  | { status: "ok"; files: ReviewFixFile[]; identity: StoredProposal["identity"] }
  | { status: "refused"; reason: ReviewFixRefusal };

export interface PrepareFixReviewInput {
  proposal: StoredProposal | undefined;
  diagnosis: DiagnosisViewState | undefined;
  readLiveFile: (relativePath: string) => string | undefined;
  canonicalIo: CanonicalPathIo;
  isDirty?: (relativePath: string) => boolean;
}

export async function snapshotLiveFiles(
  proposal: StoredProposal,
  readText: (relativePath: string) => Promise<string | undefined> | string | undefined,
): Promise<Record<string, string | undefined>> {
  const files: Record<string, string | undefined> = {};
  for (const change of proposal.proposedChange.changes) {
    if (typeof change.relativePath !== "string") {
      continue;
    }
    try {
      files[change.relativePath] = await readText(change.relativePath);
    } catch {
      files[change.relativePath] = undefined;
    }
  }
  return files;
}

export function prepareFixReview(input: PrepareFixReviewInput): PrepareFixReviewResult {
  if (input.diagnosis === undefined) {
    return refuse("REVIEW_NO_DIAGNOSIS", "Run diagnosis before reviewing a proposed change.");
  }
  if (input.proposal === undefined) {
    return refuse("APPLY_NO_PROPOSAL", "There is no proposed change to review.");
  }

  const dirtyPath = dirtyProposedPath(input.proposal, input.isDirty);
  if (dirtyPath !== undefined) {
    return refuse(
      "REVIEW_SOURCE_DIRTY",
      "A proposed file has unsaved editor changes. Save or revert it before reviewing.",
      dirtyPath,
    );
  }

  const planned = planSafeApply({
    proposal: input.proposal,
    sessionId: input.diagnosis.session.sessionId,
    diagnosis: input.diagnosis.diagnosis,
    project: input.diagnosis.project,
    readLiveFile: input.readLiveFile,
    canonicalIo: input.canonicalIo,
  });
  if (planned.status !== "ok") {
    return { status: "refused", reason: reviewReasonFromPlan(planned.reason) };
  }

  return {
    status: "ok",
    identity: planned.plan.identity,
    files: planned.plan.files.map((file) => ({
      relativePath: file.relativePath,
      workspaceRoot: file.workspaceRoot,
      currentContent: file.currentContent,
      proposedContent: file.proposedContent,
      title: `${posixBasename(file.relativePath)} (Proposed change)`,
    })),
  };
}

function dirtyProposedPath(
  proposal: StoredProposal,
  isDirty: ((relativePath: string) => boolean) | undefined,
): string | undefined {
  if (isDirty === undefined) {
    return undefined;
  }
  for (const change of proposal.proposedChange.changes) {
    if (typeof change.relativePath === "string" && isDirty(change.relativePath)) {
      return change.relativePath;
    }
  }
  return undefined;
}

function reviewReasonFromPlan(reason: ApplyPlanRefusal): ReviewFixRefusal {
  return {
    code: reason.code,
    message: reason.message,
    relativePath: reason.relativePath,
  };
}

function refuse(code: ReviewFixRefusalCode, message: string, relativePath?: string): PrepareFixReviewResult {
  return {
    status: "refused",
    reason: relativePath === undefined ? { code, message } : { code, message, relativePath },
  };
}
