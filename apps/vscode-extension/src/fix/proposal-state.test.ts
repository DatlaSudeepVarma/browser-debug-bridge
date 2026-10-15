import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeDebugSessionV1 } from "@browser-debug-bridge/schema";
import { FAKE_DIAGNOSIS, FakeAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { ManualCancellationToken } from "../project/cancellation.js";
import { DiagnosisController } from "../ui/diagnosis-state.js";
import { runDiagnosis } from "../ui/run-diagnosis.js";
import { FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { FixProposalService } from "./proposal.js";
import { FixProposalController } from "./proposal-state.js";
import { runFixProposal } from "./run-proposal.js";
import { fixtureDiagnosisState } from "./test-support.js";
import type { StoredProposal } from "./types.js";

async function successfulProposal(): Promise<StoredProposal> {
  const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL))).propose(
    fixtureDiagnosisState().session,
    fixtureDiagnosisState().project,
    FAKE_DIAGNOSIS,
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected proposal");
  }
  return result.proposal;
}

describe("fix proposal state", () => {
  it("starts with no proposal", () => {
    const controller = new FixProposalController();
    assert.equal(controller.getProposal(), undefined);
    assert.equal(controller.getTreeState().lastOutcome, "none");
  });

  it("stores a successful proposal", async () => {
    const controller = new FixProposalController();
    const outcome = await runFixProposal(
      fixtureDiagnosisState(),
      controller,
      async () => ({
        status: "ok",
        providerId: "fake",
        contextChars: 12,
        fileCount: 1,
        proposal: await successfulProposal(),
      }),
    );
    assert.equal(outcome.status, "replaced");
    assert.equal(controller.getProposal()?.proposedChange.summary, FAKE_FIX_PROPOSAL.summary);
  });

  it("does not overwrite a valid proposal after failure", async () => {
    const controller = new FixProposalController();
    const proposal = await successfulProposal();
    controller.applySuccess(proposal);
    const outcome = await runFixProposal(fixtureDiagnosisState(), controller, async () => ({
      status: "error",
      providerId: "fake",
      error: { code: "AI_FIX_UNAVAILABLE", message: "No language model is available." },
    }));
    assert.equal(outcome.status, "preserved");
    assert.equal(controller.getProposal()?.proposedChange.summary, FAKE_FIX_PROPOSAL.summary);
    assert.equal(controller.getTreeState().lastOutcome, "failed");
  });

  it("does not create a proposal on cancellation", async () => {
    const controller = new FixProposalController();
    const token = new ManualCancellationToken();
    token.cancel();
    const outcome = await runFixProposal(
      fixtureDiagnosisState(),
      controller,
      async () => ({
        status: "ok",
        providerId: "fake",
        contextChars: 1,
        fileCount: 1,
        proposal: await successfulProposal(),
      }),
      token,
    );
    assert.equal(outcome.status, "cancelled");
    assert.equal(controller.getProposal(), undefined);
  });

  it("clears the proposal when diagnosis is cleared", async () => {
    const controller = new FixProposalController();
    controller.applySuccess(await successfulProposal());
    controller.clear();
    assert.equal(controller.getProposal(), undefined);
  });

  it("invalidates the old proposal before a new diagnosis is exposed", async () => {
    const diagnosis = new DiagnosisController();
    const proposal = new FixProposalController();
    proposal.applySuccess(await successfulProposal());
    diagnosis.setDiagnosis(fixtureDiagnosisState({ ...FAKE_DIAGNOSIS, summary: "old" }));
    const outcome = await runDiagnosis(
      diagnosis,
      {
        getLatestSession: () => createFakeDebugSessionV1(),
        analyze: async () => ({ status: "ok", context: createFixtureAiProjectContext() }),
        diagnose: async () => ({
          status: "ok",
          diagnosis: { ...FAKE_DIAGNOSIS, summary: "new" },
          providerId: "fake",
          warnings: [],
          contextChars: 10,
          candidateCount: 1,
        }),
      },
      { allowCreateSession: false, proposalController: proposal },
    );
    assert.equal(outcome.status, "replaced");
    assert.equal(diagnosis.getDiagnosis()?.diagnosis.summary, "new");
    assert.equal(proposal.getProposal(), undefined);
  });
});
