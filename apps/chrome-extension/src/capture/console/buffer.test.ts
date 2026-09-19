import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleRingBuffer } from "./buffer.js";
import { MAX_CONSOLE_ENTRIES } from "./limits.js";
import type { BuiltConsoleEntry } from "./entries.js";

function entry(index: number): BuiltConsoleEntry {
  return {
    level: "log",
    message: `msg-${String(index)}`,
    timestamp: "2026-09-19T07:00:00.000Z",
  };
}

describe("console ring buffer", () => {
  it("keeps at most 50 entries", () => {
    const buffer = new ConsoleRingBuffer();
    for (let index = 0; index < MAX_CONSOLE_ENTRIES + 10; index += 1) {
      buffer.push(entry(index));
    }
    assert.equal(buffer.size, MAX_CONSOLE_ENTRIES);
    assert.equal(MAX_CONSOLE_ENTRIES, 50);
  });

  it("retains the newest entries", () => {
    const buffer = new ConsoleRingBuffer();
    for (let index = 0; index < 55; index += 1) {
      buffer.push(entry(index));
    }
    const snapshot = buffer.snapshot();
    assert.equal(snapshot[0]?.message, "msg-5");
    assert.equal(snapshot[snapshot.length - 1]?.message, "msg-54");
  });

  it("clears stored entries", () => {
    const buffer = new ConsoleRingBuffer();
    buffer.push(entry(1));
    buffer.clear();
    assert.equal(buffer.size, 0);
    assert.deepEqual(buffer.snapshot(), []);
  });
});
