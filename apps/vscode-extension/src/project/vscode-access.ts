import path from "node:path";
import * as vscode from "vscode";
import {
  MAX_DISCOVERED_FILES,
  MAX_SOURCE_FILE_BYTES,
  VSCODE_EXCLUDE,
  VSCODE_MANIFEST_INCLUDE,
  VSCODE_SOURCE_INCLUDE,
} from "./constants.js";
import { throwIfCancelled } from "./cancellation.js";
import { splitLines } from "./excerpts.js";
import type {
  CancellationTokenLike,
  DiscoveredFile,
  FileQuery,
  WorkspaceAccess,
  WorkspaceFileRead,
  WorkspaceFolderRef,
} from "./types.js";
import {
  filterSafeDiscoveredFiles,
  isManifestFileName,
  isSourceFileName,
  maxDiscoverPerFolder,
  normalizeFsPath,
} from "./workspace.js";

export function wrapVscodeCancellation(
  token?: vscode.CancellationToken,
): CancellationTokenLike | undefined {
  if (token === undefined) {
    return undefined;
  }
  return {
    get isCancellationRequested(): boolean {
      return token.isCancellationRequested;
    },
    onCancellationRequested(listener: () => void): { dispose(): void } {
      const disposable = token.onCancellationRequested(listener);
      return { dispose: (): void => disposable.dispose() };
    },
  };
}

export function createVscodeWorkspaceAccess(
  token?: vscode.CancellationToken,
): WorkspaceAccess {
  return new VscodeWorkspaceAccess(token);
}

class VscodeWorkspaceAccess implements WorkspaceAccess {
  public constructor(private readonly vscodeToken?: vscode.CancellationToken) {}

  public folders(): WorkspaceFolderRef[] {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      root: normalizeFsPath(folder.uri.fsPath),
    }));
  }

  public async findFiles(
    query: FileQuery,
    token?: CancellationTokenLike,
  ): Promise<DiscoveredFile[]> {
    throwIfCancelled(token);
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return [];
    }
    const includeGlob = query.kind === "source" ? VSCODE_SOURCE_INCLUDE : VSCODE_MANIFEST_INCLUDE;
    const perFolder = maxDiscoverPerFolder(folders.length, query.maxResults ?? MAX_DISCOVERED_FILES);
    const totalLimit = query.maxResults ?? MAX_DISCOVERED_FILES;
    const collected: DiscoveredFile[] = [];

    for (const folder of folders) {
      throwIfCancelled(token);
      const matches = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, includeGlob),
        new vscode.RelativePattern(folder, VSCODE_EXCLUDE),
        perFolder,
        this.vscodeToken,
      );
      for (const uri of matches) {
        const relativePath = normalizeFsPath(path.relative(folder.uri.fsPath, uri.fsPath));
        if (query.kind === "source" && !isSourceFileName(relativePath)) {
          continue;
        }
        if (query.kind === "manifest" && !isManifestFileName(relativePath)) {
          continue;
        }
        collected.push({
          relativePath,
          folderName: folder.name,
          folderRoot: normalizeFsPath(folder.uri.fsPath),
        });
        if (collected.length >= totalLimit) {
          return filterSafeDiscoveredFiles(collected);
        }
      }
    }
    return filterSafeDiscoveredFiles(collected);
  }

  public async readFile(
    file: DiscoveredFile,
    token?: CancellationTokenLike,
  ): Promise<WorkspaceFileRead | undefined> {
    throwIfCancelled(token);
    const uri = this.toUri(file);
    if (uri === undefined) {
      return undefined;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_SOURCE_FILE_BYTES) {
        return {
          content: undefined,
          byteLength: stat.size,
          exceededSizeLimit: true,
        };
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      return {
        content: Buffer.from(bytes).toString("utf8"),
        byteLength: stat.size,
        exceededSizeLimit: false,
      };
    } catch {
      return undefined;
    }
  }

  public async readFileRange(
    file: DiscoveredFile,
    startLine: number,
    endLine: number,
    token?: CancellationTokenLike,
  ): Promise<string | undefined> {
    throwIfCancelled(token);
    const full = await this.readFile(file, token);
    if (full?.content !== undefined) {
      const lines = splitLines(full.content);
      const start = Math.min(Math.max(startLine, 1), lines.length);
      const end = Math.min(Math.max(endLine, start), lines.length);
      return lines.slice(start - 1, end).join("\n");
    }
    const uri = this.toUri(file);
    if (uri === undefined) {
      return undefined;
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const start = Math.min(Math.max(startLine, 1), document.lineCount);
      const end = Math.min(Math.max(endLine, start), document.lineCount);
      const lines: string[] = [];
      for (let line = start; line <= end; line += 1) {
        lines.push(document.lineAt(line - 1).text);
      }
      return lines.join("\n");
    } catch {
      return undefined;
    }
  }

  private toUri(file: DiscoveredFile): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.find(
      (item) => normalizeFsPath(item.uri.fsPath) === normalizeFsPath(file.folderRoot),
    );
    if (folder === undefined) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, ...file.relativePath.split("/"));
  }
}
