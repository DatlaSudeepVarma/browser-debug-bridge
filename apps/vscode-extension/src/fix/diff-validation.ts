import { MAX_CHANGED_FILES, MAX_DIFF_CHARS, MAX_DIFF_LINES } from "./constants.js";
import { validateFixPath } from "./paths.js";
import type { ProjectContext } from "../project/types.js";
import type { ProposedChange, ValidatedUnifiedDiff } from "./types.js";

const FILE_OLD = /^--- a\/(.+)$/;
const FILE_NEW = /^\+\+\+ b\/(.+)$/;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/;

export type ValidateDiffResult =
  | { status: "ok"; diff: ValidatedUnifiedDiff }
  | { status: "invalid" }
  | { status: "too-large" };

export function validateUnifiedDiff(
  text: string,
  proposedChange: ProposedChange,
  project: ProjectContext,
  allowedPaths: readonly string[],
): ValidateDiffResult {
  if (text.length > MAX_DIFF_CHARS) {
    return { status: "too-large" };
  }
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length > MAX_DIFF_LINES) {
    return { status: "too-large" };
  }
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return { status: "invalid" };
  }

  const allowed = new Set(allowedPaths);
  const expectedPaths = proposedChange.changes.map((change) => change.relativePath);
  const seenPaths: string[] = [];
  let index = 0;
  let hunkCount = 0;

  while (index < lines.length) {
    const oldLine = lines[index];
    const newLine = lines[index + 1];
    if (oldLine === undefined || newLine === undefined) {
      return { status: "invalid" };
    }
    const oldMatch = FILE_OLD.exec(oldLine);
    const newMatch = FILE_NEW.exec(newLine);
    if (oldMatch?.[1] === undefined || newMatch?.[1] === undefined) {
      return { status: "invalid" };
    }
    if (oldMatch[1] !== newMatch[1]) {
      return { status: "invalid" };
    }
    const relativePath = oldMatch[1];
    const pathResult = validateFixPath(relativePath, project, allowed);
    if (pathResult.status !== "ok") {
      return { status: "invalid" };
    }
    if (seenPaths.includes(relativePath)) {
      return { status: "invalid" };
    }
    seenPaths.push(relativePath);
    index += 2;
    let fileHunks = 0;
    while (index < lines.length && !FILE_OLD.test(lines[index] ?? "")) {
      const hunkLine = lines[index];
      if (hunkLine === undefined) {
        return { status: "invalid" };
      }
      const hunkMatch = HUNK.exec(hunkLine);
      if (hunkMatch === null) {
        return { status: "invalid" };
      }
      const oldCount = Number(hunkMatch[2] ?? "1");
      const newCount = Number(hunkMatch[4] ?? "1");
      if (!Number.isInteger(oldCount) || !Number.isInteger(newCount) || oldCount < 0 || newCount < 0) {
        return { status: "invalid" };
      }
      index += 1;
      const consumed = consumeHunkBody(lines, index, oldCount, newCount);
      if (consumed === undefined) {
        return { status: "invalid" };
      }
      index += consumed;
      fileHunks += 1;
      hunkCount += 1;
    }
    if (fileHunks === 0) {
      return { status: "invalid" };
    }
  }

  if (seenPaths.length === 0 || seenPaths.length > MAX_CHANGED_FILES) {
    return seenPaths.length > MAX_CHANGED_FILES ? { status: "too-large" } : { status: "invalid" };
  }
  if (seenPaths.length !== expectedPaths.length) {
    return { status: "invalid" };
  }
  for (let pathIndex = 0; pathIndex < expectedPaths.length; pathIndex += 1) {
    if (seenPaths[pathIndex] !== expectedPaths[pathIndex]) {
      return { status: "invalid" };
    }
  }

  return {
    status: "ok",
    diff: {
      text,
      fileCount: seenPaths.length,
      editCount: hunkCount,
      lineCount: lines.length,
      paths: seenPaths,
    },
  };
}

function consumeHunkBody(
  lines: readonly string[],
  start: number,
  oldCount: number,
  newCount: number,
): number | undefined {
  let oldSeen = 0;
  let newSeen = 0;
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      return undefined;
    }
    if (line.startsWith("--- ") || line.startsWith("@@ ")) {
      break;
    }
    const marker = line.charAt(0);
    if (marker === " ") {
      oldSeen += 1;
      newSeen += 1;
    } else if (marker === "-") {
      oldSeen += 1;
    } else if (marker === "+") {
      newSeen += 1;
    } else if (line.startsWith("\\")) {
      index += 1;
      continue;
    } else {
      return undefined;
    }
    index += 1;
    if (oldSeen === oldCount && newSeen === newCount) {
      return index - start;
    }
    if (oldSeen > oldCount || newSeen > newCount) {
      return undefined;
    }
  }
  if (oldSeen === oldCount && newSeen === newCount) {
    return index - start;
  }
  return undefined;
}
