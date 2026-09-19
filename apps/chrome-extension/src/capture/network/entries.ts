import {
  BRIDGE_LOOPBACK_HOSTS,
  BRIDGE_PORT,
  HTTP_METHODS,
  MAX_NETWORK_ERROR_LENGTH,
  MAX_NETWORK_URL_LENGTH,
  NETWORK_DEDUP_MEMORY,
  NETWORK_DEDUP_WINDOW_MS,
  NETWORK_RESOURCE_TYPES,
  type HttpMethodName,
  type NetworkResourceType,
} from "./limits.js";

export interface BuiltNetworkEntry {
  timestamp: string;
  method: HttpMethodName;
  urlRedacted: string;
  status?: number;
  resourceType?: NetworkResourceType;
  error?: string;
}

export interface NetworkFailureInput {
  timestamp?: string;
  method?: string;
  url: string;
  status?: number;
  resourceType?: string;
  error?: string;
  failed?: boolean;
  aborted?: boolean;
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const METHOD_SET = new Set<string>(HTTP_METHODS);
const RESOURCE_SET = new Set<string>(NETWORK_RESOURCE_TYPES);

export function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

export function isHttpFailureStatus(status: number | undefined): boolean {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599;
}

export function shouldCaptureNetworkFailure(input: {
  status?: number;
  failed?: boolean;
  aborted?: boolean;
}): boolean {
  if (input.failed === true || input.aborted === true) {
    return true;
  }
  return isHttpFailureStatus(input.status);
}

export function normalizeHttpMethod(raw: string | undefined): HttpMethodName {
  const upper = (raw ?? "").trim().toUpperCase();
  if (METHOD_SET.has(upper)) {
    return upper as HttpMethodName;
  }
  return "GET";
}

export function normalizeResourceType(raw: string | undefined): NetworkResourceType | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const lower = raw.trim().toLowerCase();
  return RESOURCE_SET.has(lower) ? (lower as NetworkResourceType) : undefined;
}

export function clipNetworkUrl(url: string): string {
  if (url.length <= MAX_NETWORK_URL_LENGTH) {
    return url;
  }
  return url.slice(0, MAX_NETWORK_URL_LENGTH);
}

export function clipNetworkError(error: string): string {
  if (error.length <= MAX_NETWORK_ERROR_LENGTH) {
    return error;
  }
  return error.slice(0, MAX_NETWORK_ERROR_LENGTH);
}

export function isBridgeTrafficUrl(url: string): boolean {
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    if (!BRIDGE_LOOPBACK_HOSTS.has(parsed.hostname)) {
      return false;
    }
    const port =
      parsed.port === ""
        ? parsed.protocol === "https:"
          ? "443"
          : "80"
        : parsed.port;
    return Number(port) === BRIDGE_PORT;
  } catch {
    return url.includes("127.0.0.1:17321") || url.includes("localhost:17321");
  }
}

export function createNetworkFingerprint(entry: BuiltNetworkEntry): string {
  return `${entry.method}\n${entry.urlRedacted}\n${String(entry.status ?? "")}\n${entry.error ?? ""}`.slice(
    0,
    512,
  );
}

export function createNetworkEntry(input: NetworkFailureInput): BuiltNetworkEntry | undefined {
  if (!shouldCaptureNetworkFailure(input)) {
    return undefined;
  }
  if (isBridgeTrafficUrl(input.url)) {
    return undefined;
  }

  const url = clipNetworkUrl(input.url.trim());
  if (url.length === 0) {
    return undefined;
  }

  const timestamp =
    input.timestamp !== undefined && isIsoTimestamp(input.timestamp)
      ? input.timestamp
      : nowIsoTimestamp();
  const method = normalizeHttpMethod(input.method);
  const resourceType = normalizeResourceType(input.resourceType);
  const error =
    input.error !== undefined && input.error.length > 0
      ? clipNetworkError(input.error)
      : input.aborted === true
        ? "Request aborted"
        : input.failed === true
          ? "Network request failed"
          : undefined;
  const status = isHttpFailureStatus(input.status) ? input.status : undefined;

  const entry: BuiltNetworkEntry = {
    timestamp,
    method,
    urlRedacted: url,
  };
  if (status !== undefined) {
    entry.status = status;
  }
  if (resourceType !== undefined) {
    entry.resourceType = resourceType;
  }
  if (error !== undefined) {
    entry.error = error;
  }
  return entry;
}

export function createDeduper(
  windowMs = NETWORK_DEDUP_WINDOW_MS,
  memory = NETWORK_DEDUP_MEMORY,
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
