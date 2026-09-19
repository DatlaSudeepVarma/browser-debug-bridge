import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isIgnoredRelativePath,
  isSafeWorkspaceRelativePath,
  resolveWorkspaceFolders,
  toSafeRelativePath,
} from "./workspace.js";

describe("workspace path safety", () => {
  it("keeps workspace-relative source paths", () => {
    assert.equal(isSafeWorkspaceRelativePath("/workspace/shop", "src/components/BuyNowButton.tsx"), true);
    assert.equal(
      toSafeRelativePath("/workspace/shop", "src/components/BuyNowButton.tsx"),
      "src/components/BuyNowButton.tsx",
    );
  });

  it("rejects traversal, absolute, and UNC paths from browser input", () => {
    assert.equal(toSafeRelativePath("/workspace/shop", "../../etc/passwd"), undefined);
    assert.equal(toSafeRelativePath("/workspace/shop", "/etc/passwd"), undefined);
    assert.equal(toSafeRelativePath("/workspace/shop", "C:/Windows/System32/cmd.ts"), undefined);
    assert.equal(toSafeRelativePath("/workspace/shop", "//evil/share/x.ts"), undefined);
    assert.equal(isSafeWorkspaceRelativePath("/workspace/shop", "../outside.ts"), false);
  });

  it("ignores generated and secret locations", () => {
    assert.equal(isIgnoredRelativePath("node_modules/react/index.js"), true);
    assert.equal(isIgnoredRelativePath("dist/index.js"), true);
    assert.equal(isIgnoredRelativePath(".next/cache/index.js"), true);
    assert.equal(isIgnoredRelativePath(".env"), true);
    assert.equal(isIgnoredRelativePath(".env.local"), true);
    assert.equal(isIgnoredRelativePath("id_rsa"), true);
    assert.equal(isIgnoredRelativePath("credentials.json"), true);
    assert.equal(isIgnoredRelativePath("secrets.json"), true);
    assert.equal(isIgnoredRelativePath("src/app/checkout/page.tsx"), false);
  });
});

describe("workspace resolution", () => {
  it("returns no-workspace when no folders are open", () => {
    assert.deepEqual(resolveWorkspaceFolders([]), { status: "none" });
  });

  it("distinguishes single-root and multi-root workspaces", () => {
    const docs = { name: "docs", root: "/workspace/docs" };
    const shop = { name: "shop", root: "/workspace/shop" };
    assert.deepEqual(resolveWorkspaceFolders([shop]), { status: "single", folder: shop });
    assert.deepEqual(resolveWorkspaceFolders([docs, shop]), {
      status: "multi",
      folders: [docs, shop],
    });
  });
});
