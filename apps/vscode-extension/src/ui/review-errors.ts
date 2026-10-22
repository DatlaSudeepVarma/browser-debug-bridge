import type { ReviewFixRefusal, ReviewFixRefusalCode } from "../fix/review-fix.js";
import {
  REVIEW_DIFF_FAILED_MESSAGE,
  REVIEW_NO_DIAGNOSIS_MESSAGE,
  REVIEW_NO_PROPOSAL_MESSAGE,
  REVIEW_SOURCE_DIRTY_MESSAGE,
} from "./messages.js";

const MESSAGES: Record<ReviewFixRefusalCode, string> = {
  APPLY_NO_PROPOSAL: REVIEW_NO_PROPOSAL_MESSAGE,
  APPLY_IDENTITY_MISMATCH: "The proposed change is not valid for the current diagnosis.",
  APPLY_DIAGNOSIS_MISMATCH: "The proposed change does not belong to the current diagnosis.",
  APPLY_PATH_REJECTED: "A proposed path is not an allowed workspace file.",
  APPLY_CANONICAL_REJECTED: "A proposed path failed workspace path validation.",
  APPLY_FILE_MISSING: "A proposed file is missing or unreadable.",
  APPLY_SOURCE_STALE: "The source excerpt no longer matches the proposed change.",
  APPLY_SOURCE_CHANGED: "The source file has changed since the proposal was generated.",
  APPLY_EDIT_INVALID: "The proposed edits are not valid for the current file.",
  APPLY_PROPOSAL_MALFORMED: "The proposed change is not valid to review.",
  APPLY_TEXT_AMBIGUOUS: "The source file has unsupported encoding or ambiguous line endings.",
  REVIEW_NO_DIAGNOSIS: REVIEW_NO_DIAGNOSIS_MESSAGE,
  REVIEW_SOURCE_DIRTY: REVIEW_SOURCE_DIRTY_MESSAGE,
  REVIEW_DIFF_FAILED: REVIEW_DIFF_FAILED_MESSAGE,
};

export function userFacingReviewError(reason: ReviewFixRefusal): string {
  return MESSAGES[reason.code];
}

export function logSafeReviewError(reason: ReviewFixRefusal): string {
  return `[Review] ${reason.code}`;
}
