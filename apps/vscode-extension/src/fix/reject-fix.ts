import { proposalPreviewOwner, type ProposedPreviewStore } from "./preview-store.js";
import type { FixProposalController } from "./proposal-state.js";
import type { StoredProposal } from "./types.js";

export type RejectFixOutcome =
  | { status: "rejected"; previewCleared: boolean }
  | { status: "no-proposal" }
  | { status: "stale" }
  | { status: "busy" };

/**
 * Discards `expected` from the controller and drops its in-memory preview.
 * This is a state-management operation only: no workspace file is read or
 * written, and the diagnosis is left in place so a new proposal can be made.
 *
 * `expected` is the proposal the caller observed. If a different proposal is
 * current by the time this runs, nothing is cleared and `stale` is returned.
 */
export function rejectFixProposal(
  controller: FixProposalController,
  previewStore: ProposedPreviewStore,
  expected: StoredProposal | undefined,
): RejectFixOutcome {
  const result = controller.reject(expected);
  if (result === "busy") {
    return { status: "busy" };
  }
  if (result === "no-proposal") {
    return { status: "no-proposal" };
  }
  if (result === "stale" || expected === undefined) {
    return { status: "stale" };
  }
  const previewCleared = previewStore.clearFor(proposalPreviewOwner(expected));
  if (!previewCleared && previewStore.hasPreview()) {
    // No proposal is current any more, so any lingering preview is orphaned.
    previewStore.clear();
  }
  return { status: "rejected", previewCleared };
}
