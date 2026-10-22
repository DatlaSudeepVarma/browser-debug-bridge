import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReviewFixRefusal, ReviewFixRefusalCode } from "../fix/review-fix.js";
import { logSafeReviewError, userFacingReviewError } from "./review-errors.js";

const CODES: ReviewFixRefusalCode[] = [
  "APPLY_NO_PROPOSAL",
  "APPLY_IDENTITY_MISMATCH",
  "APPLY_DIAGNOSIS_MISMATCH",
  "APPLY_PATH_REJECTED",
  "APPLY_CANONICAL_REJECTED",
  "APPLY_FILE_MISSING",
  "APPLY_SOURCE_STALE",
  "APPLY_SOURCE_CHANGED",
  "APPLY_EDIT_INVALID",
  "APPLY_PROPOSAL_MALFORMED",
  "APPLY_TEXT_AMBIGUOUS",
  "REVIEW_NO_DIAGNOSIS",
  "REVIEW_SOURCE_DIRTY",
  "REVIEW_DIFF_FAILED",
];

describe("review error mapping", () => {
  it("maps every review refusal to a user-facing message without leaking secrets", () => {
    for (const code of CODES) {
      const reason: ReviewFixRefusal = {
        code,
        message: "secret prompt Authorization: Bearer pairing-token src/services/checkout.ts",
      };
      const message = userFacingReviewError(reason);
      assert.equal(message.length > 0, true);
      assert.equal(message.includes("secret prompt"), false);
      assert.equal(message.includes("pairing-token"), false);
      assert.equal(message.includes("Authorization"), false);
      assert.equal(logSafeReviewError(reason), `[Review] ${code}`);
    }
  });
});
