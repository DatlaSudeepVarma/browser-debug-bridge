import type { FixError, FixErrorCode } from "../fix/types.js";

const MESSAGES: Record<FixErrorCode, string> = {
  AI_FIX_UNAVAILABLE: "No language model is available. Enable a VS Code language model, then try again.",
  AI_FIX_REQUEST_FAILED: "The fix proposal request failed. The previous proposal was kept if one existed.",
  AI_FIX_RESPONSE_INVALID: "The model response was not a valid proposed change. The previous proposal was kept if one existed.",
  AI_FIX_RESPONSE_TOO_LARGE: "The model response was too large. The previous proposal was kept if one existed.",
  AI_FIX_CONTEXT_TOO_LARGE: "The fix context was too large. The previous proposal was kept if one existed.",
  AI_FIX_CONTEXT_INSUFFICIENT:
    "The diagnosis does not include enough bounded source excerpts to propose a change.",
  AI_FIX_PROPOSAL_TOO_LARGE: "The proposed change exceeded size limits and was rejected.",
  AI_DIFF_INVALID: "The proposed edits could not be turned into a valid unified diff.",
  AI_FIX_SOURCE_UNAVAILABLE:
    "A proposed file could not be read or failed workspace path checks. The previous proposal was kept if one existed.",
  AI_FIX_SOURCE_CHANGED:
    "A proposed file changed while the fix was being generated. The previous proposal was kept if one existed.",
  AI_FIX_CANCELLED: "Fix proposal was cancelled. The previous proposal was kept if one existed.",
};

export function userFacingFixError(error: FixError): string {
  return MESSAGES[error.code];
}
