import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTabIdSalt, hashTabId } from "./tab-hash.js";

describe("tab ID hashing", () => {
  it("returns a 32-character hex digest and never the raw tab id", async () => {
    const salt = "ab".repeat(32);
    const digest = await hashTabId(12345, salt);
    assert.match(digest, /^[a-f0-9]{32}$/);
    assert.equal(digest.includes("12345"), false);
    assert.equal(digest === "12345", false);
  });

  it("is stable for the same salt and tab, and distinct across tabs", async () => {
    const salt = "cd".repeat(32);
    const first = await hashTabId(8, salt);
    const second = await hashTabId(8, salt);
    const other = await hashTabId(9, salt);
    assert.equal(first, second);
    assert.notEqual(first, other);
  });

  it("generates a 256-bit per-installation salt rather than a static secret", () => {
    const salt = generateTabIdSalt();
    assert.match(salt, /^[a-f0-9]{64}$/);
    assert.notEqual(salt, generateTabIdSalt());
  });
});
