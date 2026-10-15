import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeDebugSessionV1 } from "@browser-debug-bridge/schema";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { DiagnosisController } from "./diagnosis-state.js";

function sampleState() {
  return {
    diagnosis: FAKE_DIAGNOSIS,
    project: createFixtureAiProjectContext(),
    session: createFakeDebugSessionV1(),
    providerId: "fake",
    warnings: [],
  };
}

describe("diagnosis controller state", () => {
  it("starts empty", () => {
    const controller = new DiagnosisController();
    assert.equal(controller.getDiagnosis(), undefined);
    assert.equal(controller.isRunning(), false);
  });

  it("sets and returns the current diagnosis", () => {
    const controller = new DiagnosisController();
    const state = sampleState();
    controller.setDiagnosis(state);
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, FAKE_DIAGNOSIS.summary);
    assert.equal(controller.getDiagnosis()?.providerId, "fake");
  });

  it("clears the in-memory diagnosis without touching files", () => {
    const controller = new DiagnosisController();
    controller.setDiagnosis(sampleState());
    const generation = controller.getGeneration();
    controller.clearDiagnosis();
    assert.equal(controller.getDiagnosis(), undefined);
    assert.equal(controller.getGeneration() > generation, true);
  });

  it("replaces only on a successful analysis result", () => {
    const controller = new DiagnosisController();
    controller.setDiagnosis(sampleState());
    const preserved = controller.applyResult(
      {
        status: "error",
        providerId: "vscode.lm",
        error: { code: "AI_UNAVAILABLE", message: "No language model is available." },
      },
      createFixtureAiProjectContext(),
      createFakeDebugSessionV1(),
    );
    assert.equal(preserved, "preserved");
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, FAKE_DIAGNOSIS.summary);

    const replaced = controller.applyResult(
      {
        status: "ok",
        diagnosis: { ...FAKE_DIAGNOSIS, summary: "Updated summary" },
        providerId: "vscode.lm",
        warnings: [],
        contextChars: 12,
        candidateCount: 1,
      },
      createFixtureAiProjectContext(),
      createFakeDebugSessionV1(),
    );
    assert.equal(replaced, "replaced");
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, "Updated summary");
  });
});
