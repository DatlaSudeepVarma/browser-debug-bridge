import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiError, AiErrorCode } from "../ai/types.js";
import { logSafeAiError, userFacingAiError } from "./ai-errors.js";

const CODES: AiErrorCode[] = [
  "AI_UNAVAILABLE",
  "AI_REQUEST_FAILED",
  "AI_RESPONSE_INVALID",
  "AI_RESPONSE_TOO_LARGE",
  "AI_CANCELLED",
  "AI_CONTEXT_TOO_LARGE",
];

describe("AI error mapping", () => {
  it("maps every AI error category to a user-facing message", () => {
    for (const code of CODES) {
      const error: AiError = {
        code,
        message: "secret prompt http://localhost Authorization: Bearer pairing-token",
      };
      const message = userFacingAiError(error);
      assert.equal(message.includes(code) || message.length > 0, true);
      assert.equal(message.includes("secret prompt"), false);
      assert.equal(message.includes("pairing-token"), false);
      assert.equal(message.includes("Authorization"), false);
      assert.equal(message.includes("http://localhost"), false);
    }
  });

  it("keeps developer logs to the error code only", () => {
    for (const code of CODES) {
      const line = logSafeAiError({
        code,
        message: "model said inspect src/services/checkout.ts",
      });
      assert.equal(line, `[AI] ${code}`);
      assert.equal(line.includes("checkout.ts"), false);
    }
  });
});
