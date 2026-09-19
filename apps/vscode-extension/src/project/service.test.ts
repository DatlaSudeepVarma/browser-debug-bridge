import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ManualCancellationToken } from "./cancellation.js";
import { MAX_CANDIDATES, MAX_LINES_PER_EXCERPT, MAX_SOURCE_FILE_BYTES } from "./constants.js";
import { MemoryWorkspaceAccess } from "./memory-access.js";
import { ProjectIntelligenceService } from "./service.js";
import { formatProjectIntelligenceSummary } from "./summary.js";
import {
  FIXTURE_FOLDER_NAME,
  FIXTURE_FOLDER_ROOT,
  FIXTURE_PROJECT_FILES,
  createFixtureFileMap,
} from "./test-fixtures/files.js";
import { createProjectIntelligenceSession } from "./test-fixtures/session.js";

function createService(files = FIXTURE_PROJECT_FILES): ProjectIntelligenceService {
  return new ProjectIntelligenceService(
    new MemoryWorkspaceAccess([
      {
        name: FIXTURE_FOLDER_NAME,
        root: FIXTURE_FOLDER_ROOT,
        files,
      },
    ]),
  );
}

describe("project intelligence service", () => {
  it("returns a typed no-workspace result", async () => {
    const service = new ProjectIntelligenceService(new MemoryWorkspaceAccess([]));
    const result = await service.analyzeSession(createProjectIntelligenceSession());
    assert.equal(result.status, "no-workspace");
  });

  it("ranks fixture files from session signals", async () => {
    const result = await createService().analyzeSession(createProjectIntelligenceSession());
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.context.framework?.name, "nextjs");
    assert.equal(result.context.packageManager?.name, "pnpm");
    assert.equal(result.context.languageHints.includes("TypeScript"), true);
    const paths = result.context.candidates.map((candidate) => candidate.relativePath);
    assert.equal(paths.includes("src/components/BuyNowButton.tsx"), true);
    assert.equal(paths.includes("src/app/checkout/page.tsx"), true);
    assert.equal(result.context.candidates.length <= MAX_CANDIDATES, true);
    const top = result.context.candidates[0];
    assert.equal(top?.relativePath, "src/components/BuyNowButton.tsx");
    assert.equal(
      top?.reasons.some((reason) => reason.type === "console-stack"),
      true,
    );
    assert.equal(
      result.context.candidates.every((candidate) => candidate.excerpts.every((excerpt) => excerpt.endLine - excerpt.startLine + 1 <= MAX_LINES_PER_EXCERPT)),
      true,
    );
  });

  it("ignores secret and generated files", async () => {
    const result = await createService().analyzeSession(createProjectIntelligenceSession());
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    const paths = result.context.candidates.map((candidate) => candidate.relativePath);
    assert.equal(paths.some((path) => path.includes("node_modules")), false);
    assert.equal(paths.includes(".env"), false);
    assert.equal(paths.includes("id_rsa"), false);
    assert.equal(paths.includes("credentials.json"), false);
  });

  it("does not let a malicious browser path escape the workspace", async () => {
    const result = await createService().analyzeSession(createProjectIntelligenceSession());
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    const serialized = JSON.stringify(result.context);
    assert.equal(serialized.includes("etc/passwd"), false);
    assert.equal(serialized.includes("C:/Windows"), false);
  });

  it("associates candidates with the matching multi-root folder", async () => {
    const service = new ProjectIntelligenceService(
      new MemoryWorkspaceAccess([
        {
          name: "docs",
          root: "/workspace/docs",
          files: { "notes.md": "# notes" },
        },
        {
          name: FIXTURE_FOLDER_NAME,
          root: FIXTURE_FOLDER_ROOT,
          files: FIXTURE_PROJECT_FILES,
        },
      ]),
    );
    const result = await service.analyzeSession(createProjectIntelligenceSession());
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.context.folders.length, 2);
    assert.equal(
      result.context.candidates.every((candidate) => candidate.workspaceFolder === "shop"),
      true,
    );
    assert.equal(result.context.workspaceRoot, FIXTURE_FOLDER_ROOT);
  });

  it("stops cleanly when cancelled", async () => {
    const token = new ManualCancellationToken();
    token.cancel();
    const result = await createService().analyzeSession(createProjectIntelligenceSession(), token);
    assert.equal(result.status, "cancelled");
  });

  it("produces the same ranked candidates on repeated analysis", async () => {
    const service = createService();
    const session = createProjectIntelligenceSession();
    const first = await service.analyzeSession(session);
    const second = await service.analyzeSession(session);
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    if (first.status !== "ok" || second.status !== "ok") {
      return;
    }
    assert.deepEqual(
      first.context.candidates.map((candidate) => [candidate.relativePath, candidate.score]),
      second.context.candidates.map((candidate) => [candidate.relativePath, candidate.score]),
    );
    assert.equal(formatProjectIntelligenceSummary(first), formatProjectIntelligenceSummary(second));
  });

  it("omits excerpts for oversized files without a target line", async () => {
    const largePath = "src/app/checkout/large.ts";
    const service = createService(
      createFixtureFileMap({
        [largePath]: `export const checkout = "${"x".repeat(MAX_SOURCE_FILE_BYTES + 8)}";\n`,
      }),
    );
    const result = await service.analyzeSession(createProjectIntelligenceSession());
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    const large = result.context.candidates.find((candidate) => candidate.relativePath === largePath);
    if (large !== undefined) {
      assert.deepEqual(large.excerpts, []);
    }
  });
});
