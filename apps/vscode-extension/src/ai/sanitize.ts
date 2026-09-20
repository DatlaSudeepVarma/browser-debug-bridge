import { redactSensitiveText, redactUrl } from "@browser-debug-bridge/redaction";

const AUTHORIZATION_PATTERN = /authorization\s*[:=]\s*(?:bearer\s+)?\S+/gi;
const BEARER_PATTERN = /bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PAIRING_LABEL_PATTERN = /pairing[_-]?token\s*[:=]\s*\S+/gi;
const COOKIE_PATTERN = /(?:^|[;\s])(?:cookie|set-cookie)\s*[:=]\s*[^\n]+/gi;

export function clipAiText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

export function sanitizeAiText(value: string): string {
  const withoutAuth = value
    .replace(AUTHORIZATION_PATTERN, "authorization=[REDACTED]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(PAIRING_LABEL_PATTERN, "pairing_token=[REDACTED]")
    .replace(COOKIE_PATTERN, " cookie=[REDACTED]");
  return redactSensitiveText(withoutAuth);
}

export function sanitizeAiUrl(value: string): string {
  return sanitizeAiText(redactUrl(value));
}

export function containsForbiddenAiPayload(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("authorization: bearer ") && !lower.includes("[redacted]")) {
    return true;
  }
  if (lower.includes("pairingtoken") && /[a-f0-9]{64}/.test(lower)) {
    return true;
  }
  return false;
}
