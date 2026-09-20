import { userFacingAiError } from "./ai-errors.js";
import {
  DIAGNOSIS_BUSY_MESSAGE,
  DIAGNOSIS_COMPLETE_MESSAGE,
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
  }
}
