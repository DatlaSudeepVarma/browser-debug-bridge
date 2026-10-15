import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FixError, FixErrorCode } from "../fix/types.js";
import { logSafeFixError } from "../fix/errors.js";
import { userFacingFixError } from "./fix-errors.js";

const CODES: FixErrorCode[] = [
  "AI_FIX_UNAVAILABLE",
  "AI_FIX_REQUEST_FAILED",
  "AI_FIX_RESPONSE_INVALID",
  "AI_FIX_RESPONSE_TOO_LARGE",
  "AI_FIX_CONTEXT_TOO_LARGE",
  "AI_FIX_CONTEXT_INSUFFICIENT",
  "AI_FIX_PROPOSAL_TOO_LARGE",
  "AI_DIFF_INVALID",
  "AI_FIX_CANCELLED",
];

describe("fix error mapping", () => {
  it("maps every fix error category to a user-facing message", () => {
    for (const code of CODES) {
      const error: FixError = {
        code,
        message: "secret prompt http://localhost Authorization: Bearer pairing-token src/services/checkout.ts",
      };
      const message = userFacingFixError(error);
      assert.equal(message.length > 0, true);
      assert.equal(message.includes("secret prompt"), false);
      assert.equal(message.includes("pairing-token"), false);
      assert.equal(message.includes("Authorization"), false);
      assert.equal(logSafeFixError(error), `[AI] ${code}`);
    }
  });
});
