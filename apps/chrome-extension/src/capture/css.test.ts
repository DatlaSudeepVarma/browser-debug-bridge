import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEBUG_SESSION_LIMITS } from "@browser-debug-bridge/schema";
import {
  boundMatchedRuleSummaries,
  filterComputedSubset,
  isAllowlistedStyleName,
  pickComputedStyles,
  sanitizeStyleValue,
} from "./css.js";
import { COMPUTED_STYLE_ALLOWLIST } from "./limits.js";

describe("computed CSS allowlist", () => {
  it("captures only allowlisted properties", () => {
    const subset = pickComputedStyles((name) => {
      if (name === "display") {
        return "flex";
      }
      if (name === "color") {
        return "rgb(0, 0, 0)";
      }
      return "";
    });
    assert.deepEqual(subset, {
      display: "flex",
      color: "rgb(0, 0, 0)",
    });
    assert.equal("background-image" in subset, false);
    assert.equal(isAllowlistedStyleName("display"), true);
    assert.equal(isAllowlistedStyleName("background-image"), false);
  });

  it("drops unknown keys when filtering a raw style record", () => {
    const subset = filterComputedSubset({
      display: "block",
      "background-image": "url(https://example.test/secret.png)",
      evil: "javascript:alert(1)",
    });
    assert.deepEqual(subset, { display: "block" });
  });

  it("redacts javascript and data values", () => {
    assert.equal(sanitizeStyleValue("javascript:alert(1)"), "[REDACTED]");
    assert.equal(sanitizeStyleValue("url(data:image/png;base64,aaa)"), "[REDACTED]");
    assert.equal(sanitizeStyleValue("  "), undefined);
  });

  it("keeps the allowlist centralized and within the schema property cap", () => {
    assert.ok(COMPUTED_STYLE_ALLOWLIST.includes("display"));
    assert.ok(COMPUTED_STYLE_ALLOWLIST.length <= DEBUG_SESSION_LIMITS.computedStyleProperties);
  });
});

describe("matched-rule summaries", () => {
  it("bounds count, selector length, and property names", () => {
    const rules = Array.from({ length: 40 }, (_, index) => ({
      selector: `button.primary-${String(index)}`,
      properties: ["display", "padding", "color", "background-image"],
    }));
    const summaries = boundMatchedRuleSummaries(rules);
    assert.equal(summaries.length, DEBUG_SESSION_LIMITS.matchedRuleSummaries);
    assert.equal(summaries[0]?.originHint, "display,padding,color");
    assert.equal(summaries[0]?.originHint?.includes("background-image"), false);
    const longSelector = boundMatchedRuleSummaries([
      {
        selector: "a".repeat(DEBUG_SESSION_LIMITS.cssSelector + 20),
        properties: ["display"],
      },
    ]);
    assert.ok((longSelector[0]?.selector.length ?? 0) <= DEBUG_SESSION_LIMITS.cssSelector);
  });
});
