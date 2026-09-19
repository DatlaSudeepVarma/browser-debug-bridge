import {
  REDACTED_PLACEHOLDER,
  isJwtLike,
  isSensitiveFieldName,
  redactSensitiveText,
  redactUrl,
} from "@browser-debug-bridge/redaction";
import type { BuiltConsoleEntry } from "./entries.js";

const HTTP_URL_PATTERN = /https?:\/\/[^\s]+/gi;
const BEARER_PATTERN = /Bearer\s+\S+/gi;
const PAIR_PATTERN = /([A-Za-z0-9_-]+)=([^\s&,;]+)/g;

function redactSensitivePairs(value: string): string {
  return value.replace(PAIR_PATTERN, (match, name: string, raw: string) => {
    if (isSensitiveFieldName(name) || isJwtLike(raw)) {
      return `${name}=${REDACTED_PLACEHOLDER}`;
    }
    return match;
  });
}

export function redactConsoleText(value: string): string {
  let text = redactSensitiveText(value);
  text = text.replace(HTTP_URL_PATTERN, (url) => redactUrl(url));
  text = text.replace(BEARER_PATTERN, `Bearer ${REDACTED_PLACEHOLDER}`);
  return redactSensitivePairs(text);
}

export function redactConsoleEntry(entry: BuiltConsoleEntry): BuiltConsoleEntry {
  const message = redactConsoleText(entry.message);
  if (entry.stack === undefined) {
    return { ...entry, message };
  }
  return { ...entry, message, stack: redactConsoleText(entry.stack) };
}
