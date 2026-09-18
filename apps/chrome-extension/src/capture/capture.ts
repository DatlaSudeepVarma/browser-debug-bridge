import { redactSensitiveText, redactUrl } from "@browser-debug-bridge/redaction";
import { collectMatchedRuleSummaries, pickComputedStyles } from "./css.js";
import { elementToCaptureDom, sanitizeAndTruncateHtml } from "./dom.js";
import {
  CAPTURE_LIMITS,
  MAX_CLASS_CHARS_TOTAL,
  PICKER_HOST_ATTR,
} from "./limits.js";
import type { CapturedAncestor, CapturedRect, PageCapturePayload } from "./messages.js";
import {
  boundClasses,
  buildCssSelector,
  safeElementId,
  type SelectorSource,
} from "./selectors.js";

export function previewText(
  raw: string,
  max = CAPTURE_LIMITS.textPreview,
): { text: string; truncated: boolean } {
  const normalized = redactSensitiveText(raw.replace(/\s+/g, " ").trim());
  if (normalized.length <= max) {
    return { text: normalized, truncated: false };
  }
  return { text: normalized.slice(0, max), truncated: true };
}

export function normalizeRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): CapturedRect {
  const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
  return {
    x: finite(rect.x),
    y: finite(rect.y),
    width: Math.max(0, finite(rect.width)),
    height: Math.max(0, finite(rect.height)),
  };
}

export function normalizeUserDescription(input: string): string {
  return redactSensitiveText(input.replace(/\s+/g, " ").trim()).slice(
    0,
    CAPTURE_LIMITS.userDescription,
  );
}

export function parseBrowserIdentity(userAgent: string): {
  name: string;
  version: string;
} {
  const chrome = /Chrome\/([\d.]+)/.exec(userAgent);
  const version = chrome?.[1]?.slice(0, CAPTURE_LIMITS.browserVersion);
  if (version !== undefined && version.length > 0) {
    return { name: "Chrome", version };
  }
  const chromium = /Chromium\/([\d.]+)/.exec(userAgent);
  const chromiumVersion = chromium?.[1]?.slice(0, CAPTURE_LIMITS.browserVersion);
  if (chromiumVersion !== undefined && chromiumVersion.length > 0) {
    return { name: "Chromium", version: chromiumVersion };
  }
  return { name: "Chrome", version: "0" };
}

export function capturePageMetadata(input: {
  href: string;
  title: string;
  origin: string;
}): PageCapturePayload["page"] {
  const url = redactUrl(input.href).slice(0, CAPTURE_LIMITS.pageUrl);
  const origin = input.origin.trim().slice(0, CAPTURE_LIMITS.pageOrigin);
  return {
    url: url.length > 0 ? url : "[UNPARSEABLE_URL]",
    title: redactSensitiveText(input.title.replace(/\s+/g, " ").trim()).slice(
      0,
      CAPTURE_LIMITS.pageTitle,
    ),
    origin: origin.length > 0 ? origin : "null",
  };
}

export function boundAncestorPath(chain: SelectorSource[]): CapturedAncestor[] {
  return chain.slice(-CAPTURE_LIMITS.ancestorPathDepth).map((source) => {
    const item: CapturedAncestor = {
      tag: source.tag.toLowerCase().slice(0, CAPTURE_LIMITS.tagName) || "div",
    };
    const id = safeElementId(source.id);
    if (id !== undefined) {
      item.id = id;
    }
    const classes = boundClasses(source.classes);
    if (classes.length > 0) {
      item.classes = classes;
    }
    return item;
  });
}

function nthOfType(element: Element): number {
  const parent = element.parentElement;
  if (parent === null) {
    return 1;
  }
  let count = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName === element.tagName) {
      count += 1;
    }
    if (child === element) {
      return count;
    }
  }
  return 1;
}

function namedAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    attributes[attr.name.toLowerCase()] = attr.value;
  }
  return attributes;
}

export function describeElement(element: Element): SelectorSource {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id.length > 0 ? element.id : undefined,
    classes: Array.from(element.classList),
    attributes: namedAttributes(element),
    nthOfType: nthOfType(element),
  };
}

function isPickerHost(node: Element): boolean {
  return (
    node.hasAttribute(PICKER_HOST_ATTR) ||
    node.closest(`[${PICKER_HOST_ATTR}]`) !== null
  );
}

export function selectorChainFromElement(element: Element): SelectorSource[] {
  const chain: SelectorSource[] = [];
  let current: Element | null = element;
  while (current !== null && current !== document.documentElement) {
    if (!isPickerHost(current)) {
      chain.unshift(describeElement(current));
    }
    current = current.parentElement;
  }
  return chain;
}

function visibleText(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) {
    if (element.type === "password" || element.type === "hidden") {
      return "";
    }
    if (element.type === "email" || element.type === "tel") {
      return "";
    }
    return element.innerText || element.getAttribute("placeholder") || "";
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.innerText;
  }
  return element.innerText;
}

export function captureElement(element: HTMLElement): PageCapturePayload {
  const chain = selectorChainFromElement(element);
  const described = describeElement(element);
  const truncatedFields: string[] = [];

  const classes = boundClasses(described.classes);
  if (described.classes.join("").length > MAX_CLASS_CHARS_TOTAL) {
    truncatedFields.push("selectedElement.classes");
  }

  const text = previewText(visibleText(element));
  if (text.truncated) {
    truncatedFields.push("selectedElement.textPreview");
  }

  const ancestorPath = boundAncestorPath(chain);
  if (chain.length > CAPTURE_LIMITS.ancestorPathDepth) {
    truncatedFields.push("selectedElement.ancestorPath");
  }

  const html = sanitizeAndTruncateHtml(elementToCaptureDom(element));
  if (html.truncated) {
    truncatedFields.push("dom.outerHtmlTruncated");
  }

  const matched = collectMatchedRuleSummaries(element);
  const roleRaw = element.getAttribute("role")?.trim();
  const role =
    roleRaw !== undefined && roleRaw.length > 0
      ? roleRaw.slice(0, CAPTURE_LIMITS.role)
      : undefined;

  const payload: PageCapturePayload = {
    selector: buildCssSelector(chain),
    tag: described.tag.slice(0, CAPTURE_LIMITS.tagName) || "div",
    classes,
    textPreview: text.text,
    rect: normalizeRect(element.getBoundingClientRect()),
    ancestorPath,
    outerHtml: html.outerHtmlTruncated,
    htmlBytes: html.htmlBytes,
    truncated: html.truncated,
    computedSubset: pickComputedStyles((name) =>
      window.getComputedStyle(element).getPropertyValue(name),
    ),
    matchedRuleSummaries: matched.summaries,
    page: capturePageMetadata({
      href: window.location.href,
      title: document.title,
      origin: window.location.origin,
    }),
    browser: parseBrowserIdentity(navigator.userAgent),
    crossOriginStylesheetsSkipped: matched.crossOriginStylesheetsSkipped,
    truncatedFields,
  };

  const id = safeElementId(described.id);
  if (id !== undefined) {
    payload.id = id;
  }
  if (role !== undefined && role.length > 0) {
    payload.role = role;
  }
  return payload;
}
