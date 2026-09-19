export type CandidateReasonType =
  | "console-stack"
  | "route"
  | "network"
  | "selector-id"
  | "selector-testid"
  | "component-name"
  | "selector-class"
  | "framework-convention"
  | "text";

export interface CandidateReason {
  type: CandidateReasonType;
  explanation: string;
  weight: number;
}

export interface CodeExcerpt {
  startLine: number;
  endLine: number;
  content: string;
}

export interface CandidateFile {
  relativePath: string;
  workspaceFolder: string;
  workspaceRoot: string;
  score: number;
  reasons: CandidateReason[];
  excerpts: CodeExcerpt[];
}

export interface FrameworkDetection {
  name: string;
  evidence: string[];
  reason: string;
}

export interface PackageManagerDetection {
  name: "pnpm" | "npm" | "yarn" | "bun";
  evidence: string[];
  reason: string;
}

export interface ProjectScanMetadata {
  filesConsidered: number;
  filesSelected: number;
  truncated: boolean;
  contentReads: number;
}

export interface WorkspaceFolderRef {
  name: string;
  root: string;
}

export interface ProjectContext {
  workspaceRoot: string;
  folders: WorkspaceFolderRef[];
  framework?: FrameworkDetection;
  languageHints: string[];
  packageManager?: PackageManagerDetection;
  candidates: CandidateFile[];
  metadata: ProjectScanMetadata;
}

export type ProjectContextResult =
  | { status: "ok"; context: ProjectContext }
  | { status: "no-workspace" }
  | { status: "cancelled" };

export interface DiscoveredFile {
  relativePath: string;
  folderName: string;
  folderRoot: string;
}

export interface FileQuery {
  kind: "source" | "manifest";
  maxResults?: number;
}

export interface WorkspaceFileRead {
  content: string | undefined;
  byteLength: number;
  exceededSizeLimit: boolean;
}

export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface WorkspaceAccess {
  folders(): WorkspaceFolderRef[];
  findFiles(query: FileQuery, token?: CancellationTokenLike): Promise<DiscoveredFile[]>;
  readFile(file: DiscoveredFile, token?: CancellationTokenLike): Promise<WorkspaceFileRead | undefined>;
  readFileRange?(
    file: DiscoveredFile,
    startLine: number,
    endLine: number,
    token?: CancellationTokenLike,
  ): Promise<string | undefined>;
}

export interface StackPathHit {
  relativePath: string;
  folderName: string;
  folderRoot: string;
  line?: number;
  column?: number;
}

export interface SessionSignals {
  routeSegments: string[];
  networkSegments: string[];
  ids: string[];
  classes: string[];
  testIds: string[];
  textTerms: string[];
  componentTokens: string[];
  stackHits: StackPathHit[];
  searchTerms: string[];
}
