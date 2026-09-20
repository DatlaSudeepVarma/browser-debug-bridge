import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ManualCancellationToken } from "../project/cancellation.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { MAX_AI_RESPONSE_CHARS } from "./constants.js";
import { DiagnosisService } from "./diagnosis.js";
import { mapLanguageModelFailure } from "./errors.js";
import { FAKE_DIAGNOSIS, FakeAiProvider, FailingAiProvider, UnavailableAiProvider } from "./fake-provider.js";
import { pickDeterministicIdentity } from "./model-select.js";
import { formatDiagnosisSummary } from "./summary.js";
import { createFixtureAiProjectContext } from "./test-support.js";

describe("diagnosis service", () => {
  it("returns the fake provider diagnosis after validation", async () => {
    const service = new DiagnosisService(new FakeAiProvider());
    const result = await service.diagnose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
    );
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.providerId, "fake");
    assert.equal(result.diagnosis.summary, FAKE_DIAGNOSIS.summary);
    assert.equal(result.diagnosis.hypotheses[0]?.candidateFiles[0]?.relativePath, "src/services/checkout.ts");
    const summary = formatDiagnosisSummary(result);
    assert.equal(summary.includes("AI provider: fake"), true);
    assert.equal(summary.includes("src/services/checkout.ts"), true);
    assert.equal(summary.includes(FAKE_BUY_NOW_SOURCE), false);
  });

  it("returns AI_UNAVAILABLE when the provider is unavailable", async () => {
    const result = await new DiagnosisService(new UnavailableAiProvider()).diagnose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_UNAVAILABLE");
  });

  it("returns AI_REQUEST_FAILED when the provider fails", async () => {
    const result = await new DiagnosisService(new FailingAiProvider()).diagnose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_REQUEST_FAILED");
  });

  it("returns AI_RESPONSE_TOO_LARGE when the model text exceeds the bound", async () => {
    const result = await new DiagnosisService(
      new FailingAiProvider("x".repeat(MAX_AI_RESPONSE_CHARS + 8)),
    ).diagnose(createProjectIntelligenceSession(), createFixtureAiProjectContext());
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_RESPONSE_TOO_LARGE");
  });

  it("returns AI_RESPONSE_INVALID for malformed JSON", async () => {
    const result = await new DiagnosisService(new FailingAiProvider("not-json")).diagnose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_RESPONSE_INVALID");
  });

  it("returns AI_CANCELLED when the token is already cancelled", async () => {
    const token = new ManualCancellationToken();
    token.cancel();
    const result = await new DiagnosisService(new FakeAiProvider()).diagnose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      token,
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_CANCELLED");
  });

  it("returns AI_CONTEXT_TOO_LARGE when the serialized budget cannot be met", async () => {
    const result = await new DiagnosisService(new FakeAiProvider(), {
      serializeLimits: { maxChars: 20, maxProjectFiles: 1, maxExcerptLines: 1, maxDomChars: 10 },
    }).diagnose(createProjectIntelligenceSession(), createFixtureAiProjectContext());
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_CONTEXT_TOO_LARGE");
  });

  it("maps language-model permission failures to AI_UNAVAILABLE", () => {
    assert.equal(mapLanguageModelFailure("NoPermissions").code, "AI_UNAVAILABLE");
    assert.equal(mapLanguageModelFailure("NotFound").code, "AI_UNAVAILABLE");
    assert.equal(mapLanguageModelFailure("Blocked").code, "AI_REQUEST_FAILED");
  });

  it("picks a language model deterministically without ranking quality", () => {
    const picked = pickDeterministicIdentity([
      { vendor: "copilot", family: "gpt-4", id: "b" },
      { vendor: "copilot", family: "gpt-4", id: "a" },
      { vendor: "other", family: "local", id: "z" },
    ]);
    assert.deepEqual(picked, { vendor: "copilot", family: "gpt-4", id: "a" });
  });
});

const FAKE_BUY_NOW_SOURCE = "export function BuyNowButton";
