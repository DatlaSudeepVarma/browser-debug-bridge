import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeDebugSessionV1 } from "@browser-debug-bridge/schema";
import type { AiAnalysisResult, Diagnosis } from "../ai/types.js";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { ManualCancellationToken } from "../project/cancellation.js";
import type { ProjectContextResult } from "../project/types.js";
import { DiagnosisController } from "./diagnosis-state.js";
import { runDiagnosis, type DiagnosisRunDependencies } from "./run-diagnosis.js";

function okResult(diagnosis: Diagnosis = FAKE_DIAGNOSIS): Extract<AiAnalysisResult, { status: "ok" }> {
  return {
    status: "ok",
    diagnosis,
    providerId: "fake",
    warnings: [],
    contextChars: 100,
    candidateCount: 3,
  };
}

function deps(options: {
  session?: boolean;
  analysis?: ProjectContextResult;
  diagnose?: () => Promise<AiAnalysisResult>;
  createSession?: boolean;
}): DiagnosisRunDependencies {
  const project = createFixtureAiProjectContext();
  return {
    getLatestSession: () => (options.session === false ? undefined : createFakeDebugSessionV1()),
    createSessionIfMissing: options.createSession === true ? () => createFakeDebugSessionV1() : undefined,
    analyze: async () => options.analysis ?? { status: "ok", context: project },
    diagnose: options.diagnose ?? (async () => okResult()),
  };
}

describe("diagnosis run transaction", () => {
  it("replaces the previous diagnosis after success", async () => {
    const controller = new DiagnosisController();
    controller.setDiagnosis({
      diagnosis: { ...FAKE_DIAGNOSIS, summary: "old" },
      project: createFixtureAiProjectContext(),
      providerId: "old",
      warnings: [],
    });
    const outcome = await runDiagnosis(
      controller,
      deps({
        diagnose: async () => okResult({ ...FAKE_DIAGNOSIS, summary: "new" }),
      }),
      { allowCreateSession: false },
    );
    assert.equal(outcome.status, "replaced");
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, "new");
  });

  it("preserves the previous diagnosis after failure", async () => {
    const controller = new DiagnosisController();
    controller.setDiagnosis({
      diagnosis: { ...FAKE_DIAGNOSIS, summary: "old" },
      project: createFixtureAiProjectContext(),
      providerId: "old",
      warnings: [],
    });
    const outcome = await runDiagnosis(
      controller,
      deps({
        diagnose: async () => ({
          status: "error",
          providerId: "fake",
          error: { code: "AI_UNAVAILABLE", message: "No language model is available." },
        }),
      }),
      { allowCreateSession: false },
    );
    assert.equal(outcome.status, "preserved");
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, "old");
  });

  it("preserves the previous diagnosis after cancellation", async () => {
    const controller = new DiagnosisController();
    controller.setDiagnosis({
      diagnosis: { ...FAKE_DIAGNOSIS, summary: "old" },
      project: createFixtureAiProjectContext(),
      providerId: "old",
      warnings: [],
    });
    const token = new ManualCancellationToken();
    token.cancel();
    const outcome = await runDiagnosis(controller, deps({}), { allowCreateSession: false }, token);
    assert.equal(outcome.status, "cancelled");
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, "old");
  });

  it("preserves the previous diagnosis when the provider reports AI_CANCELLED", async () => {
    const controller = new DiagnosisController();
    controller.setDiagnosis({
      diagnosis: { ...FAKE_DIAGNOSIS, summary: "old" },
      project: createFixtureAiProjectContext(),
      providerId: "old",
      warnings: [],
    });
    const outcome = await runDiagnosis(
      controller,
      deps({
        diagnose: async () => ({
          status: "error",
          providerId: "fake",
          error: { code: "AI_CANCELLED", message: "The diagnosis request was cancelled." },
        }),
      }),
      { allowCreateSession: false },
    );
    assert.equal(outcome.status, "preserved");
    assert.equal(controller.getDiagnosis()?.diagnosis.summary, "old");
  });

  it("does not create a session when refresh has none stored", async () => {
    const controller = new DiagnosisController();
    let created = false;
    const outcome = await runDiagnosis(
      controller,
      {
        ...deps({ session: false }),
        createSessionIfMissing: () => {
          created = true;
          return createFakeDebugSessionV1();
        },
      },
      { allowCreateSession: false },
    );
    assert.equal(outcome.status, "no-session");
    assert.equal(created, false);
    assert.equal(controller.getDiagnosis(), undefined);
  });
});
