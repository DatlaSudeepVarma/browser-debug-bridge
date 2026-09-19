import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import {
  MAX_SEARCH_TERMS,
  MIN_SIGNAL_SEGMENT_LENGTH,
  SKIP_URL_SEGMENTS,
} from "./constants.js";
import type { SessionSignals, StackPathHit, WorkspaceFolderRef } from "./types.js";
import { isGeneratedClassName } from "./selector.js";
import { isSafeWorkspaceRelativePath, posixStem, toSafeRelativePath } from "./workspace.js";

const STACK_PATH_PATTERN =
  /(?:webpack(?:-internal)?:\/{0,2})?(?:\.\/)?((?:[A-Za-z]:[\\/]|\\\\|\/)?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|css|scss|less|html))(?::(\d+))?(?::(\d+))?/g;

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function textVariants(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (normalized.length < MIN_SIGNAL_SEGMENT_LENGTH) {
    return [];
  }
  const words = normalized.split(" ").filter((word) => word.length > 0);
  const camel = words
    .map((word, index) => (index === 0 ? word : capitalize(word)))
    .join("");
  const pascal = words.map((word) => capitalize(word)).join("");
  const kebab = words.join("-");
  const snake = words.join("_");
  return uniqueNonEmpty([normalized, camel, pascal, kebab, snake]);
}

function capitalize(value: string): string {
  const first = value.charAt(0);
  return `${first.toUpperCase()}${value.slice(1)}`;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length < MIN_SIGNAL_SEGMENT_LENGTH || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function isUsefulPathSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (trimmed.length < MIN_SIGNAL_SEGMENT_LENGTH) {
    return false;
  }
  if (/^\d+$/.test(trimmed)) {
    return false;
  }
  if (SKIP_URL_SEGMENTS.has(trimmed.toLowerCase())) {
    return false;
  }
  if (trimmed.includes("[REDACTED]") || trimmed.includes("REDACTED")) {
    return false;
  }
  return true;
}

export function pathSegmentsFromUrl(url: string): string[] {
  try {
    const parsed = new URL(url, "https://bdb.invalid");
    return parsed.pathname
      .split("/")
      .map((segment) => decodeUriSegment(segment))
      .filter(isUsefulPathSegment);
  } catch {
    return url
      .split(/[/?#]/)
      .map((segment) => segment.trim())
      .filter(isUsefulPathSegment);
  }
}

function decodeUriSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function extractStackPathCandidates(stack: string): Array<{
  rawPath: string;
  line?: number;
  column?: number;
}> {
  const hits: Array<{ rawPath: string; line?: number; column?: number }> = [];
  STACK_PATH_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = STACK_PATH_PATTERN.exec(stack);
  while (match !== null) {
    const rawPath = cleanStackPath(match[1] ?? "");
    if (rawPath.length > 0) {
      const line = parseOptionalInt(match[2]);
      const column = parseOptionalInt(match[3]);
      hits.push({
        rawPath,
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
      });
    }
    match = STACK_PATH_PATTERN.exec(stack);
  }
  return hits;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function cleanStackPath(raw: string): string {
  let path = raw.replaceAll("\\", "/");
  path = path.replace(/^(?:webpack(?:-internal)?:\/{0,2})+/, "");
  path = path.replace(/^\.\//, "");
  const query = path.indexOf("?");
  if (query >= 0) {
    path = path.slice(0, query);
  }
  return path;
}

export function resolveStackPathAgainstFolders(
  rawPath: string,
  folders: WorkspaceFolderRef[],
): { relativePath: string; folder: WorkspaceFolderRef } | undefined {
  if (rawPath.includes("\0") || rawPath.includes("..")) {
    return undefined;
  }
  for (const folder of folders) {
    const relative = toSafeRelativePath(folder.root, rawPath);
    if (relative !== undefined && isSafeWorkspaceRelativePath(folder.root, relative)) {
      return { relativePath: relative, folder };
    }
  }
  const stripped = stripAbsolutePrefix(rawPath);
  if (stripped !== undefined && stripped !== rawPath) {
    return resolveStackPathAgainstFolders(stripped, folders);
  }
  return undefined;
}

function stripAbsolutePrefix(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const srcIndex = normalized.indexOf("/src/");
  if (srcIndex >= 0) {
    return normalized.slice(srcIndex + 1);
  }
  const appIndex = normalized.indexOf("/app/");
  if (appIndex >= 0) {
    return normalized.slice(appIndex + 1);
  }
  return undefined;
}

export function extractSessionSignals(
  session: DebugSessionV1,
  folders: WorkspaceFolderRef[],
): SessionSignals {
  const routeSegments = pathSegmentsFromUrl(session.page.url);
  const networkSegments = uniqueNonEmpty(
    session.network.flatMap((entry) => pathSegmentsFromUrl(entry.urlRedacted)),
  );
  const ids = uniqueNonEmpty(
    [session.selectedElement.id ?? "", ...idsFromSelector(session.selectedElement.selector)].filter(
      (value) => value.length > 0,
    ),
  );
  const classes = uniqueNonEmpty(
    [...session.selectedElement.classes, ...classesFromSelector(session.selectedElement.selector)].filter(
      (value) => !isGeneratedClassName(value),
    ),
  );
  const testIds = uniqueNonEmpty(testIdsFromSelector(session.selectedElement.selector));
  const textTerms = textVariants(session.selectedElement.textPreview);
  const componentTokens = uniqueNonEmpty([...ids, ...testIds, ...classes, ...textTerms]);
  const stackHits: StackPathHit[] = [];
  for (const entry of session.console) {
    if (entry.stack === undefined) {
      continue;
    }
    for (const hit of extractStackPathCandidates(entry.stack)) {
      const resolved = resolveStackPathAgainstFolders(hit.rawPath, folders);
      if (resolved === undefined) {
        continue;
      }
      stackHits.push({
        relativePath: resolved.relativePath,
        folderName: resolved.folder.name,
        folderRoot: resolved.folder.root,
        ...(hit.line === undefined ? {} : { line: hit.line }),
        ...(hit.column === undefined ? {} : { column: hit.column }),
      });
    }
  }

  const searchTerms = uniqueNonEmpty([
    ...ids,
    ...testIds,
    ...classes,
    ...textTerms.slice(0, 3),
    ...routeSegments,
    ...networkSegments,
  ]).slice(0, MAX_SEARCH_TERMS);

  return {
    routeSegments,
    networkSegments,
    ids,
    classes,
    testIds,
    textTerms,
    componentTokens,
    stackHits,
    searchTerms,
  };
}

function idsFromSelector(selector: string): string[] {
  const ids: string[] = [];
  const pattern = /#([A-Za-z_][\w-]*)/g;
  let match = pattern.exec(selector);
  while (match !== null) {
    ids.push(match[1] ?? "");
    match = pattern.exec(selector);
  }
  return ids;
}

function classesFromSelector(selector: string): string[] {
  const classes: string[] = [];
  const pattern = /\.([A-Za-z_][\w-]*)/g;
  let match = pattern.exec(selector);
  while (match !== null) {
    classes.push(match[1] ?? "");
    match = pattern.exec(selector);
  }
  return classes;
}

function testIdsFromSelector(selector: string): string[] {
  const values: string[] = [];
  const pattern = /\[data-testid(?:\^|\$|\*)?=(?:"([^"]+)"|'([^']+)'|([^\]]+))\]/g;
  let match = pattern.exec(selector);
  while (match !== null) {
    values.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
    match = pattern.exec(selector);
  }
  return values;
}

export function pathContainsSegment(relativePath: string, segment: string): boolean {
  const normalized = `/${relativePath.replaceAll("\\", "/").toLowerCase()}`;
  const needle = segment.toLowerCase();
  return (
    normalized.includes(`/${needle}/`) ||
    normalized.includes(`/${needle}.`) ||
    normalized.endsWith(`/${needle}`)
  );
}

export function basenameMatchesToken(relativePath: string, token: string): boolean {
  const stem = posixStem(relativePath).replace(/[-_]/g, "").toLowerCase();
  const normalized = token.replace(/[-_\s]/g, "").toLowerCase();
  if (stem.length < MIN_SIGNAL_SEGMENT_LENGTH || normalized.length < MIN_SIGNAL_SEGMENT_LENGTH) {
    return false;
  }
  return stem === normalized || stem.includes(normalized) || normalized.includes(stem);
}
