import { parseDebugSession, type DebugSessionV1 } from "./debug-session.js";
import {
  parseProtocolMessage,
  type SessionSubmission,
} from "./protocol.js";
import { PROTOCOL_VERSION } from "./common.js";

function createId(): string {
  return globalThis.crypto.randomUUID();
}

export function createFakeDebugSessionV1(
  overrides: Partial<Pick<DebugSessionV1, "sessionId" | "userDescription">> = {},
): DebugSessionV1 {
  const now = "2026-09-18T16:00:00.000Z";
  return parseDebugSession({
    schemaVersion: 1,
    sessionId: overrides.sessionId ?? createId(),
    createdAt: now,
    page: {
      url: "https://localhost:3000/profile?id=42",
      title: "Fake Profile",
      origin: "https://localhost:3000",
    },
    browser: {
      name: "Chrome",
      version: "0.0.0-fake",
      extensionVersion: "0.1.0",
    },
    userDescription:
      overrides.userDescription ??
      "Fake debug session for local Browser Debug Bridge development.",
    selectedElement: {
      selector: "button#fake-submit",
      tag: "button",
      id: "fake-submit",
      classes: ["fake"],
      role: "button",
      textPreview: "Fake Save",
      rect: { x: 8, y: 8, width: 80, height: 24 },
      ancestorPath: [{ tag: "body" }, { tag: "button", id: "fake-submit" }],
    },
    dom: {
      outerHtmlTruncated:
        '<button id="fake-submit" class="fake">Fake Save</button>',
      htmlBytes: 52,
      truncated: false,
    },
    css: {
      computedSubset: { display: "inline-block" },
      matchedRuleSummaries: [{ selector: "button.fake", originHint: "test" }],
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
        message: "Fake TypeError: example is not defined",
        timestamp: "2026-09-18T16:00:01.000Z",
      },
    ],
    network: [
      {
        timestamp: "2026-09-18T16:00:01.000Z",
        method: "GET",
        urlRedacted: "https://localhost:3000/api/fake",
        status: 500,
        resourceType: "fetch",
      },
    ],
    hints: {
      framework: "other",
      evidence: ["fake session fixture"],
    },
    capture: {
      startedAt: now,
      endedAt: "2026-09-18T16:00:02.000Z",
      tabIdHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      permissionsGranted: [],
    },
    redaction: {
      rulesApplied: ["fake"],
      notes: "Synthetic session. Contains no real user data.",
    },
    metadata: {
      payloadBytes: 1024,
      truncatedFields: [],
    },
  });
}

export function createFakeSessionSubmission(
  session: DebugSessionV1 = createFakeDebugSessionV1(),
): SessionSubmission {
  return parseProtocolMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: "session.submit",
    requestId: createId(),
    session,
  }) as SessionSubmission;
}
