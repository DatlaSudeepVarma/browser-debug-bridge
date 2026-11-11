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
    async open(folderRoot: string, relativePath: string, line?: number): Promise<void> {
      const document = await vscode.workspace.openTextDocument(toCandidateUri(folderRoot, relativePath));
      await vscode.window.showTextDocument(document, {
        preview: true,
        selection: lineSelection(line),
      });
    },
  };
}

function lineSelection(line: number | undefined): vscode.Range | undefined {
  if (line === undefined || !Number.isInteger(line) || line < 1 || line > 1_000_000) {
    return undefined;
  }
  const position = new vscode.Position(line - 1, 0);
  return new vscode.Range(position, position);
}

export function toCandidateUri(folderRoot: string, relativePath: string): vscode.Uri {
  const segments = relativePath.split("/").filter((part) => part.length > 0);
  return vscode.Uri.file(path.join(folderRoot, ...segments));
}
