import {
  MAX_CANDIDATE_FILES_PER_HYPOTHESIS,
  MAX_CANDIDATE_REASON_LENGTH,
  MAX_DIAGNOSIS_SUMMARY_LENGTH,
  MAX_EVIDENCE_DETAIL_LENGTH,
  MAX_EVIDENCE_PER_HYPOTHESIS,
  MAX_EXPLANATION_LENGTH,
  MAX_HYPOTHESES,
  MAX_HYPOTHESIS_TITLE_LENGTH,
  MAX_LIMITATIONS,
  MAX_LIMITATION_LENGTH,
  MAX_NEXT_STEP_LENGTH,
} from "./constants.js";
import { clipAiText } from "./sanitize.js";
import type {
  Diagnosis,
  DiagnosisCandidateRef,
  DiagnosisEvidence,
  DiagnosisHypothesis,
} from "./types.js";

export interface ValidatedDiagnosis {
  diagnosis: Diagnosis;
  warnings: string[];
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fence?.[1] ?? trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Response did not contain a JSON object.");
  }
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

export function isAllowedEvidenceId(source: string, evidenceIds: readonly string[]): boolean {
  return evidenceIds.includes(source);
}

export function validateDiagnosis(
  raw: unknown,
  evidenceIds: readonly string[],
  candidatePaths: readonly string[],
): ValidatedDiagnosis {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Diagnosis must be a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const allowed = new Set(candidatePaths);

  const hypothesesRaw = asArray(record.hypotheses).slice(0, MAX_HYPOTHESES);
  if (asArray(record.hypotheses).length > MAX_HYPOTHESES) {
    warnings.push("Extra hypotheses were dropped.");
  }

  const hypotheses: DiagnosisHypothesis[] = [];
  for (const item of hypothesesRaw) {
    const hypothesis = readHypothesis(item, evidenceIds, allowed, warnings);
    if (hypothesis !== undefined) {
      hypotheses.push(hypothesis);
    }
  }

  const limitations = asStringArray(record.limitations)
    .slice(0, MAX_LIMITATIONS)
    .map((item) => clipAiText(item, MAX_LIMITATION_LENGTH))
    .filter((item) => item.length > 0);
  if (asStringArray(record.limitations).length > MAX_LIMITATIONS) {
    warnings.push("Extra limitations were dropped.");
  }

  return {
    diagnosis: {
      summary: clipAiText(readString(record.summary), MAX_DIAGNOSIS_SUMMARY_LENGTH),
      hypotheses,
      suggestedNextStep: clipAiText(readString(record.suggestedNextStep), MAX_NEXT_STEP_LENGTH),
      limitations,
    },
    warnings,
  };
}

function readHypothesis(
  value: unknown,
  evidenceIds: readonly string[],
  allowedPaths: ReadonlySet<string>,
  warnings: string[],
): DiagnosisHypothesis | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push("A hypothesis was dropped because it was not an object.");
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const evidenceRaw = asArray(record.evidence);
  if (evidenceRaw.length > MAX_EVIDENCE_PER_HYPOTHESIS) {
    warnings.push("Extra evidence items were dropped.");
  }
  const evidence: DiagnosisEvidence[] = [];
  for (const item of evidenceRaw.slice(0, MAX_EVIDENCE_PER_HYPOTHESIS)) {
    const parsed = readEvidence(item, evidenceIds, warnings);
    if (parsed !== undefined) {
      evidence.push(parsed);
    }
  }

  const filesRaw = asArray(record.candidateFiles);
  const candidateFiles: DiagnosisCandidateRef[] = [];
  for (const item of filesRaw.slice(0, MAX_CANDIDATE_FILES_PER_HYPOTHESIS)) {
    const parsed = readCandidateRef(item, allowedPaths, warnings);
    if (parsed !== undefined) {
      candidateFiles.push(parsed);
    }
  }

  return {
    title: clipAiText(readString(record.title), MAX_HYPOTHESIS_TITLE_LENGTH),
    explanation: clipAiText(readString(record.explanation), MAX_EXPLANATION_LENGTH),
    evidence,
    candidateFiles,
  };
}

function readEvidence(
  value: unknown,
  evidenceIds: readonly string[],
  warnings: string[],
): DiagnosisEvidence | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const source = readString(record.source);
  if (!isAllowedEvidenceId(source, evidenceIds)) {
    warnings.push(`Unknown evidence reference removed: ${source || "(empty)"}`);
    return undefined;
  }
  return {
    source,
    detail: clipAiText(readString(record.detail), MAX_EVIDENCE_DETAIL_LENGTH),
  };
}

function readCandidateRef(
  value: unknown,
  allowedPaths: ReadonlySet<string>,
  warnings: string[],
): DiagnosisCandidateRef | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const relativePath = readString(record.relativePath);
  if (!allowedPaths.has(relativePath)) {
    warnings.push(`Unknown file reference removed: ${relativePath || "(empty)"}`);
    return undefined;
  }
  return {
    relativePath,
    reason: clipAiText(readString(record.reason), MAX_CANDIDATE_REASON_LENGTH),
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}
