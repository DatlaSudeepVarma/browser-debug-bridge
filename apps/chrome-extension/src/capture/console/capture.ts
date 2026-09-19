import {
  createConsoleEntry,
  createConsoleFingerprint,
  createDeduper,
  type BuiltConsoleEntry,
  type ConsoleEventSource,
} from "./entries.js";
import { CONSOLE_EVENT_NAME, CONSOLE_STOP_EVENT_NAME } from "./limits.js";
import { serializeConsoleValue } from "./serializer.js";

export interface IsolatedConsoleEvent extends BuiltConsoleEntry {
  source: ConsoleEventSource;
}

export interface ConsoleCaptureController {
  stop(): void;
}

function readOwnString(value: object, key: string): string | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return typeof descriptor?.value === "string" ? descriptor.value : undefined;
}

function readHookDetail(
  event: Event,
): { level: string; message: string; timestamp?: string; stack?: string } | undefined {
  if (!(event instanceof CustomEvent)) {
    return undefined;
  }
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) {
    return undefined;
  }
  const level = readOwnString(detail, "level");
  const message = readOwnString(detail, "message");
  if (level === undefined || message === undefined) {
    return undefined;
  }
  const timestamp = readOwnString(detail, "timestamp");
  const stack = readOwnString(detail, "stack");
  return {
    level,
    message,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(stack === undefined ? {} : { stack }),
  };
}

export function startConsoleCapture(options: {
  publish(event: IsolatedConsoleEvent): void;
}): ConsoleCaptureController {
  const deduper = createDeduper();

  const publish = (
    source: ConsoleEventSource,
    level: string,
    message: string,
    stack?: string,
    timestamp?: string,
  ): void => {
    const entry = createConsoleEntry({ level, message, stack, timestamp });
    if (entry === undefined) {
      return;
    }
    const fingerprint = createConsoleFingerprint(entry.level, entry.message, entry.stack);
    if (deduper.seen(fingerprint)) {
      return;
    }
    options.publish({ ...entry, source });
  };

  const onPageConsole = (event: Event): void => {
    const detail = readHookDetail(event);
    if (detail === undefined) {
      return;
    }
    publish("console", detail.level, detail.message, detail.stack, detail.timestamp);
  };

  const onError = (event: ErrorEvent): void => {
    const error = event.error;
    const stack = error instanceof Error ? error.stack : undefined;
    const raw =
      event.message.length > 0
        ? event.message
        : error instanceof Error
          ? error.message
          : "Uncaught error";
    publish("page-error", "error", `[page error] ${raw}`, stack);
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    const stack = reason instanceof Error ? reason.stack : undefined;
    publish(
      "unhandled-rejection",
      "error",
      `[unhandled rejection] ${serializeConsoleValue(reason)}`,
      stack,
    );
  };

  window.addEventListener(CONSOLE_EVENT_NAME, onPageConsole);
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection, true);

  return {
    stop() {
      window.removeEventListener(CONSOLE_EVENT_NAME, onPageConsole);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
      window.dispatchEvent(new Event(CONSOLE_STOP_EVENT_NAME));
    },
  };
}
