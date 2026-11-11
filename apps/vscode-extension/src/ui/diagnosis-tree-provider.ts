import * as vscode from "vscode";
import type { FixProposalController } from "../fix/proposal-state.js";
import type { DiagnosisController } from "./diagnosis-state.js";
import {
  getChildNodes,
  getRootNodes,
  nodeCanHaveChildren,
  type DiagnosisTreeActivity,
  type DiagnosisTreeNode,
} from "./diagnosis-tree.js";
import { toDiagnosisTreeItem } from "./diagnosis-tree-item.js";

export class DiagnosisTreeProvider implements vscode.TreeDataProvider<DiagnosisTreeNode> {
  private readonly emitter = new vscode.EventEmitter<DiagnosisTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  private view: vscode.TreeView<DiagnosisTreeNode> | undefined;
  private readonly activity: DiagnosisTreeActivity = {
    diagnosing: false,
    proposing: false,
    applying: false,
  };

  public constructor(
    private readonly controller: DiagnosisController,
    private readonly proposalController: FixProposalController,
  ) {}

  public attachView(view: vscode.TreeView<DiagnosisTreeNode>): void {
    this.view = view;
    this.syncChrome();
  }

  public setActivity(patch: Partial<DiagnosisTreeActivity>): void {
    if (patch.diagnosing !== undefined) {
      this.activity.diagnosing = patch.diagnosing;
    }
    if (patch.proposing !== undefined) {
      this.activity.proposing = patch.proposing;
    }
    if (patch.applying !== undefined) {
      this.activity.applying = patch.applying;
    }
    if ("statusDetail" in patch) {
      this.activity.statusDetail = patch.statusDetail;
    }
    this.refresh();
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
    return getChildNodes(state, element, proposal, this.activity);
  }

  public refresh(): void {
    this.syncChrome();
    this.emitter.fire(undefined);
  }

  private syncChrome(): void {
    if (this.view === undefined) {
      return;
    }
    this.view.message = undefined;
    if (this.activity.diagnosing) {
      this.view.description = "Diagnosing…";
      return;
    }
    if (this.activity.proposing) {
      this.view.description = "Proposing a fix…";
      return;
    }
    if (this.activity.applying || this.proposalController.isApplying()) {
      this.view.description = "Applying…";
      return;
    }
    this.view.description = "";
  }
}
