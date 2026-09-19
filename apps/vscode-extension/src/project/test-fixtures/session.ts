import { parseDebugSession, type DebugSessionV1 } from "@browser-debug-bridge/schema";

export function createProjectIntelligenceSession(): DebugSessionV1 {
  const now = "2026-09-19T10:00:00.000Z";
  return parseDebugSession({
    schemaVersion: 1,
    sessionId: "11111111-1111-4111-8111-111111111111",
    createdAt: now,
    page: {
      url: "https://localhost:3000/checkout?page=2",
      title: "Checkout",
      origin: "https://localhost:3000",
    },
    browser: {
      name: "Chrome",
      version: "0.0.0-fake",
      extensionVersion: "0.1.0",
    },
    userDescription: "Fake checkout session for project intelligence tests.",
    selectedElement: {
      selector: 'button#buy-now.buy-now[data-testid="buy-now"]',
      tag: "button",
      id: "buy-now",
      classes: ["buy-now"],
      role: "button",
      textPreview: "Buy now",
      rect: { x: 8, y: 8, width: 80, height: 24 },
      ancestorPath: [{ tag: "body" }, { tag: "button", id: "buy-now" }],
    },
    dom: {
      outerHtmlTruncated:
        '<button id="buy-now" class="buy-now" data-testid="buy-now">Buy now</button>',
      htmlBytes: 72,
      truncated: false,
    },
    css: {
      computedSubset: { display: "inline-block" },
      matchedRuleSummaries: [{ selector: "button.buy-now", originHint: "fixture" }],
    },
    screenshot: {
      mime: "image/png",
      width: 32,
      height: 32,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      cropped: true,
    },
    console: [
      {
        level: "error",
        message: "Fake TypeError: submitCheckout is not defined",
        timestamp: "2026-09-19T10:00:01.000Z",
        stack:
          "TypeError: submitCheckout is not defined\n    at BuyNowButton (src/components/BuyNowButton.tsx:3:17)\n    at evil (../../etc/passwd:1:1)",
      },
    ],
    network: [
      {
        timestamp: "2026-09-19T10:00:01.000Z",
        method: "POST",
        urlRedacted: "https://localhost:3000/api/checkout?token=[REDACTED]",
        status: 500,
        resourceType: "fetch",
      },
    ],
    hints: {
      framework: "nextjs",
      evidence: ["project intelligence fixture"],
    },
    capture: {
      startedAt: now,
      endedAt: "2026-09-19T10:00:02.000Z",
      tabIdHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      permissionsGranted: [],
    },
    redaction: {
      rulesApplied: ["fake"],
      notes: "Synthetic session for project intelligence tests.",
    },
    metadata: {
      payloadBytes: 1024,
      truncatedFields: [],
    },
  });
}
