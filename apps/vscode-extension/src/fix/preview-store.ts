import type { ReviewFixFile } from "./review-fix.js";
import type { StoredProposal } from "./types.js";

export const PROPOSED_PREVIEW_SCHEME = "browser-debug-bridge-proposal";

export interface PreviewDocument {
  uri: string;
  relativePath: string;
  title: string;
  workspaceRoot: string;
}

export type PreviewClearedListener = (uris: readonly string[]) => void;

function defaultPreviewId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Opaque key naming the proposal a preview belongs to. It contains no source
 * text, hashes of secrets, or paths; it is only compared for equality.
 */
export function proposalPreviewOwner(proposal: StoredProposal): string {
  return `${proposal.identity.sessionId}|${proposal.identity.diagnosisFingerprint}|${proposal.identity.sourceFingerprint}|${proposal.createdAt}`;
}

export class ProposedPreviewStore {
  private readonly contents = new Map<string, string>();
  private readonly listeners = new Set<PreviewClearedListener>();
  private activeUris: string[] = [];
  private owner: string | undefined;
  private previewId: string | undefined;

  public constructor(private readonly createId: () => string = defaultPreviewId) {}

  public beginPreview(files: readonly ReviewFixFile[], owner?: string): PreviewDocument[] {
    this.clear();
    this.previewId = this.createId();
    this.owner = owner;
    const documents = files.map((file, index) => {
      const uri = previewUri(this.previewId ?? "0", index);
      this.contents.set(previewLookupKey(uri), file.proposedContent);
      return {
        uri,
        relativePath: file.relativePath,
        title: file.title,
        workspaceRoot: file.workspaceRoot,
      };
    });
    this.activeUris = documents.map((document) => document.uri);
    return documents;
  }

  public provide(uri: string): string | undefined {
    return this.contents.get(previewLookupKey(uri)) ?? this.contents.get(uri);
  }

  public currentOwner(): string | undefined {
    return this.owner;
  }

  public hasPreview(): boolean {
    return this.contents.size > 0;
  }

  /** Clears only when the active preview belongs to `owner`. */
  public clearFor(owner: string): boolean {
    if (this.owner !== owner) {
      return false;
    }
    this.clear();
    return true;
  }

  public clear(): void {
    const cleared = this.activeUris;
    this.contents.clear();
    this.activeUris = [];
    this.owner = undefined;
    this.previewId = undefined;
    if (cleared.length > 0) {
      for (const listener of this.listeners) {
        listener(cleared);
      }
    }
  }

  public onDidClear(listener: PreviewClearedListener): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  public dispose(): void {
    this.clear();
    this.listeners.clear();
  }
}

export function previewUri(previewId: string, index: number): string {
  return `${PROPOSED_PREVIEW_SCHEME}:/p/${previewId}/${String(index)}`;
}

export function previewLookupKey(uri: string): string {
  const prefix = `${PROPOSED_PREVIEW_SCHEME}:`;
  let rest = uri.startsWith(prefix) ? uri.slice(prefix.length) : uri;
  if (rest.startsWith("//")) {
    const pathStart = rest.indexOf("/", 2);
    rest = pathStart >= 0 ? rest.slice(pathStart) : rest;
  }
  const cut = rest.split("?")[0]?.split("#")[0] ?? rest;
  return cut.startsWith("/p/") ? cut : uri;
}
