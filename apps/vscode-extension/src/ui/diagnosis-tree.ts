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
import { OPEN_CANDIDATE_COMMAND, REVIEW_FIX_COMMAND } from "./constants.js";
import type { DiagnosisViewState } from "./diagnosis-state.js";
import { asPlainTooltip, asPlainTreeText } from "./plain-text.js";

export type TreeIcon = "lightbulb" | "file" | "diff" | "warning" | "pass" | "error" | "sync" | "info";

export interface DiagnosisTreeActivity {
  diagnosing: boolean;
  proposing: boolean;
  applying: boolean;
  statusDetail?: string;
}

export interface DiagnosisTreeCommand {
  command: string;
  title: string;
  arguments: readonly (string | number)[];
}

export type DiagnosisTreeNode = (
  | { kind: "summary"; id: string; label: string; tooltip: string }
  | { kind: "summary-text"; id: string; label: string; tooltip: string }
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
  | { kind: "proposal-diff"; id: string; label: string; tooltip: string }
) & {
  description?: string;
  icon?: TreeIcon;
  expanded?: boolean;
  line?: number;
  relativePath?: string;
};

export function getRootNodes(state: DiagnosisViewState | undefined): DiagnosisTreeNode[] {
  if (state === undefined) {
    return [];
  }
  const { diagnosis } = state;
  const nodes: DiagnosisTreeNode[] = [
    {
      kind: "summary",
      id: "summary",
      label: "Summary",
      description: asPlainTreeText(diagnosis.summary),
      tooltip: asPlainTooltip(diagnosis.summary),
      icon: "info",
      expanded: true,
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
  activity?: DiagnosisTreeActivity,
): DiagnosisTreeNode[] {
  switch (node.kind) {
    case "summary":
      return [
        {
          kind: "summary-text",
          id: "summary-text",
          label: asPlainTreeText(state.diagnosis.summary, 240),
          tooltip: asPlainTooltip(state.diagnosis.summary),
        },
      ];
    case "hypotheses":
      return state.diagnosis.hypotheses.map((hypothesis, index) => ({
        kind: "hypothesis" as const,
        id: `hypothesis:${String(index)}`,
        index,
        label: asPlainTreeText(hypothesis.title),
        description: asPlainTreeText(hypothesis.explanation),
        tooltip: asPlainTooltip(`${hypothesis.title}\n${hypothesis.explanation}`),
        icon: "lightbulb" as const,
        expanded: index === 0,
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
        state.diagnosis.hypotheses[hypothesisIndexFromId(node.id)]?.candidateFiles ?? [],
        node.id,
        state.project,
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
        icon: "warning",
      }));
    case "proposed-fix":
      return proposedFixChildren(proposal, activity);
    case "proposal-files":
      return proposalFileNodes(proposal?.proposal);
    default:
      return [];
  }
}

export function openableRelativePath(node: DiagnosisTreeNode): string | undefined {
  if (
    node.kind === "candidate" ||
    node.kind === "candidate-group" ||
    node.kind === "excerpt" ||
    (node.kind === "evidence-ref" && node.relativePath !== undefined)
  ) {
    return node.relativePath;
  }
  return undefined;
}

export function treeItemCommand(node: DiagnosisTreeNode): DiagnosisTreeCommand | undefined {
  if (node.kind === "proposal-diff" || node.kind === "proposal-file") {
    return {
      command: REVIEW_FIX_COMMAND,
      title: "Open diff",
      arguments: [],
    };
  }
  const relativePath = openableRelativePath(node);
  if (relativePath === undefined) {
    return undefined;
  }
  return {
    command: OPEN_CANDIDATE_COMMAND,
    title: "Open Candidate File",
    arguments: node.line === undefined ? [relativePath] : [relativePath, node.line],
  };
}

export function nodeCanHaveChildren(node: DiagnosisTreeNode): boolean {
  switch (node.kind) {
    case "summary":
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
  activity?: DiagnosisTreeActivity,
): DiagnosisTreeNode[] {
  if (state === undefined) {
    return [];
  }
  const nodes: DiagnosisTreeNode[] = [];
  const walk = (current: DiagnosisTreeNode[]): void => {
    for (const node of current) {
      nodes.push(node);
      walk(getChildNodes(state, node, proposal, activity));
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
    nodes.push(candidateNode(relativePath, `project-evidence:candidate:${String(candidateIndex)}`, state.project, item.detail));
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

function candidateNode(
  relativePath: string,
  id: string,
  project: ProjectContext,
  reason?: string,
): DiagnosisTreeNode {
  const candidate = findCandidate(project, relativePath);
  const explanation = (reason?.trim() || candidate?.reasons[0]?.explanation || "").trim();
  return {
    kind: "candidate",
    id,
    label: asPlainTreeText(relativePath),
    description: explanation.length > 0 ? asPlainTreeText(explanation) : undefined,
    tooltip: asPlainTooltip(explanation.length > 0 ? explanation : relativePath),
    relativePath,
    line: candidate?.excerpts[0]?.startLine,
    icon: "file",
  };
}

function candidateFileNodes(
  files: readonly { relativePath: string; reason?: string }[],
  parentId: string,
  project: ProjectContext,
): DiagnosisTreeNode[] {
  return files.map((file, index) =>
    candidateNode(file.relativePath, `${parentId}:${String(index)}`, project, file.reason),
  );
}

function evidenceRefNodes(items: DiagnosisEvidence[], parentId: string): DiagnosisTreeNode[] {
  return items.map((item, index) => ({
    kind: "evidence-ref" as const,
    id: `${parentId}:${String(index)}`,
    label: asPlainTreeText(formatEvidenceLabel(item.source)),
    description: item.detail.trim().length > 0 ? asPlainTreeText(item.detail) : undefined,
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

function proposedFixChildren(
  proposal?: ProposalTreeState,
  activity?: DiagnosisTreeActivity,
): DiagnosisTreeNode[] {
  if (activity?.diagnosing === true || activity?.proposing === true) {
    const diagnosing = activity.diagnosing === true;
    return [
      {
        kind: "proposal-status",
        id: "proposal-status",
        label: diagnosing ? "Status: Diagnosing…" : "Status: Proposing a fix…",
        tooltip: diagnosing
          ? "A diagnosis is running. The previous proposal stays hidden until it finishes."
          : "A fix proposal is running. No workspace files are being modified.",
        icon: "sync",
      },
    ];
  }
  const nodes: DiagnosisTreeNode[] = [
    {
      kind: "proposal-status",
      id: "proposal-status",
      label: proposalStatusLabel(proposal),
      tooltip:
        activity?.statusDetail !== undefined && activity.statusDetail.trim().length > 0
          ? asPlainTooltip(activity.statusDetail)
          : proposalStatusTooltip(proposal, activity),
      icon: proposalStatusIcon(proposal),
      description:
        activity?.statusDetail !== undefined && activity.statusDetail.trim().length > 0
          ? asPlainTreeText(activity.statusDetail)
          : undefined,
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
      label: "Open diff",
      icon: "diff",
      tooltip:
        "Open a native diff of the current file against the proposed change. No workspace files will be written.",
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
    description: "Open diff",
    tooltip: asPlainTooltip(`${change.relativePath}\nOpen diff. No workspace files will be written.`),
    relativePath: change.relativePath,
    icon: "file",
  }));
}

function proposalStatusLabel(proposal?: ProposalTreeState): string {
  if (proposal?.generating === true) {
    return "Status: Generating";
  }
  if (proposal?.proposal !== undefined && proposal.reviewed === true) {
    return "Status: Reviewed";
  }
  if (proposal?.proposal !== undefined) {
    return "Status: Ready for review";
  }
  if (proposal?.lastOutcome === "failed") {
    return "Status: Failed";
  }
  if (proposal?.lastOutcome === "cancelled") {
    return "Status: Cancelled";
  }
  if (proposal?.lastOutcome === "rejected") {
    return "Status: Rejected";
  }
  if (proposal?.lastOutcome === "applied") {
    return "Status: Applied";
  }
  return "Status: Not generated";
}

function proposalStatusIcon(proposal?: ProposalTreeState): TreeIcon {
  if (proposal?.proposal !== undefined && proposal.reviewed === true) {
    return "pass";
  }
  if (proposal?.proposal !== undefined) {
    return "diff";
  }
  if (proposal?.lastOutcome === "failed") {
    return "error";
  }
  if (proposal?.lastOutcome === "cancelled" || proposal?.lastOutcome === "rejected") {
    return "warning";
  }
  if (proposal?.lastOutcome === "applied") {
    return "pass";
  }
  return "info";
}

function proposalStatusTooltip(proposal?: ProposalTreeState, activity?: DiagnosisTreeActivity): string {
  if (proposal?.proposal !== undefined && proposal.reviewed === true) {
    return "Diff opened. Apply is available. No workspace files have been written.";
  }
  if (proposal?.proposal !== undefined) {
    return "In-memory proposed change. Open the diff before applying. No workspace files have been written.";
  }
  if (activity?.statusDetail !== undefined && activity.statusDetail.trim().length > 0) {
    return asPlainTooltip(activity.statusDetail);
  }
  if (proposal?.lastOutcome === "rejected") {
    return 'The proposed change was discarded without modifying any files. Run "Browser Debug Bridge: Propose Fix" to generate another suggestion.';
  }
  if (proposal?.lastOutcome === "applied") {
    return "The proposed change was written to the workspace. Generate another proposal if you want a further suggestion.";
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
