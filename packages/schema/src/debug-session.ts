import { z } from "zod";
import {
  DEBUG_SESSION_LIMITS,
  DEBUG_SESSION_SCHEMA_VERSION,
  HexSha256Schema,
  IsoTimestampSchema,
  TabIdHashSchema,
  UuidSchema,
  strictObject,
} from "./common.js";

export const ConsoleLevelSchema = z.enum([
  "debug",
  "log",
  "info",
  "warn",
  "error",
]);

export const HttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export const FrameworkHintSchema = z.enum([
  "react",
  "vue",
  "angular",
  "svelte",
  "nextjs",
  "nuxt",
  "other",
]);

export const ScreenshotMimeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const PageSchema = strictObject({
  url: z.string().min(1).max(DEBUG_SESSION_LIMITS.pageUrl),
  title: z.string().max(DEBUG_SESSION_LIMITS.pageTitle),
  origin: z.string().min(1).max(DEBUG_SESSION_LIMITS.pageOrigin),
});

export const BrowserSchema = strictObject({
  name: z.string().min(1).max(DEBUG_SESSION_LIMITS.browserName),
  version: z.string().min(1).max(DEBUG_SESSION_LIMITS.browserVersion),
  extensionVersion: z
    .string()
    .min(1)
    .max(DEBUG_SESSION_LIMITS.extensionVersion),
});

export const ElementRectSchema = strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const AncestorPathItemSchema = strictObject({
  tag: z.string().min(1).max(DEBUG_SESSION_LIMITS.tagName),
  id: z.string().max(DEBUG_SESSION_LIMITS.elementId).optional(),
  classes: z
    .array(z.string().min(1).max(DEBUG_SESSION_LIMITS.className))
    .max(DEBUG_SESSION_LIMITS.classCount)
    .optional(),
});

export const SelectedElementSchema = strictObject({
  selector: z.string().min(1).max(DEBUG_SESSION_LIMITS.cssSelector),
  tag: z.string().min(1).max(DEBUG_SESSION_LIMITS.tagName),
  id: z.string().max(DEBUG_SESSION_LIMITS.elementId).optional(),
  classes: z
    .array(z.string().min(1).max(DEBUG_SESSION_LIMITS.className))
    .max(DEBUG_SESSION_LIMITS.classCount),
  role: z.string().max(DEBUG_SESSION_LIMITS.role).optional(),
  textPreview: z.string().max(DEBUG_SESSION_LIMITS.textPreview),
  rect: ElementRectSchema,
  ancestorPath: z
    .array(AncestorPathItemSchema)
    .max(DEBUG_SESSION_LIMITS.ancestorPathDepth),
});

export const DomCaptureSchema = strictObject({
  outerHtmlTruncated: z.string().max(DEBUG_SESSION_LIMITS.outerHtml),
  htmlBytes: z
    .number()
    .int()
    .nonnegative()
    .max(DEBUG_SESSION_LIMITS.htmlBytes),
  truncated: z.boolean(),
});

export const MatchedRuleSummarySchema = strictObject({
  selector: z.string().min(1).max(DEBUG_SESSION_LIMITS.cssSelector),
  originHint: z
    .string()
    .max(DEBUG_SESSION_LIMITS.matchedRuleOriginHint)
    .optional(),
});

export const CssCaptureSchema = strictObject({
  computedSubset: z
    .record(
      z.string().min(1).max(DEBUG_SESSION_LIMITS.computedStyleName),
      z.string().max(DEBUG_SESSION_LIMITS.computedStyleValue),
    )
    .superRefine((value, ctx) => {
      if (
        Object.keys(value).length > DEBUG_SESSION_LIMITS.computedStyleProperties
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `computedSubset supports at most ${String(DEBUG_SESSION_LIMITS.computedStyleProperties)} properties`,
        });
      }
    }),
  matchedRuleSummaries: z
    .array(MatchedRuleSummarySchema)
    .max(DEBUG_SESSION_LIMITS.matchedRuleSummaries),
});

export const ScreenshotMetadataSchema = strictObject({
  mime: ScreenshotMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: HexSha256Schema,
  cropped: z.boolean(),
});

export const ConsoleEntrySchema = strictObject({
  level: ConsoleLevelSchema,
  message: z.string().max(DEBUG_SESSION_LIMITS.consoleMessage),
  timestamp: IsoTimestampSchema,
  stack: z.string().max(DEBUG_SESSION_LIMITS.consoleStack).optional(),
});

export const NetworkEntrySchema = strictObject({
  timestamp: IsoTimestampSchema,
  method: HttpMethodSchema,
  urlRedacted: z.string().min(1).max(DEBUG_SESSION_LIMITS.networkUrl),
  status: z.number().int().min(100).max(599).optional(),
  resourceType: z
    .string()
    .min(1)
    .max(DEBUG_SESSION_LIMITS.networkResourceType)
    .optional(),
  error: z.string().max(DEBUG_SESSION_LIMITS.networkError).optional(),
});

export const HintsSchema = strictObject({
  framework: FrameworkHintSchema.optional(),
  evidence: z
    .array(z.string().min(1).max(DEBUG_SESSION_LIMITS.hintsEvidenceItem))
    .max(DEBUG_SESSION_LIMITS.hintsEvidence),
});

export const CaptureSchema = strictObject({
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema,
  tabIdHash: TabIdHashSchema,
  permissionsGranted: z
    .array(z.string().min(1).max(DEBUG_SESSION_LIMITS.permissionName))
    .max(DEBUG_SESSION_LIMITS.permissionsGranted),
}).superRefine((value, ctx) => {
  if (Date.parse(value.endedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "capture.endedAt must be greater than or equal to startedAt",
      path: ["endedAt"],
    });
  }
});

export const RedactionRecordSchema = strictObject({
  rulesApplied: z
    .array(z.string().min(1).max(DEBUG_SESSION_LIMITS.redactionRuleName))
    .max(DEBUG_SESSION_LIMITS.redactionRules),
  notes: z.string().max(DEBUG_SESSION_LIMITS.redactionNotes),
});

export const SessionMetadataSchema = strictObject({
  payloadBytes: z
    .number()
    .int()
    .nonnegative()
    .max(DEBUG_SESSION_LIMITS.payloadBytes),
  truncatedFields: z
    .array(z.string().min(1).max(DEBUG_SESSION_LIMITS.truncatedFieldPath))
    .max(DEBUG_SESSION_LIMITS.truncatedFields),
});

export const DebugSessionV1Schema = strictObject({
  schemaVersion: z.literal(DEBUG_SESSION_SCHEMA_VERSION),
  sessionId: UuidSchema,
  createdAt: IsoTimestampSchema,
  page: PageSchema,
  browser: BrowserSchema,
  userDescription: z.string().max(DEBUG_SESSION_LIMITS.userDescription),
  selectedElement: SelectedElementSchema,
  dom: DomCaptureSchema,
  css: CssCaptureSchema,
  screenshot: ScreenshotMetadataSchema,
  console: z
    .array(ConsoleEntrySchema)
    .max(DEBUG_SESSION_LIMITS.consoleEntries),
  network: z
    .array(NetworkEntrySchema)
    .max(DEBUG_SESSION_LIMITS.networkEntries),
  hints: HintsSchema,
  capture: CaptureSchema,
  redaction: RedactionRecordSchema,
  metadata: SessionMetadataSchema,
});

export type DebugSessionV1 = z.infer<typeof DebugSessionV1Schema>;
export type Page = z.infer<typeof PageSchema>;
export type BrowserInfo = z.infer<typeof BrowserSchema>;
export type SelectedElement = z.infer<typeof SelectedElementSchema>;
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>;
export type ScreenshotMetadata = z.infer<typeof ScreenshotMetadataSchema>;
export type FrameworkHint = z.infer<typeof FrameworkHintSchema>;

export function parseDebugSession(data: unknown): DebugSessionV1 {
  return DebugSessionV1Schema.parse(data);
}

export function safeParseDebugSession(data: unknown) {
  return DebugSessionV1Schema.safeParse(data);
}

export function isDebugSessionV1(data: unknown): data is DebugSessionV1 {
  return DebugSessionV1Schema.safeParse(data).success;
}
