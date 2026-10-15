import type { Diagnosis } from "../ai/types.js";
import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import type { ProjectContext } from "../project/types.js";

export type FixErrorCode =
  | "AI_FIX_UNAVAILABLE"
  | "AI_FIX_REQUEST_FAILED"
  | "AI_FIX_RESPONSE_INVALID"
  | "AI_FIX_RESPONSE_TOO_LARGE"
  | "AI_FIX_CONTEXT_TOO_LARGE"
  | "AI_FIX_CONTEXT_INSUFFICIENT"
  | "AI_FIX_PROPOSAL_TOO_LARGE"
  | "AI_DIFF_INVALID"
  | "AI_FIX_CANCELLED";

export interface FixError {
  code: FixErrorCode;
  message: string;
}

export interface ProposedEdit {
  startLine: number;
  endLine: number;
  replacement: string;
}

export interface ProposedFileChange {
  relativePath: string;
  originalContentHash: string;
  edits: ProposedEdit[];
}

export interface ProposedChange {
  summary: string;
  rationale: string;
  changes: ProposedFileChange[];
}

export interface ValidatedUnifiedDiff {
  text: string;
  fileCount: number;
  editCount: number;
  lineCount: number;
  paths: string[];
}

export interface ProposalIdentity {
  sessionId: string;
  diagnosisFingerprint: string;
  sourceFingerprint: string;
}

export interface StoredProposal {
  proposedChange: ProposedChange;
  diff: ValidatedUnifiedDiff;
  identity: ProposalIdentity;
  createdAt: string;
  providerId: string;
}

export interface SerializedFixContext {
  text: string;
  allowedPaths: string[];
  sourceFingerprint: string;
  charCount: number;
  truncated: boolean;
  fileCount: number;
}

export type SerializeFixContextResult =
  | { status: "ok"; context: SerializedFixContext }
  | { status: "too-large" }
  | { status: "insufficient" }
  | { status: "cancelled" };

export type FixProposalResult =
  | {
      status: "ok";
      proposal: StoredProposal;
      providerId: string;
      contextChars: number;
      fileCount: number;
    }
  | { status: "error"; error: FixError; providerId: string };

export interface FixProposalRequest {
  session: DebugSessionV1;
  project: ProjectContext;
  diagnosis: Diagnosis;
}
