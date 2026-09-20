import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { diagnosisLogLines, diagnosisUserNotice } from "./notifications.js";
import type { DiagnosisRunOutcome } from "./run-diagnosis.js";

const replaced: DiagnosisRunOutcome = {
  status: "replaced",
  result: {
    status: "ok",
    diagnosis: FAKE_DIAGNOSIS,
    providerId: "vscode.lm",
    warnings: [],
    contextChars: 42,
    candidateCount: 3,
  },
};

describe("diagnosis notifications", () => {
  it("logs technical fields without model text or secrets", () => {
    const lines = diagnosisLogLines(replaced);
    const joined = lines.join("\n");
    assert.equal(joined.includes("[AI] Provider: vscode.lm"), true);
    assert.equal(joined.includes("Candidates: 3"), true);
    assert.equal(joined.includes(FAKE_DIAGNOSIS.summary), false);
    assert.equal(joined.includes("checkout.ts"), false);
    assert.equal(joined.includes("Authorization"), false);
  });

  it("maps preserved AI errors to user-facing warnings", () => {
    const notice = diagnosisUserNotice({
      status: "preserved",
      result: {
        status: "error",
        providerId: "vscode.lm",
        error: { code: "AI_RESPONSE_INVALID", message: FAKE_DIAGNOSIS.summary },
      },
    });
    assert.equal(notice.kind, "warn");
    assert.equal(notice.message.includes(FAKE_DIAGNOSIS.summary), false);
    assert.equal(notice.message.includes("previous diagnosis"), true);
  });
});
