import type { FixProposalRunOutcome } from "../fix/run-proposal.js";
import { userFacingAiError } from "./ai-errors.js";
import { userFacingFixError } from "./fix-errors.js";
import {
  DIAGNOSIS_BUSY_MESSAGE,
  DIAGNOSIS_COMPLETE_MESSAGE,
  DIAGNOSIS_DISCARDED_MESSAGE,
  FIX_BUSY_MESSAGE,
  FIX_COMPLETE_MESSAGE,
  FIX_STALE_MESSAGE,
  NO_DIAGNOSIS_FOR_FIX_MESSAGE,
  NO_SESSION_MESSAGE,
  NO_WORKSPACE_MESSAGE,
} from "./messages.js";
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
