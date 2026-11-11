import * as vscode from "vscode";
import type { DiagnosisTreeNode } from "./diagnosis-tree.js";
import { treeItemCommand } from "./diagnosis-tree.js";

export function toDiagnosisTreeItem(node: DiagnosisTreeNode, hasChildren: boolean): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.label,
    hasChildren
      ? node.expanded === true
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  item.id = node.id;
  item.contextValue = node.kind;
  if (node.description !== undefined && node.description.length > 0) {
    item.description = node.description;
  }
  if ("tooltip" in node && node.tooltip !== undefined) {
    item.tooltip = node.tooltip;
  }
  if (node.icon !== undefined) {
    item.iconPath = new vscode.ThemeIcon(node.icon);
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
