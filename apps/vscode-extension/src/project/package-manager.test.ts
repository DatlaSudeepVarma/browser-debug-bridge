import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPackageManagerFromFileNames } from "./package-manager.js";

describe("package manager detection", () => {
  it("detects pnpm from lockfile or workspace file", () => {
    const detected = detectPackageManagerFromFileNames(["pnpm-lock.yaml", "package.json"]);
    assert.equal(detected?.name, "pnpm");
    assert.equal(detected?.evidence.includes("pnpm-lock.yaml"), true);
  });

  it("detects npm, yarn, and bun from lockfiles", () => {
    assert.equal(detectPackageManagerFromFileNames(["package-lock.json"])?.name, "npm");
    assert.equal(detectPackageManagerFromFileNames(["yarn.lock"])?.name, "yarn");
    assert.equal(detectPackageManagerFromFileNames(["bun.lockb"])?.name, "bun");
  });

  it("prefers bun, then pnpm, then yarn, then npm", () => {
    assert.equal(
      detectPackageManagerFromFileNames(["package-lock.json", "pnpm-lock.yaml", "bun.lock"])?.name,
      "bun",
    );
    assert.equal(
      detectPackageManagerFromFileNames(["package-lock.json", "yarn.lock", "pnpm-workspace.yaml"])?.name,
      "pnpm",
    );
  });

  it("does not infer a package manager from arbitrary text", () => {
    assert.equal(detectPackageManagerFromFileNames(["README.md", "src/pnpm-notes.ts"]), undefined);
  });
});
