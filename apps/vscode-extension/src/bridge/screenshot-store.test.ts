import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ScreenshotStore } from "./screenshot-store.js";

function artifact(sessionId: string, bound = false): {
  sessionId: string;
  mime: "image/jpeg";
  bytes: Buffer;
  sha256: string;
  bound: boolean;
  receivedAt: number;
} {
  return {
    sessionId,
    mime: "image/jpeg",
    bytes: Buffer.from([0xff, 0xd8, 0xff, sessionId.charCodeAt(0) ?? 1]),
    sha256: sessionId.replaceAll("-", "").slice(0, 64).padEnd(64, "a"),
    bound,
    receivedAt: Date.now(),
  };
}

describe("ScreenshotStore", () => {
  it("evicts the oldest pending artifact when the cap is exceeded", () => {
    const store = new ScreenshotStore(2);
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"));
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2"));
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3"));
    assert.equal(store.size, 2);
    assert.equal(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"), undefined);
    assert.ok(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2"));
    assert.ok(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3"));
  });

  it("prefers evicting pending artifacts before bound ones", () => {
    const store = new ScreenshotStore(2);
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1", true));
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2", false));
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3", false));
    assert.equal(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1")?.bound, true);
    assert.equal(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2"), undefined);
    assert.ok(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3"));
  });

  it("deletes artifacts used for rejected or rolled-back sessions", () => {
    const store = new ScreenshotStore(4);
    store.put(artifact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"));
    const removed = store.delete("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1");
    assert.ok(removed);
    assert.equal(store.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"), undefined);
    assert.equal(store.delete("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"), undefined);
  });
});
