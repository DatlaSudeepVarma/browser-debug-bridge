import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { validateFixPath } from "./paths.js";
import { fixtureAllowedPaths } from "./test-support.js";

describe("fix path validation", () => {
  const project = createFixtureAiProjectContext();
  const allowed = new Set(fixtureAllowedPaths());

  it("accepts a diagnosis candidate", () => {
    const result = validateFixPath("src/services/checkout.ts", project, allowed);
    assert.equal(result.status, "ok");
  });

  it("rejects path traversal", () => {
    for (const relativePath of ["../../secret.ts", "../../../etc/passwd"]) {
      const result = validateFixPath(relativePath, project, new Set([relativePath]));
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") {
        assert.equal(result.reason === "unsafe" || result.reason === "outside-workspace", true);
      }
    }
  });

  it("rejects absolute paths", () => {
    for (const relativePath of [
      "/etc/passwd",
      "C:\\secret.ts",
      "C:/secret.ts",
      "\\\\server\\share\\file.ts",
      "\\\\?\\C:\\secret.ts",
    ]) {
      const result = validateFixPath(relativePath, project, new Set([relativePath]));
      assert.equal(result.status, "rejected");
    }
  });

  it("rejects a canonical symlink escape even when the lexical path looks relative", () => {
    const realpaths: Record<string, string> = {
      "/workspace/shop": "/workspace/shop",
      "/workspace/shop/src": "/workspace/shop/src",
      "/workspace/shop/src/services": "/workspace/shop/src/services",
      "/workspace/shop/src/services/checkout.ts": "/etc/passwd",
    };
    const io = {
      exists(target: string): boolean {
        return target in realpaths;
      },
      realpath(target: string): string {
        const resolved = realpaths[target];
        if (resolved === undefined) {
          throw new Error(`missing ${target}`);
        }
        return resolved;
      },
      join(left: string, right: string): string {
        return `${left}/${right}`;
      },
      sep: "/",
      ignoreCase: false,
    };
    const result = validateFixPath("src/services/checkout.ts", project, allowed, io);
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(result.reason, "outside-workspace");
    }
  });

  it("rejects sensitive files", () => {
    for (const relativePath of [".env", ".env.local", "credentials.json", "id_rsa", "private.pem"]) {
      const result = validateFixPath(relativePath, project, new Set([relativePath]));
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") {
        assert.equal(result.reason === "sensitive" || result.reason === "unsafe", true);
      }
    }
  });

  it("rejects a legitimate-looking non-candidate file", () => {
    const result = validateFixPath("src/random-file.ts", project, allowed);
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(result.reason, "not-allowed");
    }
  });
});
