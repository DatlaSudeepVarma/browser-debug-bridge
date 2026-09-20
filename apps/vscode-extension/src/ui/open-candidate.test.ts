import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { openCandidateFile, type CandidateFileOpener } from "./open-candidate.js";

function opener(options: { existing?: ReadonlySet<string>; opened?: string[] } = {}): CandidateFileOpener {
  const existing = options.existing ?? new Set(["src/services/checkout.ts"]);
  const opened = options.opened ?? [];
  return {
    async exists(_folderRoot, relativePath): Promise<boolean> {
      return existing.has(relativePath);
    },
    async open(_folderRoot, relativePath): Promise<void> {
      opened.push(relativePath);
    },
  };
}

describe("candidate navigation", () => {
  const project = createFixtureAiProjectContext();

  it("opens a valid workspace candidate", async () => {
    const opened: string[] = [];
    const result = await openCandidateFile("src/services/checkout.ts", project, opener({ opened }));
    assert.equal(result.status, "opened");
    assert.deepEqual(opened, ["src/services/checkout.ts"]);
  });

  it("rejects a traversal path and does not open it", async () => {
    const opened: string[] = [];
    const result = await openCandidateFile("../../etc/passwd", project, opener({ opened }));
    assert.equal(result.status, "rejected");
    assert.deepEqual(opened, []);
  });

  it("rejects an external path", async () => {
    const opened: string[] = [];
    const result = await openCandidateFile("C:/Windows/notepad.exe", project, opener({ opened }));
    assert.equal(result.status, "rejected");
    assert.deepEqual(opened, []);
  });

  it("handles a missing file without throwing", async () => {
    const opened: string[] = [];
    const result = await openCandidateFile(
      "src/services/checkout.ts",
      project,
      opener({ existing: new Set(), opened }),
    );
    assert.equal(result.status, "missing");
    if (result.status !== "missing") {
      return;
    }
    assert.equal(result.message.includes("no longer available"), true);
    assert.deepEqual(opened, []);
  });
});
