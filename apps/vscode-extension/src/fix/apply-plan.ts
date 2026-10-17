import type { Diagnosis } from "../ai/types.js";
import { splitLines } from "../project/excerpts.js";
import type { ProjectContext } from "../project/types.js";
import { inspectCanonicalWorkspaceTarget, type CanonicalPathIo } from "./canonical-path.js";
import { diagnosisFingerprint, sha256Utf8 } from "./hash.js";
import { validateFixPath, type FixPathRejection } from "./paths.js";
import {
  buildBoundedSources,
  diagnosisCandidatePaths,
  findExcerptForRange,
  sourceFingerprint,
  type BoundedFileSource,
} from "./source.js";
import type {
  ApplyPlanErrorCode,
  ApplyPlanRefusal,
  ApplyPlanResult,
  ProposedEdit,
  SafeApplyFilePlan,
  StoredProposal,
} from "./types.js";
import { validateProposedChange } from "./validation.js";

/**
 * StoredProposal.originalContentHash is an excerpt digest from hashFileSource,
 * not a SHA-256 of the complete file. Optional trustedFullFileHashes is the
 * host-computed full-file baseline (not yet stored on StoredProposal).
 * Without that baseline, outside-excerpt drift cannot be proven.
 */
export interface PlanSafeApplyInput {
  proposal: StoredProposal | undefined;
  sessionId: string;
  diagnosis: Diagnosis;
  project: ProjectContext;
  readLiveFile: (relativePath: string) => string | undefined;
  canonicalIo: CanonicalPathIo;
  trustedFullFileHashes?: Readonly<Record<string, string>>;
}

export type {
  ApplyPlanErrorCode,
  ApplyPlanRefusal,
  ApplyPlanResult,
  SafeApplyFilePlan,
  SafeApplyPlan,
} from "./types.js";

export function planSafeApply(input: PlanSafeApplyInput): ApplyPlanResult {
  try {
    return planSafeApplyUnchecked(input);
  } catch {
    return refuse("APPLY_PROPOSAL_MALFORMED", "The stored proposal could not be planned without throwing.");
  }
}

function planSafeApplyUnchecked(input: PlanSafeApplyInput): ApplyPlanResult {
  const proposal = input.proposal;
  if (proposal === undefined) {
    return refuse("APPLY_NO_PROPOSAL", "There is no current fix proposal to apply.");
  }
  if (!hasCompleteIdentity(proposal)) {
    return refuse("APPLY_IDENTITY_MISMATCH", "The stored proposal identity is missing or inconsistent.");
  }

  const diagnosisFingerprintValue = diagnosisFingerprint(input.diagnosis);
  if (input.sessionId !== proposal.identity.sessionId) {
    return refuse("APPLY_DIAGNOSIS_MISMATCH", "The proposal does not belong to the current debug session.");
  }
  if (
    proposal.identity.diagnosisFingerprint !== diagnosisFingerprintValue ||
    input.sessionId.length === 0
  ) {
    return refuse("APPLY_DIAGNOSIS_MISMATCH", "The proposal does not belong to the current diagnosis.");
  }

  if (!isObject(proposal.proposedChange) || !isObject(proposal.diff) || !isObject(proposal.identity)) {
    return refuse("APPLY_PROPOSAL_MALFORMED", "The stored proposal is missing required fields.");
  }

  const allowedPaths = diagnosisCandidatePaths(input.diagnosis);
  const allowed = new Set(allowedPaths);
  const sources = buildBoundedSources(input.project, allowedPaths);
  if (sources.length === 0) {
    return refuse("APPLY_SOURCE_STALE", "Trusted source excerpts are no longer available for this diagnosis.");
  }
  if (sourceFingerprint(sources) !== proposal.identity.sourceFingerprint) {
    return refuse("APPLY_SOURCE_STALE", "Trusted source excerpts no longer match the proposal fingerprint.");
  }

  const rawChanges = proposal.proposedChange.changes;
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    return refuse("APPLY_PROPOSAL_MALFORMED", "The stored proposal does not contain file changes.");
  }

  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const seenPaths = new Set<string>();
  for (const item of rawChanges) {
    if (!isObject(item) || typeof item.relativePath !== "string") {
      return refuse("APPLY_PROPOSAL_MALFORMED", "A stored file change is missing a relative path.");
    }
    const lexical = validateFixPath(item.relativePath, input.project, allowed);
    if (lexical.status !== "ok") {
      return pathRefusal(item.relativePath, lexical.reason);
    }
    if (seenPaths.has(lexical.relativePath)) {
      return refuse("APPLY_PROPOSAL_MALFORMED", "The proposal lists the same file more than once.", {
        relativePath: lexical.relativePath,
      });
    }
    seenPaths.add(lexical.relativePath);

    const candidate = input.project.candidates.find((entry) => entry.relativePath === lexical.relativePath);
    const workspaceRoot = candidate?.workspaceRoot ?? input.project.workspaceRoot;
    const canonical = inspectCanonicalWorkspaceTarget(
      workspaceRoot,
      lexical.relativePath,
      input.canonicalIo,
    );
    if (canonical.status !== "ok") {
      return refuse(
        "APPLY_CANONICAL_REJECTED",
        "Canonical path validation could not prove the target stays inside the workspace.",
        { relativePath: lexical.relativePath },
      );
    }

    const source = sourceByPath.get(lexical.relativePath);
    if (source === undefined) {
      return refuse("APPLY_SOURCE_STALE", "No trusted excerpts exist for a proposed file.", {
        relativePath: lexical.relativePath,
      });
    }
    if (
      typeof item.originalContentHash === "string" &&
      item.originalContentHash !== source.originalContentHash
    ) {
      return refuse("APPLY_SOURCE_STALE", "A stored content hash did not match the trusted excerpt digest.", {
        relativePath: lexical.relativePath,
      });
    }

    const rawEdits = item.edits;
    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      return refuse("APPLY_PROPOSAL_MALFORMED", "A stored file change has no edits.", {
        relativePath: lexical.relativePath,
      });
    }
    const parsedEdits: ProposedEdit[] = [];
    for (const rawEdit of rawEdits) {
      const parsed = readStoredEdit(rawEdit);
      if (parsed.status === "malformed") {
        return refuse("APPLY_PROPOSAL_MALFORMED", "A stored edit is missing required fields.", {
          relativePath: lexical.relativePath,
        });
      }
      if (parsed.status === "invalid-range") {
        return refuse("APPLY_EDIT_INVALID", "A proposed edit range is malformed.", {
          relativePath: lexical.relativePath,
        });
      }
      if (findExcerptForRange(source, parsed.edit.startLine, parsed.edit.endLine) === undefined) {
        return refuse("APPLY_EDIT_INVALID", "A proposed edit is outside the trusted excerpt.", {
          relativePath: lexical.relativePath,
        });
      }
      parsedEdits.push(parsed.edit);
    }
    if (rangesOverlap(parsedEdits)) {
      return refuse("APPLY_EDIT_INVALID", "The proposal has overlapping edits.", {
        relativePath: lexical.relativePath,
      });
    }
  }

  const validated = validateProposedChange(proposal.proposedChange, input.project, sources, allowedPaths);
  if (validated.status !== "ok") {
    return refuse("APPLY_PROPOSAL_MALFORMED", "The stored proposal failed host-side revalidation.");
  }

  const files: SafeApplyFilePlan[] = [];

  for (const change of validated.proposedChange.changes) {
    const lexical = validateFixPath(change.relativePath, input.project, allowed);
    if (lexical.status !== "ok") {
      return pathRefusal(change.relativePath, lexical.reason);
    }

    const candidate = input.project.candidates.find((item) => item.relativePath === lexical.relativePath);
    const workspaceRoot = candidate?.workspaceRoot ?? input.project.workspaceRoot;
    const source = sourceByPath.get(lexical.relativePath);
    if (source === undefined || source.originalContentHash !== change.originalContentHash) {
      return refuse("APPLY_SOURCE_STALE", "The trusted excerpt digest no longer matches the proposal.", {
        relativePath: lexical.relativePath,
      });
    }

    let currentContent: string | undefined;
    try {
      currentContent = input.readLiveFile(lexical.relativePath);
    } catch {
      currentContent = undefined;
    }
    if (currentContent === undefined) {
      return refuse("APPLY_FILE_MISSING", "The target file is missing or unreadable.", {
        relativePath: lexical.relativePath,
      });
    }

    const text = inspectLiveText(currentContent);
    if (text.status !== "ok") {
      return refuse(
        "APPLY_TEXT_AMBIGUOUS",
        "The target file has unsupported encoding or ambiguous line endings.",
        { relativePath: lexical.relativePath },
      );
    }

    const liveLines = contentLines(currentContent);
    const excerptCheck = liveExcerptsStillMatch(source, liveLines);
    if (excerptCheck !== "ok") {
      return refuse(
        excerptCheck,
        excerptCheck === "APPLY_EDIT_INVALID"
          ? "A proposed edit range is not inside a trusted excerpt or the live file."
          : "The live file no longer matches the trusted source excerpt.",
        { relativePath: lexical.relativePath },
      );
    }

    const currentContentHash = sha256Utf8(currentContent);
    const trustedFullFileHash = input.trustedFullFileHashes?.[lexical.relativePath];
    if (trustedFullFileHash !== undefined && trustedFullFileHash !== currentContentHash) {
      return refuse(
        "APPLY_SOURCE_CHANGED",
        "The complete file changed outside the trusted excerpt baseline.",
        { relativePath: lexical.relativePath },
      );
    }

    if (change.edits.length === 0 || rangesOverlap(change.edits)) {
      return refuse("APPLY_EDIT_INVALID", "The proposal has empty or overlapping edits.", {
        relativePath: lexical.relativePath,
      });
    }
    for (const edit of change.edits) {
      if (!Number.isInteger(edit.startLine) || !Number.isInteger(edit.endLine) || edit.endLine < edit.startLine) {
        return refuse("APPLY_EDIT_INVALID", "A proposed edit range is malformed.", {
          relativePath: lexical.relativePath,
        });
      }
      if (findExcerptForRange(source, edit.startLine, edit.endLine) === undefined) {
        return refuse("APPLY_EDIT_INVALID", "A proposed edit is outside the trusted excerpt.", {
          relativePath: lexical.relativePath,
        });
      }
      if (edit.startLine < 1 || edit.endLine > liveLines.length) {
        return refuse("APPLY_EDIT_INVALID", "A proposed edit is outside the live file.", {
          relativePath: lexical.relativePath,
        });
      }
    }

    const proposedLines = applyEditsToLines(liveLines, change.edits);
    if (proposedLines === undefined) {
      return refuse("APPLY_EDIT_INVALID", "The proposed edits could not be applied to the live file.", {
        relativePath: lexical.relativePath,
      });
    }
    const proposedContent = joinLines(proposedLines, text.newline, text.trailingNewline);
    files.push({
      relativePath: lexical.relativePath,
      workspaceRoot,
      currentContent,
      currentContentHash,
      proposedContent,
      proposedContentHash: sha256Utf8(proposedContent),
      edits: change.edits,
    });
  }

  if (files.length === 0) {
    return refuse("APPLY_PROPOSAL_MALFORMED", "The proposal does not contain any usable file changes.");
  }

  return {
    status: "ok",
    plan: {
      identity: proposal.identity,
      files,
    },
  };
}

function hasCompleteIdentity(proposal: StoredProposal): boolean {
  const identity = proposal.identity;
  return (
    identity !== undefined &&
    typeof identity.sessionId === "string" &&
    identity.sessionId.length > 0 &&
    typeof identity.diagnosisFingerprint === "string" &&
    identity.diagnosisFingerprint.length === 64 &&
    typeof identity.sourceFingerprint === "string" &&
    identity.sourceFingerprint.length === 64
  );
}

function pathRefusal(relativePath: string, pathReason: FixPathRejection): ApplyPlanResult {
  return refuse(
    "APPLY_PATH_REJECTED",
    "The proposed path is not an allowed workspace file.",
    { relativePath, pathReason },
  );
}

function refuse(
  code: ApplyPlanErrorCode,
  message: string,
  extra?: { relativePath?: string; pathReason?: FixPathRejection },
): ApplyPlanResult {
  const reason: ApplyPlanRefusal = {
    code,
    message,
    ...extra,
  };
  return { status: "refused", reason };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredEdit(
  value: unknown,
): { status: "ok"; edit: ProposedEdit } | { status: "malformed" } | { status: "invalid-range" } {
  if (!isObject(value) || typeof value.replacement !== "string") {
    return { status: "malformed" };
  }
  if (typeof value.startLine !== "number" || typeof value.endLine !== "number") {
    return { status: "malformed" };
  }
  if (!Number.isInteger(value.startLine) || !Number.isInteger(value.endLine)) {
    return { status: "invalid-range" };
  }
  if (value.startLine < 1 || value.endLine < value.startLine) {
    return { status: "invalid-range" };
  }
  return {
    status: "ok",
    edit: {
      startLine: value.startLine,
      endLine: value.endLine,
      replacement: value.replacement,
    },
  };
}

function inspectLiveText(
  content: string,
): { status: "ok"; newline: "\n" | "\r\n"; trailingNewline: boolean } | { status: "ambiguous" } {
  if (content.includes("\u0000")) {
    return { status: "ambiguous" };
  }
  const hasCrlf = content.includes("\r\n");
  const withoutCrlf = content.replace(/\r\n/g, "");
  if (withoutCrlf.includes("\r")) {
    return { status: "ambiguous" };
  }
  if (hasCrlf && withoutCrlf.includes("\n")) {
    return { status: "ambiguous" };
  }
  const newline = hasCrlf ? "\r\n" : "\n";
  const trailingNewline = hasCrlf ? content.endsWith("\r\n") : content.endsWith("\n");
  return { status: "ok", newline, trailingNewline };
}

function contentLines(content: string): string[] {
  const lines = splitLines(content);
  if ((content.endsWith("\n") || content.endsWith("\r\n")) && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

function liveExcerptsStillMatch(
  source: BoundedFileSource,
  liveLines: readonly string[],
): "ok" | "APPLY_SOURCE_STALE" | "APPLY_EDIT_INVALID" {
  if (source.excerpts.length === 0) {
    return "APPLY_SOURCE_STALE";
  }
  for (const excerpt of source.excerpts) {
    if (excerpt.startLine < 1 || excerpt.endLine < excerpt.startLine) {
      return "APPLY_EDIT_INVALID";
    }
    if (excerpt.endLine > liveLines.length) {
      return "APPLY_SOURCE_STALE";
    }
    const actual = liveLines.slice(excerpt.startLine - 1, excerpt.endLine);
    if (actual.length !== excerpt.lines.length) {
      return "APPLY_SOURCE_STALE";
    }
    for (let index = 0; index < excerpt.lines.length; index += 1) {
      if (actual[index] !== excerpt.lines[index]) {
        return "APPLY_SOURCE_STALE";
      }
    }
  }
  return "ok";
}

function applyEditsToLines(lines: readonly string[], edits: readonly ProposedEdit[]): string[] | undefined {
  const next = [...lines];
  const ordered = [...edits].sort((left, right) => right.startLine - left.startLine);
  for (const edit of ordered) {
    const start = edit.startLine - 1;
    const end = edit.endLine - 1;
    if (start < 0 || end >= next.length || end < start) {
      return undefined;
    }
    const replacement = splitReplacement(edit.replacement);
    next.splice(start, end - start + 1, ...replacement);
  }
  return next;
}

function splitReplacement(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  return splitLines(value);
}

function joinLines(lines: readonly string[], newline: "\n" | "\r\n", trailingNewline: boolean): string {
  if (lines.length === 0) {
    return trailingNewline ? newline : "";
  }
  const body = lines.join(newline);
  return trailingNewline ? `${body}${newline}` : body;
}

function rangesOverlap(edits: readonly ProposedEdit[]): boolean {
  const ordered = [...edits].sort((left, right) => left.startLine - right.startLine);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (current.startLine <= previous.endLine) {
      return true;
    }
  }
  return false;
}
