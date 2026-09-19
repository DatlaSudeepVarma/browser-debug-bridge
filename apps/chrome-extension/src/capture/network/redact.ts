import {
  REDACTED_PLACEHOLDER,
  isSensitiveFieldName,
  redactSensitiveText,
  redactUrl,
} from "@browser-debug-bridge/redaction";
import type { BuiltNetworkEntry } from "./entries.js";
import { clipNetworkError, clipNetworkUrl } from "./entries.js";

const PAIR_PATTERN = /([A-Za-z0-9_-]+)=([^\s&,;]+)/g;

export function redactNetworkUrl(url: string): string {
  return clipNetworkUrl(redactUrl(url));
}

export function redactNetworkError(error: string): string {
  const withJwt = redactSensitiveText(error);
  const withPairs = withJwt.replace(PAIR_PATTERN, (match, name: string) => {
    if (isSensitiveFieldName(name)) {
      return `${name}=${REDACTED_PLACEHOLDER}`;
    }
    return match;
  });
  return clipNetworkError(withPairs);
}

export function redactNetworkEntry(entry: BuiltNetworkEntry): BuiltNetworkEntry {
  const redacted: BuiltNetworkEntry = {
    timestamp: entry.timestamp,
    method: entry.method,
    urlRedacted: redactNetworkUrl(entry.urlRedacted),
  };
  if (entry.status !== undefined) {
    redacted.status = entry.status;
  }
  if (entry.resourceType !== undefined) {
    redacted.resourceType = entry.resourceType;
  }
  if (entry.error !== undefined) {
    redacted.error = redactNetworkError(entry.error);
  }
  return redacted;
}
