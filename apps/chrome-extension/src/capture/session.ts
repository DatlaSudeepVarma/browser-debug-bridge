import {
  DEBUG_SESSION_LIMITS,
  PROTOCOL_VERSION,
  safeParseDebugSession,
  safeParseProtocolMessage,
  type DebugSessionV1,
  type ScreenshotMetadata,
  type SessionSubmission,
} from "@browser-debug-bridge/schema";
import { redactSensitiveText, redactUrl } from "@browser-debug-bridge/redaction";
import { normalizeUserDescription } from "./capture.js";
import type { BuiltConsoleEntry } from "./console/entries.js";
import { MAX_CONSOLE_ENTRIES } from "./console/limits.js";
import { redactConsoleEntry } from "./console/redact.js";
import { filterComputedSubset } from "./css.js";
import { utf8ByteLength } from "./dom.js";
import { CAPTURE_LIMITS, CAPTURE_PERMISSIONS_USED } from "./limits.js";
import type { PageCapturePayload } from "./messages.js";
import { boundClasses, safeElementId } from "./selectors.js";

export interface SessionBuildInput {
  payload: PageCapturePayload;
  userDescription: string;
  sessionId: string;
  createdAt: string;
  startedAt: string;
  endedAt: string;
  tabIdHash: string;
  extensionVersion: string;
  screenshot: ScreenshotMetadata;
  consoleEntries?: BuiltConsoleEntry[];
  permissionsGranted?: string[];
}

export type SessionBuildResult =
  | { ok: true; session: DebugSessionV1; submission: SessionSubmission }
  | { ok: false; error: string };

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function formatValidationError(path: ReadonlyArray<PropertyKey>): string {
  const field = path.map(String).join(".");
  if (field.length === 0) {
    return "The captured session was invalid and was not sent.";
  }
  return `The captured session was invalid (${field}) and was not sent.`;
}

function evidenceFor(payload: PageCapturePayload, consoleCount: number): string[] {
  const evidence = ["element picker capture", "cropped jpeg screenshot"];
  if (consoleCount > 0) {
    evidence.push("session-scoped console capture");
  }
  if (payload.crossOriginStylesheetsSkipped) {
    evidence.push("cross-origin stylesheets skipped");
  }
  if (payload.truncated) {
    evidence.push("dom html truncated");
  }
  return evidence
    .map((item) => clip(item, CAPTURE_LIMITS.hintsEvidenceItem))
    .slice(0, CAPTURE_LIMITS.hintsEvidence);
}

function sanitizeConsoleEntries(entries: BuiltConsoleEntry[]): BuiltConsoleEntry[] {
  return entries.map(redactConsoleEntry).slice(-MAX_CONSOLE_ENTRIES);
}

export function buildDebugSession(input: SessionBuildInput): SessionBuildResult {
  const payload = input.payload;
  const pageUrl = clip(redactUrl(payload.page.url), CAPTURE_LIMITS.pageUrl);
  const userDescription = normalizeUserDescription(input.userDescription);
  const outerHtml = clip(
    redactSensitiveText(payload.outerHtml),
    CAPTURE_LIMITS.outerHtml,
  );
  const id = safeElementId(payload.id);
  const consoleEntries = sanitizeConsoleEntries(input.consoleEntries ?? []);
  const truncatedFields = [...payload.truncatedFields].slice(
    0,
    CAPTURE_LIMITS.truncatedFields,
  );
  if (
    (input.consoleEntries?.length ?? 0) > MAX_CONSOLE_ENTRIES &&
    !truncatedFields.includes("console") &&
    truncatedFields.length < CAPTURE_LIMITS.truncatedFields
  ) {
    truncatedFields.push("console");
  }

  const candidate = {
    schemaVersion: 1,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    page: {
      url: pageUrl.length > 0 ? pageUrl : "[UNPARSEABLE_URL]",
      title: clip(redactSensitiveText(payload.page.title), CAPTURE_LIMITS.pageTitle),
      origin: clip(payload.page.origin, CAPTURE_LIMITS.pageOrigin) || "null",
    },
    browser: {
      name: clip(payload.browser.name, CAPTURE_LIMITS.browserName) || "Chrome",
      version: clip(payload.browser.version, CAPTURE_LIMITS.browserVersion) || "0",
      extensionVersion: clip(
        input.extensionVersion,
        CAPTURE_LIMITS.extensionVersion,
      ),
    },
    userDescription,
    selectedElement: {
      selector: clip(payload.selector, CAPTURE_LIMITS.cssSelector) || "body",
      tag: clip(payload.tag, CAPTURE_LIMITS.tagName) || "div",
      ...(id === undefined ? {} : { id }),
      classes: boundClasses(payload.classes),
      ...(payload.role === undefined || payload.role.length === 0
        ? {}
        : { role: clip(payload.role, CAPTURE_LIMITS.role) }),
      textPreview: clip(
        redactSensitiveText(payload.textPreview),
        CAPTURE_LIMITS.textPreview,
      ),
      rect: payload.rect,
      ancestorPath: payload.ancestorPath.slice(0, CAPTURE_LIMITS.ancestorPathDepth),
    },
    dom: {
      outerHtmlTruncated: outerHtml,
      htmlBytes: Math.min(
        Math.max(0, Math.trunc(payload.htmlBytes)),
        DEBUG_SESSION_LIMITS.htmlBytes,
      ),
      truncated: payload.truncated,
    },
    css: {
      computedSubset: filterComputedSubset(payload.computedSubset),
      matchedRuleSummaries: payload.matchedRuleSummaries.slice(
        0,
        CAPTURE_LIMITS.matchedRuleSummaries,
      ),
    },
    screenshot: input.screenshot,
    console: consoleEntries,
    network: [],
    hints: {
      evidence: evidenceFor(payload, consoleEntries.length),
    },
    capture: {
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      tabIdHash: input.tabIdHash,
      permissionsGranted: (input.permissionsGranted ?? [...CAPTURE_PERMISSIONS_USED]).slice(
        0,
        CAPTURE_LIMITS.permissionsGranted,
      ),
    },
    redaction: {
      rulesApplied: ["url", "dom", "text", "user-description", "console-text"],
      notes:
        "Phase 5B session-scoped console capture. Console redaction is heuristic (JWT, URLs, bearer tokens, sensitive query pairs). Runtime page errors and unhandled rejections are represented in console[]. Screenshot pixels are not redacted. Network is not captured.",
    },
    metadata: {
      payloadBytes: 0,
      truncatedFields,
    },
  };

  const parsed = safeParseDebugSession(candidate);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path ?? [];
    return { ok: false, error: formatValidationError(path) };
  }

  const payloadBytes = Math.min(
    utf8ByteLength(JSON.stringify(parsed.data)),
    CAPTURE_LIMITS.payloadBytes,
  );
  const withBytes = {
    ...parsed.data,
    metadata: {
      ...parsed.data.metadata,
      payloadBytes,
    },
  };
  const sessionParsed = safeParseDebugSession(withBytes);
  if (!sessionParsed.success) {
    return { ok: false, error: formatValidationError(sessionParsed.error.issues[0]?.path ?? []) };
  }

  const submissionCandidate = {
    protocolVersion: PROTOCOL_VERSION,
    type: "session.submit" as const,
    requestId: input.sessionId,
    session: sessionParsed.data,
  };
  const protocolParsed = safeParseProtocolMessage(submissionCandidate);
  if (!protocolParsed.success || protocolParsed.data.type !== "session.submit") {
    return { ok: false, error: "The captured session was invalid and was not sent." };
  }

  return {
    ok: true,
    session: sessionParsed.data,
    submission: protocolParsed.data,
  };
}
