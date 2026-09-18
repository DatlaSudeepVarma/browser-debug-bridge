import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REDACTED_DATA_URL,
  REDACTED_JAVASCRIPT_URL,
  REDACTED_PLACEHOLDER,
  UNPARSEABLE_URL_PLACEHOLDER,
  inspectWorkspacePath,
  isJwtLike,
  isSafeWorkspacePath,
  redactDomElement,
  redactSensitiveText,
  redactUrl,
} from "./index.js";

const FAKE_JWT =
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlLXVzZXIiLCJleGFtcGxlIjp0cnVlfQ.fake-signature";

describe("URL redaction", () => {
  it("redacts token query parameters and preserves routing", () => {
    const redacted = redactUrl(
      "https://localhost:3000/profile?id=42&token=SECRET",
    );
    assert.equal(
      redacted,
      "https://localhost:3000/profile?id=42&token=[REDACTED]",
    );
    assert.equal(redacted.includes("SECRET"), false);
  });

  it("redacts JWT-like values even when the parameter name is generic", () => {
    const redacted = redactUrl(
      `https://localhost:3000/callback?state=ok&q=${FAKE_JWT}`,
    );
    assert.equal(redacted.includes(FAKE_JWT), false);
    assert.match(redacted, /state=ok/);
    assert.match(redacted, /q=\[REDACTED\]/);
  });

  it("redacts API key parameters", () => {
    const redacted = redactUrl(
      "https://api.localhost/search?api_key=fake-api-key-example&q=button",
    );
    assert.equal(redacted.includes("fake-api-key-example"), false);
    assert.match(redacted, /api_key=\[REDACTED\]/);
    assert.match(redacted, /q=button/);
  });

  it("redacts javascript URLs", () => {
    assert.equal(redactUrl("javascript:alert(1)"), REDACTED_JAVASCRIPT_URL);
  });

  it("redacts data URLs", () => {
    assert.equal(
      redactUrl("data:text/plain;base64,ZmFrZQ=="),
      REDACTED_DATA_URL,
    );
  });

  it("keeps safe URLs useful", () => {
    assert.equal(
      redactUrl("https://localhost:3000/profile?id=42"),
      "https://localhost:3000/profile?id=42",
    );
  });

  it("handles URL parsing failures without returning the original input", () => {
    const original = "http://[broken";
    assert.equal(redactUrl(original), UNPARSEABLE_URL_PLACEHOLDER);
  });
});

describe("sensitive text", () => {
  it("detects JWT-like values", () => {
    assert.equal(isJwtLike(FAKE_JWT), true);
    assert.equal(isJwtLike("not-a-jwt"), false);
  });

  it("redacts JWT-like values inside text", () => {
    const redacted = redactSensitiveText(`header ${FAKE_JWT} footer`);
    assert.equal(redacted.includes(FAKE_JWT), false);
    assert.equal(redacted, `header ${REDACTED_PLACEHOLDER} footer`);
  });
});

describe("DOM redaction", () => {
  it("never returns password field values", () => {
    const redacted = redactDomElement({
      tag: "input",
      attributes: { type: "password", name: "password", value: "hunter2" },
      value: "hunter2",
    });
    assert.equal(redacted.value, REDACTED_PLACEHOLDER);
    assert.equal(redacted.attributes.value, REDACTED_PLACEHOLDER);
    assert.equal(JSON.stringify(redacted).includes("hunter2"), false);
  });

  it("redacts authorization-like attributes", () => {
    const redacted = redactDomElement({
      tag: "div",
      attributes: { authorization: "Bearer fake-token", id: "panel" },
    });
    assert.equal(redacted.attributes.authorization, REDACTED_PLACEHOLDER);
    assert.equal(redacted.attributes.id, "panel");
  });

  it("redacts hidden token-like values", () => {
    const redacted = redactDomElement({
      tag: "input",
      attributes: { type: "hidden", name: "access_token" },
      value: "fake-hidden-token",
    });
    assert.equal(redacted.value, REDACTED_PLACEHOLDER);
  });

  it("redacts payment autocomplete fields", () => {
    const redacted = redactDomElement({
      tag: "input",
      attributes: { type: "text", autocomplete: "cc-number" },
      value: "4111111111111111",
    });
    assert.equal(redacted.value, REDACTED_PLACEHOLDER);
    assert.equal(JSON.stringify(redacted).includes("4111111111111111"), false);
  });

  it("redacts javascript and data URLs in DOM attributes", () => {
    const redacted = redactDomElement({
      tag: "a",
      attributes: {
        href: "javascript:alert(1)",
        src: "data:text/html,fake",
      },
    });
    assert.equal(redacted.attributes.href, REDACTED_JAVASCRIPT_URL);
    assert.equal(redacted.attributes.src, REDACTED_DATA_URL);
  });
});

describe("workspace path safety", () => {
  const workspace = "/workspace";

  it("rejects traversal paths", () => {
    const inspection = inspectWorkspacePath(workspace, "../secret.ts");
    assert.equal(inspection.safe, false);
    if (!inspection.safe) {
      assert.equal(inspection.reason, "path-traversal");
    }
  });

  it("rejects absolute paths outside the workspace", () => {
    assert.equal(isSafeWorkspacePath(workspace, "/etc/passwd"), false);
    assert.equal(
      isSafeWorkspacePath("C:/workspace", "C:/Windows/System32/drivers/etc/hosts"),
      false,
    );
  });

  it("rejects .env files", () => {
    assert.equal(isSafeWorkspacePath(workspace, ".env"), false);
    assert.equal(isSafeWorkspacePath(workspace, "config/.env.local"), false);
  });

  it("rejects private key files", () => {
    assert.equal(isSafeWorkspacePath(workspace, "id_rsa"), false);
    assert.equal(isSafeWorkspacePath(workspace, ".ssh/id_ed25519"), false);
  });

  it("rejects pem and credentials files", () => {
    assert.equal(isSafeWorkspacePath(workspace, "certs/service.pem"), false);
    assert.equal(isSafeWorkspacePath(workspace, "credentials.json"), false);
  });

  it("allows safe source paths", () => {
    const inspection = inspectWorkspacePath(
      workspace,
      "packages/schema/src/index.ts",
    );
    assert.equal(inspection.safe, true);
    if (inspection.safe) {
      assert.equal(inspection.relativePath, "packages/schema/src/index.ts");
    }
    assert.equal(isSafeWorkspacePath(workspace, "src/extension.ts"), true);
    assert.equal(
      isSafeWorkspacePath(workspace, "/workspace/apps/chrome-extension/src/background.ts"),
      true,
    );
  });
});
