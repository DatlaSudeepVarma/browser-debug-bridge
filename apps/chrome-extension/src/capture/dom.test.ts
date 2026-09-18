import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REDACTED_JAVASCRIPT_URL,
  REDACTED_PLACEHOLDER,
  redactUrl,
} from "@browser-debug-bridge/redaction";
import { DEBUG_SESSION_LIMITS } from "@browser-debug-bridge/schema";
import { boundAncestorPath, capturePageMetadata, normalizeRect, previewText } from "./capture.js";
import {
  sanitizeAndTruncateHtml,
  truncateCapturedHtml,
  utf8ByteLength,
  type CaptureDomNode,
} from "./dom.js";

const FAKE_JWT =
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlLXVzZXIiLCJleGFtcGxlIjp0cnVlfQ.fake-signature";

describe("text preview", () => {
  it("normalizes whitespace and truncates to the schema limit", () => {
    const long = `hello    world ${"x".repeat(DEBUG_SESSION_LIMITS.textPreview)}`;
    const preview = previewText(long);
    assert.equal(preview.truncated, true);
    assert.ok(preview.text.length <= DEBUG_SESSION_LIMITS.textPreview);
    assert.equal(preview.text.startsWith("hello world "), true);
  });

  it("redacts JWT-like values in the preview", () => {
    const preview = previewText(`Status ${FAKE_JWT}`);
    assert.equal(preview.text.includes(FAKE_JWT), false);
    assert.equal(preview.text.includes(REDACTED_PLACEHOLDER), true);
  });
});

describe("rect normalization", () => {
  it("converts non-finite values to safe numbers", () => {
    assert.deepEqual(
      normalizeRect({
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        width: -10,
        height: Number.NaN,
      }),
      { x: 0, y: 0, width: 0, height: 0 },
    );
  });
});

describe("ancestor path", () => {
  it("bounds ancestor depth", () => {
    const chain = Array.from({ length: 24 }, (_, index) => ({
      tag: "div",
      classes: [`lvl${String(index)}`],
      attributes: {},
    }));
    const path = boundAncestorPath(chain);
    assert.equal(path.length, DEBUG_SESSION_LIMITS.ancestorPathDepth);
    assert.equal(path[path.length - 1]?.classes?.[0], "lvl23");
  });
});

describe("URL redaction integration", () => {
  it("redacts sensitive query parameters before page metadata is stored", () => {
    const page = capturePageMetadata({
      href: "http://127.0.0.1:4173/account?id=42&token=fake-secret-token",
      title: "Account",
      origin: "http://127.0.0.1:4173",
    });
    assert.equal(page.url.includes("fake-secret-token"), false);
    assert.equal(page.url.includes(REDACTED_PLACEHOLDER), true);
    assert.equal(
      page.url,
      redactUrl("http://127.0.0.1:4173/account?id=42&token=fake-secret-token"),
    );
  });
});

describe("DOM redaction and truncation", () => {
  it("redacts password values, javascript URLs, and hidden tokens", () => {
    const node: CaptureDomNode = {
      tag: "form",
      attributes: {},
      children: [
        {
          tag: "input",
          attributes: { type: "password", name: "password" },
          value: "FakePassword123!",
        },
        {
          tag: "input",
          attributes: { type: "hidden", name: "api_key" },
          value: "fake-api-key-value",
        },
        {
          tag: "a",
          attributes: { href: "javascript:alert(1)" },
          text: "click",
        },
      ],
    };
    const html = sanitizeAndTruncateHtml(node).outerHtmlTruncated;
    assert.equal(html.includes("FakePassword123!"), false);
    assert.equal(html.includes("fake-api-key-value"), false);
    assert.equal(html.includes("javascript:alert(1)"), false);
    assert.equal(html.includes(REDACTED_PLACEHOLDER), true);
    assert.equal(html.includes(REDACTED_JAVASCRIPT_URL), true);
  });

  it("reports htmlBytes as the pre-truncation sanitized size", () => {
    const html = `<div>${"a".repeat(20_000)}</div>`;
    const captured = truncateCapturedHtml(html);
    assert.equal(captured.truncated, true);
    assert.equal(captured.htmlBytes, utf8ByteLength(html));
    assert.ok(utf8ByteLength(captured.outerHtmlTruncated) <= DEBUG_SESSION_LIMITS.outerHtml);
    assert.ok(captured.outerHtmlTruncated.length <= DEBUG_SESSION_LIMITS.outerHtml);
    assert.ok(captured.htmlBytes > utf8ByteLength(captured.outerHtmlTruncated));
  });

  it("does not mark small HTML as truncated", () => {
    const html = '<button class="primary">Save</button>';
    const captured = truncateCapturedHtml(html);
    assert.equal(captured.truncated, false);
    assert.equal(captured.outerHtmlTruncated, html);
    assert.equal(captured.htmlBytes, utf8ByteLength(html));
  });
});
