import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  SCREENSHOT_MISMATCH_MESSAGE,
  SCREENSHOT_MISSING_MESSAGE,
  formatScreenshotDescription,
  prepareScreenshotPreview,
} from "./screenshot-view.js";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const JPEG_SHA256 = createHash("sha256").update(JPEG).digest("hex");

describe("screenshot preview", () => {
  it("describes dimensions and crop without the image bytes", () => {
    assert.equal(formatScreenshotDescription({ width: 800, height: 600, cropped: true }), "800×600, cropped");
    assert.equal(formatScreenshotDescription({ width: 32, height: 32, cropped: false }), "32×32, full frame");
  });

  it("refuses a session that has no stored image", () => {
    const preview = prepareScreenshotPreview({ expectedSha256: JPEG_SHA256, bytes: undefined });
    assert.equal(preview.status, "unavailable");
    if (preview.status === "unavailable") {
      assert.equal(preview.message, SCREENSHOT_MISSING_MESSAGE);
    }
  });

  it("refuses bytes whose hash or format does not match the session", () => {
    const wrongHash = prepareScreenshotPreview({ expectedSha256: "ab".repeat(32), bytes: JPEG });
    assert.equal(wrongHash.status, "unavailable");
    if (wrongHash.status === "unavailable") {
      assert.equal(wrongHash.message, SCREENSHOT_MISMATCH_MESSAGE);
    }
    const notJpeg = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const pngHash = createHash("sha256").update(notJpeg).digest("hex");
    const wrongType = prepareScreenshotPreview({ expectedSha256: pngHash, bytes: notJpeg });
    assert.equal(wrongType.status, "unavailable");
  });

  it("builds a script-free local preview when the JPEG matches", () => {
    const preview = prepareScreenshotPreview({ expectedSha256: JPEG_SHA256, bytes: JPEG });
    assert.equal(preview.status, "ready");
    if (preview.status !== "ready") {
      return;
    }
    assert.equal(preview.html.includes("<script"), false);
    assert.equal(preview.html.includes("data:image/jpeg;base64,"), true);
    assert.equal(preview.html.includes("default-src 'none'"), true);
  });
});
