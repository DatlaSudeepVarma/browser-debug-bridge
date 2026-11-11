import type { WorkspaceWriteResult } from "./run-apply.js";
import type { SafeApplyPlan } from "./types.js";

/**
 * A text document the apply batch can read, replace, and save.
 * The VS Code adapter and the unit tests both implement this.
 */
export interface ApplyTextDocument {
  readonly isDirty: boolean;
  getText(): string;
  save(): Promise<boolean>;
}

export interface ApplyDocumentBatch<T extends ApplyTextDocument = ApplyTextDocument> {
  open(file: {
    workspaceRoot: string;
    relativePath: string;
    canonicalPath?: string;
  }): Promise<T | undefined>;
  /**
   * Replace every listed document in one step. False means none of the
   * replacements were applied.
   */
  replaceAll(entries: readonly { document: T; next: string }[]): Promise<boolean>;
}

interface OpenedFile<T extends ApplyTextDocument> {
  relativePath: string;
  currentContent: string;
  proposedContent: string;
  document: T;
}

/**
 * Writes every planned file, then saves them. If a later save fails, files
 * that were already saved are put back to currentContent. Returns unsaved
 * only after that rollback succeeds.
 */
export async function commitApplyPlan<T extends ApplyTextDocument>(
  plan: SafeApplyPlan,
  batch: ApplyDocumentBatch<T>,
): Promise<WorkspaceWriteResult> {
  const opened: OpenedFile<T>[] = [];
  for (const file of plan.files) {
    const document = await openDocument(batch, file);
    if (document === undefined) {
      return { status: "not-applied" };
    }
    if (document.isDirty) {
      return { status: "dirty" };
    }
    if (document.getText() !== file.currentContent) {
      return { status: "mismatch" };
    }
    opened.push({
      relativePath: file.relativePath,
      currentContent: file.currentContent,
      proposedContent: file.proposedContent,
      document,
    });
  }

  const applied = await replaceAllSafely(
    batch,
    opened.map((item) => ({ document: item.document, next: item.proposedContent })),
  );
  if (!applied) {
    return { status: "not-applied" };
  }

  const saved: OpenedFile<T>[] = [];
  for (const item of opened) {
    if (!(await saveDocument(item.document))) {
      const restored = await writeContents(
        batch,
        opened.map((entry) => ({ document: entry.document, next: entry.currentContent })),
        saved,
      );
      if (!restored) {
        return { status: "unrestored", relativePaths: opened.map((entry) => entry.relativePath) };
      }
      return { status: "unsaved" };
    }
    saved.push(item);
  }
  return { status: "applied" };
}

/**
 * Puts every planned file back to the pre-apply contents and saves them.
 * Used when a write reported success but the bytes on disk do not match.
 */
export async function restoreApplyPlan<T extends ApplyTextDocument>(
  plan: SafeApplyPlan,
  batch: ApplyDocumentBatch<T>,
): Promise<"restored" | "unrestored"> {
  const opened: OpenedFile<T>[] = [];
  for (const file of plan.files) {
    const document = await openDocument(batch, file);
    if (document === undefined) {
      return "unrestored";
    }
    opened.push({
      relativePath: file.relativePath,
      currentContent: file.currentContent,
      proposedContent: file.proposedContent,
      document,
    });
  }
  const restored = await writeContents(
    batch,
    opened.map((item) => ({ document: item.document, next: item.currentContent })),
    opened,
  );
  return restored ? "restored" : "unrestored";
}

async function openDocument<T extends ApplyTextDocument>(
  batch: ApplyDocumentBatch<T>,
  file: { workspaceRoot: string; relativePath: string; canonicalPath?: string },
): Promise<T | undefined> {
  try {
    return await batch.open(file);
  } catch {
    return undefined;
  }
}

async function writeContents<T extends ApplyTextDocument>(
  batch: ApplyDocumentBatch<T>,
  entries: readonly { document: T; next: string }[],
  toSave: readonly { document: T }[],
): Promise<boolean> {
  if (!(await replaceAllSafely(batch, entries))) {
    return false;
  }
  for (const item of toSave) {
    if (!(await saveDocument(item.document))) {
      return false;
    }
  }
  return true;
}

async function replaceAllSafely<T extends ApplyTextDocument>(
  batch: ApplyDocumentBatch<T>,
  entries: readonly { document: T; next: string }[],
): Promise<boolean> {
  try {
    return (await batch.replaceAll(entries)) === true;
  } catch {
    return false;
  }
}

async function saveDocument(document: ApplyTextDocument): Promise<boolean> {
  try {
    return (await document.save()) === true;
  } catch {
    return false;
  }
}
