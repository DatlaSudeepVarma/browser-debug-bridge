import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REDACTED_PLACEHOLDER } from "@browser-debug-bridge/redaction";
import { redactNetworkEntry, redactNetworkUrl } from "./redact.js";

describe("network URL redaction", () => {
  it("redacts token query parameters and keeps the route", () => {
    const redacted = redactNetworkUrl(
      "http://127.0.0.1:4173/api/debug/server-error?token=fake-network-token",
    );
    assert.equal(redacted.includes("fake-network-token"), false);
    assert.equal(redacted.includes("/api/debug/server-error"), true);
    assert.equal(redacted.includes(`token=${REDACTED_PLACEHOLDER}`), true);
  });

  it("does not leave a raw token in a serialized network entry", () => {
    const entry = redactNetworkEntry({
      timestamp: "2026-09-19T08:00:00.000Z",
      method: "GET",
      urlRedacted: "/api/user?token=REAL_SECRET",
      status: 500,
      resourceType: "fetch",
      error: "Failed to fetch token=REAL_SECRET",
    });
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes("REAL_SECRET"), false);
    assert.equal(entry.urlRedacted.includes("/api/user"), true);
  });
});
