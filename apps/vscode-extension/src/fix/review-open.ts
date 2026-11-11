import type { ProposedPreviewStore, PreviewDocument } from "./preview-store.js";
import type { PrepareFixReviewResult } from "./review-fix.js";

export interface ReviewChange {
  workspaceRoot: string;
  relativePath: string;
  proposedUri: string;
  title: string;
}

export interface ReviewDiffOpener {
  openDiff(
    original: { workspaceRoot: string; relativePath: string },
    proposedUri: string,
    title: string,
  ): Promise<boolean>;
  openChanges?(title: string, changes: readonly ReviewChange[]): Promise<boolean>;
}

export type OpenReviewResult =
  | { status: "opened"; documents: PreviewDocument[] }
  | { status: "failed"; opened: number; documents: PreviewDocument[] };

export async function publishAndOpenReview(
  prepared: Extract<PrepareFixReviewResult, { status: "ok" }>,
  store: ProposedPreviewStore,
  opener: ReviewDiffOpener,
  owner?: string,
): Promise<OpenReviewResult> {
  const documents = store.beginPreview(prepared.files, owner);
  if (documents.length > 1 && opener.openChanges !== undefined) {
    const changes: ReviewChange[] = [];
    for (const [index, document] of documents.entries()) {
      const file = prepared.files[index];
      if (file === undefined) {
        store.clear();
        return { status: "failed", opened: 0, documents };
      }
      changes.push({
        workspaceRoot: file.workspaceRoot,
        relativePath: file.relativePath,
        proposedUri: document.uri,
        title: document.title,
      });
    }
    const opened = await opener.openChanges("Proposed changes", changes);
    if (!opened) {
      store.clear();
      return { status: "failed", opened: 0, documents };
    }
    return { status: "opened", documents };
  }
  let opened = 0;
  for (const [index, document] of documents.entries()) {
    const file = prepared.files[index];
    if (file === undefined) {
      store.clear();
      return { status: "failed", opened, documents };
    }
    const ok = await opener.openDiff(
      { workspaceRoot: file.workspaceRoot, relativePath: file.relativePath },
      document.uri,
      document.title,
    );
    if (!ok) {
      store.clear();
      return { status: "failed", opened, documents };
    }
    opened += 1;
  }
  if (opened === 0) {
    store.clear();
    return { status: "failed", opened, documents };
  }
  return { status: "opened", documents };
}
