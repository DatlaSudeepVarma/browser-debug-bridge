import * as vscode from "vscode";
import type { DiagnosisTreeNode } from "./diagnosis-tree.js";
import { treeItemCommand } from "./diagnosis-tree.js";

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
  const command = treeItemCommand(node);
  if (command !== undefined) {
    item.command = {
      command: command.command,
      title: command.title,
      arguments: [...command.arguments],
    };
  }
  return item;
}
