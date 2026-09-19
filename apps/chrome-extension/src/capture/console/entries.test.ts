import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipConsoleStack,
  createConsoleEntry,
  createConsoleFingerprint,
  createDeduper,
  isIsoTimestamp,
  mapConsoleLevel,
  nowIsoTimestamp,
} from "./entries.js";
import { MAX_CONSOLE_STACK_LENGTH } from "./limits.js";

describe("console entry construction", () => {
  it("builds a schema-shaped entry with a capture-time timestamp", () => {
    const before = Date.now();
    const entry = createConsoleEntry({
      level: "warn",
      message: "hello",
    });
    const after = Date.now();
    assert.ok(entry);
    if (entry === undefined) {
      return;
    }
    assert.equal(entry.level, "warn");
    assert.equal(entry.message, "hello");
    assert.equal(isIsoTimestamp(entry.timestamp), true);
    const parsed = Date.parse(entry.timestamp);
    assert.ok(parsed >= before - 5);
    assert.ok(parsed <= after + 5);
    assert.equal("stack" in entry, false);
  });

  it("generates ISO timestamps", () => {
    assert.equal(isIsoTimestamp(nowIsoTimestamp()), true);
  });

  it("truncates stacks to the capture limit", () => {
    const clipped = clipConsoleStack("s".repeat(MAX_CONSOLE_STACK_LENGTH + 40));
    assert.equal(clipped.truncated, true);
    assert.equal(clipped.text.length, MAX_CONSOLE_STACK_LENGTH);
  });

  it("keeps a provided stack when it is already bounded", () => {
    const entry = createConsoleEntry({
      level: "error",
      message: "failed",
      timestamp: "2026-09-19T07:14:00.000Z",
      stack: "Error: failed\n    at fake.js:1:1",
    });
    assert.equal(entry?.stack, "Error: failed\n    at fake.js:1:1");
    assert.equal(entry?.timestamp, "2026-09-19T07:14:00.000Z");
  });
});

describe("unsupported console level handling", () => {
  it("maps supported and conservative aliases, and ignores the rest", () => {
    assert.equal(mapConsoleLevel("error"), "error");
    assert.equal(mapConsoleLevel("warn"), "warn");
    assert.equal(mapConsoleLevel("log"), "log");
    assert.equal(mapConsoleLevel("info"), "info");
    assert.equal(mapConsoleLevel("debug"), "debug");
    assert.equal(mapConsoleLevel("warning"), "warn");
    assert.equal(mapConsoleLevel("exception"), "error");
    assert.equal(mapConsoleLevel("table"), "log");
    assert.equal(mapConsoleLevel("time"), undefined);
    assert.equal(createConsoleEntry({ level: "time", message: "x" }), undefined);
  });
});

describe("duplicate error handling", () => {
  it("drops identical fingerprints inside the dedup window", () => {
    const deduper = createDeduper(250, 16);
    const fingerprint = createConsoleFingerprint("error", "[page error] boom", "Error: boom");
    assert.equal(deduper.seen(fingerprint, 1_000), false);
    assert.equal(deduper.seen(fingerprint, 1_100), true);
    assert.equal(deduper.seen(fingerprint, 1_400), false);
  });
});
