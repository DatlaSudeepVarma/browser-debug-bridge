import { createHash } from "node:crypto";
import type { Diagnosis } from "../ai/types.js";

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function diagnosisFingerprint(diagnosis: Diagnosis): string {
  return sha256Utf8(
    JSON.stringify({
      summary: diagnosis.summary,
      hypotheses: diagnosis.hypotheses.map((hypothesis) => ({
        title: hypothesis.title,
        explanation: hypothesis.explanation,
        evidence: hypothesis.evidence.map((item) => ({
          source: item.source,
          detail: item.detail,
        })),
        candidateFiles: hypothesis.candidateFiles.map((file) => ({
          relativePath: file.relativePath,
          reason: file.reason,
        })),
      })),
      suggestedNextStep: diagnosis.suggestedNextStep,
      limitations: diagnosis.limitations,
    }),
  );
}
