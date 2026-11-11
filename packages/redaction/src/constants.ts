export const REDACTED_PLACEHOLDER = "[REDACTED]";
export const REDACTED_JAVASCRIPT_URL = "[REDACTED_JAVASCRIPT_URL]";
export const REDACTED_DATA_URL = "[REDACTED_DATA_URL]";
export const UNPARSEABLE_URL_PLACEHOLDER = "[UNPARSEABLE_URL]";

export const SENSITIVE_QUERY_PARAMETER_NAMES = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "jwt",
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "authorization",
  "code",
] as const;

/**
 * Query names whose values may stay visible. Every other query value is
 * redacted, including values that do not look like a JWT.
 */
export const PUBLIC_QUERY_PARAMETER_NAMES = [
  "id",
  "q",
  "query",
  "search",
  "state",
  "page",
  "limit",
  "offset",
  "sort",
  "order",
  "tab",
  "view",
  "lang",
  "locale",
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type SensitiveQueryParameterName =
  (typeof SENSITIVE_QUERY_PARAMETER_NAMES)[number];
