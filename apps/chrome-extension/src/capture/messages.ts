export interface CapturedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedAncestor {
  tag: string;
  id?: string;
  classes?: string[];
}

export interface MatchedRuleSummary {
  selector: string;
  originHint?: string;
}

export interface PageCapturePayload {
  selector: string;
  tag: string;
  id?: string;
  classes: string[];
  role?: string;
  textPreview: string;
  rect: CapturedRect;
  ancestorPath: CapturedAncestor[];
  outerHtml: string;
  htmlBytes: number;
  truncated: boolean;
  computedSubset: Record<string, string>;
  matchedRuleSummaries: MatchedRuleSummary[];
  page: {
    url: string;
    title: string;
    origin: string;
  };
  browser: {
    name: string;
    version: string;
  };
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  crossOriginStylesheetsSkipped: boolean;
  truncatedFields: string[];
}

export type CaptureStatus = "idle" | "picking" | "selected" | "submitting";

export interface CaptureState {
  status: CaptureStatus;
  startedAt?: string;
  tabId?: number;
  lastError?: string;
  lastSessionId?: string;
  lastSelector?: string;
}

export type ConsoleEventSource = "console" | "page-error" | "unhandled-rejection";

export interface ConsoleEventPayload {
  level: "debug" | "log" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  stack?: string;
  source: ConsoleEventSource;
}

export type RuntimeMessage =
  | { type: "start-capture" }
  | { type: "cancel-capture" }
  | { type: "get-capture-state" }
  | { type: "capture-started"; tabId: number }
  | { type: "picker-ready" }
  | { type: "picker-failed"; error: string }
  | { type: "capture-cancelled" }
  | { type: "console-event"; entry: ConsoleEventPayload }
  | {
      type: "submit-capture";
      payload: PageCapturePayload;
      userDescription: string;
    };

export type RuntimeResponse =
  | { ok: true; state?: CaptureState; sessionId?: string }
  | { ok: false; error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPageCapturePayload(value: unknown): value is PageCapturePayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.selector === "string" &&
    typeof value.tag === "string" &&
    Array.isArray(value.classes) &&
    typeof value.textPreview === "string" &&
    isRecord(value.rect) &&
    Array.isArray(value.ancestorPath) &&
    typeof value.outerHtml === "string" &&
    typeof value.htmlBytes === "number" &&
    typeof value.truncated === "boolean" &&
    isRecord(value.computedSubset) &&
    Array.isArray(value.matchedRuleSummaries) &&
    isRecord(value.page) &&
    isRecord(value.browser) &&
    isRecord(value.viewport) &&
    typeof value.viewport.width === "number" &&
    typeof value.viewport.height === "number" &&
    typeof value.viewport.devicePixelRatio === "number" &&
    typeof value.crossOriginStylesheetsSkipped === "boolean" &&
    Array.isArray(value.truncatedFields)
  );
}

const CONSOLE_LEVELS = new Set(["debug", "log", "info", "warn", "error"]);
const CONSOLE_SOURCES = new Set(["console", "page-error", "unhandled-rejection"]);

export function isConsoleEventPayload(value: unknown): value is ConsoleEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.level === "string" &&
    CONSOLE_LEVELS.has(value.level) &&
    typeof value.message === "string" &&
    typeof value.timestamp === "string" &&
    (value.stack === undefined || typeof value.stack === "string") &&
    typeof value.source === "string" &&
    CONSOLE_SOURCES.has(value.source)
  );
}

export function parseRuntimeMessage(value: unknown): RuntimeMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  switch (value.type) {
    case "start-capture":
    case "cancel-capture":
    case "get-capture-state":
    case "picker-ready":
    case "capture-cancelled":
      return { type: value.type };
    case "capture-started":
      return typeof value.tabId === "number"
        ? { type: "capture-started", tabId: value.tabId }
        : undefined;
    case "picker-failed":
      return typeof value.error === "string"
        ? { type: "picker-failed", error: value.error }
        : undefined;
    case "submit-capture":
      return isPageCapturePayload(value.payload) && typeof value.userDescription === "string"
        ? {
            type: "submit-capture",
            payload: value.payload,
            userDescription: value.userDescription,
          }
        : undefined;
    case "console-event":
      return isConsoleEventPayload(value.entry)
        ? { type: "console-event", entry: value.entry }
        : undefined;
    default:
      return undefined;
  }
}
