import { z } from "zod";

export const DEBUG_SESSION_SCHEMA_VERSION = 1;
export const PROTOCOL_VERSION = 1;

export const DEBUG_SESSION_LIMITS = {
  userDescription: 2000,
  pageUrl: 2048,
  pageTitle: 512,
  pageOrigin: 512,
  browserName: 64,
  browserVersion: 64,
  extensionVersion: 64,
  cssSelector: 512,
  tagName: 64,
  elementId: 256,
  className: 256,
  classCount: 32,
  role: 64,
  textPreview: 2048,
  ancestorPathDepth: 16,
  outerHtml: 16 * 1024,
  htmlBytes: 10 * 1024 * 1024,
  computedStyleProperties: 64,
  computedStyleName: 128,
  computedStyleValue: 512,
  matchedRuleSummaries: 32,
  matchedRuleOriginHint: 128,
  consoleEntries: 50,
  consoleMessage: 4096,
  consoleStack: 8192,
  networkEntries: 100,
  networkUrl: 2048,
  networkError: 512,
  networkResourceType: 64,
  hintsEvidence: 16,
  hintsEvidenceItem: 512,
  tabIdHash: 64,
  permissionsGranted: 16,
  permissionName: 64,
  redactionRules: 32,
  redactionRuleName: 128,
  redactionNotes: 1024,
  truncatedFields: 32,
  truncatedFieldPath: 128,
  payloadBytes: 10 * 1024 * 1024,
} as const;

export const PROTOCOL_LIMITS = {
  clientName: 128,
  clientVersion: 64,
  pairingCode: 16,
  errorCode: 64,
  errorMessage: 512,
} as const;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const UuidSchema = z
  .string()
  .uuid({ message: "session identifiers must be UUIDs" });

export const IsoTimestampSchema = z
  .string()
  .regex(ISO_TIMESTAMP_PATTERN, "must be an ISO-8601 timestamp")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a valid ISO-8601 timestamp",
  });

export const HexSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 hex digest");

export const TabIdHashSchema = z
  .string()
  .regex(/^[a-f0-9]{16,64}$/, "must be a hex hash of the tab id")
  .max(DEBUG_SESSION_LIMITS.tabIdHash);

export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}
