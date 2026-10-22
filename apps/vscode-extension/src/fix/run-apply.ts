import type { CanonicalPathIo } from "./canonical-path.js";
import { sha256Utf8 } from "./hash.js";
import { proposalPreviewOwner, type ProposedPreviewStore } from "./preview-store.js";
import type { FixProposalController } from "./proposal-state.js";
import { prepareFixReview, type PrepareFixReviewResult, type ReviewFixRefusal } from "./review-fix.js";
import type { SafeApplyPlan, StoredProposal } from "./types.js";
import type { DiagnosisViewState } from "../ui/diagnosis-state.js";

export type WorkspaceWriteResult =
  | { status: "applied" }
  | { status: "not-applied" }
  | { status: "unsaved" }
  | { status: "dirty" }
  | { status: "mismatch" };

export interface WorkspaceFileWriter {
  write(plan: SafeApplyPlan): Promise<WorkspaceWriteResult>;
}

export type ApplyFixOutcome =
  | { status: "applied"; fileCount: number }
  | { status: "refused"; reason: ReviewFixRefusal }
  | { status: "busy" }
  | { status: "declined" }
  | { status: "no-proposal" }
  | { status: "stale" }
  | { status: "stale-after-write" }
  | { status: "write-failed"; detail: "not-applied" | "unsaved" | "verify" | "mismatch" };

export interface RunApplyFixInput {
  proposalController: FixProposalController;
  previewStore: ProposedPreviewStore;
  getDiagnosis: () => DiagnosisViewState | undefined;
  getDiagnosisGeneration: () => number;
  isDiagnosisRunning: () => boolean;
  readLiveFiles: (proposal: StoredProposal) => Promise<Record<string, string | undefined>>;
  dirtyPaths: (proposal: StoredProposal) => Set<string> | Promise<Set<string>>;
  canonicalIo: CanonicalPathIo;
  confirm: (fileCount: number) => Promise<boolean>;
  write: WorkspaceFileWriter["write"];
}

/**
 * Applies the current proposal only after a fresh plan, an explicit confirm,
 * and a second plan that still matches. The writer performs the single
 * workspace edit. A failed or declined write leaves the proposal in place.
 */
export async function runApplyFix(input: RunApplyFixInput): Promise<ApplyFixOutcome> {
  if (input.isDiagnosisRunning() || !input.proposalController.beginApply()) {
    return { status: "busy" };
  }
  try {
    const proposal = input.proposalController.getProposal();
    if (proposal === undefined) {
      return { status: "no-proposal" };
    }
    const generation = input.getDiagnosisGeneration();
    const planned = await planCurrent(input, proposal);
    if (planned.status !== "ok") {
      return { status: "refused", reason: planned.reason };
    }

    const confirmed = await input.confirm(planned.files.length);
    if (!confirmed) {
      return { status: "declined" };
    }
    if (!stillCurrent(input, proposal, generation)) {
      return { status: "stale" };
    }

    const replanned = await planCurrent(input, proposal);
    if (replanned.status !== "ok") {
      return { status: "refused", reason: replanned.reason };
    }
    if (!sameAfterImage(planned, replanned)) {
      return { status: "stale" };
    }

    const written = await input.write({
      identity: proposal.identity,
      files: replanned.files.map((file) => ({
        relativePath: file.relativePath,
        workspaceRoot: file.workspaceRoot,
        currentContent: file.currentContent,
        currentContentHash: sha256Utf8(file.currentContent),
        proposedContent: file.proposedContent,
        proposedContentHash: sha256Utf8(file.proposedContent),
        edits: proposal.proposedChange.changes.find((change) => change.relativePath === file.relativePath)?.edits ?? [],
      })),
    });
    if (written.status === "dirty") {
      return {
        status: "refused",
        reason: {
          code: "REVIEW_SOURCE_DIRTY",
          message: "A proposed file has unsaved editor changes.",
        },
      };
    }
    if (written.status === "mismatch") {
      return { status: "write-failed", detail: "mismatch" };
    }
    if (written.status === "not-applied") {
      return { status: "write-failed", detail: "not-applied" };
    }
    if (written.status === "unsaved") {
      return { status: "write-failed", detail: "unsaved" };
    }

    const verified = await input.readLiveFiles(proposal);
    for (const file of replanned.files) {
      const text = verified[file.relativePath];
      if (text === undefined || sha256Utf8(text) !== sha256Utf8(file.proposedContent)) {
        return { status: "write-failed", detail: "verify" };
      }
    }
    if (!input.proposalController.consumeApplied(proposal)) {
      return { status: "stale-after-write" };
    }
    if (!input.previewStore.clearFor(proposalPreviewOwner(proposal)) && input.previewStore.hasPreview()) {
      input.previewStore.clear();
    }
    return { status: "applied", fileCount: replanned.files.length };
  } finally {
    input.proposalController.endApply();
  }
}

async function planCurrent(
  input: RunApplyFixInput,
  proposal: StoredProposal,
): Promise<PrepareFixReviewResult> {
  const live = await input.readLiveFiles(proposal);
  const dirty = await input.dirtyPaths(proposal);
  return prepareFixReview({
    proposal,
    diagnosis: input.getDiagnosis(),
    readLiveFile: (relativePath) => live[relativePath],
    canonicalIo: input.canonicalIo,
    isDirty: (relativePath) => dirty.has(relativePath),
  });
}

function stillCurrent(input: RunApplyFixInput, proposal: StoredProposal, generation: number): boolean {
  return (
    input.proposalController.getProposal() === proposal &&
    input.getDiagnosisGeneration() === generation &&
    input.isDiagnosisRunning() === false
  );
}

function sameAfterImage(
  left: Extract<PrepareFixReviewResult, { status: "ok" }>,
  right: Extract<PrepareFixReviewResult, { status: "ok" }>,
): boolean {
  if (left.files.length !== right.files.length) {
    return false;
  }
  return left.files.every((file, index) => {
    const other = right.files[index];
    return (
      other !== undefined &&
      other.relativePath === file.relativePath &&
      other.currentContent === file.currentContent &&
      other.proposedContent === file.proposedContent
    );
  });
}
