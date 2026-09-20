import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import type { CancellationTokenLike, ProjectContext } from "../project/types.js";

export type AiErrorCode =
  | "AI_UNAVAILABLE"
  | "AI_REQUEST_FAILED"
  | "AI_RESPONSE_INVALID"
  | "AI_RESPONSE_TOO_LARGE"
  | "AI_CANCELLED"
  | "AI_CONTEXT_TOO_LARGE";

export interface AiError {
  code: AiErrorCode;
  message: string;
}

export interface DiagnosisEvidence {
  source: string;
  detail: string;
}

export interface DiagnosisCandidateRef {
  relativePath: string;
  reason: string;
}

export interface DiagnosisHypothesis {
  title: string;
  explanation: string;
  evidence: DiagnosisEvidence[];
  candidateFiles: DiagnosisCandidateRef[];
}

export interface Diagnosis {
  summary: string;
  hypotheses: DiagnosisHypothesis[];
  suggestedNextStep: string;
  limitations: string[];
}

export interface AiAnalysisRequest {
  session: DebugSessionV1;
  project: ProjectContext;
}

export interface SerializedAiContext {
  text: string;
  evidenceIds: string[];
  candidatePaths: string[];
  charCount: number;
  truncated: boolean;
  candidateCount: number;
}

export type SerializeAiContextResult =
  | { status: "ok"; context: SerializedAiContext }
  | { status: "too-large" }
  | { status: "cancelled" };

export type AiCompletionResult =
  | { status: "ok"; text: string }
  | { status: "error"; error: AiError };

export type AiAnalysisResult =
  | {
      status: "ok";
      diagnosis: Diagnosis;
      providerId: string;
      warnings: string[];
      contextChars: number;
      candidateCount: number;
    }
  | { status: "error"; error: AiError; providerId: string };

export interface AiChatInput {
  system: string;
  user: string;
}

export interface AiProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  complete(input: AiChatInput, cancellationToken?: CancellationTokenLike): Promise<AiCompletionResult>;
}
