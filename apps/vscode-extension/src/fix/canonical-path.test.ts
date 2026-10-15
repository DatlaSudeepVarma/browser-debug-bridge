import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  inspectCanonicalWorkspaceTarget,
  isInsideCanonicalRoot,
  type CanonicalPathIo,
} from "./canonical-path.js";

function memoryIo(options: {
  exists: string[];
  realpath: Record<string, string>;
  sep?: string;
  ignoreCase?: boolean;
}): CanonicalPathIo {
  const sep = options.sep ?? "/";
  const exists = new Set(options.exists);
  return {
    exists(target: string): boolean {
      return exists.has(target);
    },
    realpath(target: string): string {
      const resolved = options.realpath[target];
      if (resolved === undefined) {
        throw new Error(`missing realpath for ${target}`);
      }
      return resolved;
    },
    join(left: string, right: string): string {
      return left.endsWith(sep) ? `${left}${right}` : `${left}${sep}${right}`;
    },
    sep,
    ignoreCase: options.ignoreCase ?? false,
  };
}

describe("canonical workspace path", () => {
  it("skips canonical checks when the workspace root does not exist", () => {
    const io = memoryIo({ exists: [], realpath: {} });
    const result = inspectCanonicalWorkspaceTarget("/workspace/shop", "src/services/checkout.ts", io);
    assert.equal(result.status, "skipped");
  });

  it("accepts a file whose real path stays inside the workspace", () => {
    const io = memoryIo({
      exists: ["/workspace", "/workspace/src", "/workspace/src/ok.ts"],
      realpath: {
        "/workspace": "/workspace",
        "/workspace/src": "/workspace/src",
        "/workspace/src/ok.ts": "/workspace/src/ok.ts",
      },
    });
    const result = inspectCanonicalWorkspaceTarget("/workspace", "src/ok.ts", io);
    assert.equal(result.status, "ok");
    if (result.status === "ok") {
      assert.equal(result.canonicalPath, "/workspace/src/ok.ts");
    }
  });

  it("rejects a symlink that resolves outside the workspace", () => {
    const io = memoryIo({
      exists: ["/workspace", "/workspace/src", "/workspace/src/leak.ts"],
      realpath: {
        "/workspace": "/workspace",
        "/workspace/src": "/workspace/src",
        "/workspace/src/leak.ts": "/etc/passwd",
      },
    });
    const result = inspectCanonicalWorkspaceTarget("/workspace", "src/leak.ts", io);
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(result.reason, "outside-workspace");
    }
  });

  it("does not treat a sibling directory as inside the workspace", () => {
    const io = memoryIo({
      exists: ["C:\\workspace", "C:\\workspace-evil", "C:\\workspace-evil\\a.ts"],
      realpath: {
        "C:\\workspace": "C:\\workspace",
        "C:\\workspace-evil": "C:\\workspace-evil",
        "C:\\workspace-evil\\a.ts": "C:\\workspace-evil\\a.ts",
      },
      sep: "\\",
      ignoreCase: true,
    });
    assert.equal(isInsideCanonicalRoot("C:\\workspace", "C:\\workspace-evil\\a.ts", io), false);
    assert.equal(isInsideCanonicalRoot("C:\\workspace", "C:\\workspace\\src\\a.ts", io), true);
    assert.equal(isInsideCanonicalRoot("C:\\workspace", "C:\\WORKSPACE\\src\\a.ts", io), true);
  });

  it("rejects a real filesystem symlink that escapes the temp workspace", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "bdb-jail-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "bdb-out-"));
    try {
      writeFileSync(path.join(outside, "secret.ts"), "secret");
      mkdirSync(path.join(root, "src"));
      try {
        symlinkSync(path.join(outside, "secret.ts"), path.join(root, "src", "leak.ts"));
      } catch {
        assert.ok(true, "symlink creation is unavailable on this host");
        return;
      }
      const result = inspectCanonicalWorkspaceTarget(root, "src/leak.ts");
      assert.equal(result.status, "rejected");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
