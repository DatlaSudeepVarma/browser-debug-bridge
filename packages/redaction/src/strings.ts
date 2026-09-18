import {
  REDACTED_PLACEHOLDER,
  SENSITIVE_QUERY_PARAMETER_NAMES,
} from "./constants.js";

const JWT_PATTERN =
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const JWT_IN_TEXT_PATTERN =
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const SENSITIVE_NAME_TOKENS = new Set([
  ...SENSITIVE_QUERY_PARAMETER_NAMES,
  "passwd",
  "auth",
  "credential",
  "credentials",
]);

export function isJwtLike(value: string): boolean {
  return JWT_PATTERN.test(value.trim());
}

export function redactJwtLikeValues(value: string): string {
  return value.replace(JWT_IN_TEXT_PATTERN, REDACTED_PLACEHOLDER);
}

export function isSensitiveFieldName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/^data-/, "");
  if (SENSITIVE_NAME_TOKENS.has(normalized)) {
    return true;
  }

  const tokens = normalized.split(/[^a-z0-9]+/u).filter((token) => token.length > 0);
  if (tokens.includes("api") && tokens.includes("key")) {
    return true;
  }

  return tokens.some((token) => SENSITIVE_NAME_TOKENS.has(token));
}

export function redactSensitiveText(value: string): string {
  if (isJwtLike(value)) {
    return REDACTED_PLACEHOLDER;
  }

  return redactJwtLikeValues(value);
}
