import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createScreenshotMetadata, sha256Hex } from "./screenshot.js";

describe("screenshot metadata construction", () => {
  it("records JPEG metadata for the final cropped image", () => {
    const metadata = createScreenshotMetadata({
      width: 120,
      height: 40,
      sha256: "cd".repeat(32),
    });
    assert.deepEqual(metadata, {
      mime: "image/jpeg",
      width: 120,
      height: 40,
      sha256: "cd".repeat(32),
      cropped: true,
    });
  });
});

describe("SHA-256 calculation", () => {
  it("hashes the exact provided bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);
    const digest = await sha256Hex(bytes);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digest, await sha256Hex(bytes));
    assert.notEqual(digest, await sha256Hex(new Uint8Array([0xff, 0xd8, 0xff, 0x01])));
  });
});
