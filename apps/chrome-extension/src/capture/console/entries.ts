import {
  CONSOLE_DEDUP_MEMORY,
  CONSOLE_DEDUP_WINDOW_MS,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_CONSOLE_STACK_LENGTH,
} from "./limits.js";

export type ConsoleLevelName = "debug" | "log" | "info" | "warn" | "error";
export type ConsoleEventSource = "console" | "page-error" | "unhandled-rejection";

export interface BuiltConsoleEntry {
  level: ConsoleLevelName;
  message: string;
  timestamp: string;
  stack?: string;
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

export function mapConsoleLevel(raw: string): ConsoleLevelName | undefined {
  switch (raw.trim().toLowerCase()) {
    case "debug":
    case "log":
    case "info":
    case "warn":
    case "error":
      return raw.trim().toLowerCase() as ConsoleLevelName;
    case "warning":
      return "warn";
    case "fatal":
    case "exception":
    case "assert":
      return "error";
    case "verbose":
      return "debug";
    case "dir":
    case "dirxml":
    case "table":
    case "trace":
      return "log";
    default:
      return undefined;
  }
}

export function clipConsoleMessage(message: string): { text: string; truncated: boolean } {
  if (message.length <= MAX_CONSOLE_MESSAGE_LENGTH) {
    return { text: message, truncated: false };
  }
  return { text: message.slice(0, MAX_CONSOLE_MESSAGE_LENGTH), truncated: true };
}

export function clipConsoleStack(stack: string): { text: string; truncated: boolean } {
  if (stack.length <= MAX_CONSOLE_STACK_LENGTH) {
    return { text: stack, truncated: false };
  }
  return { text: stack.slice(0, MAX_CONSOLE_STACK_LENGTH), truncated: true };
}

export function createConsoleFingerprint(
  level: string,
  message: string,
  stack?: string,
): string {
  return `${level}\n${message}\n${stack ?? ""}`.slice(0, 512);
}

export function createConsoleEntry(input: {
  level: string;
  message: string;
  timestamp?: string;
  stack?: string;
}): BuiltConsoleEntry | undefined {
  const level = mapConsoleLevel(input.level);
  if (level === undefined) {
    return undefined;
  }

  const timestamp =
    input.timestamp !== undefined && isIsoTimestamp(input.timestamp)
      ? input.timestamp
      : nowIsoTimestamp();
  const message = clipConsoleMessage(input.message).text;
  const stack =
    input.stack !== undefined && input.stack.length > 0
      ? clipConsoleStack(input.stack).text
      : undefined;

  return stack === undefined
    ? { level, message, timestamp }
    : { level, message, timestamp, stack };
}

export function createDeduper(
  windowMs = CONSOLE_DEDUP_WINDOW_MS,
  memory = CONSOLE_DEDUP_MEMORY,
): { seen: (fingerprint: string, now?: number) => boolean } {
  const recent: { fingerprint: string; at: number }[] = [];

  return {
    seen(fingerprint: string, now = Date.now()): boolean {
      const cutoff = now - windowMs;
      while (recent.length > 0) {
        const oldest = recent[0];
        if (oldest === undefined || oldest.at >= cutoff) {
          break;
        }
        recent.shift();
      }
      if (recent.some((item) => item.fingerprint === fingerprint)) {
        return true;
      }
      recent.push({ fingerprint, at: now });
      if (recent.length > memory) {
        recent.shift();
      }
      return false;
    },
  };
}
