import { HUNK_CONTEXT_LINES } from "./constants.js";
import { applyEditsToSource, type BoundedFileSource } from "./source.js";
import type { ProposedChange, ProposedFileChange } from "./types.js";

export type GenerateDiffResult =
  | { status: "ok"; text: string; updatedSources: BoundedFileSource[] }
  | { status: "invalid" };

export function generateUnifiedDiff(
  proposedChange: ProposedChange,
  sources: readonly BoundedFileSource[],
): GenerateDiffResult {
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const fileBlocks: string[] = [];
  const updatedSources: BoundedFileSource[] = [];

  for (const change of proposedChange.changes) {
    const original = sourceByPath.get(change.relativePath);
    if (original === undefined) {
      return { status: "invalid" };
    }
    if (original.originalContentHash !== change.originalContentHash) {
      return { status: "invalid" };
    }
    const updated = applyEditsToSource(original, change.edits);
    if (updated === undefined) {
      return { status: "invalid" };
    }
    const block = formatFileDiff(change, original, updated);
    if (block === undefined) {
      return { status: "invalid" };
    }
    fileBlocks.push(block);
    updatedSources.push(updated);
  }

  if (fileBlocks.length === 0) {
    return { status: "invalid" };
  }
  return {
    status: "ok",
    text: `${fileBlocks.join("\n")}\n`,
    updatedSources,
  };
}

function formatFileDiff(
  change: ProposedFileChange,
  original: BoundedFileSource,
  updated: BoundedFileSource,
): string | undefined {
  const hunks: string[] = [];
  let newOffset = 0;
  const count = Math.min(original.excerpts.length, updated.excerpts.length);
  for (let index = 0; index < count; index += 1) {
    const oldExcerpt = original.excerpts[index];
    const newExcerpt = updated.excerpts[index];
    if (oldExcerpt === undefined || newExcerpt === undefined) {
      return undefined;
    }
    const oldStart = oldExcerpt.startLine;
    const newStart = oldExcerpt.startLine + newOffset;
    const hunk = formatExcerptHunk(oldExcerpt.lines, newExcerpt.lines, oldStart, newStart);
    newOffset += newExcerpt.lines.length - oldExcerpt.lines.length;
    if (hunk !== undefined) {
      hunks.push(hunk);
    }
  }
  if (hunks.length === 0) {
    return undefined;
  }
  return [`--- a/${change.relativePath}`, `+++ b/${change.relativePath}`, ...hunks].join("\n");
}

function formatExcerptHunk(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldStart: number,
  newStart: number,
): string | undefined {
  let prefix = 0;
  const minLength = Math.min(oldLines.length, newLines.length);
  while (prefix < minLength && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  if (prefix > oldSuffix && prefix > newSuffix) {
    return undefined;
  }

  const contextBefore = Math.min(HUNK_CONTEXT_LINES, prefix);
  const contextAfterOld = Math.min(HUNK_CONTEXT_LINES, oldLines.length - 1 - oldSuffix);
  const hunkOldStartIndex = prefix - contextBefore;
  const hunkOldEndIndex = oldSuffix + contextAfterOld;
  const hunkNewStartIndex = prefix - contextBefore;
  const hunkNewEndIndex = newSuffix + Math.min(HUNK_CONTEXT_LINES, newLines.length - 1 - newSuffix);

  const oldCount = hunkOldEndIndex - hunkOldStartIndex + 1;
  const newCount = hunkNewEndIndex - hunkNewStartIndex + 1;
  const header = `@@ -${String(oldStart + hunkOldStartIndex)},${String(oldCount)} +${String(newStart + hunkNewStartIndex)},${String(newCount)} @@`;
  const body: string[] = [];

  for (let index = hunkOldStartIndex; index < prefix; index += 1) {
    body.push(` ${oldLines[index] ?? ""}`);
  }
  for (let index = prefix; index <= oldSuffix; index += 1) {
    body.push(`-${oldLines[index] ?? ""}`);
  }
  for (let index = prefix; index <= newSuffix; index += 1) {
    body.push(`+${newLines[index] ?? ""}`);
  }
  const afterCount = Math.min(
    contextAfterOld,
    Math.min(HUNK_CONTEXT_LINES, oldLines.length - 1 - oldSuffix),
  );
  for (let offset = 1; offset <= afterCount; offset += 1) {
    body.push(` ${oldLines[oldSuffix + offset] ?? ""}`);
  }

  return [header, ...body].join("\n");
}
