import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import {
  MAX_CONTENT_READS,
  MAX_DISCOVERED_FILES,
  MAX_MANIFEST_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_TOTAL_CONTEXT_LINES,
} from "./constants.js";
import { AnalysisCancelledError, throwIfCancelled } from "./cancellation.js";
import { collectExcerpts, excerptAroundLine, remainingContextBudget, splitLines } from "./excerpts.js";
import { detectFrameworkFromManifests, detectLanguageHints } from "./framework.js";
import { parsePackageJson, type ManifestFile, type PackageJsonLike } from "./manifests.js";
import { detectPackageManagerFromManifests } from "./package-manager.js";
import {
  rankCandidates,
  scoreContentSignals,
  scorePathSignals,
  toCandidateFile,
  type ScoredCandidate,
} from "./scoring.js";
import { extractSessionSignals } from "./signals.js";
import type {
  CancellationTokenLike,
  DiscoveredFile,
  ProjectContextResult,
  SessionSignals,
  WorkspaceAccess,
} from "./types.js";
import {
  filterSafeDiscoveredFiles,
  isSafeWorkspaceRelativePath,
  posixBasename,
  resolveWorkspaceFolders,
} from "./workspace.js";

export class ProjectIntelligenceService {
  public constructor(private readonly workspace: WorkspaceAccess) {}

  public async analyzeSession(
    session: DebugSessionV1,
    cancellationToken?: CancellationTokenLike,
  ): Promise<ProjectContextResult> {
    try {
      return await this.analyze(session, cancellationToken);
    } catch (error) {
      if (error instanceof AnalysisCancelledError) {
        return { status: "cancelled" };
      }
      throw error;
    }
  }

  private async analyze(
    session: DebugSessionV1,
    token?: CancellationTokenLike,
  ): Promise<ProjectContextResult> {
    throwIfCancelled(token);
    const folders = this.workspace.folders();
    const resolution = resolveWorkspaceFolders(folders);
    if (resolution.status === "none") {
      return { status: "no-workspace" };
    }

    const sourceFiles = filterSafeDiscoveredFiles(
      await this.workspace.findFiles({ kind: "source", maxResults: MAX_DISCOVERED_FILES }, token),
    );
    throwIfCancelled(token);
    const manifestFiles = filterSafeDiscoveredFiles(
      await this.workspace.findFiles({ kind: "manifest", maxResults: 80 }, token),
    );
    throwIfCancelled(token);

    const manifests = await this.readManifests(manifestFiles, token);
    const packages = collectPackageJson(manifests);
    const framework = detectFrameworkFromManifests(
      packages.map((item) => ({ pkg: item.pkg, folderName: item.folderName })),
    );
    const packageManager = detectPackageManagerFromManifests(manifests);
    const languageHints = detectLanguageHints(
      sourceFiles.map((file) => file.relativePath),
      manifests,
      packages.map((item) => item.pkg),
    );
    const signals = extractSessionSignals(session, folders);

    const scored: ScoredCandidate[] = [];
    for (const file of sourceFiles) {
      throwIfCancelled(token);
      if (!isSafeWorkspaceRelativePath(file.folderRoot, file.relativePath)) {
        continue;
      }
      scored.push(
        scorePathSignals({
          relativePath: file.relativePath,
          folderName: file.folderName,
          folderRoot: file.folderRoot,
          signals,
          ...(framework === undefined ? {} : { frameworkName: framework.name }),
        }),
      );
    }

    const contentReads = await this.applyContentSignals(scored, sourceFiles, signals, token);
    const ranked = rankCandidates(scored);
    const candidates = await this.attachExcerpts(ranked, sourceFiles, token);

    const workspaceRoot =
      resolution.status === "single"
        ? resolution.folder.root
        : pickPrimaryRoot(folders, ranked);

    return {
      status: "ok",
      context: {
        workspaceRoot,
        folders,
        ...(framework === undefined ? {} : { framework }),
        languageHints,
        ...(packageManager === undefined ? {} : { packageManager }),
        candidates,
        metadata: {
          filesConsidered: sourceFiles.length,
          filesSelected: candidates.length,
          truncated:
            sourceFiles.length >= MAX_DISCOVERED_FILES || scored.filter((item) => item.score > 0).length > ranked.length,
          contentReads,
        },
      },
    };
  }

  private async readManifests(
    files: DiscoveredFile[],
    token?: CancellationTokenLike,
  ): Promise<ManifestFile[]> {
    const manifests: ManifestFile[] = [];
    for (const file of files) {
      throwIfCancelled(token);
      const read = await this.workspace.readFile(file, token);
      if (read === undefined || read.exceededSizeLimit || read.byteLength > MAX_MANIFEST_BYTES) {
        continue;
      }
      if (read.content === undefined) {
        continue;
      }
      manifests.push({
        relativePath: file.relativePath,
        folderName: file.folderName,
        folderRoot: file.folderRoot,
        fileName: posixBasename(file.relativePath),
        content: read.content,
      });
    }
    return manifests;
  }

  private async applyContentSignals(
    scored: ScoredCandidate[],
    sourceFiles: DiscoveredFile[],
    signals: SessionSignals,
    token?: CancellationTokenLike,
  ): Promise<number> {
    const index = new Map(scored.map((item, position) => [candidateKey(item), position] as const));
    const toRead = pickFilesToRead(scored, sourceFiles, signals);
    let reads = 0;
    for (const file of toRead) {
      throwIfCancelled(token);
      if (reads >= MAX_CONTENT_READS) {
        break;
      }
      const read = await this.workspace.readFile(file, token);
      reads += 1;
      if (read?.content === undefined) {
        continue;
      }
      const key = `${file.folderRoot}::${file.relativePath}`;
      const position = index.get(key);
      if (position === undefined) {
        continue;
      }
      const current = scored[position];
      if (current === undefined) {
        continue;
      }
      scored[position] = scoreContentSignals(current, read.content, signals);
    }
    return reads;
  }

  private async attachExcerpts(
    ranked: ScoredCandidate[],
    sourceFiles: DiscoveredFile[],
    token?: CancellationTokenLike,
  ): Promise<ReturnType<typeof toCandidateFile>[]> {
    const fileMap = new Map(
      sourceFiles.map((file) => [`${file.folderRoot}::${file.relativePath}`, file] as const),
    );
    const results: ReturnType<typeof toCandidateFile>[] = [];
    let usedLines = 0;
    for (const candidate of ranked) {
      throwIfCancelled(token);
      const file = fileMap.get(`${candidate.workspaceRoot}::${candidate.relativePath}`);
      if (file === undefined) {
        results.push(toCandidateFile(candidate, []));
        continue;
      }
      const remaining = remainingContextBudget(usedLines, MAX_TOTAL_CONTEXT_LINES);
      const read = await this.workspace.readFile(file, token);
      if (read?.content !== undefined) {
        const collected = collectExcerpts({
          content: read.content,
          targetLines: candidate.targetLines,
          remainingLines: remaining,
          byteLength: read.byteLength,
          exceededSizeLimit: read.exceededSizeLimit,
        });
        usedLines += collected.usedLines;
        results.push(toCandidateFile(candidate, collected.excerpts));
        continue;
      }
      if (
        read?.exceededSizeLimit === true &&
        candidate.targetLines[0] !== undefined &&
        this.workspace.readFileRange !== undefined
      ) {
        const target = candidate.targetLines[0];
        const start = Math.max(1, target - 20);
        const end = target + 20;
        const range = await this.workspace.readFileRange(file, start, end, token);
        if (range !== undefined) {
          const excerpt = excerptAroundLine(splitLines(range), Math.min(21, splitLines(range).length));
          const excerpts = excerpt === undefined ? [] : [{ ...excerpt, startLine: start, endLine: start + splitLines(range).length - 1 }];
          usedLines += excerpts[0] === undefined ? 0 : excerpts[0].endLine - excerpts[0].startLine + 1;
          results.push(toCandidateFile(candidate, excerpts));
          continue;
        }
      }
      if (read !== undefined && read.byteLength > MAX_SOURCE_FILE_BYTES) {
        results.push(toCandidateFile(candidate, []));
        continue;
      }
      results.push(toCandidateFile(candidate, []));
    }
    return results;
  }
}

function collectPackageJson(
  manifests: ManifestFile[],
): Array<{ pkg: PackageJsonLike; folderName: string }> {
  const packages: Array<{ pkg: PackageJsonLike; folderName: string }> = [];
  for (const manifest of manifests) {
    if (manifest.fileName !== "package.json") {
      continue;
    }
    const pkg = parsePackageJson(manifest.content);
    if (pkg !== undefined) {
      packages.push({ pkg, folderName: manifest.folderName });
    }
  }
  return packages;
}

function pickPrimaryRoot(
  folders: { name: string; root: string }[],
  ranked: ScoredCandidate[],
): string {
  const top = ranked[0];
  if (top !== undefined) {
    return top.workspaceRoot;
  }
  return folders[0]?.root ?? "";
}

function candidateKey(candidate: Pick<ScoredCandidate, "workspaceRoot" | "relativePath">): string {
  return `${candidate.workspaceRoot}::${candidate.relativePath}`;
}

function pickFilesToRead(
  scored: ScoredCandidate[],
  sourceFiles: DiscoveredFile[],
  signals: SessionSignals,
): DiscoveredFile[] {
  const scoredMap = new Map(scored.map((item) => [`${item.workspaceRoot}::${item.relativePath}`, item] as const));
  const selected: DiscoveredFile[] = [];
  const seen = new Set<string>();

  const consider = (file: DiscoveredFile): void => {
    const key = `${file.folderRoot}::${file.relativePath}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    selected.push(file);
  };

  for (const file of sourceFiles) {
    const item = scoredMap.get(`${file.folderRoot}::${file.relativePath}`);
    if (item !== undefined && item.score > 0) {
      consider(file);
    }
  }
  for (const file of sourceFiles) {
    if (selected.length >= MAX_CONTENT_READS) {
      break;
    }
    const tokens = [
      ...signals.ids,
      ...signals.testIds,
      ...signals.classes,
      ...signals.componentTokens,
    ];
    if (tokens.some((token) => file.relativePath.toLowerCase().includes(token.toLowerCase()))) {
      consider(file);
    }
  }
  return selected.slice(0, MAX_CONTENT_READS);
}
