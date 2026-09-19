import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSelectorTokens } from "./selector.js";
import {
  cleanStackPath,
  extractSessionSignals,
  extractStackPathCandidates,
  normalizeSearchText,
  pathSegmentsFromUrl,
  resolveStackPathAgainstFolders,
  textVariants,
} from "./signals.js";
import { createProjectIntelligenceSession } from "./test-fixtures/session.js";

const FOLDERS = [{ name: "shop", root: "/workspace/shop" }];

describe("route candidate generation", () => {
  it("extracts useful path segments from a page URL", () => {
    assert.deepEqual(pathSegmentsFromUrl("https://localhost:3000/checkout?page=2"), ["checkout"]);
    assert.deepEqual(pathSegmentsFromUrl("https://localhost:3000/api/checkout"), [
      "api",
      "checkout",
    ]);
  });

  it("does not treat query secrets as path segments", () => {
    const segments = pathSegmentsFromUrl(
      "https://localhost:3000/checkout?token=fake-network-token",
    );
    assert.equal(segments.includes("fake-network-token"), false);
    assert.equal(segments.includes("token"), false);
  });
});

describe("selector normalization", () => {
  it("extracts id, class, and data-testid tokens", () => {
    const tokens = normalizeSelectorTokens('button#buy-now.buy-now[data-testid="buy-now"]');
    assert.deepEqual(tokens.ids, ["buy-now"]);
    assert.deepEqual(tokens.classes, ["buy-now"]);
    assert.deepEqual(tokens.testIds, ["buy-now"]);
  });

  it("drops generated class hashes", () => {
    const tokens = normalizeSelectorTokens("button.css-ab12cd._ngcontent-abc");
    assert.equal(tokens.classes.includes("css-ab12cd"), false);
    assert.equal(tokens.classes.includes("_ngcontent-abc"), false);
  });
});

describe("text normalization", () => {
  it("normalizes whitespace and builds weak variants", () => {
    assert.equal(normalizeSearchText("  Buy   now "), "buy now");
    const variants = textVariants("Buy now");
    assert.equal(variants.includes("buy now"), true);
    assert.equal(variants.includes("BuyNow") || variants.includes("buynow"), true);
    assert.equal(variants.includes("buy-now"), true);
  });
});

describe("network candidate generation", () => {
  it("uses network URL path segments from a session", () => {
    const signals = extractSessionSignals(createProjectIntelligenceSession(), FOLDERS);
    assert.equal(signals.networkSegments.includes("checkout"), true);
    assert.equal(signals.networkSegments.includes("[REDACTED]"), false);
  });
});

describe("console stack path extraction", () => {
  it("extracts a workspace-relative source path and line", () => {
    const hits = extractStackPathCandidates(
      "TypeError: x\n    at BuyNowButton (src/components/BuyNowButton.tsx:3:17)",
    );
    assert.equal(hits[0]?.rawPath, "src/components/BuyNowButton.tsx");
    assert.equal(hits[0]?.line, 3);
    assert.equal(cleanStackPath("webpack://./src/app/page.tsx?t=1"), "src/app/page.tsx");
  });

  it("rejects malicious browser paths that escape the workspace", () => {
    assert.equal(resolveStackPathAgainstFolders("../../etc/passwd", FOLDERS), undefined);
    assert.equal(resolveStackPathAgainstFolders("/etc/passwd", FOLDERS), undefined);
    assert.equal(resolveStackPathAgainstFolders("C:/Windows/System32/cmd.ts", FOLDERS), undefined);
    assert.equal(resolveStackPathAgainstFolders("//evil/share/secret.ts", FOLDERS), undefined);
    assert.equal(
      resolveStackPathAgainstFolders("src/components/BuyNowButton.tsx", FOLDERS)?.relativePath,
      "src/components/BuyNowButton.tsx",
    );
  });

  it("ignores unsafe stack frames from the fixture session", () => {
    const signals = extractSessionSignals(createProjectIntelligenceSession(), FOLDERS);
    assert.equal(signals.stackHits.length, 1);
    assert.equal(signals.stackHits[0]?.relativePath, "src/components/BuyNowButton.tsx");
    assert.equal(signals.stackHits[0]?.line, 3);
  });
});
