import * as vscode from "vscode";
import { OPEN_CANDIDATE_COMMAND } from "./constants.js";
import type { DiagnosisTreeNode } from "./diagnosis-tree.js";

export function toDiagnosisTreeItem(node: DiagnosisTreeNode, hasChildren: boolean): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.label,
    hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
  );
  item.id = node.id;
  item.contextValue = node.kind;
  if ("tooltip" in node) {
    item.tooltip = node.tooltip;
  }
  const relativePath = candidatePath(node);
  if (relativePath !== undefined) {
    item.command = {
      command: OPEN_CANDIDATE_COMMAND,
      title: "Open Candidate File",
      arguments: [relativePath],
    };
  }
  return item;
}

function candidatePath(node: DiagnosisTreeNode): string | undefined {
  if (node.kind === "candidate" || node.kind === "candidate-group") {
    return node.relativePath;
  }
  if (node.kind === "excerpt") {
    return node.relativePath;
  }
  return undefined;
}
