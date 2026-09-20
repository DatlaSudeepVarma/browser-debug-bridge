import path from "node:path";
import * as vscode from "vscode";
import type { CandidateFileOpener } from "./open-candidate.js";

export function createVscodeCandidateOpener(): CandidateFileOpener {
  return {
    async exists(folderRoot: string, relativePath: string): Promise<boolean> {
      try {
        await vscode.workspace.fs.stat(toCandidateUri(folderRoot, relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async open(folderRoot: string, relativePath: string): Promise<void> {
      const document = await vscode.workspace.openTextDocument(toCandidateUri(folderRoot, relativePath));
      await vscode.window.showTextDocument(document, { preview: true });
    },
  };
}

export function toCandidateUri(folderRoot: string, relativePath: string): vscode.Uri {
  const segments = relativePath.split("/").filter((part) => part.length > 0);
  return vscode.Uri.file(path.join(folderRoot, ...segments));
}
