import {
  MAX_EXCERPTS_PER_FILE,
  MAX_LINES_PER_EXCERPT,
  MAX_SOURCE_FILE_BYTES,
  MAX_TOTAL_CONTEXT_LINES,
} from "./constants.js";
import type { CodeExcerpt } from "./types.js";

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function excerptAroundLine(
  lines: string[],
  targetLine: number,
  maxLines = MAX_LINES_PER_EXCERPT,
): CodeExcerpt | undefined {
  if (lines.length === 0 || maxLines <= 0) {
    return undefined;
  }
  const clampedTarget = Math.min(Math.max(targetLine, 1), lines.length);
  const length = Math.min(maxLines, lines.length);
  let start = Math.max(1, clampedTarget - Math.floor(length / 2));
  let end = start + length - 1;
  if (end > lines.length) {
    end = lines.length;
    start = Math.max(1, end - length + 1);
  }
  return {
    startLine: start,
    endLine: end,
    content: lines.slice(start - 1, end).join("\n"),
  };
}

export function collectExcerpts(options: {
  content: string | undefined;
  targetLines: number[];
  remainingLines: number;
  byteLength: number;
  exceededSizeLimit: boolean;
}): { excerpts: CodeExcerpt[]; usedLines: number } {
  if (options.remainingLines <= 0) {
    return { excerpts: [], usedLines: 0 };
  }
  if (options.exceededSizeLimit && options.content === undefined) {
    return { excerpts: [], usedLines: 0 };
  }
  if (options.content === undefined) {
    return { excerpts: [], usedLines: 0 };
  }
  if (options.byteLength > MAX_SOURCE_FILE_BYTES && options.targetLines.length === 0) {
    return { excerpts: [], usedLines: 0 };
  }

  const lines = splitLines(options.content);
  const excerpts: CodeExcerpt[] = [];
  let usedLines = 0;
  const uniqueTargets = uniquePositive(options.targetLines).slice(0, MAX_EXCERPTS_PER_FILE);
  const budgetPerExcerpt = Math.min(
    MAX_LINES_PER_EXCERPT,
    Math.max(8, Math.floor(options.remainingLines / Math.max(uniqueTargets.length, 1))),
  );

  for (const target of uniqueTargets) {
    if (excerpts.length >= MAX_EXCERPTS_PER_FILE) {
      break;
    }
    const remaining = options.remainingLines - usedLines;
    if (remaining <= 0) {
      break;
    }
    const excerpt = excerptAroundLine(lines, target, Math.min(budgetPerExcerpt, remaining));
    if (excerpt === undefined) {
      continue;
    }
    excerpts.push(excerpt);
    usedLines += excerpt.endLine - excerpt.startLine + 1;
  }

  return { excerpts, usedLines };
}

export function remainingContextBudget(used: number, max = MAX_TOTAL_CONTEXT_LINES): number {
  return Math.max(0, max - used);
}

function uniquePositive(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort(
    (left, right) => left - right,
  );
}
