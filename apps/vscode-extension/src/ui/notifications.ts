import type { ApplyFixOutcome } from "../fix/run-apply.js";
import type { RejectFixOutcome } from "../fix/reject-fix.js";
import type { FixProposalRunOutcome } from "../fix/run-proposal.js";
import { userFacingAiError } from "./ai-errors.js";
import { userFacingFixError } from "./fix-errors.js";
import {
  DIAGNOSIS_BUSY_MESSAGE,
  DIAGNOSIS_COMPLETE_MESSAGE,
  DIAGNOSIS_DISCARDED_MESSAGE,
  FIX_BUSY_MESSAGE,
  FIX_COMPLETE_MESSAGE,
  APPLY_BUSY_MESSAGE,
  APPLY_COMPLETE_MESSAGE,
  APPLY_DECLINED_MESSAGE,
  APPLY_NO_PROPOSAL_MESSAGE,
  APPLY_STALE_AFTER_WRITE_MESSAGE,
  APPLY_STALE_MESSAGE,
  APPLY_UNSAVED_MESSAGE,
  APPLY_VERIFY_FAILED_MESSAGE,
  APPLY_WRITE_FAILED_MESSAGE,
  FIX_REJECTED_MESSAGE,
  FIX_STALE_MESSAGE,
  NO_DIAGNOSIS_FOR_FIX_MESSAGE,
  NO_SESSION_MESSAGE,
  NO_WORKSPACE_MESSAGE,
  REJECT_BUSY_MESSAGE,
  REJECT_NO_PROPOSAL_MESSAGE,
  REJECT_STALE_MESSAGE,
} from "./messages.js";
import { userFacingReviewError } from "./review-errors.js";
import type { DiagnosisRunOutcome } from "./run-diagnosis.js";

export type UserNotice = { kind: "info" | "warn"; message: string };

export function diagnosisLogLines(outcome: DiagnosisRunOutcome): string[] {
  switch (outcome.status) {
    case "replaced":
      return [
        `[AI] Provider: ${outcome.result.providerId}`,
        `[AI] Candidates: ${String(outcome.result.candidateCount)}`,
        `[AI] Context chars: ${String(outcome.result.contextChars)}`,
        "[AI] Diagnosis completed",
      ];
    case "preserved":
      return [`[AI] ${outcome.result.error.code}`];
    case "cancelled":
      return ["[AI] AI_CANCELLED"];
    case "no-session":
      return ["[AI] No debug session available"];
    case "no-workspace":
      return ["[AI] No workspace"];
    case "busy":
      return ["[AI] Diagnosis already running"];
    case "discarded":
      return ["[AI] Diagnosis discarded because state changed"];
  }
}

export function diagnosisUserNotice(outcome: DiagnosisRunOutcome): UserNotice {
  switch (outcome.status) {
    case "replaced":
      return { kind: "info", message: DIAGNOSIS_COMPLETE_MESSAGE };
    case "preserved":
      return { kind: "warn", message: userFacingAiError(outcome.result.error) };
    case "cancelled":
      return { kind: "warn", message: userFacingAiError({ code: "AI_CANCELLED", message: "" }) };
    case "no-session":
      return { kind: "warn", message: NO_SESSION_MESSAGE };
    case "no-workspace":
      return { kind: "warn", message: NO_WORKSPACE_MESSAGE };
    case "busy":
      return { kind: "warn", message: DIAGNOSIS_BUSY_MESSAGE };
    case "discarded":
      return { kind: "warn", message: DIAGNOSIS_DISCARDED_MESSAGE };
  }
}

export function fixProposalLogLines(outcome: FixProposalRunOutcome): string[] {
  switch (outcome.status) {
    case "replaced":
      return [
        `[AI] Provider: ${outcome.result.providerId}`,
        `[AI] Fix files: ${String(outcome.result.fileCount)}`,
        `[AI] Context chars: ${String(outcome.result.contextChars)}`,
        "[AI] Fix proposal completed",
      ];
    case "preserved":
      return [`[AI] ${outcome.result.error.code}`];
    case "cancelled":
      return ["[AI] AI_FIX_CANCELLED"];
    case "no-diagnosis":
      return ["[AI] No diagnosis available"];
    case "busy":
      return ["[AI] Fix proposal already running"];
    case "stale":
      return ["[AI] Fix proposal discarded because diagnosis changed"];
  }
}

export function fixProposalUserNotice(outcome: FixProposalRunOutcome): UserNotice {
  switch (outcome.status) {
    case "replaced":
      return { kind: "info", message: FIX_COMPLETE_MESSAGE };
    case "preserved":
      return { kind: "warn", message: userFacingFixError(outcome.result.error) };
    case "cancelled":
      return { kind: "warn", message: userFacingFixError({ code: "AI_FIX_CANCELLED", message: "" }) };
    case "no-diagnosis":
      return { kind: "warn", message: NO_DIAGNOSIS_FOR_FIX_MESSAGE };
    case "busy":
      return { kind: "warn", message: FIX_BUSY_MESSAGE };
    case "stale":
      return { kind: "warn", message: FIX_STALE_MESSAGE };
  }
}

export function rejectFixLogLines(outcome: RejectFixOutcome): string[] {
  switch (outcome.status) {
    case "rejected":
      return [
        "[Fix] Proposal rejected",
        outcome.previewCleared ? "[Fix] Preview cleared" : "[Fix] No preview was open for the proposal",
      ];
    case "no-proposal":
      return ["[Fix] No proposal to reject"];
    case "stale":
      return ["[Fix] Reject skipped because the proposal changed"];
    case "busy":
      return ["[Fix] Reject skipped because an apply is running"];
  }
}

export function rejectFixUserNotice(outcome: RejectFixOutcome): UserNotice {
  switch (outcome.status) {
    case "rejected":
      return { kind: "info", message: FIX_REJECTED_MESSAGE };
    case "no-proposal":
      return { kind: "warn", message: REJECT_NO_PROPOSAL_MESSAGE };
    case "stale":
      return { kind: "warn", message: REJECT_STALE_MESSAGE };
    case "busy":
      return { kind: "warn", message: REJECT_BUSY_MESSAGE };
  }
}

export function applyFixLogLines(outcome: ApplyFixOutcome): string[] {
  switch (outcome.status) {
    case "applied":
      return ["[Apply] APPLIED", `[Apply] Files: ${String(outcome.fileCount)}`];
    case "refused":
      return [`[Apply] ${outcome.reason.code}`];
    case "busy":
      return ["[Apply] APPLY_BUSY"];
    case "declined":
      return ["[Apply] APPLY_DECLINED"];
    case "no-proposal":
      return ["[Apply] APPLY_NO_PROPOSAL"];
    case "stale":
      return ["[Apply] APPLY_STALE"];
    case "stale-after-write":
      return ["[Apply] APPLY_STALE_AFTER_WRITE"];
    case "write-failed":
      return [`[Apply] APPLY_WRITE_FAILED ${outcome.detail}`];
  }
}

export function applyFixUserNotice(outcome: ApplyFixOutcome): UserNotice {
  switch (outcome.status) {
    case "applied":
      return { kind: "info", message: APPLY_COMPLETE_MESSAGE };
    case "refused":
      return { kind: "warn", message: userFacingReviewError(outcome.reason) };
    case "busy":
      return { kind: "warn", message: APPLY_BUSY_MESSAGE };
    case "declined":
      return { kind: "warn", message: APPLY_DECLINED_MESSAGE };
    case "no-proposal":
      return { kind: "warn", message: APPLY_NO_PROPOSAL_MESSAGE };
    case "stale":
      return { kind: "warn", message: APPLY_STALE_MESSAGE };
    case "stale-after-write":
      return { kind: "warn", message: APPLY_STALE_AFTER_WRITE_MESSAGE };
    case "write-failed":
      if (outcome.detail === "unsaved") {
        return { kind: "warn", message: APPLY_UNSAVED_MESSAGE };
      }
      if (outcome.detail === "verify") {
        return { kind: "warn", message: APPLY_VERIFY_FAILED_MESSAGE };
      }
      return { kind: "warn", message: APPLY_WRITE_FAILED_MESSAGE };
  }
}
