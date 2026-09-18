import {
  REDACTED_DATA_URL,
  REDACTED_JAVASCRIPT_URL,
  REDACTED_PLACEHOLDER,
} from "./constants.js";
import { isJwtLike, isSensitiveFieldName } from "./strings.js";
import { redactUrl } from "./urls.js";

const URL_ATTRIBUTE_NAMES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "cite",
  "data",
  "xlink:href",
]);

const PAYMENT_AUTOCOMPLETE_PREFIXES = ["cc-", "card"];
const SENSITIVE_AUTOCOMPLETE_VALUES = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
]);

const INLINE_HANDLER_LIMIT = 256;

export interface DomLikeElement {
  tag: string;
  attributes: Record<string, string>;
  value?: string;
  children?: DomLikeElement[];
}

function cloneAttributes(
  attributes: Record<string, string>,
): Record<string, string> {
  return { ...attributes };
}

function isPasswordInput(tag: string, attributes: Record<string, string>): boolean {
  return tag.toLowerCase() === "input" && attributes.type?.toLowerCase() === "password";
}

function isHiddenInput(tag: string, attributes: Record<string, string>): boolean {
  return tag.toLowerCase() === "input" && attributes.type?.toLowerCase() === "hidden";
}

function isSensitiveAutocomplete(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (SENSITIVE_AUTOCOMPLETE_VALUES.has(normalized)) {
    return true;
  }

  return PAYMENT_AUTOCOMPLETE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

function isInlineEventHandlerName(name: string): boolean {
  return /^on[a-z]+$/iu.test(name);
}

function looksLikeUrlScheme(value: string, scheme: string): boolean {
  return value.trim().toLowerCase().startsWith(`${scheme}:`);
}

export function isSensitiveDomAttribute(name: string): boolean {
  return isSensitiveFieldName(name) || isInlineEventHandlerName(name);
}

export function redactAttributeValue(
  name: string,
  value: string,
  context: { tag: string; attributes: Record<string, string> },
): string {
  const attributeName = name.toLowerCase();

  if (isPasswordInput(context.tag, context.attributes) && attributeName === "value") {
    return value.length === 0 ? value : REDACTED_PLACEHOLDER;
  }

  if (looksLikeUrlScheme(value, "javascript")) {
    return REDACTED_JAVASCRIPT_URL;
  }

  if (looksLikeUrlScheme(value, "data")) {
    return REDACTED_DATA_URL;
  }

  if (URL_ATTRIBUTE_NAMES.has(attributeName)) {
    return redactUrl(value);
  }

  if (isSensitiveFieldName(name) || isSensitiveFieldName(attributeName)) {
    return value.length === 0 ? value : REDACTED_PLACEHOLDER;
  }

  if (isInlineEventHandlerName(attributeName)) {
    if (value.length > INLINE_HANDLER_LIMIT || isJwtLike(value) || isSensitiveFieldName(value)) {
      return REDACTED_PLACEHOLDER;
    }
  }

  if (isJwtLike(value)) {
    return REDACTED_PLACEHOLDER;
  }

  return value;
}

function shouldRedactElementValue(
  tag: string,
  attributes: Record<string, string>,
  value: string,
): boolean {
  if (isPasswordInput(tag, attributes)) {
    return value.length > 0;
  }

  if (isSensitiveAutocomplete(attributes.autocomplete)) {
    return value.length > 0;
  }

  const identifyingNames = [attributes.name, attributes.id, attributes.autocomplete];
  if (identifyingNames.some((candidate) => candidate && isSensitiveFieldName(candidate))) {
    return value.length > 0;
  }

  if (isHiddenInput(tag, attributes) && (isJwtLike(value) || isSensitiveFieldName(attributes.name ?? "") || isSensitiveFieldName(attributes.id ?? ""))) {
    return value.length > 0;
  }

  return isJwtLike(value);
}

export function redactDomElement(element: DomLikeElement): DomLikeElement {
  const attributes = cloneAttributes(element.attributes);
  const context = { tag: element.tag, attributes };

  const redactedAttributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(attributes)) {
    redactedAttributes[name] = redactAttributeValue(name, value, context);
  }

  const next: DomLikeElement = {
    tag: element.tag,
    attributes: redactedAttributes,
  };

  if (element.value !== undefined) {
    next.value = shouldRedactElementValue(element.tag, attributes, element.value)
      ? REDACTED_PLACEHOLDER
      : element.value;
  }

  if (element.children) {
    next.children = element.children.map((child) => redactDomElement(child));
  }

  return next;
}
