import * as vscode from "vscode";
import type { WorkspaceFileWriter, WorkspaceWriteResult } from "../fix/run-apply.js";
import type { SafeApplyPlan } from "../fix/types.js";
import { toCandidateUri } from "./vscode-open.js";

/**
 * The only workspace write path. One WorkspaceEdit covers every planned file.
 * Nothing is written if any target is dirty or its buffer disagrees with the
 * plan. applyEdit false means no change was made. A failed save is reported
 * and is not rolled back.
 */
export function createVscodeApplyWriter(): WorkspaceFileWriter {
  return {
    async write(plan: SafeApplyPlan): Promise<WorkspaceWriteResult> {
      const edit = new vscode.WorkspaceEdit();
      const documents: vscode.TextDocument[] = [];
      for (const file of plan.files) {
        let document: vscode.TextDocument;
        try {
          document = await vscode.workspace.openTextDocument(
            toCandidateUri(file.workspaceRoot, file.relativePath),
          );
        } catch {
          return { status: "not-applied" };
        }
        if (document.isDirty) {
          return { status: "dirty" };
        }
        if (document.getText() !== file.currentContent) {
          return { status: "mismatch" };
        }
        const end = document.lineAt(Math.max(document.lineCount - 1, 0)).range.end;
        edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), file.proposedContent);
        documents.push(document);
      }
      let applied = false;
      try {
        applied = await vscode.workspace.applyEdit(edit);
      } catch {
        return { status: "not-applied" };
      }
      if (!applied) {
        return { status: "not-applied" };
      }
      for (const document of documents) {
        try {
          if ((await document.save()) !== true) {
            return { status: "unsaved" };
          }
        } catch {
          return { status: "unsaved" };
        }
      }
      return { status: "applied" };
    },
  };
}
