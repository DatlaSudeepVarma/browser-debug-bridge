import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EVIDENCE_DETAIL_LENGTH,
  MAX_EVIDENCE_PER_HYPOTHESIS,
  MAX_EXPLANATION_LENGTH,
  MAX_HYPOTHESES,
  MAX_DIAGNOSIS_SUMMARY_LENGTH,
} from "./constants.js";
import { FAKE_DIAGNOSIS } from "./fake-provider.js";
import { extractJsonObject, validateDiagnosis } from "./validation.js";

const EVIDENCE_IDS = ["BROWSER.network[0]", "PROJECT.candidate[0]"];
const PATHS = ["src/services/checkout.ts"];

describe("diagnosis output validation", () => {
  it("accepts the fake structured diagnosis", () => {
    const validated = validateDiagnosis(FAKE_DIAGNOSIS, EVIDENCE_IDS, PATHS);
    assert.equal(validated.diagnosis.hypotheses[0]?.candidateFiles[0]?.relativePath, "src/services/checkout.ts");
    assert.equal(validated.warnings.length, 0);
  });

  it("removes unknown file and evidence references", () => {
    const validated = validateDiagnosis(
      {
        ...FAKE_DIAGNOSIS,
        hypotheses: [
          {
            title: "Invented",
            explanation: "no",
            evidence: [
              { source: "BROWSER.network[0]", detail: "ok" },
              { source: "BROWSER.secret[9]", detail: "nope" },
            ],
            candidateFiles: [
              { relativePath: "src/services/checkout.ts", reason: "known" },
              { relativePath: "src/secret-file.ts", reason: "invented" },
            ],
          },
        ],
      },
      EVIDENCE_IDS,
      PATHS,
    );
    assert.deepEqual(
      validated.diagnosis.hypotheses[0]?.candidateFiles.map((item) => item.relativePath),
      ["src/services/checkout.ts"],
    );
    assert.deepEqual(
      validated.diagnosis.hypotheses[0]?.evidence.map((item) => item.source),
      ["BROWSER.network[0]"],
    );
    assert.equal(validated.warnings.some((item) => item.includes("src/secret-file.ts")), true);
    assert.equal(validated.warnings.some((item) => item.includes("BROWSER.secret[9]")), true);
  });

  it("enforces hypothesis, evidence, and string limits", () => {
    const hypotheses = Array.from({ length: MAX_HYPOTHESES + 2 }, (_, index) => ({
      title: `H${String(index)}`,
      explanation: "e".repeat(MAX_EXPLANATION_LENGTH + 20),
      evidence: Array.from({ length: MAX_EVIDENCE_PER_HYPOTHESIS + 2 }, () => ({
        source: "BROWSER.network[0]",
        detail: "d".repeat(MAX_EVIDENCE_DETAIL_LENGTH + 20),
      })),
      candidateFiles: [],
    }));
    const validated = validateDiagnosis(
      {
        summary: "s".repeat(MAX_DIAGNOSIS_SUMMARY_LENGTH + 30),
        hypotheses,
        suggestedNextStep: "next",
        limitations: ["one"],
      },
      EVIDENCE_IDS,
      PATHS,
    );
    assert.equal(validated.diagnosis.hypotheses.length, MAX_HYPOTHESES);
    assert.equal(validated.diagnosis.summary.length, MAX_DIAGNOSIS_SUMMARY_LENGTH);
    assert.equal(validated.diagnosis.hypotheses[0]?.explanation.length, MAX_EXPLANATION_LENGTH);
    assert.equal(validated.diagnosis.hypotheses[0]?.evidence.length, MAX_EVIDENCE_PER_HYPOTHESIS);
    assert.equal(
      validated.diagnosis.hypotheses[0]?.evidence[0]?.detail.length,
      MAX_EVIDENCE_DETAIL_LENGTH,
    );
  });

  it("rejects malformed JSON", () => {
    assert.throws(() => extractJsonObject("not json"), /JSON object/);
    assert.throws(() => extractJsonObject("[]"), /JSON object/);
  });

  it("extracts JSON from a fenced block", () => {
    const parsed = extractJsonObject(`here\n\`\`\`json\n${JSON.stringify(FAKE_DIAGNOSIS)}\n\`\`\``);
    assert.equal((parsed as { summary: string }).summary.includes("checkout"), true);
  });
});
