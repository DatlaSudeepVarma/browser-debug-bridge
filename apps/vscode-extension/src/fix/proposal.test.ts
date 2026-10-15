import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAKE_DIAGNOSIS, FakeAiProvider, FailingAiProvider, UnavailableAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { ManualCancellationToken } from "../project/cancellation.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { MAX_CHANGED_FILES, MAX_REPLACEMENT_CHARS } from "./constants.js";
import { FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { FixProposalService } from "./proposal.js";

function propose(provider: FakeAiProvider | FailingAiProvider | UnavailableAiProvider) {
  return new FixProposalService(provider).propose(
    createProjectIntelligenceSession(),
    createFixtureAiProjectContext(),
    FAKE_DIAGNOSIS,
  );
}

describe("fix proposal service", () => {
  it("returns a validated fake proposal and unified diff", async () => {
    const result = await propose(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)));
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.proposal.proposedChange.changes[0]?.relativePath, "src/services/checkout.ts");
    assert.equal(result.proposal.diff.text.includes("--- a/src/services/checkout.ts"), true);
    assert.equal(result.proposal.identity.sessionId, createProjectIntelligenceSession().sessionId);
  });

  it("returns AI_FIX_UNAVAILABLE when the provider is unavailable", async () => {
    const result = await propose(new UnavailableAiProvider());
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_UNAVAILABLE");
  });

  it("returns AI_FIX_REQUEST_FAILED when the provider fails", async () => {
    const result = await propose(new FailingAiProvider());
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_REQUEST_FAILED");
  });

  it("returns AI_FIX_CANCELLED when the token is already cancelled", async () => {
    const token = new ManualCancellationToken();
    token.cancel();
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL))).propose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      FAKE_DIAGNOSIS,
      token,
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_CANCELLED");
  });

  it("returns AI_FIX_RESPONSE_INVALID for malformed JSON", async () => {
    const result = await propose(new FakeAiProvider("not-json"));
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
  });

  it("rejects a traversal path from the model", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: [
            {
              relativePath: "../../secret.ts",
              edits: [{ startLine: 1, endLine: 1, replacement: "x" }],
            },
          ],
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
  });

  it("rejects a non-candidate path from the model", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: [
            {
              relativePath: "src/random-file.ts",
              edits: [{ startLine: 1, endLine: 1, replacement: "x" }],
            },
          ],
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
  });

  it("rejects too many files", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: Array.from({ length: MAX_CHANGED_FILES + 1 }, () => FAKE_FIX_PROPOSAL.changes[0]),
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_PROPOSAL_TOO_LARGE");
  });

  it("rejects an oversized replacement before generating a diff", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: [
            {
              relativePath: "src/services/checkout.ts",
              edits: [{ startLine: 2, endLine: 2, replacement: "x".repeat(MAX_REPLACEMENT_CHARS + 1) }],
            },
          ],
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_PROPOSAL_TOO_LARGE");
  });

  it("returns AI_FIX_CONTEXT_INSUFFICIENT when no excerpts are available", async () => {
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL))).propose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      {
        ...FAKE_DIAGNOSIS,
        hypotheses: [
          {
            title: "No files",
            explanation: "Nothing to edit",
            evidence: [],
            candidateFiles: [],
          },
        ],
      },
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_CONTEXT_INSUFFICIENT");
  });
});
