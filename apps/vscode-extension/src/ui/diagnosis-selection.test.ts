import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeDebugSessionV1, parseDebugSession } from "@browser-debug-bridge/schema";
import { FixProposalController } from "../fix/proposal-state.js";
import type { StoredProposal } from "../fix/types.js";
import { SessionStore } from "../bridge/session-store.js";
import { ManualCancellationToken } from "../project/cancellation.js";
import { DiagnosisController } from "./diagnosis-state.js";
import { clearDiagnosisView, selectDiagnosisSession } from "./diagnosis-selection.js";
import { runDiagnosis } from "./run-diagnosis.js";
import { fixtureDiagnosisState } from "../fix/test-support.js";

function sourceFor(store: SessionStore) {
  return {
    getSession(sessionId: string) {
      return store.get(sessionId)?.session;
    },
    latestCapturedSession() {
      return store.latest("captured")?.session;
    },
    latestSyntheticSession() {
      return store.latest("synthetic")?.session;
    },
  };
}

describe("diagnosis session selection", () => {
  it("keeps Diagnose Latest on the captured session when a synthetic session arrives later", () => {
    const store = new SessionStore();
    const captured = parseDebugSession({
      ...createFakeDebugSessionV1(),
      browser: { ...createFakeDebugSessionV1().browser, version: "120.0.0" },
    });
    const synthetic = createFakeDebugSessionV1();
    store.add(captured, 1, "captured");
    store.add(synthetic, 2, "synthetic");
    const source = sourceFor(store);
    assert.equal(selectDiagnosisSession({ source: "captured" }, source)?.sessionId, captured.sessionId);
    assert.equal(
      selectDiagnosisSession({ source: "synthetic", allowCreate: false }, source)?.sessionId,
      synthetic.sessionId,
    );
    assert.equal(selectDiagnosisSession({ source: "id", sessionId: captured.sessionId }, source)?.sessionId, captured.sessionId);
    assert.equal(selectDiagnosisSession({ source: "captured" }, undefined), undefined);
  });

  it("does not create a session when refresh has only a synthetic session", async () => {
    const store = new SessionStore();
    store.add(createFakeDebugSessionV1(), 1, "synthetic");
    const source = sourceFor(store);
    assert.equal(selectDiagnosisSession({ source: "captured" }, source), undefined);
    let created = false;
    const outcome = await runDiagnosis(
      new DiagnosisController(),
      {
        getLatestSession: () => selectDiagnosisSession({ source: "captured" }, source),
        createSessionIfMissing: () => {
          created = true;
          return createFakeDebugSessionV1();
        },
        analyze: async () => ({ status: "cancelled" }),
        diagnose: async () => {
          throw new Error("diagnosis must not run");
        },
      },
      { allowCreateSession: false },
      new ManualCancellationToken(),
    );
    assert.equal(outcome.status, "no-session");
    assert.equal(created, false);
  });

  it("clears the diagnosis and proposal, and refuses while apply is running", () => {
    const diagnosis = new DiagnosisController();
    diagnosis.setDiagnosis(fixtureDiagnosisState());
    const proposals = new FixProposalController();
    proposals.applySuccess({ createdAt: "proposal" } as StoredProposal);
    let previewClears = 0;
    assert.equal(
      clearDiagnosisView({
        diagnosis,
        proposals,
        clearPreview: () => {
          previewClears += 1;
        },
      }),
      "cleared",
    );
    assert.equal(diagnosis.getDiagnosis(), undefined);
    assert.equal(proposals.getProposal(), undefined);
    assert.equal(previewClears, 1);

    diagnosis.setDiagnosis(fixtureDiagnosisState());
    proposals.applySuccess({ createdAt: "proposal" } as StoredProposal);
    assert.equal(proposals.beginApply(), true);
    assert.equal(
      clearDiagnosisView({
        diagnosis,
        proposals,
        clearPreview: () => {
          previewClears += 1;
        },
      }),
      "busy",
    );
    assert.equal(diagnosis.getDiagnosis()?.diagnosis.summary, fixtureDiagnosisState().diagnosis.summary);
    assert.equal(proposals.getProposal()?.createdAt, "proposal");
    assert.equal(previewClears, 1);

    const running = new DiagnosisController();
    running.setDiagnosis(fixtureDiagnosisState());
    assert.equal(running.beginRun(), true);
    assert.equal(
      clearDiagnosisView({
        diagnosis: running,
        proposals: new FixProposalController(),
        clearPreview: () => {
          previewClears += 1;
        },
      }),
      "busy",
    );
    assert.equal(running.getDiagnosis()?.diagnosis.summary, fixtureDiagnosisState().diagnosis.summary);
    assert.equal(previewClears, 1);
  });
});
