import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFakeDebugSessionV1,
  createFakeSessionSubmission,
  parseDebugSession,
} from "./index.js";

describe("fake debug session helpers", () => {
  it("creates a valid DebugSessionV1", () => {
    const session = createFakeDebugSessionV1();
    assert.equal(session.schemaVersion, 1);
    assert.equal(parseDebugSession(session).sessionId, session.sessionId);
  });

  it("wraps a fake session in a valid protocol submission", () => {
    const submission = createFakeSessionSubmission();
    assert.equal(submission.type, "session.submit");
    assert.equal(submission.session.page.url.includes("token="), false);
  });
});
