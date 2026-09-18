import { isJwtLike, isSensitiveFieldName } from "@browser-debug-bridge/redaction";
import {
  CAPTURE_LIMITS,
  MAX_CLASS_CHARS_TOTAL,
  MAX_CLASS_SELECTOR_PARTS,
  MAX_DATA_ATTR_VALUE,
  MAX_NTH_OF_TYPE,
  MAX_SELECTOR_CHAIN,
  PREFERRED_DATA_ATTRIBUTES,
} from "./limits.js";

export interface SelectorSource {
  tag: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  nthOfType?: number;
}

const PREFERRED_DATA_ATTRIBUTE_SET = new Set<string>(PREFERRED_DATA_ATTRIBUTES);
const CSS_IDENT_PATTERN = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const UUID_LIKE_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENSITIVE_ID_TOKEN_PATTERN =
  /(?:^|[-_])(token|secret|password|credential|session|auth)(?:[-_]|$)/i;
const LONG_HEX_PATTERN = /^[0-9a-f]{32,}$/i;

export function isValidCssIdent(value: string): boolean {
  return CSS_IDENT_PATTERN.test(value);
}

export function isUnsafeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (isSensitiveFieldName(trimmed) || isJwtLike(trimmed)) {
    return true;
  }
  if (EMAIL_PATTERN.test(trimmed) || UUID_LIKE_PATTERN.test(trimmed)) {
    return true;
  }
  if (LONG_HEX_PATTERN.test(trimmed)) {
    return true;
  }
  return SENSITIVE_ID_TOKEN_PATTERN.test(trimmed);
}

export function boundClasses(classes: string[]): string[] {
  const bounded: string[] = [];
  let totalChars = 0;

  for (const raw of classes) {
    const value = raw.trim();
    if (value.length === 0 || isUnsafeIdentifier(value)) {
      continue;
    }
    const clipped = value.slice(0, CAPTURE_LIMITS.className);
    if (totalChars + clipped.length > MAX_CLASS_CHARS_TOTAL) {
      break;
    }
    bounded.push(clipped);
    totalChars += clipped.length;
    if (bounded.length >= CAPTURE_LIMITS.classCount) {
      break;
    }
  }

  return bounded;
}

export function canUseIdSelector(id: string): boolean {
  if (id.length === 0 || id.length > CAPTURE_LIMITS.elementId) {
    return false;
  }
  return isValidCssIdent(id) && !isUnsafeIdentifier(id);
}

function isSafeAttributeValue(value: string): boolean {
  if (value.length === 0 || value.length > MAX_DATA_ATTR_VALUE) {
    return false;
  }
  if (/\s/.test(value) || isUnsafeIdentifier(value)) {
    return false;
  }
  return true;
}

function escapeAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function normalizeTag(tag: string): string {
  const lower = tag.trim().toLowerCase();
  return lower.length === 0 ? "div" : lower.slice(0, CAPTURE_LIMITS.tagName);
}

function dataAttributeSelector(
  tag: string,
  attributes: Record<string, string>,
): string | undefined {
  for (const name of PREFERRED_DATA_ATTRIBUTES) {
    const value = attributes[name];
    if (value !== undefined && isSafeAttributeValue(value)) {
      return `${tag}[${name}="${escapeAttributeValue(value)}"]`;
    }
  }

  for (const [name, value] of Object.entries(attributes)) {
    if (!name.startsWith("data-") || isSensitiveFieldName(name)) {
      continue;
    }
    if (PREFERRED_DATA_ATTRIBUTE_SET.has(name)) {
      continue;
    }
    if (isSafeAttributeValue(value)) {
      return `${tag}[${name}="${escapeAttributeValue(value)}"]`;
    }
  }

  return undefined;
}

function semanticSelector(
  tag: string,
  attributes: Record<string, string>,
): string | undefined {
  const name = attributes.name;
  if (name !== undefined && isSafeAttributeValue(name) && !isSensitiveFieldName(name)) {
    return `${tag}[name="${escapeAttributeValue(name)}"]`;
  }

  const type = attributes.type;
  if (
    type !== undefined &&
    isSafeAttributeValue(type) &&
    type.toLowerCase() !== "password" &&
    type.toLowerCase() !== "hidden"
  ) {
    return `${tag}[type="${escapeAttributeValue(type)}"]`;
  }

  const role = attributes.role;
  if (role !== undefined && isSafeAttributeValue(role)) {
    return `${tag}[role="${escapeAttributeValue(role)}"]`;
  }

  return undefined;
}

function classCombinationSelector(tag: string, classes: string[]): string | undefined {
  const safe = boundClasses(classes)
    .filter((value) => isValidCssIdent(value))
    .slice(0, MAX_CLASS_SELECTOR_PARTS);
  if (safe.length === 0) {
    return undefined;
  }
  return `${tag}.${safe.join(".")}`;
}

function structuralSelector(tag: string, nthOfType: number | undefined): string {
  if (
    nthOfType !== undefined &&
    nthOfType >= 1 &&
    nthOfType <= MAX_NTH_OF_TYPE
  ) {
    return `${tag}:nth-of-type(${String(nthOfType)})`;
  }
  return tag;
}

export function selectorForElement(source: SelectorSource): string {
  const tag = normalizeTag(source.tag);

  if (source.id !== undefined && canUseIdSelector(source.id)) {
    return `#${source.id}`;
  }

  return (
    dataAttributeSelector(tag, source.attributes) ??
    semanticSelector(tag, source.attributes) ??
    classCombinationSelector(tag, source.classes) ??
    structuralSelector(tag, source.nthOfType)
  );
}

export function boundSelector(parts: string[]): string {
  const usable = parts.filter((part) => part.length > 0);
  if (usable.length === 0) {
    return "body";
  }

  let result = usable.join(" > ");
  const working = [...usable];
  while (result.length > CAPTURE_LIMITS.cssSelector && working.length > 1) {
    working.shift();
    result = working.join(" > ");
  }
  if (result.length > CAPTURE_LIMITS.cssSelector) {
    return result.slice(0, CAPTURE_LIMITS.cssSelector);
  }
  return result;
}

export function buildCssSelector(chain: SelectorSource[]): string {
  if (chain.length === 0) {
    return "body";
  }

  const parts: string[] = [];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const source = chain[index];
    if (source === undefined) {
      continue;
    }
    parts.unshift(selectorForElement(source));
    if (source.id !== undefined && canUseIdSelector(source.id)) {
      break;
    }
    if (parts.length >= MAX_SELECTOR_CHAIN) {
      break;
    }
  }

  return boundSelector(parts);
}

export function safeElementId(id: string | undefined): string | undefined {
  if (id === undefined || id.length === 0) {
    return undefined;
  }
  if (isUnsafeIdentifier(id)) {
    return undefined;
  }
  return id.slice(0, CAPTURE_LIMITS.elementId);
}
