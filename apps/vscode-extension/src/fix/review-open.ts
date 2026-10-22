import type { ProposedPreviewStore, PreviewDocument } from "./preview-store.js";
import type { PrepareFixReviewResult } from "./review-fix.js";

export interface ReviewDiffOpener {
  openDiff(
    original: { workspaceRoot: string; relativePath: string },
    proposedUri: string,
    title: string,
  ): Promise<boolean>;
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
