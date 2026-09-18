import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEBUG_SESSION_LIMITS,
  parseDebugSession,
  safeParseDebugSession,
} from "./index.js";
import { cloneFixture, loadFixture } from "./test-utils.js";

const validSession = loadFixture("valid-debug-session.json");
const invalidSession = loadFixture("invalid-debug-session.json");

function mutateValid(mutator: (session: Record<string, unknown>) => void): unknown {
  const clone = cloneFixture(validSession) as Record<string, unknown>;
  mutator(clone);
  return clone;
}

describe("DebugSessionV1", () => {
  it("accepts a valid debug session fixture", () => {
    const parsed = parseDebugSession(validSession);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.sessionId, "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    assert.equal(parsed.screenshot.sha256.length, 64);
    assert.equal("bytes" in parsed.screenshot, false);
  });

  it("rejects the invalid debug session fixture", () => {
    const result = safeParseDebugSession(invalidSession);
    assert.equal(result.success, false);
  });

  it("rejects an invalid sessionId", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.sessionId = "not-a-uuid";
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects an invalid schemaVersion", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.schemaVersion = 2;
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects an invalid timestamp", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.createdAt = "yesterday";
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects missing required fields", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        delete session.page;
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects an oversized userDescription", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.userDescription = "x".repeat(DEBUG_SESSION_LIMITS.userDescription + 1);
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects oversized DOM outer HTML", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.dom = {
          ...(session.dom as Record<string, unknown>),
          outerHtmlTruncated: "<div>".repeat(
            Math.ceil((DEBUG_SESSION_LIMITS.outerHtml + 1) / 5),
          ),
        };
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects too many console messages", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        const consoleEntries = session.console as unknown[];
        const sample = consoleEntries[0];
        assert.ok(sample);
        session.console = Array.from(
          { length: DEBUG_SESSION_LIMITS.consoleEntries + 1 },
          () => cloneFixture(sample),
        );
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects too many network entries", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        const networkEntries = session.network as unknown[];
        const sample = networkEntries[0];
        assert.ok(sample);
        session.network = Array.from(
          { length: DEBUG_SESSION_LIMITS.networkEntries + 1 },
          () => cloneFixture(sample),
        );
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects invalid screenshot metadata", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.screenshot = {
          ...(session.screenshot as Record<string, unknown>),
          mime: "image/gif",
          width: 0,
          sha256: "not-a-hash",
        };
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects screenshot bytes inside the session", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.screenshot = {
          ...(session.screenshot as Record<string, unknown>),
          bytes: "AAAA",
        };
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects an invalid framework value", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.hints = {
          ...(session.hints as Record<string, unknown>),
          framework: "jquery",
        };
      }),
    );
    assert.equal(result.success, false);
  });

  it("rejects extra sensitive fields such as cookies", () => {
    const result = safeParseDebugSession(
      mutateValid((session) => {
        session.cookies = [{ name: "session", value: "fake" }];
      }),
    );
    assert.equal(result.success, false);
  });
});
