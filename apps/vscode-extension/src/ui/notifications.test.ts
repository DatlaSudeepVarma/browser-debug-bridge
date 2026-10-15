import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { FAKE_FIX_PROPOSAL } from "../fix/fake-proposal.js";
import type { FixProposalRunOutcome } from "../fix/run-proposal.js";
import { diagnosisLogLines, diagnosisUserNotice, fixProposalLogLines, fixProposalUserNotice } from "./notifications.js";
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

describe("fix proposal notifications", () => {
  it("logs technical fields without source or model text", () => {
    const outcome: FixProposalRunOutcome = {
      status: "replaced",
      result: {
        status: "ok",
        providerId: "vscode.lm",
        contextChars: 99,
        fileCount: 1,
        proposal: {
          proposedChange: {
            summary: FAKE_FIX_PROPOSAL.summary,
            rationale: FAKE_FIX_PROPOSAL.rationale,
            changes: [],
          },
          diff: { text: "--- a/src/services/checkout.ts\n", fileCount: 1, editCount: 1, lineCount: 1, paths: [] },
          identity: { sessionId: "id", diagnosisFingerprint: "a", sourceFingerprint: "b" },
          createdAt: "2026-01-01T00:00:00.000Z",
          providerId: "vscode.lm",
        },
      },
    };
    const joined = fixProposalLogLines(outcome).join("\n");
    assert.equal(joined.includes("[AI] Provider: vscode.lm"), true);
    assert.equal(joined.includes("Fix files: 1"), true);
    assert.equal(joined.includes(FAKE_FIX_PROPOSAL.summary), false);
    assert.equal(joined.includes("checkout.ts"), false);
  });

  it("maps preserved fix errors without leaking model text", () => {
    const notice = fixProposalUserNotice({
      status: "preserved",
      result: {
        status: "error",
        providerId: "vscode.lm",
        error: { code: "AI_FIX_RESPONSE_INVALID", message: FAKE_FIX_PROPOSAL.summary },
      },
    });
    assert.equal(notice.kind, "warn");
    assert.equal(notice.message.includes(FAKE_FIX_PROPOSAL.summary), false);
  });
});
