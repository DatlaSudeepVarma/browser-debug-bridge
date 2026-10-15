import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestReplayCache } from "./replay-cache.js";

describe("RequestReplayCache", () => {
  it("accepts a fresh requestId", () => {
    const cache = new RequestReplayCache();
    assert.equal(cache.check("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", "session-a"), "fresh");
  });

  it("treats the same requestId and session as idempotent", () => {
    const cache = new RequestReplayCache();
    cache.remember("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", "session-a");
    assert.equal(cache.check("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", "session-a"), "idempotent");
  });

  it("rejects the same requestId for a different session", () => {
    const cache = new RequestReplayCache();
    cache.remember("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", "session-a");
    assert.equal(cache.check("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", "session-b"), "conflict");
  });

  it("evicts the oldest request ids when the bound is exceeded", () => {
    const cache = new RequestReplayCache(2);
    cache.remember("id-1", "s1");
    cache.remember("id-2", "s2");
    cache.remember("id-3", "s3");
    assert.equal(cache.size, 2);
    assert.equal(cache.check("id-1", "s1"), "fresh");
    assert.equal(cache.check("id-3", "s3"), "idempotent");
  });
});
