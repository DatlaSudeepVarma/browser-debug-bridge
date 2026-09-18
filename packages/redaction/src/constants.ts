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

export type SensitiveQueryParameterName =
  (typeof SENSITIVE_QUERY_PARAMETER_NAMES)[number];
