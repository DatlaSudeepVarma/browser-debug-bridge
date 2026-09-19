import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDeduper,
  createNetworkEntry,
  createNetworkFingerprint,
  isBridgeTrafficUrl,
  normalizeHttpMethod,
  shouldCaptureNetworkFailure,
} from "./entries.js";
import { MAX_NETWORK_ERROR_LENGTH, MAX_NETWORK_URL_LENGTH } from "./limits.js";

describe("network failure selection", () => {
  it("captures HTTP 400", () => {
    assert.equal(shouldCaptureNetworkFailure({ status: 400 }), true);
    assert.equal(createNetworkEntry({ url: "/api/x", method: "GET", status: 400 })?.status, 400);
  });

  it("captures HTTP 404", () => {
    assert.equal(createNetworkEntry({ url: "/missing", method: "GET", status: 404 })?.status, 404);
  });

  it("captures HTTP 500", () => {
    assert.equal(createNetworkEntry({ url: "/api/fail", method: "GET", status: 500 })?.status, 500);
  });

  it("ignores HTTP 200", () => {
    assert.equal(shouldCaptureNetworkFailure({ status: 200 }), false);
    assert.equal(createNetworkEntry({ url: "/api/ok", method: "GET", status: 200 }), undefined);
  });

  it("ignores HTTP 304", () => {
    assert.equal(shouldCaptureNetworkFailure({ status: 304 }), false);
    assert.equal(createNetworkEntry({ url: "/api/cached", method: "GET", status: 304 }), undefined);
  });

  it("captures fetch rejections", () => {
    const entry = createNetworkEntry({
      url: "http://127.0.0.1:9/unavailable",
      method: "GET",
      failed: true,
      error: "Failed to fetch",
      resourceType: "fetch",
    });
    assert.equal(entry?.error, "Failed to fetch");
    assert.equal(entry?.resourceType, "fetch");
    assert.equal(entry?.status, undefined);
  });

  it("captures XHR errors", () => {
    const entry = createNetworkEntry({
      url: "/api/xhr",
      method: "POST",
      failed: true,
      error: "Network request failed",
      resourceType: "xmlhttprequest",
    });
    assert.equal(entry?.resourceType, "xmlhttprequest");
    assert.equal(entry?.error, "Network request failed");
  });
});

describe("network method and size limits", () => {
  it("normalizes methods to uppercase and falls back safely", () => {
    assert.equal(normalizeHttpMethod("post"), "POST");
    assert.equal(normalizeHttpMethod("GET"), "GET");
    assert.equal(normalizeHttpMethod("not-a-method"), "GET");
    assert.equal(normalizeHttpMethod(undefined), "GET");
  });

  it("truncates URLs", () => {
    const url = `https://localhost/path?q=${"x".repeat(MAX_NETWORK_URL_LENGTH)}`;
    const entry = createNetworkEntry({ url, method: "GET", status: 404 });
    assert.ok(entry);
    assert.equal(entry?.urlRedacted.length, MAX_NETWORK_URL_LENGTH);
  });

  it("truncates error text", () => {
    const entry = createNetworkEntry({
      url: "/api/x",
      method: "GET",
      failed: true,
      error: "e".repeat(MAX_NETWORK_ERROR_LENGTH + 40),
    });
    assert.equal(entry?.error?.length, MAX_NETWORK_ERROR_LENGTH);
  });
});

describe("network isolation", () => {
  it("excludes the local VS Code bridge URL", () => {
    assert.equal(isBridgeTrafficUrl("http://127.0.0.1:17321/sessions"), true);
    assert.equal(isBridgeTrafficUrl("http://localhost:17321/health"), true);
    assert.equal(
      createNetworkEntry({
        url: "http://127.0.0.1:17321/sessions",
        method: "POST",
        status: 401,
      }),
      undefined,
    );
    assert.equal(isBridgeTrafficUrl("http://127.0.0.1:4173/api/debug/not-found"), false);
  });

  it("does not keep request bodies, response bodies, or headers", () => {
    const raw = {
      url: "/api/x",
      method: "POST",
      status: 500,
      body: "SECRET_BODY",
      requestBody: "SECRET_REQUEST",
      responseBody: "SECRET_RESPONSE",
      headers: { Authorization: "Bearer secret" },
    };
    const entry = createNetworkEntry(raw);
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes("SECRET_BODY"), false);
    assert.equal(serialized.includes("SECRET_REQUEST"), false);
    assert.equal(serialized.includes("SECRET_RESPONSE"), false);
    assert.equal(serialized.includes("Authorization"), false);
    assert.equal(serialized.includes("Bearer"), false);
    assert.equal("body" in (entry ?? {}), false);
    assert.equal("headers" in (entry ?? {}), false);
  });
});

describe("network duplicate suppression", () => {
  it("drops identical method/url/status events in the dedup window", () => {
    const entry = createNetworkEntry({ url: "/api/x", method: "GET", status: 404 });
    assert.ok(entry);
    if (entry === undefined) {
      return;
    }
    const fingerprint = createNetworkFingerprint(entry);
    const deduper = createDeduper(250, 16);
    assert.equal(deduper.seen(fingerprint, 1_000), false);
    assert.equal(deduper.seen(fingerprint, 1_100), true);
    assert.equal(deduper.seen(fingerprint, 1_400), false);
  });
});
