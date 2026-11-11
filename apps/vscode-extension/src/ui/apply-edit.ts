import * as vscode from "vscode";
import {
  commitApplyPlan,
  restoreApplyPlan,
  type ApplyDocumentBatch,
  type ApplyTextDocument,
} from "../fix/apply-documents.js";
import { nodeCanonicalIo, recheckApplyCanonicalPath } from "../fix/canonical-path.js";
import type { WorkspaceFileWriter, WorkspaceWriteResult } from "../fix/run-apply.js";
import type { SafeApplyPlan } from "../fix/types.js";

interface VscodeApplyDocument extends ApplyTextDocument {
  readonly textDocument: vscode.TextDocument;
}

/**
 * The only workspace write path. One WorkspaceEdit covers every planned file.
 * Each target is resolved again immediately before the edit, and the edit
 * opens that real path. A path that moved is refused. Nothing is written if
 * any target is dirty or its buffer disagrees with the plan. A failed save
 * rolls the already-saved files back to currentContent. restore() puts a
 * finished write back when the bytes on disk do not match.
 */
export function createVscodeApplyWriter(): WorkspaceFileWriter {
  const batch = createVscodeBatch();
  return {
    async write(plan: SafeApplyPlan): Promise<WorkspaceWriteResult> {
      const canonicalPaths: string[] = [];
      for (const file of plan.files) {
        const checked = recheckApplyCanonicalPath(file, nodeCanonicalIo);
        if (checked.status !== "ok") {
          return { status: "mismatch" };
        }
        canonicalPaths.push(checked.canonicalPath);
      }
      return commitApplyPlan(
        {
          ...plan,
          files: plan.files.map((file, index) => ({
            ...file,
            canonicalPath: canonicalPaths[index] ?? file.canonicalPath,
          })),
        },
        batch,
      );
    },
    restore(plan: SafeApplyPlan): Promise<"restored" | "unrestored"> {
      return restoreApplyPlan(plan, batch);
    },
  };
}

function createVscodeBatch(): ApplyDocumentBatch<VscodeApplyDocument> {
  return {
    async open(file): Promise<VscodeApplyDocument | undefined> {
      if (file.canonicalPath === undefined || file.canonicalPath.length === 0) {
        return undefined;
      }
      try {
        const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(file.canonicalPath));
        return {
          textDocument,
          get isDirty(): boolean {
            return textDocument.isDirty;
          },
          getText(): string {
            return textDocument.getText();
          },
          save(): Promise<boolean> {
            return Promise.resolve(textDocument.save());
          },
        };
      } catch {
        return undefined;
      }
    },
    async replaceAll(entries): Promise<boolean> {
      const edit = new vscode.WorkspaceEdit();
      for (const entry of entries) {
        const document = entry.document.textDocument;
        const end = document.lineAt(Math.max(document.lineCount - 1, 0)).range.end;
        edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(0, 0), end),
          entry.next,
        );
      }
      try {
        return (await vscode.workspace.applyEdit(edit)) === true;
      } catch {
        return false;
      }
    },
  };
}
