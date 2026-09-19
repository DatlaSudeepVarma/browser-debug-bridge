import { MAX_DISCOVERED_FILES, MAX_SOURCE_FILE_BYTES } from "./constants.js";
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
  isManifestFileName,
  isSourceFileName,
  maxDiscoverPerFolder,
  normalizeFsPath,
} from "./workspace.js";

export interface MemoryFolder {
  name: string;
  root: string;
  files: Record<string, string>;
}

export class MemoryWorkspaceAccess implements WorkspaceAccess {
  private readonly memoryFolders: MemoryFolder[];

  public constructor(folders: MemoryFolder[]) {
    this.memoryFolders = folders.map((folder) => ({
      ...folder,
      root: normalizeFsPath(folder.root),
    }));
  }

  public folders(): WorkspaceFolderRef[] {
    return this.memoryFolders.map((folder) => ({
      name: folder.name,
      root: folder.root,
    }));
  }

  public async findFiles(
    query: FileQuery,
    token?: CancellationTokenLike,
  ): Promise<DiscoveredFile[]> {
    throwIfCancelled(token);
    const results: DiscoveredFile[] = [];
    const perFolder = maxDiscoverPerFolder(
      this.memoryFolders.length,
      query.maxResults ?? MAX_DISCOVERED_FILES,
    );
    const totalLimit = query.maxResults ?? MAX_DISCOVERED_FILES;

    for (const folder of this.memoryFolders) {
      throwIfCancelled(token);
      let taken = 0;
      const paths = Object.keys(folder.files).sort((left, right) => left.localeCompare(right));
      for (const relativePath of paths) {
        throwIfCancelled(token);
        if (query.kind === "source" && !isSourceFileName(relativePath)) {
          continue;
        }
        if (query.kind === "manifest" && !isManifestFileName(relativePath)) {
          continue;
        }
        results.push({
          relativePath,
          folderName: folder.name,
          folderRoot: folder.root,
        });
        taken += 1;
        if (taken >= perFolder || results.length >= totalLimit) {
          break;
        }
      }
      if (results.length >= totalLimit) {
        break;
      }
    }
    return results;
  }

  public async readFile(
    file: DiscoveredFile,
    token?: CancellationTokenLike,
  ): Promise<WorkspaceFileRead | undefined> {
    throwIfCancelled(token);
    const content = this.lookup(file);
    if (content === undefined) {
      return undefined;
    }
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > MAX_SOURCE_FILE_BYTES) {
      return {
        content: undefined,
        byteLength,
        exceededSizeLimit: true,
      };
    }
    return {
      content,
      byteLength,
      exceededSizeLimit: false,
    };
  }

  public async readFileRange(
    file: DiscoveredFile,
    startLine: number,
    endLine: number,
    token?: CancellationTokenLike,
  ): Promise<string | undefined> {
    throwIfCancelled(token);
    const content = this.lookup(file);
    if (content === undefined) {
      return undefined;
    }
    const lines = splitLines(content);
    const start = Math.min(Math.max(startLine, 1), lines.length);
    const end = Math.min(Math.max(endLine, start), lines.length);
    return lines.slice(start - 1, end).join("\n");
  }

  private lookup(file: DiscoveredFile): string | undefined {
    const folder = this.memoryFolders.find((item) => item.root === normalizeFsPath(file.folderRoot));
    return folder?.files[file.relativePath];
  }
}
