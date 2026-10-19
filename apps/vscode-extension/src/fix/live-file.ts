import { splitLines } from "../project/excerpts.js";
import { MAX_SOURCE_FILE_BYTES } from "../project/constants.js";
import type { ProjectContext } from "../project/types.js";
import { inspectCanonicalWorkspaceTarget, type CanonicalPathIo } from "./canonical-path.js";
import { sha256Utf8 } from "./hash.js";
import { validateFixPath } from "./paths.js";
import type { BoundedFileSource } from "./source.js";
import type { ProposedFileChange } from "./types.js";

export interface LiveFileReader {
  readText(relativePath: string): Promise<string | undefined> | string | undefined;
}

export interface CapturedLiveBaseline {
  relativePath: string;
  hash: string;
}

export type LiveTextInspection =
  | { status: "ok"; newline: "\n" | "\r\n"; trailingNewline: boolean }
  | { status: "ambiguous" };

export type LiveExcerptMatch = "ok" | "APPLY_SOURCE_STALE" | "APPLY_EDIT_INVALID";

export type VerifyLiveBaselinesResult =
  | { status: "ok"; liveFileHashes: Record<string, string> }
  | { status: "unavailable" }
  | { status: "changed" };

export function createMemoryLiveFileReader(
  files: Readonly<Record<string, string | undefined>>,
): LiveFileReader {
  return {
    readText(relativePath: string): string | undefined {
      return files[relativePath];
    },
  };
}

export async function readLiveFileText(
  reader: LiveFileReader,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await reader.readText(relativePath);
  } catch {
    return undefined;
  }
}

export function inspectLiveText(content: string): LiveTextInspection {
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

export function contentLines(content: string): string[] {
  const lines = splitLines(content);
  if ((content.endsWith("\n") || content.endsWith("\r\n")) && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

export function liveExcerptsMatch(source: BoundedFileSource, liveLines: readonly string[]): LiveExcerptMatch {
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

export function hasStoredLiveFileHashes(
  hashes: Readonly<Record<string, string>> | undefined,
): hashes is Readonly<Record<string, string>> {
  return hashes !== undefined;
}

export async function captureSourceBaselines(options: {
  sources: readonly BoundedFileSource[];
  project: ProjectContext;
  allowedPaths: readonly string[];
  reader: LiveFileReader;
  canonicalIo: CanonicalPathIo;
}): Promise<Map<string, CapturedLiveBaseline>> {
  const captured = new Map<string, CapturedLiveBaseline>();
  const sourceByPath = new Map(options.sources.map((source) => [source.relativePath, source]));
  for (const source of options.sources) {
    const baseline = await readTrustedBaseline(
      source.relativePath,
      sourceByPath,
      options.project,
      options.allowedPaths,
      options.reader,
      options.canonicalIo,
    );
    if (baseline !== undefined) {
      captured.set(source.relativePath, baseline);
    }
  }
  return captured;
}

export async function verifyProposedBaselines(options: {
  changes: readonly ProposedFileChange[];
  sources: readonly BoundedFileSource[];
  project: ProjectContext;
  allowedPaths: readonly string[];
  captured: ReadonlyMap<string, CapturedLiveBaseline>;
  reader: LiveFileReader;
  canonicalIo: CanonicalPathIo;
}): Promise<VerifyLiveBaselinesResult> {
  const sourceByPath = new Map(options.sources.map((source) => [source.relativePath, source]));
  const liveFileHashes: Record<string, string> = {};
  for (const change of options.changes) {
    const captured = options.captured.get(change.relativePath);
    if (captured === undefined) {
      return { status: "unavailable" };
    }
    const current = await readTrustedBaseline(
      change.relativePath,
      sourceByPath,
      options.project,
      options.allowedPaths,
      options.reader,
      options.canonicalIo,
    );
    if (current === undefined) {
      return { status: "unavailable" };
    }
    if (current.hash !== captured.hash) {
      return { status: "changed" };
    }
    liveFileHashes[change.relativePath] = captured.hash;
  }
  return { status: "ok", liveFileHashes };
}

async function readTrustedBaseline(
  relativePath: string,
  sourceByPath: ReadonlyMap<string, BoundedFileSource>,
  project: ProjectContext,
  allowedPaths: readonly string[],
  reader: LiveFileReader,
  canonicalIo: CanonicalPathIo,
): Promise<CapturedLiveBaseline | undefined> {
  const allowed = new Set(allowedPaths);
  const lexical = validateFixPath(relativePath, project, allowed);
  if (lexical.status !== "ok") {
    return undefined;
  }
  const candidate = project.candidates.find((item) => item.relativePath === lexical.relativePath);
  const workspaceRoot = candidate?.workspaceRoot ?? project.workspaceRoot;
  const canonical = inspectCanonicalWorkspaceTarget(workspaceRoot, lexical.relativePath, canonicalIo);
  if (canonical.status !== "ok") {
    return undefined;
  }
  const source = sourceByPath.get(lexical.relativePath);
  if (source === undefined) {
    return undefined;
  }
  const content = await readLiveFileText(reader, lexical.relativePath);
  if (content === undefined) {
    return undefined;
  }
  if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_FILE_BYTES) {
    return undefined;
  }
  if (inspectLiveText(content).status !== "ok") {
    return undefined;
  }
  if (liveExcerptsMatch(source, splitLines(content)) !== "ok") {
    return undefined;
  }
  return {
    relativePath: lexical.relativePath,
    hash: sha256Utf8(content),
  };
}
