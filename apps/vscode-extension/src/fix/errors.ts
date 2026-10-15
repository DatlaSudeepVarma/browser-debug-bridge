import type { AiError, AiErrorCode } from "../ai/types.js";
import type { FixError, FixErrorCode } from "./types.js";

const PROVIDER_MAP: Record<AiErrorCode, FixErrorCode> = {
  AI_UNAVAILABLE: "AI_FIX_UNAVAILABLE",
  AI_REQUEST_FAILED: "AI_FIX_REQUEST_FAILED",
  AI_RESPONSE_INVALID: "AI_FIX_RESPONSE_INVALID",
  AI_RESPONSE_TOO_LARGE: "AI_FIX_RESPONSE_TOO_LARGE",
  AI_CANCELLED: "AI_FIX_CANCELLED",
  AI_CONTEXT_TOO_LARGE: "AI_FIX_CONTEXT_TOO_LARGE",
};

export function fixError(code: FixErrorCode, message: string): FixError {
  return { code, message };
}

export function mapProviderError(error: AiError): FixError {
  return fixError(PROVIDER_MAP[error.code], error.message);
}

export function logSafeFixError(error: FixError): string {
  return `[AI] ${error.code}`;
}
