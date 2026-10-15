import * as vscode from "vscode";
import type { FixProposalController } from "../fix/proposal-state.js";
import type { DiagnosisController } from "./diagnosis-state.js";
import {
  getChildNodes,
  getRootNodes,
  nodeCanHaveChildren,
  type DiagnosisTreeNode,
} from "./diagnosis-tree.js";
import { toDiagnosisTreeItem } from "./diagnosis-tree-item.js";
import { EMPTY_DIAGNOSIS_MESSAGE } from "./messages.js";

export class DiagnosisTreeProvider implements vscode.TreeDataProvider<DiagnosisTreeNode> {
  private readonly emitter = new vscode.EventEmitter<DiagnosisTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  private view: vscode.TreeView<DiagnosisTreeNode> | undefined;

  public constructor(
    private readonly controller: DiagnosisController,
    private readonly proposalController: FixProposalController,
  ) {}

  public attachView(view: vscode.TreeView<DiagnosisTreeNode>): void {
    this.view = view;
    this.syncEmptyState();
  }

  public getTreeItem(element: DiagnosisTreeNode): vscode.TreeItem {
    return toDiagnosisTreeItem(element, nodeCanHaveChildren(element));
  }

  public getChildren(element?: DiagnosisTreeNode): DiagnosisTreeNode[] {
    const state = this.controller.getDiagnosis();
    const proposal = this.proposalController.getTreeState();
    if (element === undefined) {
      return getRootNodes(state);
    }
    if (state === undefined) {
      return [];
    }
    return getChildNodes(state, element, proposal);
  }

  public refresh(): void {
    this.syncEmptyState();
    this.emitter.fire(undefined);
  }

  private syncEmptyState(): void {
    if (this.view === undefined) {
      return;
    }
    this.view.message = this.controller.getDiagnosis() === undefined ? EMPTY_DIAGNOSIS_MESSAGE : undefined;
  }
}
