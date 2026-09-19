import { GENERIC_SOURCE_BASENAMES, MAX_CANDIDATES, SCORE_WEIGHTS } from "./constants.js";
import { basenameMatchesToken, pathContainsSegment } from "./signals.js";
import type {
  CandidateFile,
  CandidateReason,
  CandidateReasonType,
  SessionSignals,
} from "./types.js";
import { posixStem } from "./workspace.js";

export interface PathScoreInput {
  relativePath: string;
  folderName: string;
  folderRoot: string;
  signals: SessionSignals;
  frameworkName?: string;
}

export interface ScoredCandidate {
  relativePath: string;
  workspaceFolder: string;
  workspaceRoot: string;
  score: number;
  reasons: CandidateReason[];
  targetLines: number[];
}

export function scorePathSignals(input: PathScoreInput): ScoredCandidate {
  const reasons: CandidateReason[] = [];
  const targetLines: number[] = [];
  const { relativePath, signals } = input;

  for (const hit of signals.stackHits) {
    if (
      hit.relativePath === relativePath &&
      hit.folderRoot === input.folderRoot
    ) {
      addReason(reasons, {
        type: "console-stack",
        explanation: "Console stack path matches this workspace file",
        weight: SCORE_WEIGHTS.consoleStack,
      });
      if (hit.line !== undefined) {
        targetLines.push(hit.line);
      }
    }
  }

  if (signals.routeSegments.some((segment) => pathContainsSegment(relativePath, segment))) {
    const segment = signals.routeSegments.find((item) => pathContainsSegment(relativePath, item));
    addReason(reasons, {
      type: "route",
      explanation: `Path segment '${segment ?? "route"}' matches file path`,
      weight: SCORE_WEIGHTS.route,
    });
    if (
      input.frameworkName !== undefined &&
      matchesFrameworkConvention(relativePath, input.frameworkName, signals.routeSegments)
    ) {
      addReason(reasons, {
        type: "framework-convention",
        explanation: `File path follows ${input.frameworkName} routing convention`,
        weight: SCORE_WEIGHTS.frameworkConvention,
      });
    }
  }

  if (signals.networkSegments.some((segment) => pathContainsSegment(relativePath, segment))) {
    const segment = signals.networkSegments.find((item) => pathContainsSegment(relativePath, item));
    addReason(reasons, {
      type: "network",
      explanation: `Network path segment '${segment ?? "request"}' matches file path`,
      weight: SCORE_WEIGHTS.network,
    });
  }

  if (signals.ids.some((id) => pathContainsSegment(relativePath, id) || basenameMatchesToken(relativePath, id))) {
    addReason(reasons, {
      type: "selector-id",
      explanation: "Selected element id matches file path",
      weight: SCORE_WEIGHTS.selectorId,
    });
  }

  if (
    signals.testIds.some(
      (testId) => pathContainsSegment(relativePath, testId) || basenameMatchesToken(relativePath, testId),
    )
  ) {
    addReason(reasons, {
      type: "selector-testid",
      explanation: "data-testid matches file path",
      weight: SCORE_WEIGHTS.selectorTestId,
    });
  }

  if (
    !GENERIC_SOURCE_BASENAMES.has(posixStem(relativePath).toLowerCase()) &&
    signals.componentTokens.some((token) => basenameMatchesToken(relativePath, token))
  ) {
    addReason(reasons, {
      type: "component-name",
      explanation: "Component or file name matches a selected-element token",
      weight: SCORE_WEIGHTS.componentName,
    });
  }

  if (signals.classes.some((className) => pathContainsSegment(relativePath, className))) {
    addReason(reasons, {
      type: "selector-class",
      explanation: "Selected class name matches file path",
      weight: SCORE_WEIGHTS.selectorClass,
    });
  }

  return {
    relativePath,
    workspaceFolder: input.folderName,
    workspaceRoot: input.folderRoot,
    score: sumWeights(reasons),
    reasons,
    targetLines,
  };
}

export function scoreContentSignals(
  current: ScoredCandidate,
  content: string,
  signals: SessionSignals,
): ScoredCandidate {
  const reasons = [...current.reasons];
  const targetLines = [...current.targetLines];
  const lower = content.toLowerCase();

  if (!hasReason(reasons, "selector-id")) {
    const idHit = firstPatternHit(content, idContentPatterns(signals.ids));
    if (idHit !== undefined) {
      addReason(reasons, {
        type: "selector-id",
        explanation: "Selected element id appears in this file",
        weight: SCORE_WEIGHTS.selectorId,
      });
      targetLines.push(idHit);
    }
  }

  if (!hasReason(reasons, "selector-testid")) {
    const testHit = firstPatternHit(content, testIdContentPatterns(signals.testIds));
    if (testHit !== undefined) {
      addReason(reasons, {
        type: "selector-testid",
        explanation: "data-testid appears in this file",
        weight: SCORE_WEIGHTS.selectorTestId,
      });
      targetLines.push(testHit);
    }
  }

  if (!hasReason(reasons, "selector-class")) {
    const classHit = firstPatternHit(content, classContentPatterns(signals.classes));
    if (classHit !== undefined) {
      addReason(reasons, {
        type: "selector-class",
        explanation: "Selected class name appears in this file",
        weight: SCORE_WEIGHTS.selectorClass,
      });
      targetLines.push(classHit);
    }
  }

  if (!hasReason(reasons, "text")) {
    const textHit = firstContentHit(content, lower, signals.textTerms);
    if (textHit !== undefined) {
      addReason(reasons, {
        type: "text",
        explanation: "Selected element text appears in this file",
        weight: SCORE_WEIGHTS.text,
      });
      targetLines.push(textHit);
    }
  }

  return {
    ...current,
    reasons,
    score: sumWeights(reasons),
    targetLines: uniqueSorted(targetLines),
  };
}

export function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  const folder = left.workspaceFolder.localeCompare(right.workspaceFolder);
  if (folder !== 0) {
    return folder;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

export function rankCandidates(candidates: ScoredCandidate[], limit = MAX_CANDIDATES): ScoredCandidate[] {
  return [...candidates]
    .filter((candidate) => candidate.score > 0)
    .sort(compareCandidates)
    .slice(0, limit);
}

export function toCandidateFile(
  candidate: ScoredCandidate,
  excerpts: CandidateFile["excerpts"],
): CandidateFile {
  return {
    relativePath: candidate.relativePath,
    workspaceFolder: candidate.workspaceFolder,
    workspaceRoot: candidate.workspaceRoot,
    score: candidate.score,
    reasons: candidate.reasons,
    excerpts,
  };
}

function addReason(reasons: CandidateReason[], reason: CandidateReason): void {
  if (hasReason(reasons, reason.type)) {
    return;
  }
  reasons.push(reason);
}

function hasReason(reasons: CandidateReason[], type: CandidateReasonType): boolean {
  return reasons.some((reason) => reason.type === type);
}

function sumWeights(reasons: CandidateReason[]): number {
  return reasons.reduce((total, reason) => total + reason.weight, 0);
}

function matchesFrameworkConvention(
  relativePath: string,
  frameworkName: string,
  routeSegments: string[],
): boolean {
  const path = relativePath.replaceAll("\\", "/").toLowerCase();
  if (frameworkName === "nextjs") {
    return routeSegments.some(
      (segment) =>
        path.includes(`/app/${segment.toLowerCase()}/page.`) ||
        path.includes(`/pages/${segment.toLowerCase()}.`) ||
        path.includes(`/pages/${segment.toLowerCase()}/index.`),
    );
  }
  if (frameworkName === "nuxt") {
    return routeSegments.some((segment) => path.includes(`/pages/${segment.toLowerCase()}`));
  }
  if (frameworkName === "svelte") {
    return routeSegments.some((segment) => path.includes(`/routes/${segment.toLowerCase()}`));
  }
  return false;
}

function firstContentHit(content: string, lower: string, terms: string[]): number | undefined {
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index >= 0) {
      return lineNumberAt(content, index);
    }
  }
  return undefined;
}

function firstPatternHit(content: string, patterns: string[]): number | undefined {
  for (const pattern of patterns) {
    const index = content.indexOf(pattern);
    if (index >= 0) {
      return lineNumberAt(content, index);
    }
  }
  return undefined;
}

function idContentPatterns(ids: string[]): string[] {
  return ids.flatMap((id) => [`id="${id}"`, `id='${id}'`, `#${id}`]);
}

function testIdContentPatterns(testIds: string[]): string[] {
  return testIds.flatMap((testId) => [
    `data-testid="${testId}"`,
    `data-testid='${testId}'`,
  ]);
}

function classContentPatterns(classes: string[]): string[] {
  return classes.flatMap((className) => [
    `.${className}`,
    `className="${className}"`,
    `className='${className}'`,
    `class="${className}"`,
    `class='${className}'`,
  ]);
}

export function lineNumberAt(content: string, index: number): number {
  let line = 1;
  const limit = Math.min(index, content.length);
  for (let cursor = 0; cursor < limit; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
