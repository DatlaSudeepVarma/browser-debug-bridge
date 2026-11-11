import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitApplyPlan, restoreApplyPlan, type ApplyDocumentBatch, type ApplyTextDocument } from "./apply-documents.js";
import type { SafeApplyFilePlan, SafeApplyPlan } from "./types.js";

class MemoryDocument implements ApplyTextDocument {
  public saves = 0;
  public saveResult: boolean | "throw" = true;
  public constructor(
    public text: string,
    public dirty = false,
  ) {}

  public get isDirty(): boolean {
    return this.dirty;
  }

  public getText(): string {
    return this.text;
  }

  public async save(): Promise<boolean> {
    this.saves += 1;
    if (this.saveResult === "throw") {
      throw new Error("save failed");
    }
    if (this.saveResult === true) {
      this.dirty = false;
    }
    return this.saveResult;
  }
}

function planFor(files: { path: string; current: string; next: string }[]): SafeApplyPlan {
  return {
    identity: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      diagnosisFingerprint: "a".repeat(64),
      sourceFingerprint: "b".repeat(64),
    },
    files: files.map(
      (file): SafeApplyFilePlan => ({
        relativePath: file.path,
        workspaceRoot: "/workspace/shop",
        canonicalPath: `/workspace/shop/${file.path}`,
        currentContent: file.current,
        currentContentHash: "c".repeat(64),
        proposedContent: file.next,
        proposedContentHash: "d".repeat(64),
        edits: [],
      }),
    ),
  };
}

function batch(
  docs: Record<string, MemoryDocument>,
  options?: { replace?: boolean | "throw" },
): ApplyDocumentBatch<MemoryDocument> & { replacements: string[][] } {
  const replacements: string[][] = [];
  return {
    replacements,
    async open(file) {
      return docs[file.relativePath];
    },
    async replaceAll(entries) {
      if (options?.replace === "throw") {
        throw new Error("replace failed");
      }
      if (options?.replace === false) {
        return false;
      }
      for (const entry of entries) {
        entry.document.text = entry.next;
      }
      replacements.push(entries.map((entry) => entry.next));
      return true;
    },
  };
}

describe("apply document commit", () => {
  it("replaces every file once and saves them", async () => {
    const first = new MemoryDocument("one");
    const second = new MemoryDocument("two");
    const documents = batch({ "a.ts": first, "b.ts": second });
    const result = await commitApplyPlan(
      planFor([
        { path: "a.ts", current: "one", next: "ONE" },
        { path: "b.ts", current: "two", next: "TWO" },
      ]),
      documents,
    );
    assert.equal(result.status, "applied");
    assert.equal(first.text, "ONE");
    assert.equal(second.text, "TWO");
    assert.equal(first.saves, 1);
    assert.equal(second.saves, 1);
    assert.equal(documents.replacements.length, 1);
  });

  it("does not replace files when one buffer is dirty or the text disagrees", async () => {
    const dirty = new MemoryDocument("one", true);
    const dirtyBatch = batch({ "a.ts": dirty });
    const dirtyResult = await commitApplyPlan(planFor([{ path: "a.ts", current: "one", next: "ONE" }]), dirtyBatch);
    assert.equal(dirtyResult.status, "dirty");
    assert.equal(dirty.text, "one");
    assert.equal(dirtyBatch.replacements.length, 0);

    const stale = new MemoryDocument("changed");
    const staleBatch = batch({ "a.ts": stale });
    const mismatch = await commitApplyPlan(planFor([{ path: "a.ts", current: "one", next: "ONE" }]), staleBatch);
    assert.equal(mismatch.status, "mismatch");
    assert.equal(stale.text, "changed");
    assert.equal(staleBatch.replacements.length, 0);
  });

  it("rolls back an earlier saved file when a later save fails", async () => {
    const first = new MemoryDocument("one");
    const second = new MemoryDocument("two");
    second.saveResult = false;
    const documents = batch({ "a.ts": first, "b.ts": second });
    const result = await commitApplyPlan(
      planFor([
        { path: "a.ts", current: "one", next: "ONE" },
        { path: "b.ts", current: "two", next: "TWO" },
      ]),
      documents,
    );
    assert.equal(result.status, "unsaved");
    assert.equal(first.text, "one");
    assert.equal(second.text, "two");
    assert.equal(first.saves, 2);
    assert.equal(second.saves, 1);
  });

  it("reports unrestored when the rollback save fails", async () => {
    const first = new MemoryDocument("one");
    const second = new MemoryDocument("two");
    second.saveResult = false;
    let firstSaves = 0;
    const originalSave = first.save.bind(first);
    first.save = async () => {
      firstSaves += 1;
      if (firstSaves > 1) {
        return false;
      }
      return originalSave();
    };
    const documents = batch({ "a.ts": first, "b.ts": second });
    const result = await commitApplyPlan(
      planFor([
        { path: "a.ts", current: "one", next: "ONE" },
        { path: "b.ts", current: "two", next: "TWO" },
      ]),
      documents,
    );
    assert.equal(result.status, "unrestored");
    if (result.status === "unrestored") {
      assert.deepEqual(result.relativePaths, ["a.ts", "b.ts"]);
    }
  });

  it("restores previous contents after a write that did not match", async () => {
    const doc = new MemoryDocument("NEXT");
    const documents = batch({ "a.ts": doc });
    const restored = await restoreApplyPlan(planFor([{ path: "a.ts", current: "one", next: "NEXT" }]), documents);
    assert.equal(restored, "restored");
    assert.equal(doc.text, "one");
    assert.equal(doc.saves, 1);
  });
});
