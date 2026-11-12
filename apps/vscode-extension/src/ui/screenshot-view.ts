import { createHash, timingSafeEqual } from "node:crypto";
import { SCREENSHOT_LIMITS, type ScreenshotMetadata } from "@browser-debug-bridge/schema";

export const SCREENSHOT_MISSING_MESSAGE = "No screenshot image is stored for this session.";
export const SCREENSHOT_MISMATCH_MESSAGE = "The stored screenshot does not match this session.";

export type ScreenshotPreview =
  | { status: "ready"; html: string }
  | { status: "unavailable"; message: string };

export function formatScreenshotDescription(
  screenshot: Pick<ScreenshotMetadata, "width" | "height" | "cropped">,
): string {
  const frame = screenshot.cropped ? "cropped" : "full frame";
  return `${String(screenshot.width)}×${String(screenshot.height)}, ${frame}`;
}

export function prepareScreenshotPreview(input: {
  expectedSha256: string;
  bytes: Uint8Array | undefined;
}): ScreenshotPreview {
  const bytes = input.bytes;
  if (bytes === undefined || bytes.byteLength === 0) {
    return { status: "unavailable", message: SCREENSHOT_MISSING_MESSAGE };
  }
  if (
    bytes.byteLength > SCREENSHOT_LIMITS.maxBytes ||
    !isJpeg(bytes) ||
    !hashMatches(input.expectedSha256, bytes)
  ) {
    return { status: "unavailable", message: SCREENSHOT_MISMATCH_MESSAGE };
  }
  return { status: "ready", html: screenshotHtml(Buffer.from(bytes).toString("base64")) };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hashMatches(expected: string, bytes: Uint8Array): boolean {
  const digest = Buffer.from(createHash("sha256").update(bytes).digest("hex"));
  const expectedBytes = Buffer.from(expected);
  if (digest.length !== expectedBytes.length || expectedBytes.length === 0) {
    return false;
  }
  return timingSafeEqual(digest, expectedBytes);
}

function screenshotHtml(base64: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
<title>Screenshot</title>
</head>
<body style="margin:0;background:#1e1e1e;">
<img alt="Captured screenshot" style="max-width:100%;height:auto;display:block;" src="data:image/jpeg;base64,${base64}" />
</body>
</html>`;
}
