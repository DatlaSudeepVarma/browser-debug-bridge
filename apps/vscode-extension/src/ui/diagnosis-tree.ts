import type { Diagnosis, DiagnosisEvidence } from "../ai/types.js";
import type { StoredProposal } from "../fix/types.js";
import type { ProposalTreeState } from "../fix/proposal-state.js";
import type { CandidateFile, ProjectContext } from "../project/types.js";
import {
  formatEvidenceLabel,
  isBrowserEvidence,
  isProjectEvidence,
  parseEvidenceRef,
} from "./evidence-refs.js";
import type { DiagnosisViewState } from "./diagnosis-state.js";
import { asPlainTooltip, asPlainTreeText } from "./plain-text.js";

export type DiagnosisTreeNode =
  | { kind: "summary"; id: string; label: string; tooltip: string }
  | { kind: "hypotheses"; id: string; label: string }
  | {
      kind: "hypothesis";
      id: string;
      index: number;
      label: string;
      tooltip: string;
    }
  | { kind: "explanation"; id: string; label: string; tooltip: string }
  | { kind: "hypothesis-evidence"; id: string; label: string }
  | { kind: "hypothesis-candidates"; id: string; label: string }
  | {
      kind: "evidence-ref";
      id: string;
      label: string;
      tooltip: string;
      source: string;
    }
  | { kind: "suggested-next-step"; id: string; label: string }
  | {
      kind: "suggested-next-step-text";
      id: string;
      label: string;
      tooltip: string;
    }
  | { kind: "evidence"; id: string; label: string }
  | { kind: "browser-evidence"; id: string; label: string }
  | { kind: "project-evidence"; id: string; label: string }
  | {
      kind: "candidate-group";
      id: string;
      label: string;
      tooltip: string;
      relativePath: string;
    }
  | {
      kind: "candidate";
      id: string;
      label: string;
      tooltip: string;
      relativePath: string;
    }
  | {
      kind: "excerpt";
      id: string;
      label: string;
      tooltip: string;
      relativePath?: string;
    }
  | { kind: "limitations"; id: string; label: string }
  | { kind: "limitation"; id: string; label: string; tooltip: string }
  | { kind: "proposed-fix"; id: string; label: string }
  | { kind: "proposal-status"; id: string; label: string; tooltip: string }
  | { kind: "proposal-summary"; id: string; label: string; tooltip: string }
  | { kind: "proposal-rationale"; id: string; label: string; tooltip: string }
  | { kind: "proposal-files"; id: string; label: string }
  | {
      kind: "proposal-file";
      id: string;
      label: string;
      tooltip: string;
      relativePath: string;
    }
  | { kind: "proposal-changes"; id: string; label: string }
  | { kind: "proposal-diff"; id: string; label: string; tooltip: string };

export function getRootNodes(state: DiagnosisViewState | undefined): DiagnosisTreeNode[] {
  if (state === undefined) {
    return [];
  }
  const { diagnosis } = state;
  const nodes: DiagnosisTreeNode[] = [
    {
      kind: "summary",
      id: "summary",
      label: asPlainTreeText(diagnosis.summary),
      tooltip: asPlainTooltip(diagnosis.summary),
    },
  ];
  if (diagnosis.hypotheses.length > 0) {
    nodes.push({
      kind: "hypotheses",
      id: "hypotheses",
      label: `Hypotheses (${String(diagnosis.hypotheses.length)})`,
    });
  }
  if (diagnosis.suggestedNextStep.trim().length > 0) {
    nodes.push({
      kind: "suggested-next-step",
      id: "suggested-next-step",
      label: "Suggested Next Step",
    });
  }
  if (collectEvidence(diagnosis, state.project).length > 0) {
    nodes.push({ kind: "evidence", id: "evidence", label: "Evidence" });
  }
  if (diagnosis.limitations.length > 0) {
    nodes.push({
      kind: "limitations",
      id: "limitations",
      label: `Limitations (${String(diagnosis.limitations.length)})`,
    });
  }
  nodes.push({
    kind: "proposed-fix",
    id: "proposed-fix",
    label: "Proposed Fix",
  });
  return nodes;
}

export function getChildNodes(
  state: DiagnosisViewState,
  node: DiagnosisTreeNode,
  proposal?: ProposalTreeState,
): DiagnosisTreeNode[] {
  switch (node.kind) {
    case "hypotheses":
      return state.diagnosis.hypotheses.map((hypothesis, index) => ({
        kind: "hypothesis" as const,
        id: `hypothesis:${String(index)}`,
        index,
        label: asPlainTreeText(hypothesis.title),
        tooltip: asPlainTooltip(hypothesis.title),
      }));
    case "hypothesis":
      return hypothesisChildren(state, node.index);
    case "hypothesis-evidence":
      return evidenceRefNodes(
        state.diagnosis.hypotheses[hypothesisIndexFromId(node.id)]?.evidence ?? [],
        node.id,
      );
    case "hypothesis-candidates":
      return candidateFileNodes(
        state.diagnosis.hypotheses[hypothesisIndexFromId(node.id)]?.candidateFiles.map(
          (file) => file.relativePath,
        ) ?? [],
        node.id,
      );
    case "suggested-next-step":
      return [
        {
          kind: "suggested-next-step-text",
          id: "suggested-next-step-text",
          label: asPlainTreeText(state.diagnosis.suggestedNextStep),
          tooltip: asPlainTooltip(state.diagnosis.suggestedNextStep),
        },
      ];
    case "evidence":
      return evidenceSectionChildren(state);
    case "browser-evidence":
      return evidenceRefNodes(
        collectEvidence(state.diagnosis, state.project).filter((item) => isBrowserEvidence(item.source)),
        "browser-evidence",
      );
    case "project-evidence":
      return projectEvidenceChildren(state);
    case "candidate-group":
      return candidateDetailChildren(state.project, node.relativePath, node.id);
    case "limitations":
      return state.diagnosis.limitations.map((limitation, index) => ({
        kind: "limitation" as const,
        id: `limitation:${String(index)}`,
        label: asPlainTreeText(limitation),
        tooltip: asPlainTooltip(limitation),
      }));
    case "proposed-fix":
      return proposedFixChildren(proposal);
    case "proposal-files":
      return proposalFileNodes(proposal?.proposal);
    default:
      return [];
  }
}

export function openableRelativePath(node: DiagnosisTreeNode): string | undefined {
  if (node.kind === "candidate" || node.kind === "candidate-group" || node.kind === "proposal-file") {
    return node.relativePath;
  }
  if (node.kind === "excerpt") {
    return node.relativePath;
  }
  return undefined;
}

export function nodeCanHaveChildren(node: DiagnosisTreeNode): boolean {
  switch (node.kind) {
    case "hypotheses":
    case "hypothesis":
    case "hypothesis-evidence":
    case "hypothesis-candidates":
    case "suggested-next-step":
    case "evidence":
    case "browser-evidence":
    case "project-evidence":
    case "candidate-group":
    case "limitations":
    case "proposed-fix":
    case "proposal-files":
      return true;
    default:
      return false;
  }
}

export function collectTreeNodes(
  state: DiagnosisViewState | undefined,
  proposal?: ProposalTreeState,
): DiagnosisTreeNode[] {
  if (state === undefined) {
    return [];
  }
  const nodes: DiagnosisTreeNode[] = [];
  const walk = (current: DiagnosisTreeNode[]): void => {
    for (const node of current) {
      nodes.push(node);
      walk(getChildNodes(state, node, proposal));
    }
  };
  walk(getRootNodes(state));
  return nodes;
}

function hypothesisChildren(state: DiagnosisViewState, index: number): DiagnosisTreeNode[] {
  const hypothesis = state.diagnosis.hypotheses[index];
  if (hypothesis === undefined) {
    return [];
  }
  const nodes: DiagnosisTreeNode[] = [
    {
      kind: "explanation",
      id: `hypothesis:${String(index)}:explanation`,
      label: asPlainTreeText(hypothesis.explanation),
      tooltip: asPlainTooltip(hypothesis.explanation),
    },
  ];
  if (hypothesis.evidence.length > 0) {
    nodes.push({
      kind: "hypothesis-evidence",
      id: `hypothesis:${String(index)}:evidence`,
      label: "Evidence",
    });
  }
  if (hypothesis.candidateFiles.length > 0) {
    nodes.push({
      kind: "hypothesis-candidates",
      id: `hypothesis:${String(index)}:candidates`,
      label: "Candidate Files",
    });
  }
  return nodes;
}

function evidenceSectionChildren(state: DiagnosisViewState): DiagnosisTreeNode[] {
  const evidence = collectEvidence(state.diagnosis, state.project);
  const nodes: DiagnosisTreeNode[] = [];
  if (evidence.some((item) => isBrowserEvidence(item.source))) {
    nodes.push({ kind: "browser-evidence", id: "browser-evidence", label: "Browser" });
  }
  if (evidence.some((item) => isProjectEvidence(item.source))) {
    nodes.push({ kind: "project-evidence", id: "project-evidence", label: "Project" });
  }
  return nodes;
}

function projectEvidenceChildren(state: DiagnosisViewState): DiagnosisTreeNode[] {
  const evidence = collectEvidence(state.diagnosis, state.project).filter((item) =>
    isProjectEvidence(item.source),
  );
  const nodes: DiagnosisTreeNode[] = [];
  const seenCandidates = new Set<number>();
  for (const item of evidence) {
    const parsed = parseEvidenceRef(item.source);
    if (parsed?.kind === "framework") {
      nodes.push({
        kind: "evidence-ref",
        id: `project-evidence:${item.source}`,
        label: formatEvidenceLabel(item.source),
        tooltip: evidenceTooltip(item),
        source: item.source,
      });
      continue;
    }
    const candidateIndex =
      parsed?.kind === "candidate"
        ? parsed.index
        : parsed?.kind === "excerpt"
          ? parsed.candidateIndex
          : undefined;
    if (candidateIndex === undefined || seenCandidates.has(candidateIndex)) {
      continue;
    }
    seenCandidates.add(candidateIndex);
    const candidate = state.project.candidates[candidateIndex];
    const relativePath = candidate?.relativePath ?? `candidate[${String(candidateIndex)}]`;
    const hasExcerpts = (candidate?.excerpts.length ?? 0) > 0;
    if (hasExcerpts && candidate !== undefined) {
      nodes.push({
        kind: "candidate-group",
        id: `project-evidence:candidate:${String(candidateIndex)}`,
        label: asPlainTreeText(relativePath),
        tooltip: asPlainTooltip(relativePath),
        relativePath: candidate.relativePath,
      });
    } else {
      nodes.push({
        kind: "candidate",
        id: `project-evidence:candidate:${String(candidateIndex)}`,
        label: asPlainTreeText(relativePath),
        tooltip: asPlainTooltip(relativePath),
        relativePath,
      });
    }
  }
  return nodes;
}

function candidateDetailChildren(
  project: ProjectContext,
  relativePath: string,
  parentId: string,
): DiagnosisTreeNode[] {
  const candidate = findCandidate(project, relativePath);
  const nodes: DiagnosisTreeNode[] = [
    {
      kind: "candidate",
      id: `${parentId}:file`,
      label: asPlainTreeText(relativePath),
      tooltip: asPlainTooltip(relativePath),
      relativePath,
    },
  ];
  candidate?.excerpts.forEach((excerpt, index) => {
    nodes.push(excerptNode(excerpt.content, `${parentId}:excerpt:${String(index)}`, relativePath));
  });
  return nodes;
}

function candidateFileNodes(paths: string[], parentId: string): DiagnosisTreeNode[] {
  return paths.map((relativePath, index) => ({
    kind: "candidate" as const,
    id: `${parentId}:${String(index)}`,
    label: asPlainTreeText(relativePath),
    tooltip: asPlainTooltip(relativePath),
    relativePath,
  }));
}

function evidenceRefNodes(items: DiagnosisEvidence[], parentId: string): DiagnosisTreeNode[] {
  return items.map((item, index) => ({
    kind: "evidence-ref" as const,
    id: `${parentId}:${String(index)}`,
    label: asPlainTreeText(formatEvidenceLabel(item.source)),
    tooltip: evidenceTooltip(item),
    source: item.source,
  }));
}

function excerptNode(content: string, id: string, relativePath?: string): DiagnosisTreeNode {
  return {
    kind: "excerpt",
    id,
    label: asPlainTreeText(content),
    tooltip: asPlainTooltip(content),
    relativePath,
  };
}

function evidenceTooltip(item: DiagnosisEvidence): string {
  const detail = item.detail.trim();
  if (detail.length === 0) {
    return item.source;
  }
  return asPlainTooltip(`${item.source}: ${detail}`);
}

function collectEvidence(diagnosis: Diagnosis, project: ProjectContext): DiagnosisEvidence[] {
  const refs: DiagnosisEvidence[] = [];
  const seen = new Set<string>();
  const add = (item: DiagnosisEvidence): void => {
    if (seen.has(item.source)) {
      return;
    }
    seen.add(item.source);
    refs.push(item);
  };
  for (const hypothesis of diagnosis.hypotheses) {
    for (const item of hypothesis.evidence) {
      add(item);
    }
    for (const file of hypothesis.candidateFiles) {
      const index = project.candidates.findIndex((candidate) => candidate.relativePath === file.relativePath);
      if (index < 0) {
        continue;
      }
      add({ source: `PROJECT.candidate[${String(index)}]`, detail: file.reason });
    }
  }
  return refs;
}

function proposedFixChildren(proposal?: ProposalTreeState): DiagnosisTreeNode[] {
  const nodes: DiagnosisTreeNode[] = [
    {
      kind: "proposal-status",
      id: "proposal-status",
      label: proposalStatusLabel(proposal),
      tooltip: proposalStatusTooltip(proposal),
    },
  ];
  const stored = proposal?.proposal;
  if (stored === undefined) {
    return nodes;
  }
  nodes.push(
    {
      kind: "proposal-summary",
      id: "proposal-summary",
      label: asPlainTreeText(stored.proposedChange.summary),
      tooltip: asPlainTooltip(stored.proposedChange.summary),
    },
    {
      kind: "proposal-rationale",
      id: "proposal-rationale",
      label: asPlainTreeText(stored.proposedChange.rationale),
      tooltip: asPlainTooltip(stored.proposedChange.rationale),
    },
    {
      kind: "proposal-files",
      id: "proposal-files",
      label: `Files (${String(stored.diff.fileCount)})`,
    },
    {
      kind: "proposal-changes",
      id: "proposal-changes",
      label: `${String(editCount(stored))} edit${editCount(stored) === 1 ? "" : "s"}`,
    },
    {
      kind: "proposal-diff",
      id: "proposal-diff",
      label: "Ready for review",
      tooltip: "Unified diff generated in memory. No workspace files were changed.",
    },
  );
  return nodes;
}

function proposalFileNodes(stored: StoredProposal | undefined): DiagnosisTreeNode[] {
  if (stored === undefined) {
    return [];
  }
  return stored.proposedChange.changes.map((change, index) => ({
    kind: "proposal-file" as const,
    id: `proposal-file:${String(index)}`,
    label: asPlainTreeText(change.relativePath),
    tooltip: asPlainTooltip(change.relativePath),
    relativePath: change.relativePath,
  }));
}

function proposalStatusLabel(proposal?: ProposalTreeState): string {
  if (proposal?.generating === true) {
    return "Status: Generating";
  }
  if (proposal?.proposal !== undefined) {
    return "Status: Ready";
  }
  if (proposal?.lastOutcome === "failed") {
    return "Status: Failed";
  }
  if (proposal?.lastOutcome === "cancelled") {
    return "Status: Cancelled";
  }
  return "Status: Not generated";
}

function proposalStatusTooltip(proposal?: ProposalTreeState): string {
  if (proposal?.proposal !== undefined) {
    return "In-memory proposed change. It has not been applied.";
  }
  return 'Run "Browser Debug Bridge: Propose Fix" to generate a suggested change.';
}

function editCount(stored: StoredProposal): number {
  return stored.proposedChange.changes.reduce((total, change) => total + change.edits.length, 0);
}

function hypothesisIndexFromId(id: string): number {
  const match = /^hypothesis:(\d+):/.exec(id);
  return match?.[1] === undefined ? -1 : Number(match[1]);
}

export function findCandidate(
  project: ProjectContext,
  relativePath: string,
): CandidateFile | undefined {
  return project.candidates.find((candidate) => candidate.relativePath === relativePath);
}
