import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NetworkRingBuffer } from "./buffer.js";
import type { BuiltNetworkEntry } from "./entries.js";
import { MAX_NETWORK_ENTRIES } from "./limits.js";

function entry(index: number): BuiltNetworkEntry {
  return {
    timestamp: "2026-09-19T08:00:00.000Z",
    method: "GET",
    urlRedacted: `/api/fail/${String(index)}`,
    status: 500,
    resourceType: "fetch",
  };
}

describe("network ring buffer", () => {
  it("keeps at most 100 entries", () => {
    const buffer = new NetworkRingBuffer();
    for (let index = 0; index < MAX_NETWORK_ENTRIES + 12; index += 1) {
      buffer.push(entry(index));
    }
    assert.equal(buffer.size, MAX_NETWORK_ENTRIES);
    assert.equal(MAX_NETWORK_ENTRIES, 100);
  });

  it("retains the newest entries", () => {
    const buffer = new NetworkRingBuffer();
    for (let index = 0; index < 105; index += 1) {
      buffer.push(entry(index));
    }
    const snapshot = buffer.snapshot();
    assert.equal(snapshot[0]?.urlRedacted, "/api/fail/5");
    assert.equal(snapshot[snapshot.length - 1]?.urlRedacted, "/api/fail/104");
  });

  it("clears stored entries when the session ends", () => {
    const buffer = new NetworkRingBuffer();
    buffer.push(entry(1));
    buffer.clear();
    assert.equal(buffer.size, 0);
    assert.deepEqual(buffer.snapshot(), []);
  });
});
