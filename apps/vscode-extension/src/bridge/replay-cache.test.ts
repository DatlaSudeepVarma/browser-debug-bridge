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

  it("keeps the oldest request id after many newer ids", () => {
    const cache = new RequestReplayCache();
    cache.remember("id-1", "s1");
    for (let index = 0; index < 200; index += 1) {
      cache.remember(`id-${String(index + 2)}`, `s${String(index + 2)}`);
    }
    assert.equal(cache.check("id-1", "s1"), "idempotent");
    assert.equal(cache.check("id-1", "other"), "conflict");
    assert.equal(cache.size, 201);
  });
});
