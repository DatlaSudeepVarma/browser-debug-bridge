import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEBUG_SESSION_LIMITS } from "@browser-debug-bridge/schema";
import { CAPTURE_LIMITS } from "./limits.js";
import {
  boundClasses,
  boundSelector,
  buildCssSelector,
  canUseIdSelector,
  isUnsafeIdentifier,
  selectorForElement,
  type SelectorSource,
} from "./selectors.js";

function source(overrides: Partial<SelectorSource> & Pick<SelectorSource, "tag">): SelectorSource {
  return {
    classes: [],
    attributes: {},
    ...overrides,
  };
}

describe("selector generation", () => {
  it("generates a useful CSS selector from mixed attributes", () => {
    const selector = selectorForElement(
      source({
        tag: "button",
        classes: ["primary", "save"],
        attributes: { type: "submit" },
      }),
    );
    assert.equal(selector, 'button[type="submit"]');
  });

  it("prefers a stable id selector", () => {
    const selector = selectorForElement(
      source({
        tag: "button",
        id: "checkout-submit",
        classes: ["primary"],
        attributes: { "data-testid": "pay" },
      }),
    );
    assert.equal(selector, "#checkout-submit");
    assert.equal(canUseIdSelector("checkout-submit"), true);
  });

  it("uses a class combination when no stable id or data attribute exists", () => {
    const selector = selectorForElement(
      source({
        tag: "button",
        classes: ["primary", "save"],
      }),
    );
    assert.equal(selector, "button.primary.save");
  });

  it("falls back to a bounded structural selector", () => {
    const selector = selectorForElement(
      source({
        tag: "div",
        nthOfType: 3,
      }),
    );
    assert.equal(selector, "div:nth-of-type(3)");
  });

  it("does not emit high nth-of-type structural selectors", () => {
    const selector = selectorForElement(
      source({
        tag: "div",
        nthOfType: 37,
      }),
    );
    assert.equal(selector, "div");
    assert.equal(selector.includes(":nth-child(37)"), false);
    assert.equal(selector.includes(":nth-of-type(37)"), false);
  });

  it("prefers a useful data-* attribute over classes", () => {
    const selector = selectorForElement(
      source({
        tag: "button",
        classes: ["css-module-hash"],
        attributes: { "data-testid": "pricing-cta" },
      }),
    );
    assert.equal(selector, 'button[data-testid="pricing-cta"]');
  });

  it("bounds selector length", () => {
    const longClass = "c".repeat(DEBUG_SESSION_LIMITS.cssSelector);
    const selector = boundSelector([
      "main",
      `section.${longClass}`,
      "div.card",
      "button",
    ]);
    assert.ok(selector.length <= DEBUG_SESSION_LIMITS.cssSelector);
    assert.equal(selector.includes("button"), true);
  });

  it("stops a selector chain at a stable id", () => {
    const selector = buildCssSelector([
      source({ tag: "main" }),
      source({ tag: "section", id: "pricing" }),
      source({ tag: "button", classes: ["primary"] }),
    ]);
    assert.equal(selector, "#pricing > button.primary");
  });
});

describe("identifier safety", () => {
  it("rejects token, email, UUID, and session-like ids", () => {
    assert.equal(isUnsafeIdentifier("access-token"), true);
    assert.equal(isUnsafeIdentifier("user@example.com"), true);
    assert.equal(isUnsafeIdentifier("550e8400-e29b-41d4-a716-446655440000"), true);
    assert.equal(isUnsafeIdentifier("session-id"), true);
    assert.equal(isUnsafeIdentifier("checkout-submit"), false);
  });

  it("omits unsafe ids from id selectors", () => {
    assert.equal(canUseIdSelector("session-token"), false);
    assert.equal(
      selectorForElement(
        source({
          tag: "div",
          id: "session-token",
          classes: ["card"],
        }),
      ),
      "div.card",
    );
  });
});

describe("class bounds", () => {
  it("limits class count and total length", () => {
    const many = Array.from({ length: 40 }, (_, index) => `cls${String(index)}`);
    const bounded = boundClasses(many);
    assert.ok(bounded.length <= DEBUG_SESSION_LIMITS.classCount);
    assert.ok(bounded.join("").length <= 512);
  });

  it("drops obviously sensitive class names", () => {
    const bounded = boundClasses(["primary", "token", "save"]);
    assert.deepEqual(bounded, ["primary", "save"]);
  });
});

describe("capture limits", () => {
  it("matches DebugSessionV1 schema limits", () => {
    const keys = Object.keys(CAPTURE_LIMITS) as Array<keyof typeof CAPTURE_LIMITS>;
    for (const key of keys) {
      assert.equal(
        CAPTURE_LIMITS[key],
        DEBUG_SESSION_LIMITS[key],
        `CAPTURE_LIMITS.${key} must match DEBUG_SESSION_LIMITS.${key}`,
      );
    }
  });
});
