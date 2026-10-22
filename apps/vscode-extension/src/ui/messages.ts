export const EMPTY_DIAGNOSIS_MESSAGE =
  'No diagnosis available.\n\nRun "Browser Debug Bridge: Diagnose Test Session"';

export const NO_SESSION_MESSAGE =
  "No debug session available. Start a browser debugging session first.";

export const NO_WORKSPACE_MESSAGE = "Open a workspace folder before diagnosing a session.";

export const DIAGNOSIS_BUSY_MESSAGE = "A diagnosis is already running.";

export const DIAGNOSIS_CLEARED_MESSAGE = "Diagnosis cleared.";

export const DIAGNOSIS_COMPLETE_MESSAGE = "Read-only AI diagnosis complete.";

export const NO_DIAGNOSIS_FOR_FIX_MESSAGE = "Run diagnosis before proposing a fix.";

export const FIX_BUSY_MESSAGE = "A fix proposal is already running.";

export const DIAGNOSIS_DISCARDED_MESSAGE =
  "The diagnosis was cleared before it finished. No new diagnosis was stored.";

export const FIX_COMPLETE_MESSAGE = "In-memory proposed change ready. No workspace files were modified.";

export const FIX_STALE_MESSAGE =
  "The diagnosis changed before the proposal was ready. Propose a fix again.";

export const UNSAFE_CANDIDATE_MESSAGE = "That file path is not a validated diagnosis candidate.";

export const REVIEW_NO_DIAGNOSIS_MESSAGE = "Run diagnosis before reviewing a proposed change.";

export const REVIEW_NO_PROPOSAL_MESSAGE = "There is no proposed change to review.";

export const REVIEW_SOURCE_DIRTY_MESSAGE =
  "A proposed file has unsaved editor changes. Save or revert it before reviewing.";

export const REVIEW_DIFF_FAILED_MESSAGE = "The proposed change could not be opened in the diff editor.";

export const REVIEW_OPENED_MESSAGE = "Opened a read-only diff of the proposed change. No files were written.";

export const FIX_REJECTED_MESSAGE =
  "Proposed change rejected. No workspace files were modified. The diagnosis is still available.";

export const REJECT_NO_PROPOSAL_MESSAGE = "There is no proposed change to reject.";

export const REJECT_STALE_MESSAGE =
  "The proposed change was replaced before it could be rejected. Review the current proposal.";

export const REJECT_BUSY_MESSAGE = "A proposed change is being applied. Wait until it finishes.";

export const APPLY_COMPLETE_MESSAGE = "Proposed change applied and saved. The diagnosis is still available.";

export const APPLY_DECLINED_MESSAGE = "Apply was cancelled. No workspace files were modified.";

export const APPLY_BUSY_MESSAGE = "Apply is already running, or another diagnosis or proposal is in progress.";

export const APPLY_NO_PROPOSAL_MESSAGE = "There is no proposed change to apply.";

export const APPLY_STALE_MESSAGE =
  "The proposed change or diagnosis changed before it could be applied. No workspace files were modified.";

export const APPLY_STALE_AFTER_WRITE_MESSAGE =
  "The proposed change was written, but it was no longer the current proposal afterward. Check the workspace files.";

export const APPLY_WRITE_FAILED_MESSAGE = "The proposed change was not applied. No workspace files were modified.";

export const APPLY_UNSAVED_MESSAGE =
  "The proposed change was applied in the editor but could not be saved. It was not reported as applied.";

export const APPLY_VERIFY_FAILED_MESSAGE =
  "The workspace files did not match the proposed change after writing. It was not reported as applied.";

export function applyConfirmMessage(fileCount: number): string {
  const files = fileCount === 1 ? "1 file" : `${String(fileCount)} files`;
  return `Apply this proposed change to ${files}? The current workspace contents will be overwritten and saved.`;
}

export function missingCandidateMessage(relativePath: string): string {
  return `The referenced file is no longer available: ${relativePath}`;
}
