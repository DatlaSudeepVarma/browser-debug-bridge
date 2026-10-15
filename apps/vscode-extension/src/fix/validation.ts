import { extractJsonObject } from "../ai/validation.js";
import { clipAiText } from "../ai/sanitize.js";
import type { ProjectContext } from "../project/types.js";
import {
  MAX_CHANGED_FILES,
  MAX_EDITS_PER_FILE,
  MAX_FIX_RATIONALE_LENGTH,
  MAX_FIX_SUMMARY_LENGTH,
  MAX_REPLACEMENT_CHARS,
  MAX_TOTAL_REPLACEMENT_CHARS,
} from "./constants.js";
import { validateFixPath } from "./paths.js";
import { findExcerptForRange, type BoundedFileSource } from "./source.js";
import type { ProposedChange, ProposedEdit, ProposedFileChange } from "./types.js";

const ROOT_KEYS = new Set(["summary", "rationale", "changes"]);
const CHANGE_KEYS = new Set(["relativePath", "edits", "originalContentHash"]);
const EDIT_KEYS = new Set(["startLine", "endLine", "replacement"]);

export type ValidateProposalResult =
  | { status: "ok"; proposedChange: ProposedChange }
  | { status: "invalid" }
  | { status: "too-large" };

export function parseFixProposalJson(text: string): unknown {
  return extractJsonObject(text);
}

export function validateProposedChange(
  raw: unknown,
  project: ProjectContext,
  sources: readonly BoundedFileSource[],
  allowedPaths: readonly string[],
): ValidateProposalResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { status: "invalid" };
  }
  const record = raw as Record<string, unknown>;
  if (!hasOnlyKeys(record, ROOT_KEYS)) {
    return { status: "invalid" };
  }
  const summary = readRequiredString(record.summary);
  const rationale = readRequiredString(record.rationale);
  if (summary === undefined || rationale === undefined) {
    return { status: "invalid" };
  }
  if (!Array.isArray(record.changes) || record.changes.length === 0) {
    return { status: "invalid" };
  }
  if (record.changes.length > MAX_CHANGED_FILES) {
    return { status: "too-large" };
  }

  const allowed = new Set(allowedPaths);
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const seenPaths = new Set<string>();
  const changes: ProposedFileChange[] = [];
  let totalReplacementChars = 0;

  for (const item of record.changes) {
    const parsed = readFileChange(item, project, allowed, sourceByPath, seenPaths);
    if (parsed.status === "too-large") {
      return { status: "too-large" };
    }
    if (parsed.status !== "ok") {
      return { status: "invalid" };
    }
    totalReplacementChars += parsed.replacementChars;
    if (totalReplacementChars > MAX_TOTAL_REPLACEMENT_CHARS) {
      return { status: "too-large" };
    }
    changes.push(parsed.change);
  }

  return {
    status: "ok",
    proposedChange: {
      summary: clipAiText(summary, MAX_FIX_SUMMARY_LENGTH),
      rationale: clipAiText(rationale, MAX_FIX_RATIONALE_LENGTH),
      changes,
    },
  };
}

function readFileChange(
  value: unknown,
  project: ProjectContext,
  allowed: ReadonlySet<string>,
  sourceByPath: ReadonlyMap<string, BoundedFileSource>,
  seenPaths: Set<string>,
):
  | { status: "ok"; change: ProposedFileChange; replacementChars: number }
  | { status: "invalid" }
  | { status: "too-large" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { status: "invalid" };
  }
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, CHANGE_KEYS)) {
    return { status: "invalid" };
  }
  const relativePath = readRequiredString(record.relativePath);
  if (relativePath === undefined) {
    return { status: "invalid" };
  }
  const pathResult = validateFixPath(relativePath, project, allowed);
  if (pathResult.status !== "ok") {
    return { status: "invalid" };
  }
  if (seenPaths.has(pathResult.relativePath)) {
    return { status: "invalid" };
  }
  seenPaths.add(pathResult.relativePath);
  const source = sourceByPath.get(pathResult.relativePath);
  if (source === undefined) {
    return { status: "invalid" };
  }
  if (!Array.isArray(record.edits) || record.edits.length === 0) {
    return { status: "invalid" };
  }
  if (record.edits.length > MAX_EDITS_PER_FILE) {
    return { status: "too-large" };
  }

  const edits: ProposedEdit[] = [];
  let replacementChars = 0;
  for (const item of record.edits) {
    const edit = readEdit(item, source);
    if (edit === undefined) {
      return { status: "invalid" };
    }
    if (edit.replacement.length > MAX_REPLACEMENT_CHARS) {
      return { status: "too-large" };
    }
    replacementChars += edit.replacement.length;
    edits.push(edit);
  }
  if (rangesOverlap(edits)) {
    return { status: "invalid" };
  }

  return {
    status: "ok",
    replacementChars,
    change: {
      relativePath: pathResult.relativePath,
      originalContentHash: source.originalContentHash,
      edits,
    },
  };
}

function readEdit(value: unknown, source: BoundedFileSource): ProposedEdit | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, EDIT_KEYS)) {
    return undefined;
  }
  const startLine = readPositiveInt(record.startLine);
  const endLine = readPositiveInt(record.endLine);
  if (startLine === undefined || endLine === undefined || endLine < startLine) {
    return undefined;
  }
  if (typeof record.replacement !== "string") {
    return undefined;
  }
  if (findExcerptForRange(source, startLine, endLine) === undefined) {
    return undefined;
  }
  return {
    startLine,
    endLine,
    replacement: record.replacement,
  };
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

function readRequiredString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}
