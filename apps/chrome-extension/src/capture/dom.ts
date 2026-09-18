import {
  redactDomElement,
  type DomLikeElement,
} from "@browser-debug-bridge/redaction";
import { CAPTURE_LIMITS, MAX_DOM_DEPTH, MAX_DOM_NODES } from "./limits.js";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface CaptureDomNode {
  tag: string;
  attributes: Record<string, string>;
  value?: string;
  text?: string;
  children?: CaptureDomNode[];
}

export interface TruncatedHtml {
  outerHtmlTruncated: string;
  htmlBytes: number;
  truncated: boolean;
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) {
    return text;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    encoded.slice(0, maxBytes),
  );
}

/**
 * `htmlBytes` is the UTF-8 size of the sanitized HTML *before* truncation,
 * capped at the schema maximum. That matches DebugSessionV1.dom.htmlBytes:
 * original captured size, not the truncated string length.
 */
export function truncateCapturedHtml(
  html: string,
  maxBytes = CAPTURE_LIMITS.outerHtml,
  maxChars = CAPTURE_LIMITS.outerHtml,
): TruncatedHtml {
  const rawBytes = utf8ByteLength(html);
  const htmlBytes = Math.min(rawBytes, CAPTURE_LIMITS.htmlBytes);
  const needsByteTruncation = rawBytes > maxBytes;
  const needsCharTruncation = html.length > maxChars;
  if (!needsByteTruncation && !needsCharTruncation) {
    return { outerHtmlTruncated: html, htmlBytes, truncated: false };
  }

  let clipped = html.length > maxChars ? html.slice(0, maxChars) : html;
  clipped = truncateToUtf8Bytes(clipped, maxBytes);
  return { outerHtmlTruncated: clipped, htmlBytes, truncated: true };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function toDomLike(node: CaptureDomNode): DomLikeElement {
  const next: DomLikeElement = {
    tag: node.tag,
    attributes: { ...node.attributes },
  };
  if (node.value !== undefined) {
    next.value = node.value;
  }
  if (node.children !== undefined) {
    next.children = node.children.map((child) => toDomLike(child));
  }
  return next;
}

function mergeRedacted(
  original: CaptureDomNode,
  redacted: DomLikeElement,
): CaptureDomNode {
  const children = original.children?.map((child, index) => {
    const redactedChild = redacted.children?.[index];
    return redactedChild === undefined ? child : mergeRedacted(child, redactedChild);
  });

  const next: CaptureDomNode = {
    tag: redacted.tag,
    attributes: redacted.attributes,
  };
  if (redacted.value !== undefined) {
    next.value = redacted.value;
  }
  if (original.text !== undefined && original.tag !== "script" && original.tag !== "style") {
    next.text = original.text;
  }
  if (children !== undefined) {
    next.children = children;
  }
  return next;
}

export function redactCaptureDom(node: CaptureDomNode): CaptureDomNode {
  return mergeRedacted(node, redactDomElement(toDomLike(node)));
}

export function serializeDomLike(node: CaptureDomNode): string {
  const tag = node.tag.toLowerCase();
  const attributes = { ...node.attributes };
  if (node.value !== undefined && (tag === "input" || tag === "textarea" || tag === "select")) {
    attributes.value = node.value;
  }

  const attrText = Object.entries(attributes)
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");
  const open = attrText.length > 0 ? `<${tag} ${attrText}>` : `<${tag}>`;
  if (VOID_TAGS.has(tag)) {
    return attrText.length > 0 ? `<${tag} ${attrText} />` : `<${tag} />`;
  }

  const inner = `${escapeText(node.text ?? "")}${(node.children ?? [])
    .map((child) => serializeDomLike(child))
    .join("")}`;
  return `${open}${inner}</${tag}>`;
}

export function sanitizeAndTruncateHtml(node: CaptureDomNode): TruncatedHtml {
  return truncateCapturedHtml(serializeDomLike(redactCaptureDom(node)));
}

function readAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    attributes[attr.name.toLowerCase()] = attr.value;
  }
  return attributes;
}

function directText(element: Element): string {
  let text = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    }
  }
  return text;
}

function formValue(element: Element): string | undefined {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.value;
  }
  return undefined;
}

export function elementToCaptureDom(
  element: Element,
  maxNodes = MAX_DOM_NODES,
): CaptureDomNode {
  let remaining = maxNodes;

  const walk = (current: Element, depth: number): CaptureDomNode | undefined => {
    if (remaining <= 0 || depth > MAX_DOM_DEPTH) {
      return undefined;
    }
    remaining -= 1;
    const tag = current.tagName.toLowerCase();
    const skipContent = tag === "script" || tag === "style";
    const children: CaptureDomNode[] = [];
    if (!skipContent) {
      for (const child of Array.from(current.children)) {
        const next = walk(child, depth + 1);
        if (next !== undefined) {
          children.push(next);
        }
      }
    }

    const node: CaptureDomNode = {
      tag,
      attributes: readAttributes(current),
    };
    const value = formValue(current);
    if (value !== undefined) {
      node.value = value;
    }
    if (!skipContent) {
      const text = directText(current);
      if (text.length > 0) {
        node.text = text;
      }
    }
    if (children.length > 0) {
      node.children = children;
    }
    return node;
  };

  return (
    walk(element, 0) ?? {
      tag: element.tagName.toLowerCase(),
      attributes: readAttributes(element),
    }
  );
}
