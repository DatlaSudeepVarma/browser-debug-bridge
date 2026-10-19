import type { Diagnosis } from "../ai/types.js";
import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import type { ProjectContext } from "../project/types.js";
import type { FixPathRejection } from "./paths.js";

export type FixErrorCode =
  | "AI_FIX_UNAVAILABLE"
  | "AI_FIX_REQUEST_FAILED"
  | "AI_FIX_RESPONSE_INVALID"
  | "AI_FIX_RESPONSE_TOO_LARGE"
  | "AI_FIX_CONTEXT_TOO_LARGE"
  | "AI_FIX_CONTEXT_INSUFFICIENT"
  | "AI_FIX_PROPOSAL_TOO_LARGE"
  | "AI_DIFF_INVALID"
  | "AI_FIX_SOURCE_UNAVAILABLE"
  | "AI_FIX_SOURCE_CHANGED"
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
  /**
   * Host-computed SHA-256 of each proposed file's complete UTF-8 text at
   * proposal time. Distinct from ProposedFileChange.originalContentHash,
   * which remains an excerpt digest. Absent on legacy in-memory proposals.
   */
  liveFileHashes?: Readonly<Record<string, string>>;
}

export type ApplyPlanErrorCode =
  | "APPLY_NO_PROPOSAL"
  | "APPLY_IDENTITY_MISMATCH"
  | "APPLY_DIAGNOSIS_MISMATCH"
  | "APPLY_PATH_REJECTED"
  | "APPLY_CANONICAL_REJECTED"
  | "APPLY_FILE_MISSING"
  | "APPLY_SOURCE_STALE"
  | "APPLY_SOURCE_CHANGED"
  | "APPLY_EDIT_INVALID"
  | "APPLY_PROPOSAL_MALFORMED"
  | "APPLY_TEXT_AMBIGUOUS";

export interface ApplyPlanRefusal {
  code: ApplyPlanErrorCode;
  message: string;
  relativePath?: string;
  pathReason?: FixPathRejection;
}

export interface SafeApplyFilePlan {
  relativePath: string;
  workspaceRoot: string;
  currentContent: string;
  currentContentHash: string;
  proposedContent: string;
  proposedContentHash: string;
  edits: ProposedEdit[];
}

export interface SafeApplyPlan {
  identity: ProposalIdentity;
  files: SafeApplyFilePlan[];
}

export type ApplyPlanResult =
  | { status: "ok"; plan: SafeApplyPlan }
  | { status: "refused"; reason: ApplyPlanRefusal };

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
