import {
  REDACTED_DATA_URL,
  REDACTED_JAVASCRIPT_URL,
  REDACTED_PLACEHOLDER,
  UNPARSEABLE_URL_PLACEHOLDER,
} from "./constants.js";
import { isJwtLike, isSensitiveFieldName } from "./strings.js";

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z+\-.]*:/;

function shouldRedactQueryPair(name: string, value: string): boolean {
  return isSensitiveFieldName(name) || isJwtLike(value);
}

function redactQueryString(query: string): string {
  if (query.length === 0) {
    return query;
  }

  const first = query[0];
  const prefix = first === "?" || first === "#" ? first : "";
  const raw = prefix ? query.slice(1) : query;
  if (raw.length === 0) {
    return query;
  }

  if (prefix === "#" && !raw.includes("=")) {
    return query;
  }

  const params = new URLSearchParams(raw);
  const parts: string[] = [];

  for (const [key, value] of params.entries()) {
    const redacted = shouldRedactQueryPair(key, value);
    parts.push(
      `${encodeURIComponent(key)}=${redacted ? REDACTED_PLACEHOLDER : encodeURIComponent(value)}`,
    );
  }

  return `${prefix}${parts.join("&")}`;
}

function serializeUrl(url: URL): string {
  return `${url.origin}${url.pathname}${redactQueryString(url.search)}${redactQueryString(url.hash)}`;
}

function redactParsedUrl(url: URL): string {
  const protocol = url.protocol.toLowerCase();
  if (protocol === "javascript:") {
    return REDACTED_JAVASCRIPT_URL;
  }
  if (protocol === "data:") {
    return REDACTED_DATA_URL;
  }

  return serializeUrl(url);
}

export function redactUrl(input: string): string {
  if (input.trim().length === 0) {
    return UNPARSEABLE_URL_PLACEHOLDER;
  }

  try {
    if (SCHEME_PATTERN.test(input)) {
      return redactParsedUrl(new URL(input));
    }

    const parsed = new URL(input, "https://redaction.invalid");
    return `${parsed.pathname}${redactQueryString(parsed.search)}${redactQueryString(parsed.hash)}`;
  } catch {
    return UNPARSEABLE_URL_PLACEHOLDER;
  }
}
