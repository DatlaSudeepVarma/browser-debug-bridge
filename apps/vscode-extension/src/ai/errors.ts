import type { AiError, AiErrorCode } from "./types.js";

export class AiAnalysisError extends Error {
  public readonly code: AiErrorCode;

  public constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiAnalysisError";
    this.code = code;
  }

  public toError(): AiError {
    return { code: this.code, message: this.message };
  }
}

export function aiError(code: AiErrorCode, message: string): AiError {
  return { code, message };
}

export function mapLanguageModelFailure(code: string | undefined): AiError {
  if (code === "NoPermissions" || code === "NotFound") {
    return aiError("AI_UNAVAILABLE", "No language model is available or permission was not granted.");
  }
  if (code === "Blocked") {
    return aiError("AI_REQUEST_FAILED", "The language model request was blocked.");
  }
  return aiError("AI_REQUEST_FAILED", "The language model request failed.");
}

export function isCancelledError(error: unknown): boolean {
  if (error instanceof AiAnalysisError && error.code === "AI_CANCELLED") {
    return true;
  }
  if (error instanceof Error && /cancel/i.test(error.name + error.message)) {
    return true;
  }
  return false;
}
