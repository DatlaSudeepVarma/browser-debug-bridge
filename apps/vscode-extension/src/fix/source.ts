import type { Diagnosis } from "../ai/types.js";
import { splitLines } from "../project/excerpts.js";
import type { CandidateFile, ProjectContext } from "../project/types.js";
import {
  MAX_FIX_EXCERPTS_PER_FILE,
  MAX_FIX_FILES,
  MAX_FIX_LINES_PER_EXCERPT,
} from "./constants.js";
import { sha256Utf8 } from "./hash.js";
import type { ProposedEdit } from "./types.js";

export interface BoundedExcerpt {
  startLine: number;
  endLine: number;
  lines: string[];
}

export interface BoundedFileSource {
  relativePath: string;
  workspaceRoot: string;
  originalContentHash: string;
  excerpts: BoundedExcerpt[];
}

export interface SourceLimits {
  maxFiles: number;
  maxExcerptsPerFile: number;
  maxLinesPerExcerpt: number;
}

const DEFAULT_SOURCE_LIMITS: SourceLimits = {
  maxFiles: MAX_FIX_FILES,
  maxExcerptsPerFile: MAX_FIX_EXCERPTS_PER_FILE,
  maxLinesPerExcerpt: MAX_FIX_LINES_PER_EXCERPT,
};

export function diagnosisCandidatePaths(diagnosis: Diagnosis): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const hypothesis of diagnosis.hypotheses) {
    for (const file of hypothesis.candidateFiles) {
      if (seen.has(file.relativePath)) {
        continue;
      }
      seen.add(file.relativePath);
      paths.push(file.relativePath);
    }
  }
  return paths;
}

export function hashFileSource(relativePath: string, excerpts: readonly BoundedExcerpt[]): string {
  const body = excerpts
    .map((excerpt) => `${String(excerpt.startLine)}:${String(excerpt.endLine)}\n${excerpt.lines.join("\n")}`)
    .join("\n---\n");
  return sha256Utf8(`${relativePath}\n${body}`);
}

export function sourceFingerprint(files: readonly BoundedFileSource[]): string {
  return sha256Utf8(files.map((file) => file.originalContentHash).join("|"));
}

export function clipExcerptLines(content: string, startLine: number, maxLines: number): BoundedExcerpt | undefined {
  const lines = splitLines(content).slice(0, maxLines);
  if (lines.length === 0) {
    return undefined;
  }
  return {
    startLine,
    endLine: startLine + lines.length - 1,
    lines,
  };
}

export function buildBoundedSources(
  project: ProjectContext,
  requestedPaths: readonly string[],
  limitOverrides?: Partial<SourceLimits>,
): BoundedFileSource[] {
  const limits = { ...DEFAULT_SOURCE_LIMITS, ...limitOverrides };
  const sources: BoundedFileSource[] = [];
  for (const relativePath of requestedPaths) {
    if (sources.length >= limits.maxFiles) {
      break;
    }
    const candidate = project.candidates.find((item) => item.relativePath === relativePath);
    if (candidate === undefined) {
      continue;
    }
    const source = sourceFromCandidate(candidate, limits);
    if (source === undefined) {
      continue;
    }
    sources.push(source);
  }
  return sources;
}

export function sourceFromCandidate(
  candidate: CandidateFile,
  limits: SourceLimits = DEFAULT_SOURCE_LIMITS,
): BoundedFileSource | undefined {
  const excerpts: BoundedExcerpt[] = [];
  for (const excerpt of candidate.excerpts.slice(0, limits.maxExcerptsPerFile)) {
    const clipped = clipExcerptLines(excerpt.content, excerpt.startLine, limits.maxLinesPerExcerpt);
    if (clipped !== undefined) {
      excerpts.push(clipped);
    }
  }
  if (excerpts.length === 0) {
    return undefined;
  }
  return {
    relativePath: candidate.relativePath,
    workspaceRoot: candidate.workspaceRoot,
    originalContentHash: hashFileSource(candidate.relativePath, excerpts),
    excerpts,
  };
}

function splitReplacement(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  return splitLines(value);
}

export function findExcerptForRange(
  source: BoundedFileSource,
  startLine: number,
  endLine: number,
): BoundedExcerpt | undefined {
  return source.excerpts.find(
    (excerpt) => excerpt.startLine <= startLine && endLine <= excerpt.endLine,
  );
}

export function applyEditsToSource(
  source: BoundedFileSource,
  edits: readonly ProposedEdit[],
): BoundedFileSource | undefined {
  const excerpts = source.excerpts.map((excerpt) => ({
    ...excerpt,
    lines: [...excerpt.lines],
  }));
  const ordered = [...edits].sort((left, right) => right.startLine - left.startLine);
  for (const edit of ordered) {
    const excerpt = excerpts.find(
      (item) => item.startLine <= edit.startLine && edit.endLine <= item.endLine,
    );
    if (excerpt === undefined) {
      return undefined;
    }
    const localStart = edit.startLine - excerpt.startLine;
    const localEnd = edit.endLine - excerpt.startLine;
    if (localStart < 0 || localEnd >= excerpt.lines.length) {
      return undefined;
    }
    const replacement = splitReplacement(edit.replacement);
    excerpt.lines.splice(localStart, localEnd - localStart + 1, ...replacement);
    excerpt.endLine = excerpt.startLine + excerpt.lines.length - 1;
  }
  return {
    ...source,
    excerpts,
  };
}
