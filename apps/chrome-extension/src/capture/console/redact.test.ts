import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REDACTED_PLACEHOLDER } from "@browser-debug-bridge/redaction";
import { redactConsoleEntry, redactConsoleText } from "./redact.js";

const FAKE_JWT =
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlLXVzZXIiLCJleGFtcGxlIjp0cnVlfQ.fake-signature";

describe("console redaction", () => {
  it("redacts JWT-like values", () => {
    const redacted = redactConsoleText(`auth ${FAKE_JWT}`);
    assert.equal(redacted.includes(FAKE_JWT), false);
    assert.match(redacted, new RegExp(REDACTED_PLACEHOLDER.replace("[", "\\[")));
  });

  it("redacts API key query pairs", () => {
    const redacted = redactConsoleText("fixture error api_key=fake-api-key-456");
    assert.equal(redacted.includes("fake-api-key-456"), false);
    assert.equal(redacted.includes(`api_key=${REDACTED_PLACEHOLDER}`), true);
  });

  it("redacts sensitive text including bearer tokens and token pairs", () => {
    const redacted = redactConsoleText(
      "Bearer abcdef.token value token=fake-token-123 https://localhost/x?secret=shh",
    );
    assert.equal(redacted.includes("abcdef.token"), false);
    assert.equal(redacted.includes("fake-token-123"), false);
    assert.equal(redacted.includes("shh"), false);
    assert.equal(redacted.includes(`Bearer ${REDACTED_PLACEHOLDER}`), true);
  });

  it("does not leave raw secrets on a console entry", () => {
    const entry = redactConsoleEntry({
      level: "error",
      message: `token=${FAKE_JWT}`,
      timestamp: "2026-09-19T07:14:00.000Z",
      stack: `Error token=fake-token-123\n    at fake.js:1:1`,
    });
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes(FAKE_JWT), false);
    assert.equal(serialized.includes("fake-token-123"), false);
  });
});
