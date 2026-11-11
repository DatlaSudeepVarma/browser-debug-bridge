import {
  PUBLIC_QUERY_PARAMETER_NAMES,
  REDACTED_DATA_URL,
  REDACTED_JAVASCRIPT_URL,
  REDACTED_PLACEHOLDER,
  UNPARSEABLE_URL_PLACEHOLDER,
} from "./constants.js";
import { isJwtLike, isSensitiveFieldName, redactSensitiveText } from "./strings.js";

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z+\-.]*:/;
const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9._~+/-]{16,}$/;
const PUBLIC_QUERY_NAMES = new Set<string>(PUBLIC_QUERY_PARAMETER_NAMES);

function shouldRedactQueryPair(name: string, value: string): boolean {
  if (isSensitiveFieldName(name) || isJwtLike(value) || redactSensitiveText(value) !== value) {
    return true;
  }
  return !PUBLIC_QUERY_NAMES.has(name.trim().toLowerCase());
}

function looksLikeOpaqueSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!OPAQUE_SECRET_PATTERN.test(trimmed)) {
    return false;
  }
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed) && trimmed.length < 24) {
    return false;
  }
  return true;
}

function redactHashBody(raw: string): string {
  if (!raw.includes("=")) {
    if (isSensitiveFieldName(raw) || isJwtLike(raw) || looksLikeOpaqueSecret(raw)) {
      return REDACTED_PLACEHOLDER;
    }
    return redactSensitiveText(raw);
  }
  return redactParameterList(raw);
}

function redactParameterList(raw: string): string {
  const params = new URLSearchParams(raw);
  const parts: string[] = [];
  for (const [key, value] of params.entries()) {
    const redacted = shouldRedactQueryPair(key, value);
    parts.push(
      `${encodeURIComponent(key)}=${redacted ? REDACTED_PLACEHOLDER : encodeURIComponent(value)}`,
    );
  }
  return parts.join("&");
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

  if (prefix === "#") {
    return `#${redactHashBody(raw)}`;
  }

  return `${prefix}${redactParameterList(raw)}`;
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
