import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { resolveCandidatePath } from "./open-path.js";

describe("candidate path resolution", () => {
  const project = createFixtureAiProjectContext();

  it("accepts a validated workspace candidate", () => {
    const result = resolveCandidatePath("src/services/checkout.ts", project);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.resolved.relativePath, "src/services/checkout.ts");
    assert.equal(result.resolved.folderRoot, "/workspace/shop");
  });

  it("rejects a traversal path even if it is listed as allowed", () => {
    const allowed = new Set(["../../etc/passwd", "src/services/checkout.ts"]);
    const result = resolveCandidatePath("../../etc/passwd", project, allowed);
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") {
      return;
    }
    assert.equal(result.reason === "not-allowed" || result.reason === "unsafe", true);
  });

  it("rejects an external absolute path", () => {
    const allowed = new Set(["C:/Windows/System32/drivers/etc/hosts"]);
    const result = resolveCandidatePath("C:/Windows/System32/drivers/etc/hosts", project, allowed);
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") {
      return;
    }
    assert.equal(result.reason === "not-allowed" || result.reason === "outside-workspace", true);
  });

  it("rejects a path that is not a ProjectContext candidate", () => {
    const result = resolveCandidatePath("package.json", project);
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") {
      return;
    }
    assert.equal(result.reason, "not-allowed");
  });
});
