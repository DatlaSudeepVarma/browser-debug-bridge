import type { AiError, AiErrorCode } from "../ai/types.js";

const MESSAGES: Record<AiErrorCode, string> = {
  AI_UNAVAILABLE: "No language model is available. Enable a VS Code language model, then try again.",
  AI_REQUEST_FAILED: "The diagnosis request failed. The previous diagnosis was kept.",
  AI_RESPONSE_INVALID: "The model response was not a valid diagnosis. The previous diagnosis was kept.",
  AI_RESPONSE_TOO_LARGE: "The model response was too large. The previous diagnosis was kept.",
  AI_CANCELLED: "Diagnosis was cancelled. The previous diagnosis was kept.",
  AI_CONTEXT_TOO_LARGE: "The diagnosis context was too large. The previous diagnosis was kept.",
};

export function userFacingAiError(error: AiError): string {
  return MESSAGES[error.code];
}

export function logSafeAiError(error: AiError): string {
  return `[AI] ${error.code}`;
}
