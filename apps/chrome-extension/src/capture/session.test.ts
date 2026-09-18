import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REDACTED_PLACEHOLDER } from "@browser-debug-bridge/redaction";
import { safeParseDebugSession } from "@browser-debug-bridge/schema";
import { parseBrowserIdentity } from "./capture.js";
import type { PageCapturePayload } from "./messages.js";
import { buildDebugSession } from "./session.js";

const FAKE_JWT =
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlLXVzZXIiLCJleGFtcGxlIjp0cnVlfQ.fake-signature";

function payload(overrides: Partial<PageCapturePayload> = {}): PageCapturePayload {
  return {
    selector: "button.primary",
    tag: "button",
    id: "pricing-cta",
    classes: ["primary"],
    role: "button",
    textPreview: "Buy now",
    rect: { x: 10, y: 20, width: 80, height: 24 },
    ancestorPath: [
      { tag: "main" },
      { tag: "section", id: "pricing" },
      { tag: "button", id: "pricing-cta", classes: ["primary"] },
    ],
    outerHtml: '<button id="pricing-cta" class="primary">Buy now</button>',
    htmlBytes: 58,
    truncated: false,
    computedSubset: { display: "inline-block", color: "rgb(0, 0, 0)" },
    matchedRuleSummaries: [{ selector: "button.primary", originHint: "display,color" }],
    page: {
      url: "http://127.0.0.1:4173/pricing",
      title: "Pricing",
      origin: "http://127.0.0.1:4173",
    },
    browser: { name: "Chrome", version: "129.0.0.0" },
    crossOriginStylesheetsSkipped: false,
    truncatedFields: [],
    ...overrides,
  };
}

const baseInput = {
  userDescription: "The CTA wraps on small screens.",
  sessionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  createdAt: "2026-09-18T16:30:00.000Z",
  startedAt: "2026-09-18T16:29:50.000Z",
  endedAt: "2026-09-18T16:30:00.000Z",
  tabIdHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  extensionVersion: "0.1.0",
};

describe("browser identity", () => {
  it("parses Chrome without extra fingerprinting", () => {
    assert.deepEqual(
      parseBrowserIdentity(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      ),
      { name: "Chrome", version: "129.0.0.0" },
    );
  });
});

describe("DebugSession construction", () => {
  it("builds a valid DebugSessionV1 and session.submit wrapper", () => {
    const result = buildDebugSession({
      ...baseInput,
      payload: payload(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const parsed = safeParseDebugSession(result.session);
    assert.equal(parsed.success, true);
    assert.equal(result.submission.type, "session.submit");
    assert.equal(result.session.schemaVersion, 1);
    assert.equal(result.session.console.length, 0);
    assert.equal(result.session.network.length, 0);
    assert.equal(result.session.screenshot.width, 1);
    assert.deepEqual(result.session.capture.permissionsGranted, [
      "activeTab",
      "scripting",
    ]);
  });

  it("rejects invalid captured data instead of submitting it", () => {
    const result = buildDebugSession({
      ...baseInput,
      sessionId: "not-a-uuid",
      payload: payload(),
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.match(result.error, /invalid/i);
    assert.equal(result.error.includes("not-a-uuid"), false);
  });

  it("redacts sensitive values so they never appear in the serialized capture", () => {
    const result = buildDebugSession({
      ...baseInput,
      userDescription: `Broken layout ${FAKE_JWT}`,
      payload: payload({
        page: {
          url: "http://127.0.0.1:4173/account?token=fake-secret-token",
          title: "Account",
          origin: "http://127.0.0.1:4173",
        },
        textPreview: `Welcome ${FAKE_JWT}`,
        outerHtml:
          '<form><input type="password" value="[REDACTED]" /><a href="[REDACTED_JAVASCRIPT_URL]">x</a></form>',
        htmlBytes: 120,
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const serialized = JSON.stringify(result.session);
    assert.equal(serialized.includes("fake-secret-token"), false);
    assert.equal(serialized.includes(FAKE_JWT), false);
    assert.equal(serialized.includes("FakePassword123!"), false);
    assert.equal(result.session.page.url.includes(REDACTED_PLACEHOLDER), true);
    assert.equal(result.session.userDescription.includes(FAKE_JWT), false);
  });
});
