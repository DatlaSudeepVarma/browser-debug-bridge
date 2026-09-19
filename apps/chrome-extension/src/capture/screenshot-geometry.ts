import type { CapturedRect } from "./messages.js";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface ScaledSize {
  width: number;
  height: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp the selected-element rect to the visible viewport.
 * Does not scroll. Returns undefined when nothing visible remains.
 */
export function clampVisibleRect(
  rect: CapturedRect,
  viewport: ViewportSize,
): CapturedRect | undefined {
  const viewportWidth = Math.max(0, finite(viewport.width));
  const viewportHeight = Math.max(0, finite(viewport.height));
  if (viewportWidth < 1 || viewportHeight < 1) {
    return undefined;
  }

  const left = finite(rect.x);
  const top = finite(rect.y);
  const right = left + Math.max(0, finite(rect.width));
  const bottom = top + Math.max(0, finite(rect.height));

  const x = clamp(left, 0, viewportWidth);
  const y = clamp(top, 0, viewportHeight);
  const x2 = clamp(right, 0, viewportWidth);
  const y2 = clamp(bottom, 0, viewportHeight);
  const width = x2 - x;
  const height = y2 - y;
  if (width < 0.5 || height < 0.5) {
    return undefined;
  }
  return { x, y, width, height };
}

/**
 * Map a viewport-space element rect onto screenshot pixels and clamp to the image.
 */
export function computeCropRect(
  image: ImageSize,
  viewport: ViewportSize,
  elementRect: CapturedRect,
): CropRect | undefined {
  const imageWidth = Math.max(0, Math.floor(finite(image.width)));
  const imageHeight = Math.max(0, Math.floor(finite(image.height)));
  if (imageWidth < 1 || imageHeight < 1) {
    return undefined;
  }

  const visible = clampVisibleRect(elementRect, viewport);
  if (visible === undefined) {
    return undefined;
  }

  const viewportWidth = Math.max(1, finite(viewport.width));
  const viewportHeight = Math.max(1, finite(viewport.height));
  const scaleX = imageWidth / viewportWidth;
  const scaleY = imageHeight / viewportHeight;

  let sx = Math.round(visible.x * scaleX);
  let sy = Math.round(visible.y * scaleY);
  let sw = Math.round(visible.width * scaleX);
  let sh = Math.round(visible.height * scaleY);

  sx = clamp(sx, 0, imageWidth - 1);
  sy = clamp(sy, 0, imageHeight - 1);
  sw = clamp(Math.max(1, sw), 1, imageWidth - sx);
  sh = clamp(Math.max(1, sh), 1, imageHeight - sy);
  return { sx, sy, sw, sh };
}

/**
 * Scale down to max width/height. Never upscales. Preserves aspect ratio.
 */
export function scaleToMax(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): ScaledSize {
  const sourceWidth = Math.max(1, Math.round(finite(width, 1)));
  const sourceHeight = Math.max(1, Math.round(finite(height, 1)));
  const capWidth = Math.max(1, Math.round(finite(maxWidth, 1)));
  const capHeight = Math.max(1, Math.round(finite(maxHeight, 1)));
  const scale = Math.min(1, capWidth / sourceWidth, capHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function isWithinByteLimit(byteLength: number, maxBytes: number): boolean {
  return Number.isFinite(byteLength) && byteLength > 0 && byteLength <= maxBytes;
}
