import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import { throwIfCancelled } from "../project/cancellation.js";
import type { CancellationTokenLike, CandidateFile, ProjectContext } from "../project/types.js";
import {
  MAX_AI_CONSOLE_ENTRIES,
  MAX_AI_DOM_CHARS,
  MAX_AI_EXCERPTS_PER_FILE,
  MAX_AI_EXCERPT_LINES,
  MAX_AI_INPUT_CHARS,
  MAX_AI_NETWORK_ENTRIES,
  MAX_AI_PROJECT_FILES,
  MAX_AI_USER_DESCRIPTION_CHARS,
} from "./constants.js";
import { clipAiText, sanitizeAiText, sanitizeAiUrl } from "./sanitize.js";
import type { SerializeAiContextResult, SerializedAiContext } from "./types.js";

export interface AiSerializeLimits {
  maxChars: number;
  maxProjectFiles: number;
  maxExcerptLines: number;
  maxExcerptsPerFile: number;
  maxConsoleEntries: number;
  maxNetworkEntries: number;
  maxDomChars: number;
}

const DEFAULT_LIMITS: AiSerializeLimits = {
  maxChars: MAX_AI_INPUT_CHARS,
  maxProjectFiles: MAX_AI_PROJECT_FILES,
  maxExcerptLines: MAX_AI_EXCERPT_LINES,
  maxExcerptsPerFile: MAX_AI_EXCERPTS_PER_FILE,
  maxConsoleEntries: MAX_AI_CONSOLE_ENTRIES,
  maxNetworkEntries: MAX_AI_NETWORK_ENTRIES,
  maxDomChars: MAX_AI_DOM_CHARS,
};

export function defaultAiSerializeLimits(): AiSerializeLimits {
  return { ...DEFAULT_LIMITS };
}

export function serializeAiContext(
  session: DebugSessionV1,
  project: ProjectContext,
  token?: CancellationTokenLike,
  limitOverrides?: Partial<AiSerializeLimits>,
): SerializeAiContextResult {
  throwIfCancelled(token);
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  let fileCount = Math.min(limits.maxProjectFiles, project.candidates.length);
  let excerptsPerFile = limits.maxExcerptsPerFile;
  let excerptLines = limits.maxExcerptLines;
  let domChars = limits.maxDomChars;
  let truncated = fileCount < project.candidates.length;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    throwIfCancelled(token);
    const built = buildContext(session, project, {
      fileCount,
      excerptsPerFile,
      excerptLines,
      domChars,
      limits,
    });
    if (built.text.length <= limits.maxChars) {
      truncated =
        truncated ||
        built.truncated ||
        fileCount < project.candidates.length ||
        excerptsPerFile < limits.maxExcerptsPerFile ||
        excerptLines < limits.maxExcerptLines ||
        domChars < limits.maxDomChars;
      return {
        status: "ok",
        context: {
          ...built,
          truncated,
          charCount: built.text.length,
          candidateCount: built.candidatePaths.length,
        },
      };
    }
    if (excerptsPerFile > 0) {
      excerptsPerFile -= 1;
      truncated = true;
      continue;
    }
    if (excerptLines > 8) {
      excerptLines = Math.max(8, Math.floor(excerptLines / 2));
      truncated = true;
      continue;
    }
    if (fileCount > 1) {
      fileCount -= 1;
      truncated = true;
      continue;
    }
    if (domChars > 256) {
      domChars = Math.max(256, Math.floor(domChars / 2));
      truncated = true;
      continue;
    }
    return { status: "too-large" };
  }
  return { status: "too-large" };
}

function buildContext(
  session: DebugSessionV1,
  project: ProjectContext,
  options: {
    fileCount: number;
    excerptsPerFile: number;
    excerptLines: number;
    domChars: number;
    limits: AiSerializeLimits;
  },
): Omit<SerializedAiContext, "charCount" | "candidateCount"> & {
  candidatePaths: string[];
} {
  const evidenceIds: string[] = [];
  const lines: string[] = [];
  const pushId = (id: string): void => {
    evidenceIds.push(id);
  };

  lines.push("## Page");
  pushId("BROWSER.page");
  lines.push("id: BROWSER.page");
  lines.push(`url: ${sanitizeAiUrl(session.page.url)}`);
  lines.push(`title: ${sanitizeAiText(session.page.title)}`);
  lines.push(`origin: ${sanitizeAiText(session.page.origin)}`);
  lines.push("");

  lines.push("## User description");
  pushId("BROWSER.userDescription");
  lines.push("id: BROWSER.userDescription");
  lines.push("UNTRUSTED USER-PROVIDED DESCRIPTION");
  lines.push(
    sanitizeAiText(clipAiText(session.userDescription, MAX_AI_USER_DESCRIPTION_CHARS)) || "(empty)",
  );
  lines.push("");

  lines.push("## Selected Element");
  pushId("BROWSER.selectedElement");
  lines.push("id: BROWSER.selectedElement");
  lines.push(`selector: ${sanitizeAiText(session.selectedElement.selector)}`);
  lines.push(`tag: ${sanitizeAiText(session.selectedElement.tag)}`);
  lines.push(`idAttr: ${sanitizeAiText(session.selectedElement.id ?? "")}`);
  lines.push(`classes: ${session.selectedElement.classes.map((item) => sanitizeAiText(item)).join(", ")}`);
  lines.push(`role: ${sanitizeAiText(session.selectedElement.role ?? "")}`);
  lines.push(`textPreview: ${sanitizeAiText(session.selectedElement.textPreview)}`);
  lines.push(
    `rect: ${String(session.selectedElement.rect.x)},${String(session.selectedElement.rect.y)} ${String(session.selectedElement.rect.width)}x${String(session.selectedElement.rect.height)}`,
  );
  lines.push(
    `ancestorPath: ${session.selectedElement.ancestorPath
      .map((item) => sanitizeAiText(item.tag + (item.id === undefined ? "" : `#${item.id}`)))
      .join(" > ")}`,
  );
  lines.push("");

  lines.push("## DOM Evidence");
  pushId("BROWSER.dom");
  lines.push("id: BROWSER.dom");
  lines.push(sanitizeAiText(clipAiText(session.dom.outerHtmlTruncated, options.domChars)));
  lines.push("");

  lines.push("## CSS Evidence");
  pushId("BROWSER.css");
  lines.push("id: BROWSER.css");
  const computed = Object.entries(session.css.computedSubset)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${sanitizeAiText(name)}: ${sanitizeAiText(value)}`)
    .join("; ");
  lines.push(`computedSubset: ${computed}`);
  for (const rule of session.css.matchedRuleSummaries) {
    lines.push(
      `matchedRule: ${sanitizeAiText(rule.selector)}${
        rule.originHint === undefined ? "" : ` (${sanitizeAiText(rule.originHint)})`
      }`,
    );
  }
  lines.push("");

  lines.push("## Screenshot metadata");
  pushId("BROWSER.screenshot");
  lines.push("id: BROWSER.screenshot");
  lines.push(`mime: ${session.screenshot.mime}`);
  lines.push(`width: ${String(session.screenshot.width)}`);
  lines.push(`height: ${String(session.screenshot.height)}`);
  lines.push(`sha256: ${session.screenshot.sha256}`);
  lines.push(`cropped: ${session.screenshot.cropped ? "true" : "false"}`);
  lines.push("bytesIncluded: false");
  lines.push("");

  const consoleEntries = session.console.slice(-options.limits.maxConsoleEntries);
  lines.push("## Console Evidence");
  consoleEntries.forEach((entry, index) => {
    const id = `BROWSER.console[${String(index)}]`;
    pushId(id);
    lines.push(
      `${id}: ${entry.level} ${sanitizeAiText(entry.message)}${
        entry.stack === undefined ? "" : ` stack=${sanitizeAiText(clipAiText(entry.stack, 400))}`
      }`,
    );
  });
  if (consoleEntries.length === 0) {
    lines.push("(none)");
  }
  lines.push("");

  const networkEntries = session.network.slice(-options.limits.maxNetworkEntries);
  lines.push("## Network Evidence");
  networkEntries.forEach((entry, index) => {
    const id = `BROWSER.network[${String(index)}]`;
    pushId(id);
    lines.push(
      `${id}: ${entry.method} ${sanitizeAiUrl(entry.urlRedacted)} status=${
        entry.status === undefined ? "?" : String(entry.status)
      }${entry.error === undefined ? "" : ` error=${sanitizeAiText(entry.error)}`}`,
    );
  });
  if (networkEntries.length === 0) {
    lines.push("(none)");
  }
  lines.push("");

  lines.push("## Project Context");
  pushId("BROWSER.hints");
  lines.push("id: BROWSER.hints");
  lines.push(`sessionFrameworkHint: ${session.hints.framework ?? "unspecified"}`);
  lines.push(`sessionHintEvidence: ${session.hints.evidence.map((item) => sanitizeAiText(item)).join("; ")}`);
  pushId("PROJECT.framework");
  lines.push("id: PROJECT.framework");
  lines.push(`framework: ${project.framework?.name ?? "not detected"}`);
  lines.push(`languageHints: ${project.languageHints.join(", ") || "(none)"}`);
  lines.push(`packageManager: ${project.packageManager?.name ?? "not detected"}`);
  lines.push("");

  const candidates = project.candidates.slice(0, options.fileCount);
  const candidatePaths = candidates.map((candidate) => candidate.relativePath);
  lines.push("## Candidate Files");
  candidates.forEach((candidate, index) => {
    appendCandidate(lines, evidenceIds, candidate, index, options);
  });
  if (candidates.length === 0) {
    lines.push("(none)");
  }

  return {
    text: lines.join("\n"),
    evidenceIds,
    candidatePaths,
    truncated:
      session.console.length > consoleEntries.length ||
      session.network.length > networkEntries.length ||
      project.candidates.length > candidates.length,
  };
}

function appendCandidate(
  lines: string[],
  evidenceIds: string[],
  candidate: CandidateFile,
  index: number,
  options: { excerptsPerFile: number; excerptLines: number },
): void {
  const id = `PROJECT.candidate[${String(index)}]`;
  evidenceIds.push(id);
  lines.push(`${id}: ${candidate.relativePath}`);
  lines.push(`score: ${String(candidate.score)}`);
  lines.push(
    `reasons: ${candidate.reasons.map((reason) => sanitizeAiText(reason.explanation)).join("; ")}`,
  );
  const excerpts = candidate.excerpts.slice(0, options.excerptsPerFile);
  excerpts.forEach((excerpt, excerptIndex) => {
    const excerptId = `${id}.excerpt[${String(excerptIndex)}]`;
    evidenceIds.push(excerptId);
    const excerptLines = excerpt.content.split(/\r?\n/).slice(0, options.excerptLines);
    lines.push(
      `${excerptId}: lines ${String(excerpt.startLine)}-${String(excerpt.endLine)}`,
    );
    lines.push(sanitizeAiText(excerptLines.join("\n")));
  });
}
