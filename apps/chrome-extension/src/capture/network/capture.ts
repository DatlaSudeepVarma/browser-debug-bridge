import {
  createDeduper,
  createNetworkEntry,
  createNetworkFingerprint,
  type BuiltNetworkEntry,
} from "./entries.js";
import { NETWORK_EVENT_NAME, NETWORK_STOP_EVENT_NAME } from "./limits.js";
import { redactNetworkEntry } from "./redact.js";

export interface NetworkCaptureController {
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

function readOwnNumber(value: object, key: string): number | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return typeof descriptor?.value === "number" ? descriptor.value : undefined;
}

function readOwnBoolean(value: object, key: string): boolean | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return typeof descriptor?.value === "boolean" ? descriptor.value : undefined;
}

function readHookDetail(event: Event): {
  method?: string;
  url: string;
  timestamp?: string;
  status?: number;
  error?: string;
  resourceType?: string;
  failed?: boolean;
  aborted?: boolean;
} | undefined {
  if (!(event instanceof CustomEvent)) {
    return undefined;
  }
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) {
    return undefined;
  }
  const url = readOwnString(detail, "url");
  if (url === undefined) {
    return undefined;
  }
  const method = readOwnString(detail, "method");
  const timestamp = readOwnString(detail, "timestamp");
  const error = readOwnString(detail, "error");
  const resourceType = readOwnString(detail, "resourceType");
  const status = readOwnNumber(detail, "status");
  const failed = readOwnBoolean(detail, "failed");
  const aborted = readOwnBoolean(detail, "aborted");
  return {
    url,
    ...(method === undefined ? {} : { method }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(error === undefined ? {} : { error }),
    ...(resourceType === undefined ? {} : { resourceType }),
    ...(status === undefined ? {} : { status }),
    ...(failed === undefined ? {} : { failed }),
    ...(aborted === undefined ? {} : { aborted }),
  };
}

export function startNetworkCapture(options: {
  publish(entry: BuiltNetworkEntry): void;
}): NetworkCaptureController {
  const deduper = createDeduper();

  const onPageNetwork = (event: Event): void => {
    const detail = readHookDetail(event);
    if (detail === undefined) {
      return;
    }
    const built = createNetworkEntry(detail);
    if (built === undefined) {
      return;
    }
    const entry = redactNetworkEntry(built);
    const fingerprint = createNetworkFingerprint(entry);
    if (deduper.seen(fingerprint)) {
      return;
    }
    options.publish(entry);
  };

  window.addEventListener(NETWORK_EVENT_NAME, onPageNetwork);

  return {
    stop() {
      window.removeEventListener(NETWORK_EVENT_NAME, onPageNetwork);
      window.dispatchEvent(new Event(NETWORK_STOP_EVENT_NAME));
    },
  };
}
