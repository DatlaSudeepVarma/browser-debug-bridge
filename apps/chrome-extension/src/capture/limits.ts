/**
 * Capture-time bounds. Numeric values must match
 * `@browser-debug-bridge/schema` `DEBUG_SESSION_LIMITS`. Tests assert that.
 * Content-script code uses this module so the injected bundle does not pull Zod.
 */
export const CAPTURE_LIMITS = {
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

export const COMPUTED_STYLE_ALLOWLIST = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "margin",
  "padding",
  "border",
  "border-radius",
  "color",
  "background",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "text-align",
  "opacity",
  "visibility",
  "overflow",
  "overflow-x",
  "overflow-y",
  "z-index",
  "flex",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "transform",
] as const;

export type ComputedStyleName = (typeof COMPUTED_STYLE_ALLOWLIST)[number];

export const PREFERRED_DATA_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
] as const;

export const MAX_SELECTOR_CHAIN = 5;
export const MAX_NTH_OF_TYPE = 9;
export const MAX_CLASS_SELECTOR_PARTS = 3;
export const MAX_CLASS_CHARS_TOTAL = 512;
export const MAX_DATA_ATTR_VALUE = 64;
export const MAX_DOM_NODES = 200;
export const MAX_DOM_DEPTH = 12;
export const MAX_RULES_PER_STYLESHEET = 250;
export const TAB_ID_HASH_HEX_LENGTH = 32;

export const PICKER_HOST_ATTR = "data-bdb-picker-host";
export const CAPTURE_PORT_NAME = "bdb-capture";
export const CAPTURE_STATE_STORAGE_KEY = "browserDebugBridge.captureState";
export const TAB_ID_SALT_STORAGE_KEY = "browserDebugBridge.tabIdSalt";
export const CAPTURE_FLAG_KEY = "__bdbCaptureRunning";

export const PLACEHOLDER_SCREENSHOT_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const CAPTURE_PERMISSIONS_USED = ["activeTab", "scripting"] as const;
