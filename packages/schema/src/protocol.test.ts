import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProtocolMessage, safeParseProtocolMessage } from "./index.js";
import { cloneFixture, loadFixture } from "./test-utils.js";

const validSubmission = loadFixture("valid-protocol-session.json");

describe("protocol messages", () => {
  it("accepts a valid session submission fixture", () => {
    const parsed = parseProtocolMessage(validSubmission);
    assert.equal(parsed.type, "session.submit");
    assert.equal(parsed.protocolVersion, 1);
  });

  it("accepts a valid health response", () => {
    const parsed = parseProtocolMessage({
      protocolVersion: 1,
      type: "health.response",
      status: "ok",
      service: "browser-debug-bridge",
      extensionVersion: "0.1.0",
      serverTime: "2026-09-18T16:00:00.000Z",
    });
    assert.equal(parsed.type, "health.response");
  });

  it("accepts valid pair request, response, and status", () => {
    parseProtocolMessage({
      protocolVersion: 1,
      type: "pair.request",
      requestId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      clientName: "chrome-extension",
      clientVersion: "0.1.0",
    });
    parseProtocolMessage({
      protocolVersion: 1,
      type: "pair.response",
      requestId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      pairingCode: "AB12CD",
      expiresAt: "2026-09-18T16:05:00.000Z",
    });
    parseProtocolMessage({
      protocolVersion: 1,
      type: "pair.status",
      state: "paired",
      paired: true,
    });
    parseProtocolMessage({
      protocolVersion: 1,
      type: "pair.token",
      token: "a".repeat(64),
    });
    parseProtocolMessage({
      protocolVersion: 1,
      type: "pair.token.result",
      paired: true,
    });
    parseProtocolMessage({
      protocolVersion: 1,
      type: "screenshot.ack",
      sessionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      accepted: true,
      sha256: "ab".repeat(32),
      bytes: 128,
    });
  });

  it("rejects an invalid protocol version", () => {
    const clone = cloneFixture(validSubmission) as Record<string, unknown>;
    clone.protocolVersion = 2;
    const result = safeParseProtocolMessage(clone);
    assert.equal(result.success, false);
  });

  it("rejects a malformed session submission", () => {
    const clone = cloneFixture(validSubmission) as Record<string, unknown>;
    clone.session = { schemaVersion: 1 };
    const result = safeParseProtocolMessage(clone);
    assert.equal(result.success, false);
  });

  it("rejects a malformed acknowledgement", () => {
    const result = safeParseProtocolMessage({
      protocolVersion: 1,
      type: "session.ack",
      requestId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      accepted: "yes",
    });
    assert.equal(result.success, false);
  });

  it("rejects a malformed protocol error", () => {
    const result = safeParseProtocolMessage({
      protocolVersion: 1,
      type: "error",
      code: "not_a_real_code",
      message: "Something went wrong",
    });
    assert.equal(result.success, false);
  });
});
