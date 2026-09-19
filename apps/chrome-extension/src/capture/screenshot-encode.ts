import { SCREENSHOT_LIMITS } from "@browser-debug-bridge/schema";
import type { CapturedRect } from "./messages.js";
import {
  computeCropRect,
  isWithinByteLimit,
  scaleToMax,
} from "./screenshot-geometry.js";
import { createScreenshotMetadata, sha256Hex } from "./screenshot.js";

const JPEG_QUALITY_STEPS = [SCREENSHOT_LIMITS.jpegQuality, 0.65, 0.5, 0.35] as const;
const SETTLE_MS = 50;

export interface EncodedScreenshot {
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
  metadata: ReturnType<typeof createScreenshotMetadata>;
}

export interface TabScreenshotAdapter {
  captureVisiblePng(windowId: number): Promise<string>;
}

export const chromeTabScreenshotAdapter: TabScreenshotAdapter = {
  async captureVisiblePng(windowId: number): Promise<string> {
    return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function canvasToJpeg(
  canvas: OffscreenCanvas,
  quality: number,
): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function encodeCroppedJpeg(input: {
  source: ImageBitmap;
  crop: { sx: number; sy: number; sw: number; sh: number };
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
}): Promise<{ bytes: Uint8Array; width: number; height: number } | undefined> {
  const scaled = scaleToMax(input.crop.sw, input.crop.sh, input.maxWidth, input.maxHeight);
  const canvas = new OffscreenCanvas(scaled.width, scaled.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    return undefined;
  }
  context.drawImage(
    input.source,
    input.crop.sx,
    input.crop.sy,
    input.crop.sw,
    input.crop.sh,
    0,
    0,
    scaled.width,
    scaled.height,
  );

  for (const quality of JPEG_QUALITY_STEPS) {
    const bytes = await canvasToJpeg(canvas, quality);
    if (isWithinByteLimit(bytes.byteLength, input.maxBytes)) {
      return { bytes, width: scaled.width, height: scaled.height };
    }
  }
  return undefined;
}

export async function captureCroppedScreenshot(input: {
  adapter: TabScreenshotAdapter;
  windowId: number;
  rect: CapturedRect;
  viewport: { width: number; height: number };
  settleMs?: number;
}): Promise<
  | { ok: true; value: EncodedScreenshot }
  | { ok: false; reason: "not-visible" | "too-large" | "capture" }
> {
  try {
    await delay(input.settleMs ?? SETTLE_MS);
    const dataUrl = await input.adapter.captureVisiblePng(input.windowId);
    const bitmap = await dataUrlToBitmap(dataUrl);
    try {
      const crop = computeCropRect(
        { width: bitmap.width, height: bitmap.height },
        input.viewport,
        input.rect,
      );
      if (crop === undefined) {
        return { ok: false, reason: "not-visible" };
      }
      const encoded = await encodeCroppedJpeg({
        source: bitmap,
        crop,
        maxWidth: SCREENSHOT_LIMITS.maxWidth,
        maxHeight: SCREENSHOT_LIMITS.maxHeight,
        maxBytes: SCREENSHOT_LIMITS.maxBytes,
      });
      if (encoded === undefined) {
        return { ok: false, reason: "too-large" };
      }
      const sha256 = await sha256Hex(encoded.bytes);
      return {
        ok: true,
        value: {
          ...encoded,
          sha256,
          metadata: createScreenshotMetadata({
            width: encoded.width,
            height: encoded.height,
            sha256,
          }),
        },
      };
    } finally {
      bitmap.close();
    }
  } catch {
    return { ok: false, reason: "capture" };
  }
}
